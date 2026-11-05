"""Fit a frozen pre-2016 lake model and test independent low-water episodes."""

import gzip
import hashlib
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.lake_recovery import (
    low_water_origins,
    recovery_times,
    seasonal_bands,
    simulate,
    summarize,
    train,
    weather_paths,
)
from weather_modeller.lake_weather import hourly_days
from weather_modeller.sources import SourceClient


def historic_level_paths(days, levels, origin, count=400, horizon=90):
    from weather_modeller.lake_recovery import season

    s = season(days[origin])
    eligible = []
    for i, d in enumerate(days):
        distance = abs(season(d) - s)
        if (
            i + horizon < len(days)
            and d.year >= 1990
            and days[i + horizon].year <= 2015
            and min(distance, 366 - distance) <= 15
            and np.isfinite(levels[i : i + horizon + 1]).all()
        ):
            eligible.append(i)
    rng = np.random.default_rng(902)
    return np.stack(
        [
            levels[i + 1 : i + horizon + 1] - levels[i] + levels[origin]
            for i in rng.choice(eligible, count)
        ]
    )


def forecast(client, lake, origin):
    # Previous day's 12 UTC run: published before the next day's retrospective origin.
    params = dict(
        latitude=",".join(str(n["latitude"]) for n in lake["nodes"]),
        longitude=",".join(str(n["longitude"]) for n in lake["nodes"]),
        hourly="precipitation,temperature_2m,et0_fao_evapotranspiration",
        models="ecmwf_ifs",
        run=str(origin) + "T12:00",
        forecast_days=16,
        timeformat="unixtime",
        timezone="UTC",
    )
    url = "https://single-runs-api.open-meteo.com/v1/forecast?" + urlencode(params)
    raw = client.fetch(url, f"lake-recovery/past-{lake['id']}-{origin}.json")
    data = json.loads(raw)
    if not isinstance(data, list) or len(data) != len(lake["nodes"]):
        raise ValueError("Archived forecast locations missing")
    decoded = [hourly_days(d, origin + timedelta(days=1)) for d in data]
    horizon = min(len(d[0]) for d in decoded)
    if horizon < 7:
        raise ValueError("Less than seven archived forecast days")
    return np.stack([d[1][:horizon, 0, :] for d in decoded], axis=1), client.manifest[-1]


