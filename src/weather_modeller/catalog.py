"""Validated station and historical-event selection."""

import json
import re
from datetime import date, timedelta


def date_range(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if last < first:
        raise ValueError("End date precedes start date")
    return [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]


def load_catalog(root):
    config = json.loads((root / "config" / "catalog.json").read_text(encoding="utf-8"))
    date_range(config["historyStart"], config["historyEnd"])
    for key in ("weatherStations", "riverStations"):
        if (
            not config[key]
            or len(config[key]) != len(set(config[key]))
            or any(not re.fullmatch(r"[A-Za-z0-9_-]+", code) for code in config[key])
        ):
            raise ValueError(f"{key} must be a nonempty list of unique identifiers")
    ids = set()
    for event in config["events"]:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", event["id"]) or event["id"] in ids:
            raise ValueError("Duplicate event identifier")
        ids.add(event["id"])
        days = date_range(event["start"], event["end"])
        if (
            len(days) > 31
            or event["start"] < config["historyStart"]
            or event["end"] > config["historyEnd"]
        ):
            raise ValueError("Event windows must fit the history range and contain at most 31 days")
    if not ids:
        raise ValueError("At least one event is required")
    return config
