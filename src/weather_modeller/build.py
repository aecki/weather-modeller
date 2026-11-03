"""Stage and verify complete builds before replacing the last usable app."""

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from .regional import validate_release
from .regional_history import validate_history
from .regional_models import validate_models
from .storage import write_json
from .validation import validate_snapshot

REQUIRED_ASSETS = (
    "index.html",
    "favicon.svg",
    "style.css",
    "overview.css",
    "app.js",
    "data-core.js",
    "graphics.js",
    "model-worker.js",
    "third-party-notices.txt",
    "data/observations.json",
    "data/provenance.json",
    "data/regional/manifest.json",
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


def version_entry_assets(destination: Path) -> None:
    """Keep a cached page from mixing scripts and styles from different deployments."""
    entry = destination / "index.html"
    html = entry.read_text(encoding="utf-8")
    for name in ("style.css", "overview.css", "graphics.js", "data-core.js", "app.js"):
        digest = hashlib.sha256((destination / name).read_bytes()).hexdigest()[:16]
        html = html.replace(f'"{name}"', f'"{name}?v={digest}"')
    entry.write_text(html, encoding="utf-8")


def build(root: Path) -> Path:
    root = Path(root)
    source, data, output = root / "web", root / "data/processed", root / "dist"
    snapshot = json.loads((data / "observations.json").read_text(encoding="utf-8"))
    validate_snapshot(snapshot)
    json.loads((data / "provenance.json").read_text(encoding="utf-8"))
    if (data / "regional").exists():
        validate_release(data / "regional")
    if (data / "regional-history").exists():
        history_config = root / "config/regional-history.json"
        expected = (
            json.loads(history_config.read_text()).get("manifestSha256")
            if history_config.exists()
            else None
        )
        validate_history(data / "regional-history", expected)
    if (data / "regional-models").exists():
        config = json.loads((root / "config/regional-models.json").read_text())
        validate_models(data / "regional-models", config["manifestSha256"])
    if output.is_symlink():
        raise ValueError("Refusing to build into a symlinked dist directory")
    staging_root = root / ".cache/build"
    staging_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=staging_root) as directory:
        staged, previous = Path(directory) / "dist", Path(directory) / "previous"
        shutil.copytree(source, staged, ignore=shutil.ignore_patterns("graphics", "modelling"))
        shutil.copytree(data, staged / "data")
        reference = root / "data/reference/rainfall-archive"
        if reference.exists():
            shutil.copytree(reference, staged / "data/rainfall-archive")
        if not (staged / "data/regional/manifest.json").exists():
            write_json(staged / "data/regional/manifest.json", {"schemaVersion": 1, "days": []})
        compile_frontend(root, staged)
        (staged / ".nojekyll").touch()
        for asset in REQUIRED_ASSETS:
            if not (staged / asset).is_file():
                raise ValueError(f"Missing application asset: {asset}")
        version_entry_assets(staged)
        had_previous = output.exists()
        if had_previous:
            output.rename(previous)
        try:
            staged.rename(output)
        except OSError:
            if had_previous:
                previous.rename(output)
            raise
    print(f"Built static web app: {output}", flush=True)
    return output
