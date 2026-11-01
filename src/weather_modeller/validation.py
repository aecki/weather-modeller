"""Validate the observation contract before publishing a local build or refreshed data."""

import math
from datetime import date, timedelta


def finite_number(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def validate_snapshot(snapshot: dict) -> None:
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1:
        raise ValueError("Unsupported observation snapshot schema")
    dates = snapshot.get("dates", [])
    if (
        not dates
        or dates[0] != snapshot.get("historyStart")
        or dates[-1] != snapshot.get("historyEnd")
    ):
        raise ValueError("Snapshot dates must match the history range")
    start = date.fromisoformat(dates[0])
    if dates != [(start + timedelta(days=i)).isoformat() for i in range(len(dates))]:
        raise ValueError("Snapshot dates must be unique, consecutive ISO dates")
    for collection in ("events", "stations", "rivers"):
        rows = snapshot.get(collection, [])
        if not rows or len({row.get("id") for row in rows}) != len(rows):
            raise ValueError(f"Snapshot {collection} must contain unique identifiers")
        if any(not isinstance(row.get("id"), str) or not row["id"] for row in rows):
            raise ValueError(f"Snapshot {collection} identifiers must be nonempty strings")
    for event in snapshot["events"]:
        if (
            event["start"] not in dates
            or event["end"] not in dates
            or event["start"] > event["end"]
        ):
            raise ValueError("Snapshot event windows must fit the observation dates")
    for station in snapshot["stations"]:
        values = station.get("values", [])
        if len(values) != len(dates) or any(
            v is not None and (not finite_number(v) or v < 0) for v in values
        ):
            raise ValueError(f"Invalid rainfall array at {station['id']}")
    for station in snapshot["stations"] + snapshot["rivers"]:
        if not finite_number(station.get("lat")) or not -90 <= station["lat"] <= 90:
            raise ValueError(f"Invalid station latitude: {station['id']}")
        if not finite_number(station.get("lon")) or not -180 <= station["lon"] <= 180:
            raise ValueError(f"Invalid station longitude: {station['id']}")
