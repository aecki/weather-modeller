#!/usr/bin/env python3
"""Cross-platform entry point; no editable install or shell-specific commands required."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from weather_modeller.cli import main

if __name__ == "__main__":
    main()
