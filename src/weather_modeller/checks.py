"""Offline numerical and application integrity checks."""

import shutil
import subprocess
import sys

from .build import build


def check(root):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is missing; use the repository-local Conda environment")
    subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"],
        cwd=root,
        check=True,
    )
    for path in ("app.js", "data-core.js"):
        subprocess.run([node, "--check", str(root / "web" / path)], check=True)
    subprocess.run([node, str(root / "tests" / "test_data.cjs")], cwd=root, check=True)
    subprocess.run([node, str(root / "tests/test_regional.mjs")], cwd=root, check=True)
    subprocess.run([node, str(root / "tests/test_regional_history.mjs")], cwd=root, check=True)
    subprocess.run([node, str(root / "scripts/test_graphics.mjs")], cwd=root, check=True)
    subprocess.run([node, str(root / "tests/test_regional_models.mjs")], cwd=root, check=True)
    build(root)
    subprocess.run([node, str(root / "tests/test_models.mjs")], cwd=root, check=True)
    subprocess.run([node, str(root / "tests/test_comparison.mjs")], cwd=root, check=True)
    print("All local checks passed.")


def quality(root):
    """Explicit developer checks; normal app use needs no development packages."""
    subprocess.run([sys.executable, "-m", "ruff", "check", "."], cwd=root, check=True)
    subprocess.run([sys.executable, "-m", "ruff", "format", "--check", "."], cwd=root, check=True)
    prettier = root / "node_modules/prettier/bin/prettier.cjs"
    if not prettier.is_file():
        raise RuntimeError("Install local frontend dev tools with npm ci --ignore-scripts")
    subprocess.run(
        [
            shutil.which("node"),
            str(prettier),
            "--check",
            "web/index.html",
            "web/style.css",
            "web/app.js",
            "web/data-core.js",
            "tests/test_data.cjs",
            "config/catalog.json",
            "web/graphics",
            "scripts/build_frontend.mjs",
            "scripts/test_graphics.mjs",
            "tests/test_graphics.jsx",
            "tests/test_models.mjs",
            "tests/test_comparison.mjs",
            "tests/test_regional.mjs",
            "tests/test_regional_history.mjs",
            "tests/test_regional_models.mjs",
            "web/modelling",
        ],
        cwd=root,
        check=True,
    )
