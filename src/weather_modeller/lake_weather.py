"""Strict local-day aggregation of archived hourly weather forecasts."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

VARIABLES = ("precipitation", "temperature_2m", "et0_fao_evapotranspiration")


def hourly_days(payload, first, limit=16, ensemble=False, selected_members=None):
    """Flux values cover the preceding hour. Require all 23/24/25 local-day intervals."""
    data = payload["hourly"]
    units = payload["hourly_units"]
    times = data["time"]
    if (
        units["precipitation"] != "mm"
        or units["temperature_2m"] != "°C"
        or units["et0_fao_evapotranspiration"] != "mm"
    ):
        raise ValueError("Unexpected weather units")
    if len(set(times)) != len(times):
        raise ValueError("Duplicate forecast hours")
    members = sorted(
        k.removeprefix("precipitation")
        for k in data
        if k == "precipitation" or k.startswith("precipitation_member")
    )
    if selected_members is not None:
        if any(member not in members for member in selected_members):
            raise ValueError("Requested ensemble member missing")
        members = list(selected_members)
    if not ensemble and members != [""]:
        raise ValueError("Unexpected deterministic forecast members")
    if ensemble and len(members) < 10:
        raise ValueError("Too few weather ensemble members")
    zone = ZoneInfo("Europe/Zurich")
    lookup = {int(t): i for i, t in enumerate(times)}
    days = []
    daily = []
    for offset in range(limit):
        d = first + timedelta(days=offset)
        start = datetime(d.year, d.month, d.day, tzinfo=zone).astimezone(UTC)
        next_day = d + timedelta(days=1)
        end = datetime(next_day.year, next_day.month, next_day.day, tzinfo=zone).astimezone(UTC)
        expected = list(range(int(start.timestamp()) + 3600, int(end.timestamp()) + 1, 3600))
        if not all(t in lookup for t in expected):
            break
        indices = [lookup[t] for t in expected]
        values = []
        for member in members:
            columns = []
            for variable in VARIABLES:
                key = variable + member
                if key not in data or len(data[key]) != len(times):
                    raise ValueError("Incomplete ensemble fields")
                raw = [data[key][i] for i in indices]
                columns.append([float(v) if v is not None else np.nan for v in raw])
            a = np.array(columns)
            if not np.isfinite(a).all():
                values = []
                break
            if (a[[0, 2]] < 0).any():
                raise ValueError("Negative weather flux")
            values.append([a[0].sum(), a[1].mean(), a[2].sum()])
        if not values:
            break
        days.append(str(d))
        daily.append(values)
    if not daily:
        raise ValueError("No complete forecast day")
    return days, np.asarray(daily), members


def valid_members(payloads, first, limit=15):
    """Exclude a member globally for invalid fluxes in the requested local-day window."""
    if not payloads:
        raise ValueError("No forecast locations")
    candidates = sorted(
        k.removeprefix("precipitation")
        for k in payloads[0]["hourly"]
        if k == "precipitation" or k.startswith("precipitation_member")
    )
    zone = ZoneInfo("Europe/Zurich")
    last = first + timedelta(days=limit)
    begin = datetime(first.year, first.month, first.day, tzinfo=zone).timestamp()
    end = datetime(last.year, last.month, last.day, tzinfo=zone).timestamp()
    rejected = []
    for member in candidates:
        invalid = False
        for point in payloads:
            for variable in ("precipitation", "et0_fao_evapotranspiration"):
                values = point["hourly"].get(variable + member)
                if values is None:
                    invalid = True
                    continue
                for timestamp, value in zip(point["hourly"]["time"], values, strict=True):
                    if begin < timestamp <= end and value is not None and value < 0:
                        invalid = True
        if invalid:
            rejected.append(member)
    return [member for member in candidates if member not in rejected], rejected
