"""Reproject the official downloaded Swiss Map Raster 500 for offline visx display.

Optional preparation tool; the app, build and tests use only its bundled outputs.
"""

import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Run with the repository weather-modeller environment.")

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

raw = ROOT / "data/raw/geography"
out = ROOT / "web/geography"
metadata = json.loads((raw / "classic-map.json").read_text())
asset = next(a for k, a in metadata["assets"].items() if "_komb_" in k)
source = raw / "classic-map.tif"
digest = hashlib.sha256(source.read_bytes()).hexdigest()
if asset["checksum:multihash"].lower() != "1220" + digest:
    raise ValueError("Official map checksum mismatch; review the source download.")
bounds = [4.7, 45.2, 11.7, 48.3]
projected = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
width = 4000
height = round(width * (projected[3] - projected[1]) / (projected[2] - projected[0]))
target_transform = from_bounds(*projected, width, height)
rgb = np.full((height, width, 3), 255, dtype=np.uint8)
with rasterio.open(source) as src:
    assert str(src.crs) == "EPSG:2056"
    palette = np.array([src.colormap(1)[i][:3] for i in range(256)], dtype=np.uint8)
    indices = src.read(1)
    for channel in range(3):
        reproject(
            source=palette[indices, channel],
            destination=rgb[:, :, channel],
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=target_transform,
            dst_crs="EPSG:3857",
            dst_nodata=255,
            resampling=Resampling.bilinear,
        )
Image.fromarray(rgb).save(out / "classic-map.webp", quality=85, method=6)
provenance = dict(
    source="Federal Office of Topography swisstopo",
    attribution="© swisstopo",
    dataset="Swiss Map Raster 500, colour combination (komb)",
    sourceUrl="https://www.swisstopo.admin.ch/en/national-map-1-500000",
    stacItemUrl="https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.pixelkarte-farbe-pk500.noscale/items/swiss-map-raster500_500",
    downloadUrl=asset["href"],
    sourceUpdated=asset["updated"],
    inputSha256=digest,
    preparedAt=datetime.now(UTC).isoformat(),
    processing=dict(
        sourceCRS="EPSG:2056",
        sourcePixelMetres=25,
        mapScale="1:500000",
        imageCRS="EPSG:3857",
        bounds=bounds,
        width=width,
        height=height,
        resampling="bilinear",
        output="WebP quality 85, method 6",
        outsideSource="white; no extrapolated cartography",
    ),
    output=dict(
        file="classic-map.webp",
        sha256=hashlib.sha256((out / "classic-map.webp").read_bytes()).hexdigest(),
    ),
    note="Fixed-resolution national map for geographic context. Does not stream higher-detail tiles when zoomed. Current downloaded cartography is used for all historical events; it does not define catchments or inundation.",
)
(out / "classic-map.json").write_text(json.dumps(provenance, indent=2) + "\n")
print(width, height, (out / "classic-map.webp").stat().st_size, "bytes")
