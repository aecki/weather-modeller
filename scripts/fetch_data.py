#!/usr/bin/env python3
"""Compatibility entrypoint. Prefer: python run.py fetch [--refresh]."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from weather_modeller.ingestion import fetch_observations

if __name__ == "__main__":
    fetch_observations(refresh="--refresh" in sys.argv)
