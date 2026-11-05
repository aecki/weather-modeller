"""Prepare current-year complete-month totals from the verified daily release."""

import calendar
import hashlib
import json
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.regional import promote
from weather_modeller.storage import write_json


def sum_complete_month(fields):
    import numpy as np

    if not fields:
        raise ValueError("No fields for month")
    values = np.asarray(fields, dtype=np.float64)
    if np.isinf(values).any() or np.any(values[np.isfinite(values)] < 0):
        raise ValueError("Invalid precipitation in yearly summary")
    return np.where(np.isfinite(values).all(axis=0), np.nansum(values, axis=0), np.nan).astype(
        "<f4"
    )


def prepare(root=ROOT):
    import numpy as np

    root = Path(root)
    source = root / "data/processed/regional"
    manifest_raw = (source / "manifest.json").read_bytes()
    release = json.loads(manifest_raw)
    latest = date.fromisoformat(release["latestAvailable"])
    grid = release["grid"]
    size = grid["width"] * grid["height"]
    lookup = {row["date"]: row for row in release["days"]}
    totals = np.full((12, size), np.nan, dtype="<f4")
    months, through, used = 0, None, []
    for month in range(1, 13):
        length = calendar.monthrange(latest.year, month)[1]
        end = date(latest.year, month, length)
        if end > latest:
            break
        records = [
            lookup.get(date(latest.year, month, day).isoformat()) for day in range(1, length + 1)
        ]
        if any(record is None for record in records):
            break
        fields = []
        for record in records:
            if record["path"] != f"grids/{record['sha256']}.f32":
                raise ValueError("Invalid rainfall field path")
            raw = (source / record["path"]).read_bytes()
            if len(raw) != size * 4 or hashlib.sha256(raw).hexdigest() != record["sha256"]:
                raise ValueError("Rainfall field failed integrity checks")
            fields.append(np.frombuffer(raw, dtype="<f4"))
        totals[month - 1] = sum_complete_month(fields)
        used.extend({k: r[k] for k in ("date", "sha256", "sourceId", "status")} for r in records)
        months, through = month, end.isoformat()
    payload = totals.tobytes()
    digest = hashlib.sha256(payload).hexdigest()
    cache = root / ".cache/year-overview-build"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        staged = Path(directory) / "year-overview"
        staged.mkdir()
        (staged / f"{digest}.f32").write_bytes(payload)
        write_json(
            staged / "manifest.json",
            {
                "schemaVersion": 1,
                "year": latest.year,
                "months": months,
                "through": through,
                "grid": grid,
                "path": f"{digest}.f32",
                "sha256": digest,
                "encoding": "month/cell float32 little endian; monthly totals in mm; NaN missing",
                "releaseGeneratedAt": release["generatedAt"],
                "latestRainfallDay": release["latestAvailable"],
                "dailyReleaseSha256": hashlib.sha256(manifest_raw).hexdigest(),
                "inputs": used,
                "statuses": sorted({r["status"] for r in used}),
                "attribution": "Source: MeteoSwiss",
            },
            compact=True,
        )
        promote(staged, root / "data/processed/year-overview")
    print("Prepared current-year overview:", latest.year, "through", through, flush=True)


if __name__ == "__main__":
    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    prepare()
