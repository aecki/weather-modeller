"""Explicit download of real, cross-border ERA5 catchment weather for model fitting."""

import gzip
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.sources import SourceClient


def main():
    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    folder = ROOT / "data/reference/lake-recovery"
    catchment = json.loads((folder / "catchments.json").read_text())
    nodes = [n for lake in catchment["lakes"] for n in lake["nodes"]]
    client = SourceClient(ROOT)
    rows = []
    for year, end in [(1989, 1993), (1994, 1998), *[(y, y) for y in range(1999, 2026)]]:
        params = dict(
            latitude=",".join(str(n["latitude"]) for n in nodes),
            longitude=",".join(str(n["longitude"]) for n in nodes),
            start_date=f"{year}-01-01",
            end_date=f"{end}-12-31",
            daily="precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration",
            timezone="Europe/Zurich",
            models="era5",
            cell_selection="nearest",
        )
        url = "https://archive-api.open-meteo.com/v1/archive?" + urlencode(params)
        data = json.loads(client.fetch(url, f"lake-recovery/era5-{year}-{end}.json"))
        if not isinstance(data, list) or len(data) != len(nodes):
            raise ValueError("Missing weather locations")
        if any(
            point["daily_units"].get("precipitation_sum") != "mm"
            or point["daily_units"].get("temperature_2m_mean") != "°C"
            or point["daily_units"].get("et0_fao_evapotranspiration") != "mm"
            for point in data
        ):
            raise ValueError("Unexpected daily weather units")
        dates = data[0]["daily"]["time"]
        if any(d["daily"]["time"] != dates for d in data):
            raise ValueError("Weather dates do not align")
        for i, day in enumerate(dates):
            rows.append(
                [
                    day,
                    *[
                        [
                            d["daily"][v][i]
                            for v in (
                                "precipitation_sum",
                                "temperature_2m_mean",
                                "et0_fao_evapotranspiration",
                            )
                        ]
                        for d in data
                    ],
                ]
            )
        print(year, end, len(rows), flush=True)
    for lake in catchment["lakes"]:
        lake_file = ROOT / f"data/processed/water/{lake['id']}.json"
        lake_data = json.loads(lake_file.read_text())
        lookup = {row[0]: row[1] for row in lake_data["rows"]}
        offset = sum(
            len(item["nodes"]) for item in catchment["lakes"][: catchment["lakes"].index(lake)]
        )
        data = [
            [row[0], lookup.get(row[0]), *row[1 + offset : 1 + offset + len(lake["nodes"])]]
            for row in rows
        ]
        raw = gzip.compress(
            json.dumps(data, separators=(",", ":"), allow_nan=False).encode(), mtime=0
        )
        name = f"history-{lake['id']}.json.gz"
        (folder / name).write_bytes(raw)
        lake["history"] = dict(
            path=name,
            sha256=hashlib.sha256(raw).hexdigest(),
            waterSha256=hashlib.sha256(lake_file.read_bytes()).hexdigest(),
            waterSources=lake_data["sources"],
        )
    manifest = dict(
        schemaVersion=1,
        attribution="Lake levels: FOEN. Weather: ECMWF ERA5 reanalysis via Open-Meteo (CC BY 4.0). Reanalysis estimates are not rain-gauge observations or archived forecasts.",
        weatherSources=client.manifest,
        catchmentsSha256=hashlib.sha256((folder / "catchments.json").read_bytes()).hexdigest(),
        lakes=[{k: v for k, v in lake.items() if k != "geometry"} for lake in catchment["lakes"]],
    )
    (folder / "inputs.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
