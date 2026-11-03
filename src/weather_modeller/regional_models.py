"""Fixed-footprint regional annual maxima from the pinned real RhiresD archive."""

import gzip
import json
import tempfile
from datetime import date, timedelta
from pathlib import Path

from .regional import GRID, decode_days, promote, sha256, source_file
from .regional_history import gzip_bytes, validate_history
from .storage import atomic_write_bytes, write_json

CHUNK = 64


def rectangle_sums(values, bounds):
    import numpy as np

    integral = np.pad(values.astype("f8").cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    top, left, bottom, right = bounds
    return (
        integral[bottom, right]
        - integral[top, right]
        - integral[bottom, left]
        + integral[top, left]
    )


def footprints(cells):
    import numpy as np

    height, width = GRID["height"], GRID["width"]
    mask = np.zeros((height, width), dtype=bool)
    mask.ravel()[cells] = True
    row, col = cells // width, cells % width
    radius = np.full(len(cells), -1, dtype=int)
    for half in (10, 15, 20, 25, 35, 50):
        bounds = (
            np.maximum(0, row - half),
            np.maximum(0, col - half),
            np.minimum(height, row + half + 1),
            np.minimum(width, col + half + 1),
        )
        count = rectangle_sums(mask, bounds)
        radius[(radius < 0) & (count >= 400)] = half
    if (radius < 0).any():
        raise ValueError("No sufficiently large Swiss footprint")
    bounds = (
        np.maximum(0, row - radius),
        np.maximum(0, col - radius),
        np.minimum(height, row + radius + 1),
        np.minimum(width, col + radius + 1),
    )
    counts = rectangle_sums(mask, bounds).astype(int)
    return mask, radius, bounds, counts


def regional_means(values, mask, bounds, counts):
    import numpy as np

    valid = mask & np.isfinite(values)
    n = rectangle_sums(valid, bounds)
    sums = rectangle_sums(np.where(valid, values, 0), bounds)
    return np.where(n == counts, np.maximum(0, sums / counts), np.nan)


def annual_summary(values):
    """One row per day, one column per region; whole years must be complete."""
    import numpy as np

    if np.isinf(values).any() or np.any(np.isfinite(values) & (values < 0)):
        raise ValueError("Invalid regional rainfall")
    complete = np.isfinite(values).all(0)
    result = np.full((values.shape[1], 8), np.nan)
    result[:, 0] = values.sum(0)
    result[:, 1] = (values >= 1).sum(0)
    for k, days in enumerate((1, 3, 5)):
        # Add only windows fully within this calendar year.
        sums = sum(values[offset : len(values) - days + offset + 1] for offset in range(days))
        best = np.argmax(np.where(np.isfinite(sums), sums, -np.inf), axis=0)
        result[:, 2 + 2 * k] = sums[best, np.arange(values.shape[1])]
        result[:, 3 + 2 * k] = best + days - 1
    result[~complete] = np.nan
    return result


def prepare_models(root):
    import numpy as np

    root = Path(root)
    history = root / "data/processed/regional-history"
    config = json.loads((root / "config/regional-history.json").read_text())
    baseline = validate_history(history, config["manifestSha256"])
    cells_raw = (history / "cells.u32").read_bytes()
    cells = np.frombuffer(cells_raw, dtype="<u4").astype(int)
    mask, radius, bounds, counts = footprints(cells)
    cache = root / ".cache/regional-models"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        staging = Path(directory) / "models"
        (staging / "chunks").mkdir(parents=True)
        records = np.empty((len(cells), len(baseline["years"]), 8), dtype="f8")
        for yi, source in enumerate(baseline["sources"]):
            year = source["year"]
            first, last = date(year, 1, 1), date(year, 12, 31)
            dates = [first + timedelta(days=i) for i in range((last - first).days + 1)]
            candidate = {
                "asset": {"href": source["url"]},
                "sha256": source["sha256"],
                "item": "archive-ch",
                "start": first,
                "end": last,
                "variable": "RhiresD",
            }
            path, _ = source_file(root, candidate)
            version, fields = decode_days(path, candidate, dates)
            if version != source["version"]:
                raise ValueError("Historical provider version mismatch")
            means = np.stack(
                [
                    regional_means(
                        np.frombuffer(raw, dtype="<f4").reshape(mask.shape), mask, bounds, counts
                    )
                    for _, raw, _ in fields
                ]
            )
            records[:, yi] = annual_summary(means)
            print(f"Regional annual maxima: {year}, verified real source", flush=True)
        chunks = []
        for start in range(0, len(cells), CHUNK):
            rows = []
            for pos in range(start, min(start + CHUNK, len(cells))):
                rows.append(
                    {
                        "cell": int(cells[pos]),
                        "halfWidthCells": int(radius[pos]),
                        "areaKm2": int(counts[pos]),
                        "years": [
                            row.tolist() if np.isfinite(row).all() else None for row in records[pos]
                        ],
                    }
                )
            raw = gzip_bytes(json.dumps(rows, separators=(",", ":"), allow_nan=False).encode())
            digest = sha256(raw)
            atomic_write_bytes(staging / f"chunks/{start // CHUNK}-{digest}.json.gz", raw)
            chunks.append(digest)
        atomic_write_bytes(staging / "cells.u32", cells_raw)
        settings = {
            "schemaVersion": 1,
            "method": "swiss-area-mean-annual-maxima-v1",
            "historyReferenceId": baseline["referenceId"],
            "grid": GRID,
            "years": baseline["years"],
            "cellCount": len(cells),
            "chunkSize": CHUNK,
            "cellsSha256": sha256(cells_raw),
            "chunks": chunks,
        }
        identity = sha256(json.dumps(settings, sort_keys=True, separators=(",", ":")).encode())
        write_json(
            staging / "manifest.json",
            {
                **settings,
                "referenceId": identity,
                "sources": baseline["sources"],
                "columns": [
                    "totalMm",
                    "wetDaysAtLeast1Mm",
                    "max1Mm",
                    "max1DayOfYearZeroBased",
                    "max3Mm",
                    "max3EndingDayOfYearZeroBased",
                    "max5Mm",
                    "max5EndingDayOfYearZeroBased",
                ],
                "footprint": "Fixed Swiss cells within a square centred on the address cell; smallest half-width 10/15/20/25/35/50 cells containing at least 400 km2. All footprint cells must be valid on every day of a retained year.",
                "attribution": "Source: MeteoSwiss; boundary © swisstopo",
            },
            compact=True,
        )
        validate_models(staging)
        output = root / "data/processed/regional-models"
        output.parent.mkdir(parents=True, exist_ok=True)
        promote(staging, output)
    from .regional_history import package_reference

    return package_reference(root, output, "regional-models", identity)


def validate_models(directory, expected_manifest_sha=None):
    directory = Path(directory)
    raw = (directory / "manifest.json").read_bytes()
    if expected_manifest_sha and sha256(raw) != expected_manifest_sha:
        raise ValueError("Regional model manifest checksum mismatch")
    m = json.loads(raw)
    keys = (
        "schemaVersion",
        "method",
        "historyReferenceId",
        "grid",
        "years",
        "cellCount",
        "chunkSize",
        "cellsSha256",
        "chunks",
    )
    identity = sha256(
        json.dumps({k: m[k] for k in keys}, sort_keys=True, separators=(",", ":")).encode()
    )
    if (
        identity != m["referenceId"]
        or m["grid"] != GRID
        or m["chunkSize"] != CHUNK
        or len(m["years"]) < 20
    ):
        raise ValueError("Invalid regional model reference")
    cells_raw = (directory / "cells.u32").read_bytes()
    if sha256(cells_raw) != m["cellsSha256"] or len(cells_raw) != m["cellCount"] * 4:
        raise ValueError("Invalid regional model cell index")
    import struct

    cells = [item[0] for item in struct.iter_unpack("<I", cells_raw)]
    if not cells or any(a >= b for a, b in zip(cells, cells[1:], strict=False)):
        raise ValueError("Invalid model cell order")
    if len(m["chunks"]) != (len(cells) + CHUNK - 1) // CHUNK:
        raise ValueError("Incomplete regional model chunks")
    for i, digest in enumerate(m["chunks"]):
        chunk = (directory / f"chunks/{i}-{digest}.json.gz").read_bytes()
        if sha256(chunk) != digest:
            raise ValueError("Regional model chunk checksum mismatch")
        rows = json.loads(gzip.decompress(chunk))
        if [r["cell"] for r in rows] != cells[i * CHUNK : (i + 1) * CHUNK]:
            raise ValueError("Regional model chunk cells mismatch")
        for row in rows:
            if row["areaKm2"] < 400 or len(row["years"]) != len(m["years"]):
                raise ValueError("Invalid regional model footprint or record")
    return m
