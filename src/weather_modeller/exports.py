"""Independent CSV reference for testing browser downloads."""

import csv
import io
from pathlib import Path


def selection_csv(snapshot, selection):
    event = next((e for e in snapshot["events"] if e["id"] == selection.get("event")), None)
    station = next((s for s in snapshot["stations"] if s["id"] == selection.get("station")), None)
    river = next((r for r in snapshot["rivers"] if r["id"] == selection.get("river")), None)
    days = selection.get("days")
    if not event or not station or not river or type(days) is not int or days not in (1, 3, 5):
        raise ValueError(
            "Choose a known event, rainfall station, river gauge and 1/3/5-day duration"
        )
    by_date = {row["timestamp"][:10]: row for row in river["events"][event["id"]]}
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(
        [
            "date",
            "rain_station",
            "rain_daily_mm",
            f"rain_trailing_{days}day_mm",
            "rain_interval_utc",
            "river_station",
            "river_name",
            "river_derived_24hour_mean_m3s",
            "river_release_state",
            "river_interval_utc",
        ]
    )
    for i, day in enumerate(snapshot["dates"]):
        if not event["start"] <= day <= event["end"]:
            continue
        window = station["values"][max(0, i - days + 1) : i + 1]
        total = (
            round(sum(window), 1)
            if len(window) == days and all(v is not None for v in window)
            else None
        )
        row = by_date.get(day, {})
        writer.writerow(
            [
                day,
                station["id"],
                station["values"][i],
                total,
                "06:00 to next day 06:00",
                river["id"],
                river["river"],
                row.get("value"),
                row.get("releaseState"),
                "06:00 to next day 06:00",
            ]
        )
    # Identifiers come from the checked-in catalog; never accept caller-provided paths.
    filename = f"swiss-observations-{event['id']}-{station['id']}-{river['id']}-{days}day.csv"
    if Path(filename).name != filename or ".." in filename or "\\" in filename:
        raise ValueError("Invalid catalog identifier for export")
    return filename, stream.getvalue()
