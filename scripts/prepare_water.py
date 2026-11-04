"""Explicit FOEN daily lake ingestion and a censored historical recovery comparison."""

import math
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.regional import promote
from weather_modeller.sources import SourceClient
from weather_modeller.storage import write_json

LAKES = {
    "2209": "Lake Zurich",
    "2032": "Lake Constance",
    "2027": "Lake Geneva",
    "2207": "Lake Lucerne",
    "2093": "Lake Thun",
    "2023": "Lake Brienz",
    "2208": "Lake Biel",
    "2154": "Lake Neuchâtel",
    "2022": "Lake Maggiore",
    "2101": "Lake Lugano",
    "2118": "Walensee",
    "2004": "Lake Murten",
    "2017": "Lake Zug",
    "2007": "Lac de Joux",
    "2057": "Lac des Brenets",
    "2031": "Lake Ägeri",
    "2097": "Lake Hallwil",
    "2168": "Lake Sempach",
    "2137": "Lake Baldegg",
    "2088": "Lake Sarnen",
    "2484": "Lake Lauerz",
    "2072": "Lake Sils",
    "2073": "Lake Silvaplana",
    "2066": "Lake St Moritz",
    "2014": "Lake Zurich (Obersee)",
}


def kaplan_meier(rows, horizon=180):
    """Right-censored historical follow-up, not a distribution of recovered cases alone."""
    survival, median = 1.0, None
    for day in sorted({t for t, event in rows if event}):
        at_risk = sum(t >= day for t, _ in rows)
        events = sum(t == day and e for t, e in rows)
        survival *= 1 - events / at_risk
        if median is None and survival <= 0.5:
            median = day
    # A horizon probability is unsupported if nobody was followed that far and survival > 0.
    supported = survival == 0 or any(t >= horizon for t, _ in rows)
    return {"medianDays": median, "recoveredBy180": 1 - survival if supported else None}


def analyse(rows):
    import numpy as np

    lookup = {r[0]: r[1] for r in rows if r[1] is not None}
    if not lookup:
        return {"unavailable": "No daily water levels are available."}
    latest = max(lookup)
    current = lookup[latest]
    current_day = date.fromisoformat(latest)

    # Calendar position in a leap reference year preserves February 29.
    def season(d):
        return (date(2000, d.month, d.day) - date(2000, 1, 1)).days

    baseline = [(date.fromisoformat(d), v) for d, v in lookup.items() if "1991" <= d[:4] <= "2020"]
    bands = []
    for day in range(366):
        matching = [
            (d.year, v)
            for d, v in baseline
            if min(abs(season(d) - day), 366 - abs(season(d) - day)) <= 15
        ]
        if len({y for y, _ in matching}) < 20:
            bands.append(None)
        else:
            bands.append(np.quantile([v for _, v in matching], [0.25, 0.5, 0.75]).tolist())
    band = bands[season(current_day)]
    recent = [
        [d, lookup.get(d), bands[season(date.fromisoformat(d))]]
        for d in sorted(lookup)
        if d >= (current_day - timedelta(days=89)).isoformat()
    ]
    result = {
        "latest": latest,
        "level": current,
        "band": band,
        "recent": recent,
        "baseline": "1991–2020, calendar day ±15 days; middle 50% of observed daily levels; at least 20 distinct years",
    }
    if band is None:
        result["recovery"] = {
            "unavailable": "Not enough historical data for a seasonal comparison."
        }
        return result
    if current >= band[0]:
        result["recovery"] = {
            "state": "within" if current <= band[2] else "above",
            "unavailable": "No low-water recovery estimate: the latest level is not below the usual seasonal range.",
        }
        return result
    deficit = band[0] - current
    followups, cases = [], []
    for year in range(1970, current_day.year):
        try:
            start = date(year, current_day.month, current_day.day)
        except ValueError:
            continue
        initial = lookup.get(start.isoformat())
        initial_band = bands[season(start)]
        if initial is None or initial_band is None:
            continue
        gap = initial_band[0] - initial
        if gap <= 0 or abs(gap - deficit) > max(0.05, deficit * 0.5):
            continue
        streak, followed, recovered = 0, 0, False
        for t in range(1, 181):
            d = start + timedelta(days=t)
            v, b = lookup.get(d.isoformat()), bands[season(d)]
            if d >= date(current_day.year, 1, 1) or v is None or b is None:
                break
            followed = t
            streak = streak + 1 if b[0] <= v <= b[2] else 0
            if streak >= 7:
                recovered = True
                break
        if followed:
            followups.append([followed, recovered])
            cases.append(
                {
                    "start": start.isoformat(),
                    "followupDays": followed,
                    "recovered": recovered,
                    "initialDeficitCm": gap * 100,
                }
            )
    recovery = {
        "state": "below",
        "deficitCm": deficit * 100,
        "matches": len(followups),
        "recovered": sum(e for _, e in followups),
        "horizonDays": 180,
        "cases": cases,
    }
    if len(followups) < 10:
        recovery["unavailable"] = "Too few comparable historical years for a recovery estimate."
    else:
        recovery.update(kaplan_meier(followups))
        rng = np.random.default_rng(20261104)
        boot = [
            kaplan_meier([followups[i] for i in rng.integers(0, len(followups), len(followups))])
            for _ in range(500)
        ]
        finite = [x["medianDays"] for x in boot if x["medianDays"] is not None]
        ordered = sorted(x["medianDays"] if x["medianDays"] is not None else math.inf for x in boot)
        recovery["medianInterval"] = (
            [ordered[12], ordered[487]] if math.isfinite(ordered[487]) else None
        )
        recovery["medianSupportedFraction"] = len(finite) / 500
    result["recovery"] = recovery
    return result


