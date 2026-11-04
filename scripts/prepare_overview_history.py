"""Prepare compact descriptive cell summaries from the pinned real RhiresD archive.

Explicit preparation only; does not modify the regional extreme-value model.
"""

import calendar
import gzip
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Use the repository environment")
sys.path.insert(0, str(ROOT / "src"))
import h5py
import numpy as np

from weather_modeller.storage import write_json


def top_windows(values, offsets, duration, count=5):
    """Rank non-overlapping complete windows; ties prefer the earlier ending day."""
    sums = np.cumsum(np.where(np.isfinite(values), values, 0), axis=0, dtype=np.float64)
    valid = np.cumsum(np.isfinite(values), axis=0)
    rolled = sums.copy()
    rolled[duration:] -= sums[:-duration]
    n = valid.copy()
    n[duration:] -= valid[:-duration]
    rolled[n != duration] = -np.inf
    columns = np.arange(values.shape[1])
    result = []
    for _ in range(count):
        at = np.argmax(rolled, axis=0)
        result.append(np.stack([rolled[at, columns], at + offsets], axis=-1))
        for delta in range(1 - duration, duration):
            blocked = np.clip(at + delta, 0, len(values) - 1)
            rolled[blocked, columns] = -np.inf
    return result


def prepare():
    baseline = json.loads((ROOT / "data/processed/regional-history/manifest.json").read_text())
    cells = np.fromfile(ROOT / "data/processed/regional-history/cells.u32", dtype="<u4")
    years = baseline["years"]
    monthly, wet = [], []
    candidates = {d: [] for d in (1, 3, 5)}
    epoch = date(years[0], 1, 1)
    for source in baseline["sources"]:
        year = source["year"]
        path = ROOT / f"data/raw/rainfall-audit/{year}.nc"
        if hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Source mismatch: {year}")
        with h5py.File(path) as f:
            a = f["RhiresD"][:]
            if f["N"][0] < f["N"][-1]:
                a = a[:, ::-1]
            if f["E"][0] > f["E"][-1]:
                a = a[:, :, ::-1]
            a = a.reshape(len(a), -1)[:, cells].copy()
            fill = float(f["RhiresD"].attrs["_FillValue"][0])
            a[a == fill] = np.nan
        if np.isinf(a).any() or np.any(a[np.isfinite(a)] < 0):
            raise ValueError("Invalid rainfall")
        month_rows, wet_rows = [], []
        first = 0
        for month in range(1, 13):
            length = calendar.monthrange(year, month)[1]
            v = a[first : first + length]
            complete = np.isfinite(v).all(axis=0)
            month_rows.append(np.where(complete, np.sum(v, axis=0, dtype=np.float64), np.nan))
            wet_rows.append(np.where(complete, np.sum(v >= 1, axis=0), np.nan))
            first += length
        monthly.append(month_rows)
        wet.append(wet_rows)
        for duration in candidates:
            candidates[duration].extend(top_windows(a, (date(year, 1, 1) - epoch).days, duration))
        print("Summarised", year, flush=True)
    totals = np.asarray(monthly)
    wet = np.asarray(wet)
    all_complete = np.isfinite(totals).all(axis=1)
    annual = np.where(all_complete, totals.sum(axis=1), np.nan)
    ranked = {}
    for duration, rows in candidates.items():
        rows = np.asarray(rows)
        columns = np.arange(len(cells))
        out = []
        for _ in range(5):
            # Day offset breaks equal-value ties deterministically.
            order = np.lexsort((rows[:, :, 1], -rows[:, :, 0]), axis=0)
            picked = rows[order[0], columns].copy()
            out.append(picked)
            overlap = np.abs(rows[:, :, 1] - picked[:, 1]) < duration
            rows[:, :, 0][overlap] = -np.inf
        ranked[duration] = np.asarray(out)
    outdir = ROOT / "data/reference/rainfall-summary"
    outdir.mkdir(parents=True, exist_ok=True)
    chunks = []
    for start in range(0, len(cells), 128):
        records = []
        for i in range(start, min(start + 128, len(cells))):
            months = []
            for m in range(12):
                v = totals[:, m, i]
                ok = np.isfinite(v)
                if not ok.any():
                    months.append(None)
                    continue
                at = int(np.nanargmax(v))
                months.append(
                    [
                        int(ok.sum()),
                        float(np.nanmean(v)),
                        *np.nanquantile(v, [0.1, 0.9]).tolist(),
                        float(v[at]),
                        years[at],
                        float(np.nanmean(wet[:, m, i])),
                    ]
                )
            v = annual[:, i]
            good = np.isfinite(v)
            y = None
            if good.any():
                lo, hi = int(np.nanargmin(v)), int(np.nanargmax(v))
                y = [
                    int(good.sum()),
                    float(np.nanmean(v)),
                    float(v[lo]),
                    years[lo],
                    float(v[hi]),
                    years[hi],
                ]
            extremes = {
                str(d): [
                    [float(value), int(day)] for value, day in ranked[d][:, i] if np.isfinite(value)
                ]
                for d in ranked
            }
            records.append(
                {"cell": int(cells[i]), "months": months, "annual": y, "extremes": extremes}
            )
        raw = (json.dumps(records, separators=(",", ":"), allow_nan=False) + "\n").encode()
        encoded = gzip.compress(raw, compresslevel=9, mtime=0)
        digest = hashlib.sha256(encoded).hexdigest()
        filename = f"{start // 128}-{digest}.json.gz"
        (outdir / filename).write_bytes(encoded)
        chunks.append(
            {
                "first": int(cells[start]),
                "last": int(cells[min(start + 127, len(cells) - 1)]),
                "path": filename,
                "sha256": digest,
            }
        )
    write_json(
        outdir / "manifest.json",
        {
            "schemaVersion": 1,
            "epoch": epoch.isoformat(),
            "years": years,
            "sources": baseline["sources"],
            "referenceId": baseline["referenceId"],
            "chunks": chunks,
            "monthFields": ["count", "mean", "p10", "p90", "maximum", "maximumYear", "meanWetDays"],
            "annualFields": ["count", "mean", "minimum", "minimumYear", "maximum", "maximumYear"],
            "interpretation": "Smoothed containing-cell regional estimates; not building observations or local extreme-value estimates",
            "extremes": "Five largest non-overlapping complete windows, within calendar years; ties prefer earliest date",
        },
        compact=True,
    )
    print("Prepared", len(cells), "cells", flush=True)


if __name__ == "__main__":
    prepare()
