"""Explicit installation of optional developer tools inside the local environment."""

import shutil
import subprocess
import sys
from pathlib import Path


def install_frontend(root: Path) -> None:
    prefix = Path(sys.prefix).resolve()
    if prefix != (root / ".environments/weather-modeller").resolve():
        raise RuntimeError("Developer tools must be installed through python run.py dev")
    node = shutil.which("node")
    candidates = [
        prefix / "lib/node_modules/npm/bin/npm-cli.js",
        prefix / "node_modules/npm/bin/npm-cli.js",
        prefix / "Library/lib/node_modules/npm/bin/npm-cli.js",
        prefix / "Library/node_modules/npm/bin/npm-cli.js",
    ]
    npm = next((path for path in candidates if path.is_file()), None)
    if not node or npm is None:
        raise RuntimeError("Node.js/npm are missing from the repository-local environment")
    subprocess.run([node, str(npm), "ci", "--ignore-scripts"], cwd=root, check=True)


def _install_requirements(root: Path, filename: str, command: str) -> None:
    if Path(sys.prefix).resolve() != (root / ".environments/weather-modeller").resolve():
        raise RuntimeError(
            f"Optional dependencies must be installed through python run.py {command}"
        )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--isolated",
            "--no-user",
            "--disable-pip-version-check",
            "--cache-dir",
            str(root / ".cache/pip"),
            "-r",
            str(root / filename),
        ],
        cwd=root,
        check=True,
    )


def install_dev_tools(root: Path) -> None:
    _install_requirements(root, "requirements-dev.txt", "dev")
    install_frontend(root)


def install_regional_tools(root: Path) -> None:
    """Use the checked-out interpreter directly, without relying on shell activation."""
    _install_requirements(root, "requirements-regional.txt", "regional-deps")


def install_history_tools(root: Path) -> None:
    _install_requirements(root, "requirements-history.txt", "history-deps")
