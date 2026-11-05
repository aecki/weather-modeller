"""Extract two full transboundary FOEN catchments and area-weighted weather nodes.

Explicit preparation from the checksummed official 2024 GeoPackage; not a daily job.
"""

import hashlib
import json
import sqlite3
import sys
from pathlib import Path

from pyproj import Transformer
from shapely import from_wkb, union_all
from shapely.geometry import box, mapping
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]


def main():
    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    raw = ROOT / "data/raw/lake-prototype"
    source = json.loads((raw / "total-source.json").read_text())
    path = raw / "total-catchments.gpkg"
    if hashlib.file_digest(path.open("rb"), "sha256").hexdigest() != source["sha256"]:
        raise ValueError("Catchment source checksum mismatch")
    c = sqlite3.connect(path)
    ids = {}
    for identifier, object_id in c.execute("select EZGNR,OBJECTID from Gesamteinzugsgebiete"):
        ids.setdefault(identifier, []).append(object_id)
    to_geo = Transformer.from_crs(2056, 4326, always_xy=True).transform
    result = []
    for station, basin, label in [
        ("2209", 123466, "Lake Zurich outlet"),
        ("2032", 171668, "Upper Lake Constance outlet at Konstanz"),
    ]:
        parts = []
        for oid in ids[basin]:
            blob = c.execute(
                "select Shape from Gesamteinzugsgebiete where OBJECTID=?", (oid,)
            ).fetchone()[0]
            start = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(blob[3] >> 1) & 7]
            parts.append(from_wkb(blob[start:]))
        polygon = union_all(parts)
        official = c.execute(
            "select Gesamtflaeche,Anteil_CH from physiogeographie where EZGNR=?", (basin,)
        ).fetchone()
        if abs(polygon.area / 1e6 - official[0]) > 0.1:
            raise ValueError("Extracted catchment does not match official area")
        x0, y0, x1, y1 = polygon.bounds
        nodes = []
        for i in range(2):
            for j in range(2):
                region = polygon.intersection(
                    box(
                        x0 + (x1 - x0) * i / 2,
                        y0 + (y1 - y0) * j / 2,
                        x0 + (x1 - x0) * (i + 1) / 2,
                        y0 + (y1 - y0) * (j + 1) / 2,
                    )
                )
                if region.is_empty:
                    continue
                point = region.representative_point()
                lon, lat = to_geo(point.x, point.y)
                nodes.append(
                    dict(
                        latitude=round(lat, 5),
                        longitude=round(lon, 5),
                        weight=region.area / polygon.area,
                    )
                )
        result.append(
            dict(
                id=station,
                basinId=basin,
                label=label,
                areaKm2=official[0],
                swissPercent=official[1],
                nodes=nodes,
                geometry=mapping(transform(to_geo, polygon.simplify(75, preserve_topology=True))),
            )
        )
    out = ROOT / "data/reference/lake-recovery"
    out.mkdir(exist_ok=True)
    (out / "catchments.json").write_text(
        json.dumps(
            dict(
                schemaVersion=1,
                source=source,
                attribution="FOEN, Topographical catchments of Swiss waterbodies, edition 2024",
                note="Topographic lake-outlet catchments, not hydrogeological or engineered diversion boundaries. Constance uses the Konstanz outlet subcatchment, including a small shore/outlet increment. Four area-weighted representative weather nodes per basin; coarse spatial sampling.",
                lakes=result,
            ),
            separators=(",", ":"),
        )
        + "\n"
    )
    for lake in result:
        print(lake["id"], lake["areaKm2"], lake["swissPercent"], lake["nodes"])


if __name__ == "__main__":
    main()