def main():
    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    folder = ROOT / "data/reference/lake-recovery"
    inputs = json.loads((folder / "inputs.json").read_text())
    client = SourceClient(ROOT)
    reports = []
    for lake in inputs["lakes"]:
        raw = (folder / lake["history"]["path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != lake["history"]["sha256"]:
            raise ValueError("Model inputs failed checksum")
        rows = json.loads(gzip.decompress(raw))
        days = [date.fromisoformat(r[0]) for r in rows]
        levels = np.array([r[1] if r[1] is not None else np.nan for r in rows])
        weather = np.array([r[2:] for r in rows], dtype=float)
        weights = np.array([n["weight"] for n in lake["nodes"]])
        water = json.loads((ROOT / f"data/processed/water/{lake['id']}.json").read_text())
        baseline_rows = [r for r in water["rows"] if "1970" <= r[0][:4] <= "2009"]
        baseline_raw = gzip.compress(
            json.dumps(baseline_rows, separators=(",", ":"), allow_nan=False).encode(), mtime=0
        )
        baseline_name = f"baseline-{lake['id']}.json.gz"
        (folder / baseline_name).write_bytes(baseline_raw)
        bands = seasonal_bands(baseline_rows, 1970, 2009)
        model, liquid, snow = train(days, levels, weather, weights)
        model["weights"] = weights.tolist()
        model["initialSnow2025"] = snow[-1].tolist()
        name = f"model-{lake['id']}.json"
        model_raw = (json.dumps(model, separators=(",", ":"), allow_nan=False) + "\n").encode()
        (folder / name).write_bytes(model_raw)
        cases = []
        excluded = []
        for i in low_water_origins(days, levels, bands):
            if not np.isfinite(levels[i - 8 : i + 1]).all():
                excluded.append(
                    dict(origin=str(days[i]), reason="Incomplete initial water-level history")
                )
                continue
            followup = levels[i + 1 : i + 91]
            missing = np.flatnonzero(~np.isfinite(followup))
            observed_days = int(missing[0]) if len(missing) else len(followup)
            if observed_days == 0:
                excluded.append(dict(origin=str(days[i]), reason="No observed follow-up"))
                continue
            future = weather_paths(days, weather, i)
            common = (
                model,
                days[i],
                levels[i - 7 : i + 1],
                weather[i - 29 : i + 1],
                snow[i],
                liquid[i - 29 : i + 1],
            )
            paths = simulate(*common, future, weights)
            baseline = historic_level_paths(days, levels, i)
            observed = levels[i + 1 : i + 1 + observed_days][None, :]
            actual = recovery_times(observed, bands, days[i])[0]
            item = dict(
                origin=str(days[i]),
                observedRecoveryDays=int(actual) if np.isfinite(actual) else None,
                observedFollowupDays=observed_days,
                recoveryDays=summarize(paths, bands, days[i])["recoveryDays"],
                seasonalWeather=summarize(paths, bands, days[i])["probabilities"],
                baseline=summarize(baseline, bands, days[i])["probabilities"],
                levelMaeCm=float(
                    np.mean(np.abs(np.median(paths[:, :observed_days], axis=0) - observed[0])) * 100
                ),
                coverage90=float(
                    np.mean(
                        (observed[0] >= np.quantile(paths[:, :observed_days], 0.05, axis=0))
                        & (observed[0] <= np.quantile(paths[:, :observed_days], 0.95, axis=0))
                    )
                ),
            )
            if days[i] >= date(2024, 3, 2):
                real_forecast, source = forecast(client, lake, days[i])
                with_forecast = future.copy()
                h = len(real_forecast)
                with_forecast[:, :h] = real_forecast
                tested = simulate(*common, with_forecast, weights)
                item["archivedForecast"] = dict(
                    forecastDays=h,
                    weather=real_forecast.tolist(),
                    source=source,
                    run=str(days[i]) + "T12:00Z",
                    probabilities=summarize(tested, bands, days[i])["probabilities"],
                    levelMaeCm=float(
                        np.mean(np.abs(np.median(tested[:, :observed_days], axis=0) - observed[0]))
                        * 100
                    ),
                    coverage90=float(
                        np.mean(
                            (observed[0] >= np.quantile(tested[:, :observed_days], 0.05, axis=0))
                            & (observed[0] <= np.quantile(tested[:, :observed_days], 0.95, axis=0))
                        )
                    ),
                )
            cases.append(item)
            print(
                lake["id"],
                item["origin"],
                item["observedRecoveryDays"],
                "forecast",
                "archivedForecast" in item,
                flush=True,
            )
        metrics = []
        for horizon in (14, 30, 60, 90):

            def score(group, archive=False, cases=cases, horizon=horizon):
                errors = []
                for case in cases:
                    if archive and "archivedForecast" not in case:
                        continue
                    if case["observedFollowupDays"] < horizon and (
                        case["observedRecoveryDays"] is None
                        or case["observedRecoveryDays"] > horizon
                    ):
                        continue
                    prediction = next(
                        r["probability"]
                        for r in (
                            case["archivedForecast"]["probabilities"] if archive else case[group]
                        )
                        if r["days"] == horizon
                    )
                    observed = (
                        case["observedRecoveryDays"] is not None
                        and case["observedRecoveryDays"] <= horizon
                    )
                    errors.append((prediction - int(observed)) ** 2)
                return float(np.mean(errors)) if errors else None

            metrics.append(
                dict(
                    days=horizon,
                    seasonalWeatherBrier=score("seasonalWeather"),
                    baselineBrier=score("baseline"),
                    archivedForecastBrier=score(None, True),
                    knownOutcomes=sum(
                        c["observedFollowupDays"] >= horizon
                        or (
                            c["observedRecoveryDays"] is not None
                            and c["observedRecoveryDays"] <= horizon
                        )
                        for c in cases
                    ),
                )
            )
        reports.append(
            dict(
                id=lake["id"],
                modelPath=name,
                modelSha256=hashlib.sha256(model_raw).hexdigest(),
                coverage90=float(
                    np.average(
                        [c["coverage90"] for c in cases],
                        weights=[c["observedFollowupDays"] for c in cases],
                    )
                )
                if cases
                else None,
                archivedCoverage90=float(
                    np.average(
                        [
                            c["archivedForecast"]["coverage90"]
                            for c in cases
                            if "archivedForecast" in c
                        ],
                        weights=[
                            c["observedFollowupDays"] for c in cases if "archivedForecast" in c
                        ],
                    )
                )
                if any("archivedForecast" in c for c in cases)
                else None,
                cases=cases,
                excludedOrigins=excluded,
                scores=metrics,
                historicalBands=bands,
                baselinePath=baseline_name,
                baselineSha256=hashlib.sha256(baseline_raw).hexdigest(),
                baselineSources=water["sources"],
                lowWaterEpisodes=len(cases),
                archivedForecastEpisodes=sum("archivedForecast" in c for c in cases),
            )
        )
    report = dict(
        schemaVersion=1,
        inputsSha256=hashlib.sha256((folder / "inputs.json").read_bytes()).hexdigest(),
        event="Seven consecutive daily mean levels inside the moving seasonal middle-50% range.",
        split="Hydrological fit 1990–2009, penalty and residual blocks 2010–2015, frozen refit through 2015; episode tests 2016–2025.",
        targetBaseline="Historical tests use only 1970–2009 lake levels for seasonal thresholds; current outlook uses 1991–2020.",
        limits="Research outlook. Sparse independent episodes, overlapping recovery windows and a short genuine forecast archive. Older cases use seasonal weather resampling, not archived forecasts. Current ensemble probabilities have not been calibrated against a long archive of ensemble forecasts.",
        lakes=reports,
    )
    (folder / "validation.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
