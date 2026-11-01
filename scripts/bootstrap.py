#!/usr/bin/env python3
"""Create a repository-local Conda prefix without changing base or user config."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def local_environment():
    env = os.environ.copy()
    cache = ROOT / ".cache"
    for name in ("conda", "tmp", "pip", "python"):
        (cache / name).mkdir(parents=True, exist_ok=True)
    env.update({
        "CONDARC": str(ROOT / ".condarc"),
        "CONDA_PKGS_DIRS": str(cache / "conda"),
        "CONDA_ENVS_PATH": str(ROOT / ".environments"),
        "CONDA_REGISTER_ENVS": "false",
        "CONDA_NO_PLUGINS": "true",
        "CONDA_SOLVER": "classic",
        "CONDA_AUTO_UPDATE_CONDA": "false",
        "CONDA_NOTIFY_OUTDATED_CONDA": "false",
        "CONDA_NUMBER_CHANNEL_NOTICES": "0",
        "CONDA_REPORT_ERRORS": "false",
        "XDG_CACHE_HOME": str(cache),
        "PIP_CACHE_DIR": str(cache / "pip"),
        "PYTHONPYCACHEPREFIX": str(cache / "python"),
        "TMPDIR": str(cache / "tmp"),
        "TEMP": str(cache / "tmp"),
        "TMP": str(cache / "tmp"),
    })
    return env


def main():
    conda = os.environ.get("CONDA_EXE") or shutil.which("conda")
    if not conda or not Path(conda).is_file():
        raise SystemExit("Conda is required for setup. No packages will be installed into base.")
    exists = (ROOT / ".environments" / "weather-modeller" / "conda-meta" / "history").exists()
    update = "--update" in sys.argv
    if exists and not update:
        print("Repository-local environment already exists. Use setup --update to update it.")
        return
    command = [conda, "env", "update" if exists else "create", "--file", str(ROOT / "environment.yml"), "--prefix", str(ROOT / ".environments" / "weather-modeller")]
    command += ["--prune"] if exists else ["--no-default-packages", "--yes"]
    print("Creating environment in", ROOT / ".environments" / "weather-modeller", flush=True)
    subprocess.run(command, cwd=ROOT, env=local_environment(), check=True)
    print("Ready. Start the app with: python run.py serve")


if __name__ == "__main__":
    main()
