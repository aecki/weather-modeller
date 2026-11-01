"""Stage and verify complete builds before replacing the last usable app."""

import json
import shutil
import tempfile
from pathlib import Path

from .validation import validate_snapshot

REQUIRED_ASSETS = (
    "index.html",
    "favicon.svg",
    "style.css",
    "app.js",
    "data-core.js",
    "vendor/leaflet.js",
    "vendor/leaflet.css",
    "vendor/LEAFLET-LICENSE",
    "geography/countries.geojson",
    "geography/lakes.geojson",
    "geography/provenance.json",
    "data/observations.json",
    "data/provenance.json",
)


def build(root: Path) -> Path:
    root = Path(root)
    source, data, output = root / "web", root / "data/processed", root / "dist"
    snapshot = json.loads((data / "observations.json").read_text(encoding="utf-8"))
    validate_snapshot(snapshot)
    json.loads((data / "provenance.json").read_text(encoding="utf-8"))
    if output.is_symlink():
        raise ValueError("Refusing to build into a symlinked dist directory")
    staging_root = root / ".cache/build"
    staging_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=staging_root) as directory:
        staged, previous = Path(directory) / "dist", Path(directory) / "previous"
        shutil.copytree(source, staged)
        shutil.copytree(data, staged / "data")
        for asset in REQUIRED_ASSETS:
            if not (staged / asset).is_file():
                raise ValueError(f"Missing application asset: {asset}")
        had_previous = output.exists()
        if had_previous:
            output.rename(previous)
        try:
            staged.rename(output)
        except OSError:
            if had_previous:
                previous.rename(output)
            raise
    print(f"Built self-contained app: {output}", flush=True)
    return output
