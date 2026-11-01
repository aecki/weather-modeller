"""Download official Swiss observations and retain auditable source records."""

import csv
import io
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta

from .aggregation import mean_discharge_day
from .catalog import date_range, load_catalog
from .project import project_root
from .sources import SourceClient
from .storage import write_json
from .validation import validate_snapshot

METEO_BASE = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn"
FOEN_API = "https://data.bafu.admin.ch/api"


def read_csv(raw):
    """MeteoSwiss documents Windows-1252 encoding and semicolon delimiters."""
    return list(csv.DictReader(io.StringIO(raw.decode("cp1252")), delimiter=";"))


def fetch_observations(root=None, *, refresh=False):
    root = project_root(root)
    config = load_catalog(root)
    dates = date_range(config["historyStart"], config["historyEnd"])
    client = SourceClient(root, refresh)
    metadata = {
        s["station_abbr"]: s
        for s in read_csv(client.fetch(METEO_BASE + "/ogd-smn_meta_stations.csv", "stations.csv"))
    }
    client.fetch(METEO_BASE + "/ogd-smn_meta_parameters.csv", "parameters.csv")

    def weather(code):
        m = metadata[code]
        url = f"{METEO_BASE}/{code.lower()}/ogd-smn_{code.lower()}_d_historical.csv"
        rows = read_csv(client.fetch(url, f"{code}.csv"))
        lookup = {}
        for row in rows:
            day = datetime.strptime(row["reference_timestamp"], "%d.%m.%Y %H:%M").date().isoformat()
            value = row.get("rre150d0", "")
            if day in lookup:
                raise ValueError(f"Duplicate rainfall date at {code}: {day}")
            lookup[day] = float(value) if value else None
        values = [lookup.get(day) for day in dates]
        if any(v is not None and (not math.isfinite(v) or v < 0) for v in values):
            raise ValueError(f"Invalid rainfall at {code}")
        print(
            code,
            m["station_name"],
            sum(v is not None for v in values),
            "daily observations",
            flush=True,
        )
        return {
            "id": code,
            "name": m["station_name"],
            "canton": m["station_canton"],
            "lat": float(m["station_coordinates_wgs84_lat"]),
            "lon": float(m["station_coordinates_wgs84_lon"]),
            "elevation": float(m["station_height_masl"]),
            "url": url,
            "values": values,
        }

    with ThreadPoolExecutor(max_workers=4) as pool:
        stations = list(pool.map(weather, config["weatherStations"]))
    river_metadata = client.graphql(
        "{ water { observations { stations { no name riverName latitude longitude } } } }",
        "river-stations.json",
    )["stations"]
    rivers = []
    for code in config["riverStations"]:
        station = next(s for s in river_metadata if s["no"] == code)
        records, hourly = {}, {}
        for event in config["events"]:
            end = (date.fromisoformat(event["end"]) + timedelta(days=1)).isoformat()
            query = (
                '{ water { observations { data_1hour_mean(where: { station: { no: { _eq: "'
                + code
                + '" } }, parameterName: { _eq: "Q" }, timestamp: { _gte: "'
                + event["start"]
                + 'T06:00:00Z", _lt: "'
                + end
                + 'T06:00:00Z" } }) { timestamp value unitSymbol releaseState } } } }'
            )
            rows = client.graphql(query, f"river-hourly-{code}-{event['id']}.json")[
                "data_1hour_mean"
            ]
            if any(r["unitSymbol"] not in ("m³/s", "m3/s") for r in rows):
                raise ValueError(f"Unexpected discharge unit at {code}")
            hourly[event["id"]] = sorted(rows, key=lambda r: r["timestamp"])
            records[event["id"]] = [
                mean_discharge_day(rows, day) for day in date_range(event["start"], event["end"])
            ]
        print("River", code, station["name"], flush=True)
        rivers.append(
            {
                "id": code,
                "name": station["name"],
                "river": station["riverName"],
                "lat": station["latitude"],
                "lon": station["longitude"],
                "events": records,
                "hourly": hourly,
            }
        )
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "dates": dates,
        "events": config["events"],
        "stations": stations,
        "rivers": rivers,
        "rainParameter": "rre150d0",
        "rainUnit": "mm",
        "rainInterval": "06:00 UTC on the labelled day to 06:00 UTC the following day",
        "riverInterval": "Derived mean of 24 hourly means, 06:00–06:00 UTC; incomplete windows are null",
        "historyStart": config["historyStart"],
        "historyEnd": config["historyEnd"],
    }
    validate_snapshot(payload)
    output = root / "data" / "processed"
    # Build the complete payload successfully before replacing the last usable snapshot.
    write_json(output / "observations.json", payload, compact=True)
    write_json(
        output / "provenance.json", {"sources": sorted(client.manifest, key=lambda r: r["file"])}
    )
    print(f"Saved {len(stations)} weather stations and {len(rivers)} river stations to {output}")
