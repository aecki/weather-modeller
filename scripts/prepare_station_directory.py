"""Index every MeteoSwiss station offering daily precipitation, with source versions."""

import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.ingestion import read_csv
from weather_modeller.sources import SourceClient
from weather_modeller.storage import write_json

if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Use the repository environment")
client = SourceClient(ROOT, refresh=True)
stations, annual = [], []
for network in ("smn", "smn-precip", "smn-tower", "nime", "tot"):
    base = f"https://data.geo.admin.ch/ch.meteoschweiz.ogd-{network}"
    metadata = read_csv(
        client.fetch(
            f"{base}/ogd-{network}_meta_stations.csv", f"station-network/{network}-stations.csv"
        )
    )
    inventory = read_csv(
        client.fetch(
            f"{base}/ogd-{network}_meta_datainventory.csv",
            f"station-network/{network}-inventory.csv",
        )
    )
    coverage = {}
    for row in inventory:
        if row["parameter_shortname"] == ("rre250c0" if network == "tot" else "rre150d0"):
            coverage.setdefault(row["station_abbr"], []).append(
                {k: row[k] for k in ("data_since", "data_till", "owner")}
            )
    for row in metadata:
        code = row["station_abbr"]
        if code not in coverage:
            continue
        (annual if network == "tot" else stations).append(
            {
                "id": f"{network}:{code}",
                "code": code,
                "network": network,
                "name": row["station_name"],
                "canton": row["station_canton"],
                "lat": float(row["station_coordinates_wgs84_lat"]),
                "lon": float(row["station_coordinates_wgs84_lon"]),
                "elevation": float(row["station_height_masl"]),
                "coverage": coverage[code],
                "easting": float(row["station_coordinates_lv95_east"]),
                "northing": float(row["station_coordinates_lv95_north"]),
                "type": row["station_type_en"],
                "url": f"{base}/{code.lower()}/ogd-{network}_{code.lower()}_{'y' if network == 'tot' else 'd'}_historical.csv",
            }
        )
stations.sort(key=lambda x: (x["name"], x["id"]))
write_json(
    ROOT / "data/reference/station-network.json",
    {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "stations": stations,
        "annualStations": sorted(annual, key=lambda s: s["name"]),
        "sources": client.manifest,
        "scope": "Every SMN, SMN-precip, SMN-tower and NIME station with inventoried rre150d0 daily precipitation; annual totalisers are listed separately. Overlapping network histories remain separate, not spliced. Source histories loaded on demand.",
    },
    compact=True,
)
print("Indexed", len(stations), "daily precipitation stations")
