"""Census address coordinates against the official CH national polygon.

Run after audit_rainfall_archive.py. Requires optional NumPy and Shapely.
No private address input; the source is the public swisstopo directory.
"""

import csv
import hashlib
import io
import json
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/rainfall-audit"
OUT = ROOT / "docs/rainfall-audit"
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Run using the repository weather-modeller environment.")
url = "https://api3.geo.admin.ch/rest/services/ech/MapServer/find?" + urllib.parse.urlencode(
    {
        "layer": "ch.swisstopo.swissboundaries3d-land-flaeche.fill",
        "searchText": "CH",
        "searchField": "id",
        "returnGeometry": "true",
        "geometryFormat": "geojson",
        "sr": "2056",
        "contains": "false",
    }
)
path = RAW / "boundary-response.json"
if not path.exists():
    with urllib.request.urlopen(url, timeout=120) as response:
        path.write_bytes(response.read())
features = json.loads(path.read_text())["results"]
assert len(features) == 1 and features[0]["id"] == "CH"
polygon = shape(features[0]["geometry"])
assert polygon.is_valid
shapely.prepare(polygon)
xy, records = [], []
with (
    zipfile.ZipFile(RAW / "addresses.zip") as z,
    z.open(next(n for n in z.namelist() if n.endswith(".csv"))) as f,
):
    for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"), delimiter=";"):
        xy.append((float(row["ADR_EASTING"]), float(row["ADR_NORTHING"])))
        records.append((row["ADR_EGAID"], row["COM_CANTON"], row["COM_NAME"], row["ADR_STATUS"]))
xy = np.array(xy)
inside = shapely.intersects_xy(polygon, xy[:, 0], xy[:, 1])
indices = np.flatnonzero(~inside)
distance = shapely.distance(shapely.points(xy[indices]), polygon)
exceptions = [
    {
        "address_id": records[i][0],
        "canton": records[i][1],
        "municipality": records[i][2],
        "status": records[i][3],
        "distance_outside_polygon_m": round(float(d), 2),
        "easting": float(xy[i, 0]),
        "northing": float(xy[i, 1]),
    }
    for i, d in zip(indices, distance, strict=True)
]
# Evaluate current and historic masks against the same directory coordinates.
cols = np.floor((xy[:, 0] - 2474000) / 1000).astype(int)
rows = np.floor((1324000 - xy[:, 1]) / 1000).astype(int)
in_bounds = (rows >= 0) & (rows < 265) & (cols >= 0) & (cols < 370)
every = np.ones((265, 370), bool)
mask_files = sorted(RAW.glob("masks-*.npz"))
for m in mask_files:
    every &= np.load(m)["every"]
covered = np.zeros(len(xy), bool)
covered[in_bounds] = every[rows[in_bounds], cols[in_bounds]]
result = {
    "checked_at_utc": datetime.now(UTC).isoformat(),
    "source_url": url,
    "boundary_response_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    "source_layer": "ch.swisstopo.swissboundaries3d-land-flaeche.fill",
    "shapely_version": shapely.__version__,
    "address_rows": len(xy),
    "inside_or_on_CH_polygon": int(inside.sum()),
    "outside_polygon": len(exceptions),
    "outside_within_1m": int((distance <= 1).sum()),
    "outside_within_10m": int((distance <= 10).sum()),
    "outside_within_100m": int((distance <= 100).sum()),
    "mask_files_checked": len(mask_files),
    "inside_CH_missing_at_least_one_decoded_day": int((inside & ~covered).sum()),
    "outside_CH_missing_at_least_one_decoded_day": int((~inside & ~covered).sum()),
    "exceptions": exceptions,
    "limitations": [
        "Point-in-polygon uses this service geometry, not a legal adjudication of boundary addresses.",
        "Current address directory evaluated against historical rainfall masks; not historical building occupancy.",
        "Bulk coordinate coverage does not establish search-service recall.",
    ],
}
(OUT / "address-boundary.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
print(json.dumps({k: v for k, v in result.items() if k != "exceptions"}, indent=2))
