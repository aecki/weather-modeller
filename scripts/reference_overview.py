"""Independent NetCDF4/direct-sum reference for selected real overview cells."""

import calendar
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import netCDF4
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Use the repository environment")
index = json.loads((ROOT / "data/reference/rainfall-summary/manifest.json").read_text())
# Bern, Geneva, Lugano, Davos: use established independently located source cells.
r = json.loads((ROOT / "tests/fixtures/regional-models/reference.json").read_text())
cells = [c["cell"] for c in r["cells"]]
records = {c: {"months": [], "wet": [], "daily": []} for c in cells}
for year in index["years"]:
    with netCDF4.Dataset(ROOT / f"data/raw/rainfall-audit/{year}.nc") as f:
        flip_n = f.variables["N"][0] < f.variables["N"][-1]
        flip_e = f.variables["E"][0] > f.variables["E"][-1]
        for cell in cells:
            row, col = divmod(cell, 370)
            v = f.variables["RhiresD"][
                :, 264 - row if flip_n else row, 369 - col if flip_e else col
            ]
            values = [None if np.ma.is_masked(x) else float(x) for x in v]
            monthly, wet, at = [], [], 0
            for month in range(1, 13):
                n = calendar.monthrange(year, month)[1]
                window = values[at : at + n]
                monthly.append(sum(window) if all(x is not None for x in window) else None)
                wet.append(
                    sum(x >= 1 for x in window) if all(x is not None for x in window) else None
                )
                at += n
            records[cell]["months"].append(monthly)
            records[cell]["wet"].append(wet)
            records[cell]["daily"].extend(
                (str(date(year, 1, 1) + timedelta(days=i)), value) for i, value in enumerate(values)
            )
    print("Independent reads", year, flush=True)
out = []
for cell, rec in records.items():
    months = []
    for m in range(12):
        v = np.asarray([year[m] if year[m] is not None else np.nan for year in rec["months"]])
        at = int(np.nanargmax(v))
        months.append(
            [
                int(np.isfinite(v).sum()),
                float(np.nanmean(v)),
                *np.nanquantile(v, [0.1, 0.9]).tolist(),
                float(v[at]),
                index["years"][at],
                float(np.nanmean([y[m] if y[m] is not None else np.nan for y in rec["wet"]])),
            ]
        )
    annual = [
        (index["years"][i], sum(v))
        for i, v in enumerate(rec["months"])
        if all(x is not None for x in v)
    ]
    minimum = min(annual, key=lambda x: x[1])
    maximum = max(annual, key=lambda x: x[1])
    yearly = [
        len(annual),
        sum(v for _, v in annual) / len(annual),
        minimum[1],
        minimum[0],
        maximum[1],
        maximum[0],
    ]
    extremes = {}
    for duration in (1, 3, 5):
        candidates = []
        for i in range(duration - 1, len(rec["daily"])):
            rows = rec["daily"][i - duration + 1 : i + 1]
            if rows[0][0][:4] != rows[-1][0][:4] or any(v is None for _, v in rows):
                continue
            candidates.append((sum(v for _, v in rows), rows[-1][0]))
        candidates.sort(key=lambda x: (-x[0], x[1]))
        chosen = []
        for amount, day in candidates:
            if all(
                abs((date.fromisoformat(day) - date.fromisoformat(d)).days) >= duration
                for _, d in chosen
            ):
                chosen.append((amount, day))
            if len(chosen) == 5:
                break
        extremes[str(duration)] = [
            [v, (date.fromisoformat(d) - date(1961, 1, 1)).days] for v, d in chosen
        ]
    out.append(
        {
            "cell": cell,
            "months": months,
            "annual": yearly,
            "extremes": extremes,
            "yearMonths": rec["months"],
        }
    )
(ROOT / "tests/fixtures/overview-history.json").write_text(
    json.dumps(
        {
            "method": "Independent NetCDF4 point reads, Python direct sums and full-archive sorting; four real Swiss cells",
            "records": out,
        },
        separators=(",", ":"),
    )
    + "\n"
)
