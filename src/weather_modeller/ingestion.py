"""Download official Swiss observations and retain auditable source records."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import csv
import hashlib
import io
import json
import math
import re
import subprocess
import time

from .aggregation import mean_discharge_day
from .project import project_root

METEO_BASE = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn"
FOEN_API = "https://data.bafu.admin.ch/api"


def write_json(path, value, *, compact=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False,
                                   **({"separators": (",", ":")} if compact else {"indent": 2})) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_csv(raw):
    """MeteoSwiss documents Windows-1252 encoding and semicolon delimiters."""
    return list(csv.DictReader(io.StringIO(raw.decode("cp1252")), delimiter=";"))


def date_range(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if last < first:
        raise ValueError("End date precedes start date")
    return [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]


def load_catalog(root):
    config = json.loads((root / "config" / "catalog.json").read_text(encoding="utf-8"))
    date_range(config["historyStart"], config["historyEnd"])
    for key in ("weatherStations", "riverStations"):
        if not config[key] or len(config[key]) != len(set(config[key])) or any(not re.fullmatch(r"[A-Za-z0-9_-]+", code) for code in config[key]):
            raise ValueError(f"{key} must be a nonempty list of unique identifiers")
    ids = set()
    for event in config["events"]:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", event["id"]) or event["id"] in ids:
            raise ValueError("Duplicate event identifier")
        ids.add(event["id"])
        days = date_range(event["start"], event["end"])
        if len(days) > 31 or event["start"] < config["historyStart"] or event["end"] > config["historyEnd"]:
            raise ValueError("Event windows must fit the history range and contain at most 31 days")
    if not ids:
        raise ValueError("At least one event is required")
    return config


class SourceClient:
    def __init__(self, root, refresh=False):
        self.root, self.refresh = root, refresh
        self.cache = root / "data" / "raw"
        self.cache.mkdir(parents=True, exist_ok=True)
        self.manifest = []

    def fetch(self, url, key, body=None):
        path = self.cache / key
        request_path = path.with_suffix(path.suffix + ".request.json")
        request = {"url": url, "body": body}
        cached_request = json.loads(request_path.read_text(encoding="utf-8")) if request_path.exists() else None
        if self.refresh or not path.exists() or cached_request != request:
            command = ["curl", "--fail", "--silent", "--show-error", "--max-time", "90", url]
            if body is not None:
                command += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
            for attempt in range(4):
                try:
                    result = subprocess.run(command, input=json.dumps(body).encode() if body is not None else None,
                                            capture_output=True, check=True)
                    temporary = path.with_suffix(path.suffix + ".tmp")
                    temporary.write_bytes(result.stdout)
                    temporary.replace(path)
                    write_json(request_path, request)
                    break
                except subprocess.CalledProcessError as error:
                    if attempt == 3:
                        raise RuntimeError(f"Download failed for {url}: {error.stderr.decode(errors='replace')}") from error
                    time.sleep(2 ** attempt)
        raw = path.read_bytes()
        self.manifest.append({
            "url": url, "file": path.relative_to(self.root).as_posix(),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "retrievedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
            **({"request": body} if body is not None else {}),
        })
        return raw

    def graphql(self, query, key):
        response = json.loads(self.fetch(FOEN_API, key, {"query": query}))
        if response.get("errors"):
            raise RuntimeError(f"FOEN GraphQL error: {response['errors']}")
        return response["data"]["water"]["observations"]


def fetch_observations(root=None, *, refresh=False):
    root = project_root(root)
    config = load_catalog(root)
    dates = date_range(config["historyStart"], config["historyEnd"])
    client = SourceClient(root, refresh)
    metadata = {s["station_abbr"]: s for s in read_csv(client.fetch(METEO_BASE + "/ogd-smn_meta_stations.csv", "stations.csv"))}
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
        print(code, m["station_name"], sum(v is not None for v in values), "daily observations", flush=True)
        return {"id": code, "name": m["station_name"], "canton": m["station_canton"],
                "lat": float(m["station_coordinates_wgs84_lat"]), "lon": float(m["station_coordinates_wgs84_lon"]),
                "elevation": float(m["station_height_masl"]), "url": url, "values": values}

    with ThreadPoolExecutor(max_workers=4) as pool:
        stations = list(pool.map(weather, config["weatherStations"]))
    river_metadata = client.graphql("{ water { observations { stations { no name riverName latitude longitude } } } }", "river-stations.json")["stations"]
    rivers = []
    for code in config["riverStations"]:
        station = next(s for s in river_metadata if s["no"] == code)
        records, hourly = {}, {}
        for event in config["events"]:
            end = (date.fromisoformat(event["end"]) + timedelta(days=1)).isoformat()
            query = ('{ water { observations { data_1hour_mean(where: { station: { no: { _eq: "' + code +
                     '" } }, parameterName: { _eq: "Q" }, timestamp: { _gte: "' + event["start"] +
                     'T06:00:00Z", _lt: "' + end + 'T06:00:00Z" } }) { timestamp value unitSymbol releaseState } } } }')
            rows = client.graphql(query, f"river-hourly-{code}-{event['id']}.json")["data_1hour_mean"]
            if any(r["unitSymbol"] not in ("m³/s", "m3/s") for r in rows):
                raise ValueError(f"Unexpected discharge unit at {code}")
            hourly[event["id"]] = sorted(rows, key=lambda r: r["timestamp"])
            records[event["id"]] = [mean_discharge_day(rows, day) for day in date_range(event["start"], event["end"])]
        print("River", code, station["name"], flush=True)
        rivers.append({"id": code, "name": station["name"], "river": station["riverName"],
                       "lat": station["latitude"], "lon": station["longitude"], "events": records, "hourly": hourly})
    payload = {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(), "dates": dates,
               "events": config["events"], "stations": stations, "rivers": rivers,
               "rainParameter": "rre150d0", "rainUnit": "mm",
               "rainInterval": "06:00 UTC on the labelled day to 06:00 UTC the following day",
               "riverInterval": "Derived mean of 24 hourly means, 06:00–06:00 UTC; incomplete windows are null",
               "historyStart": config["historyStart"], "historyEnd": config["historyEnd"]}
    output = root / "data" / "processed"
    # Build the complete payload successfully before replacing the last usable snapshot.
    write_json(output / "observations.json", payload, compact=True)
    write_json(output / "provenance.json", {"sources": sorted(client.manifest, key=lambda r: r["file"])})
    print(f"Saved {len(stations)} weather stations and {len(rivers)} river stations to {output}")
