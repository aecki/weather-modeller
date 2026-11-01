"""Observation aggregation with explicit UTC windows and missingness."""
from datetime import datetime, timedelta
import math


def utc_datetime(timestamp):
    value = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Observation timestamps must include a timezone")
    return value


def mean_discharge_day(rows, day):
    """Mean exactly 24 hourly means, using interval-start timestamps [06:00, 06:00)."""
    start = utc_datetime(day + "T06:00:00Z")
    end = start + timedelta(days=1)
    group = [row for row in rows if start <= utc_datetime(row["timestamp"]) < end]
    expected = {start + timedelta(hours=i) for i in range(24)}
    actual = {utc_datetime(row["timestamp"]) for row in group}
    complete = (
        len(group) == 24
        and actual == expected
        and all(isinstance(row["value"], (int, float)) and math.isfinite(row["value"]) for row in group)
    )
    return {
        "timestamp": day + "T06:00:00Z",
        "value": round(sum(row["value"] for row in group) / 24, 3) if complete else None,
        "hourlySampleCount": len(group),
        "unitSymbol": "m³/s",
        "releaseState": ",".join(sorted({str(row["releaseState"]) for row in group})),
    }
