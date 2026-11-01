#!/usr/bin/env python3
"""Portable launcher: dispatch to the Python environment inside this checkout."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
from bootstrap import ENVIRONMENT, local_environment


def main():
    args = sys.argv[1:] or ["serve"]
    if args[0] == "setup":
        result = subprocess.call(
            [sys.executable, str(ROOT / "scripts" / "bootstrap.py"), *args[1:]],
            cwd=ROOT,
            env=local_environment(),
        )
        if result != 0:
            return result
        args = ["install-frontend"]
    python = ENVIRONMENT / ("python.exe" if os.name == "nt" else "bin/python")
    if not python.is_file():
        print(
            "Run `python run.py setup` first. The environment stays inside this repository.",
            file=sys.stderr,
        )
        return 1
    return subprocess.call(
        [str(python), str(ROOT / "scripts" / "manage.py"), *args], cwd=ROOT, env=local_environment()
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130) from None
