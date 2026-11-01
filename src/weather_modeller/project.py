"""Locate a source checkout without machine-specific paths."""
from pathlib import Path


def project_root(root=None):
    path = Path(root).resolve() if root is not None else Path(__file__).resolve().parents[2]
    if not (path / "config" / "catalog.json").is_file():
        raise ValueError(f"Not a weather-modeller checkout: {path}")
    return path
