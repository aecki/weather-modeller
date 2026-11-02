"""Stage and verify complete builds before replacing the last usable app."""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from .storage import write_json
from .validation import validate_snapshot

REQUIRED_ASSETS = (
    "index.html",
    "favicon.svg",
    "style.css",
    "app.js",
    "data-core.js",
    "graphics.js",
    "model-worker.js",
    "third-party-notices.txt",
    "runtime-config.json",
    "geography/countries.geojson",
    "geography/lakes.geojson",
    "geography/classic-map.json",
    "geography/classic-map.webp",
    "geography/provenance.json",
    "data/observations.json",
    "data/provenance.json",
)


def compile_frontend(root: Path, destination: Path) -> None:
    node = shutil.which("node")
    if not node or not (root / "node_modules/esbuild").is_dir():
        raise RuntimeError(
            "Frontend build dependencies are missing. Run python run.py setup first."
        )
    subprocess.run(
        [node, str(root / "scripts/build_frontend.mjs"), str(destination)], cwd=root, check=True
    )


def build(root: Path, *, export_mode: str = "download") -> Path:
    if export_mode not in ("download", "repository"):
        raise ValueError("Unsupported export mode")
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
        shutil.copytree(source, staged, ignore=shutil.ignore_patterns("graphics", "modelling"))
        shutil.copytree(data, staged / "data")
        compile_frontend(root, staged)
        write_json(staged / "runtime-config.json", {"exportMode": export_mode})
        (staged / ".nojekyll").touch()
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