def prepare_into(output):
    now = datetime.now(UTC)
    end_year = now.year
    meta_client = SourceClient(ROOT, refresh=True)
    stations = meta_client.graphql(
        "{ water { observations { stations { no name riverName latitude longitude localX localY coverageFrom coverageTo status } } } }",
        "water-network/stations.json",
    )["stations"]
    output.mkdir(parents=True, exist_ok=True)
    write_json(
        output / "stations.json",
        {"generatedAt": now.isoformat(), "stations": stations, "sources": meta_client.manifest},
        compact=True,
    )

    def lake(item):
        code, label = item
        sources, rows = [], []
        for year in range(1970, end_year + 1, 10):
            stop = min(year + 10, end_year + 1)
            client = SourceClient(ROOT, refresh=stop > end_year)
            query = (
                '{ water { observations { data_1day_mean(where:{station:{no:{_eq:"'
                + code
                + '"}},parameterName:{_eq:"W"},timestamp:{_gte:"'
                + str(year)
                + '-01-01T00:00:00Z",_lt:"'
                + str(stop)
                + '-01-01T00:00:00Z"}}) { timestamp value unitSymbol releaseState } } } }'
            )
            data = client.graphql(query, f"water-network/{code}-{year}.json")["data_1day_mean"]
            for r in data:
                if r["unitSymbol"] not in ("m ü.M.", "m a.s.l."):
                    raise ValueError(f"Unknown water-level datum: {r['unitSymbol']}")
                if r["value"] is not None and not math.isfinite(r["value"]):
                    raise ValueError("Nonfinite lake level")
                stamp = datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00"))
                if stamp >= now:
                    continue
                day = stamp.astimezone(ZoneInfo("Europe/Zurich")).date().isoformat()
                if day >= now.astimezone(ZoneInfo("Europe/Zurich")).date().isoformat():
                    continue
                rows.append([day, r["value"], r["timestamp"], r["releaseState"]])
            sources.extend(client.manifest)
        rows.sort()
        if len({r[0] for r in rows}) != len(rows):
            raise ValueError(f"Duplicate lake day: {code}")
        station = next(s for s in stations if s["no"] == code)
        payload = {
            "schemaVersion": 1,
            "generatedAt": now.isoformat(),
            "station": station,
            "label": label,
            "sources": sources,
            "rows": rows,
            "analysis": analyse(rows),
            "unit": "metres above sea level, provider datum",
            "dayConvention": "Provider interval-start timestamps retained; daily labels use Europe/Zurich",
        }
        write_json(output / f"{code}.json", payload, compact=True)
        print(
            "Prepared lake",
            label,
            len(rows),
            "daily observations; latest",
            payload["analysis"].get("latest"),
            "historical cases",
            payload["analysis"].get("recovery", {}).get("matches", "not applicable"),
            flush=True,
        )
        return {
            "id": code,
            "label": label,
            "lat": station["latitude"],
            "lon": station["longitude"],
            "easting": station["localX"],
            "northing": station["localY"],
        }

    with ThreadPoolExecutor(max_workers=3) as pool:
        lakes = list(pool.map(lake, LAKES.items()))
    write_json(
        output / "manifest.json",
        {
            "schemaVersion": 1,
            "generatedAt": now.isoformat(),
            "lakes": lakes,
            "method": "Seasonal middle-50% band, 1991–2020; historical same-calendar-day deficits within max(5 cm,50% of deficit); one start per year before current year; 7 consecutive days in band; 180-day right-censored Kaplan–Meier follow-up; min10 starts; 500 year-resamples; not weather-conditioned or operational forecast",
        },
        compact=True,
    )


def prepare():
    cache = ROOT / ".cache/water-build"
    cache.mkdir(parents=True, exist_ok=True)
    destination = ROOT / "data/processed/water"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        staged = Path(directory) / "water"
        prepare_into(staged)
        promote(staged, destination)


if __name__ == "__main__":
    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    prepare()
