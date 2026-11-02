"""Prepare bundled swisstopo display layers from explicitly downloaded archives.

Optional tooling only; build, serve and routine checks do not import these packages.
"""

import hashlib
import io
import json
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Run with the repository weather-modeller environment.")

import shapefile  # noqa: E402
from pyproj import Transformer  # noqa: E402
from shapely.geometry import box, mapping, shape  # noqa: E402
from shapely.geometry.polygon import orient  # noqa: E402
from shapely.ops import transform  # noqa: E402

RAW = ROOT / "data/raw/geography"
OUT = ROOT / "web/geography"
SOURCES = [
    ("swisstlmregio_2026", "ch.swisstopo.swisstlmregio"),
    ("swissboundaries3d_2026-01", "ch.swisstopo.swissboundaries3d"),
]
project = Transformer.from_crs(2056, 4326, always_xy=True).transform
extent = box(5.7, 45.7, 10.7, 48.0)
inputs = []
archives = {}
for version, collection in SOURCES:
    metadata = json.loads((RAW / f"{version}.json").read_text())
    if metadata["id"] != version or metadata["collection"] != collection:
        raise ValueError("Unexpected STAC dataset identity")
    asset = next(a for k, a in metadata["assets"].items() if k.endswith(".shp.zip"))
    archive = RAW / f"{version}.zip"
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if asset["checksum:multihash"].lower() != "1220" + digest:
        raise ValueError(f"Provider checksum mismatch: {archive.name}")
    inputs.append(dict(version=version, url=asset["href"], sha256=digest))
    archives[version] = zipfile.ZipFile(archive)


def records(version, suffix):
    archive = archives[version]
    member = next(n for n in archive.namelist() if n.endswith(suffix))
    reader = shapefile.Reader(
        shp=io.BytesIO(archive.read(member)),
        dbf=io.BytesIO(archive.read(member[:-4] + ".dbf")),
        encoding="utf-8",
    )
    yield from reader.iterShapeRecords()


def feature(record, properties):
    original = shape(record.shape.__geo_interface__)
    # Simplification takes place in LV95 metres, preserving polygon topology.
    geometry = transform(project, original.simplify(100, preserve_topology=True)).intersection(
        extent
    )
    if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    # d3/visx spherical paths require clockwise exteriors (opposite RFC 7946).
    from shapely.geometry import MultiPolygon

    geometry = MultiPolygon([orient(p, sign=-1) for p in polygons])
    return dict(type="Feature", properties=properties, geometry=mapping(geometry))


countries = []
for record in records("swisstlmregio_2026", "swissTLMRegio_LANDESGEBIET_LV95.shp"):
    attrs = record.record.as_dict()
    if attrs["ICC"] == "CH":
        continue
    item = feature(record, dict(name=attrs["NAME"], countryCode=attrs["ICC"]))
    if item:
        countries.append(item)
for record in records("swissboundaries3d_2026-01", "TLM_LANDESGEBIET.shp"):
    attrs = record.record.as_dict()
    if attrs["ICC"] == "CH":
        countries.append(feature(record, dict(name="Switzerland", countryCode="CH")))
lakes = []
for record in records("swisstlmregio_2026", "swissTLMRegio_Lake.shp"):
    # Omit small lakes below 0.5 square kilometres at this national display scale.
    if shape(record.shape.__geo_interface__).area < 500_000:
        continue
    item = feature(record, dict(sourceId=record.record.as_dict()["UUID"]))
    if item:
        lakes.append(item)
outputs = []
for name, features in [("countries", countries), ("lakes", lakes)]:
    path = OUT / f"{name}.geojson"
    data = json.dumps(dict(type="FeatureCollection", features=features), separators=(",", ":"))
    path.write_text(data + "\n")
    outputs.append(
        dict(
            file=path.name,
            features=len(features),
            sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        )
    )
provenance = dict(
    source="Federal Office of Topography swisstopo",
    attribution="© swisstopo",
    sourceUrl="https://www.swisstopo.admin.ch/en/conditions-geodata",
    licence="swisstopo Open Government Data: free use with source attribution",
    preparedAt=datetime.now(UTC).isoformat(),
    inputs=inputs,
    processing=dict(
        sourceCRS="EPSG:2056",
        outputCRS="EPSG:4326 (longitude, latitude)",
        simplificationMetres=100,
        preserveTopology=True,
        minimumLakeAreaM2=500000,
        clipBounds=[5.7, 45.7, 10.7, 48.0],
        winding="clockwise exteriors for d3/visx",
    ),
    outputs=outputs,
    note="Generalised display geography, not cadastral, hydrological or historical event boundaries.",
)
(OUT / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
print(outputs)
