"""Explicit, resumable national data audit. Never invoked by app/build/test commands.

Run with the repository Python and optional requirements-geography.txt installed.
Uses fixed catalog snapshots under data/raw/rainfall-audit; delete those snapshots
explicitly to investigate a later provider release. No observation files are edited.
"""

import calendar
import csv
import hashlib
import io
import json
import shutil
import sys
import time
import urllib.request
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/rainfall-audit"
OUT = ROOT / "docs/rainfall-audit"
RAW.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Run using the repository weather-modeller environment.")
# This audit is an explicit download command. Freeze first-seen inventory for
# reproducibility; remove only these catalog snapshots to select a later release.
for name, collection in [
    ("rain", "ch.meteoschweiz.ogd-surface-derived-grid"),
    ("addresses", "ch.swisstopo.amtliches-gebaeudeadressverzeichnis"),
]:
    catalog_path = RAW / f"{name}-catalog.json"
    if not catalog_path.exists():
        url = f"https://data.geo.admin.ch/api/stac/v1/collections/{collection}/items?limit=100"
        with urllib.request.urlopen(url, timeout=120) as response:
            catalog_path.write_bytes(response.read())


def read_json(path):
    return json.loads(path.read_text())


def save(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    tmp.replace(path)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(asset, filename):
    path = RAW / filename
    expected = asset["file:checksum"].lower()
    if not path.exists():
        # Reuse the already audited 2025/September files without another download.
        reuse = (
            ROOT
            / "data/raw/feasibility"
            / {"2025.nc": "2025.nc", "202609.nc": "september.nc"}.get(filename, "__none__")
        )
        if reuse.exists() and "1220" + digest(reuse) == expected:
            shutil.copyfile(reuse, path)
        else:
            for attempt in range(3):
                try:
                    with (
                        urllib.request.urlopen(asset["href"], timeout=180) as r,
                        path.with_suffix(".part").open("wb") as f,
                    ):
                        shutil.copyfileobj(r, f)
                    path.with_suffix(".part").replace(path)
                    break
                except OSError:
                    if attempt == 2:
                        raise
                    time.sleep(2)
    sha = digest(path)
    if "1220" + sha != expected:
        raise ValueError(f"Provider checksum mismatch: {filename}; preserve file for investigation")
    return path, {
        "url": asset["href"],
        "sha256": sha,
        "bytes": path.stat().st_size,
        "provider_updated": asset.get("updated"),
    }


def source(path, variable):
    return rasterio.open(f'NETCDF:"{path}":{variable}')


catalog = read_json(RAW / "rain-catalog.json")
assert not any(link["rel"] == "next" for link in catalog["links"]), (
    "Catalogue pagination must be followed"
)
features = catalog["features"]
archive = next(f for f in features if f["id"] == "archive-ch")
annual_assets = sorted((k, a) for k, a in archive["assets"].items() if ".rhiresd_" in k)
address_catalog = read_json(RAW / "addresses-catalog.json")
address_item = next(f for f in address_catalog["features"] if f["id"].endswith("_ch"))
address_asset = next(a for k, a in address_item["assets"].items() if k.endswith(".csv.zip"))
address_path, address_meta = fetch(address_asset, "addresses.zip")
with zipfile.ZipFile(address_path) as z:
    csv_name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    with z.open(csv_name) as f:
        header = f.readline().decode("utf-8-sig").strip()
        print("Address fields:", header, flush=True)

# Header discovery is intentionally before further processing: provider field names
# are asserted below, not guessed silently.
with zipfile.ZipFile(address_path) as z, z.open(csv_name) as f:
    rows = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"), delimiter=";")
    fieldnames = rows.fieldnames
    assert {"ADR_EASTING", "ADR_NORTHING", "COM_CANTON"}.issubset(fieldnames), fieldnames
    coords, cantons, ids = [], [], []
    statuses = Counter()
    invalid_rows = []
    for i, row in enumerate(rows):
        statuses[row.get("ADR_STATUS", "not supplied")] += 1
        try:
            x, y = float(row["ADR_EASTING"]), float(row["ADR_NORTHING"])
            if not np.isfinite(x + y):
                raise ValueError("nonfinite")
        except ValueError:
            invalid_rows.append(i + 2)
            continue
        coords.append((x, y))
        cantons.append(row["COM_CANTON"])
        ids.append(row.get("EGID", row.get("ADR_EGAID", "")))
xy = np.array(coords)
print(f"Address rows decoded: {len(xy):,}; invalid coordinates: {len(invalid_rows)}", flush=True)
# All address coordinates are LV95, matching the source grid. Count addresses in
# containing cells; no interpolation and no snapping to valid neighbouring cells.
occupancy = np.zeros((265, 370), dtype=np.int64)
cols = np.floor((xy[:, 0] - 2474000) / 1000).astype(int)
rs = np.floor((1324000 - xy[:, 1]) / 1000).astype(int)
in_bounds = (rs >= 0) & (rs < 265) & (cols >= 0) & (cols < 370)
np.add.at(occupancy, (rs[in_bounds], cols[in_bounds]), 1)
occupied = occupancy > 0
np.save(RAW / "address-occupancy.npy", occupancy)
# This file is a CH-only official directory; use canton membership to flag scope
# anomalies rather than treating the rectangular hydrological grid as Switzerland.
expected_cantons = set(
    "AG AI AR BE BL BS FR GE GL GR JU LU NE NW OW SG SH SO SZ TG TI UR VD VS ZG ZH".split()
)
assert set(cantons) <= expected_cantons, set(cantons) - expected_cantons


def audit_file(job):
    label, asset, variable, first, last = job
    result_path = RAW / f"audit-{label}.json"
    mask_path = RAW / f"masks-{label}.npz"
    # Cached summaries are tied to both provider hash and the audit implementation.
    script_sha = digest(Path(__file__))
    if result_path.exists() and mask_path.exists():
        cached = read_json(result_path)
        if (
            cached["provider_checksum"] == asset["file:checksum"]
            and cached["script_sha256"] == script_sha
        ):
            return cached
    path, meta = fetch(asset, f"{label}.nc")
    with source(path, variable) as ds:
        tags = ds.tags()
        expected_days = (last - first).days + 1
        units = tags.get("time#units", "")
        base = date.fromisoformat(units.split("since ")[1][:10])
        offsets = [float(ds.tags(b).get("NETCDF_DIM_time", "nan")) for b in ds.indexes]
        dates = [base + timedelta(days=n) for n in offsets]
        expected_dates = [first + timedelta(days=i) for i in range(expected_days)]
        checks = {
            "dates": dates == expected_dates,
            "exact_time_offsets": offsets == list(range(expected_days)),
            "shape": ds.shape == (265, 370),
            "crs": ds.crs.to_epsg() == 2056,
            "transform": tuple(ds.transform)[:6]
            == (1000.0, 0.0, 2474000.0, 0.0, -1000.0, 1324000.0),
            "units": tags.get(f"{variable}#units") == "millimeter",
        }
        every = np.ones(ds.shape, bool)
        ever = np.zeros(ds.shape, bool)
        valid_counts, address_missing, day_max, day_address_mean = [], [], [], []
        negatives = nonfinite = 0
        vmin, vmax = float("inf"), -float("inf")
        versions = Counter()
        for band in ds.indexes:
            a = ds.read(band, masked=True)
            data = np.asarray(a)
            valid = ~np.ma.getmaskarray(a)
            nonfinite += int(np.sum(valid & ~np.isfinite(data)))
            valid &= np.isfinite(data)
            negatives += int(np.sum(valid & (data < 0)))
            every &= valid
            ever |= valid
            valid_counts.append(int(valid.sum()))
            address_missing.append(int(occupancy[~valid].sum()))
            vals = data[valid]
            vmin, vmax = min(vmin, float(vals.min())), max(vmax, float(vals.max()))
            day_max.append(float(data[valid & occupied].max()))
            day_address_mean.append(float(data[valid & occupied].mean()))
            versions[ds.tags(band).get("version", "missing")] += 1
        checks["no_negative_values"] = negatives == 0
        checks["no_nonfinite_valid_values"] = nonfinite == 0
        checks["nonempty_all_days"] = min(valid_counts) > 0
        np.savez_compressed(mask_path, every=every, ever=ever)
        result = {
            "period": label,
            "variable": variable,
            "first": str(first),
            "last": str(last),
            "days": ds.count,
            "checks": checks,
            "passed": all(checks.values()),
            "min_mm": vmin,
            "max_mm": vmax,
            "valid_cells_min": min(valid_counts),
            "valid_cells_max": max(valid_counts),
            "valid_every_day_cells": int(every.sum()),
            "valid_any_day_cells": int(ever.sum()),
            "address_missing_min": min(address_missing),
            "address_missing_max": max(address_missing),
            "negative_values": negatives,
            "nonfinite_values": nonfinite,
            "versions": dict(versions),
            "daily_max_over_address_cells_mm": day_max,
            "daily_mean_over_address_cells_mm": day_address_mean,
            "source": meta,
            "provider_checksum": asset["file:checksum"],
            "script_sha256": script_sha,
        }
    save(result_path, result)
    print(
        f"Audited {label}: {ds.count} days; passed={result['passed']}; max={vmax:.1f} mm",
        flush=True,
    )
    return result


annual_jobs = []
for key, asset in annual_assets:
    year = int(key.split("_")[-2][:4])
    annual_jobs.append((str(year), asset, "RhiresD", date(year, 1, 1), date(year, 12, 31)))
assert [int(j[0]) for j in annual_jobs] == list(range(1961, 2026))
print("Starting full annual audit with two download/decoder workers.", flush=True)
with ThreadPoolExecutor(max_workers=2) as pool:
    annual_results = list(pool.map(audit_file, annual_jobs))
save(OUT / "annual-files.json", annual_results)

monthly_jobs = []
for feature in features:
    if len(feature["id"]) != 9:
        continue
    for key, asset in feature["assets"].items():
        if ".rhiresd_" in key:
            year, month = int(feature["id"][:4]), int(feature["id"][4:6])
            monthly_jobs.append(
                (
                    feature["id"][:6],
                    asset,
                    "RhiresD",
                    date(year, month, 1),
                    date(year, month, calendar.monthrange(year, month)[1]),
                )
            )
with ThreadPoolExecutor(max_workers=2) as pool:
    monthly_results = list(pool.map(audit_file, monthly_jobs))
save(OUT / "monthly-files.json", monthly_results)

# Decode every preliminary day, including days without a final counterpart.
prelim_jobs = []
for feature in features:
    for key, asset in feature["assets"].items():
        if ".rprelimd_" in key:
            day = date.fromisoformat(
                f"{feature['id'][:4]}-{feature['id'][4:6]}-{feature['id'][6:8]}"
            )
            prelim_jobs.append((feature["id"][:8], asset, "RprelimD", day, day))
with ThreadPoolExecutor(max_workers=2) as pool:
    prelim_results = list(pool.map(audit_file, prelim_jobs))
save(OUT / "preliminary-files.json", prelim_results)

# Check the duplicate consolidated month against its final annual counterpart.
annual_by_year = {r["period"]: r for r in annual_results}
consolidated_overlaps = []
for month in monthly_results:
    year = month["period"][:4]
    if year not in annual_by_year:
        continue
    first = date.fromisoformat(month["first"])
    offset = (first - date(int(year), 1, 1)).days
    largest = 0.0
    mask_differences = 0
    with (
        source(RAW / f"{year}.nc", "RhiresD") as annual,
        source(RAW / f"{month['period']}.nc", "RhiresD") as monthly,
    ):
        for band in monthly.indexes:
            a, b = annual.read(offset + band, masked=True), monthly.read(band, masked=True)
            ma, mb = np.ma.getmaskarray(a), np.ma.getmaskarray(b)
            mask_differences += int((ma != mb).sum())
            valid = ~(ma | mb)
            largest = max(largest, float(abs(np.asarray(a)[valid] - np.asarray(b)[valid]).max()))
    consolidated_overlaps.append(
        {
            "month": month["period"],
            "days": month["days"],
            "max_absolute_difference_mm": largest,
            "mask_cell_day_differences": mask_differences,
            "annual_sha256": annual_by_year[year]["source"]["sha256"],
            "monthly_sha256": month["source"]["sha256"],
        }
    )
save(OUT / "consolidated-overlaps.json", consolidated_overlaps)

# Combine masks across every decoded file, including daily and consolidated data.
every = np.ones(occupancy.shape, bool)
ever = np.zeros(occupancy.shape, bool)
for r in annual_results + monthly_results + prelim_results:
    m = np.load(RAW / f"masks-{r['period']}.npz")
    every &= m["every"]
    ever |= m["ever"]
covered_every = np.zeros(len(xy), bool)
covered_ever = np.zeros(len(xy), bool)
covered_every[in_bounds] = every[rs[in_bounds], cols[in_bounds]]
covered_ever[in_bounds] = ever[rs[in_bounds], cols[in_bounds]]
canton_rows = []
ct = np.array(cantons)
for canton in sorted(expected_cantons):
    sel = ct == canton
    canton_rows.append(
        {
            "canton": canton,
            "coordinate_rows": int(sel.sum()),
            "covered_every_decoded_day": int((covered_every & sel).sum()),
            "covered_at_least_one_decoded_day": int((covered_ever & sel).sum()),
        }
    )
coverage = {
    "source": address_meta,
    "rows": len(xy) + len(invalid_rows),
    "valid_coordinate_rows": len(xy),
    "invalid_coordinate_rows": len(invalid_rows),
    "outside_grid_rows": int((~in_bounds).sum()),
    "address_status_counts": dict(statuses),
    "covered_every_decoded_day": int(covered_every.sum()),
    "covered_at_least_one_decoded_day": int(covered_ever.sum()),
    "address_occupied_cells": int(occupied.sum()),
    "cantons": canton_rows,
    "method": "Census of all CH CSV rows, including all listed statuses; LV95 containing-cell lookup, no snapping. Directory census is not a search API census, accuracy validation, or historical address reconstruction.",
}
save(OUT / "address-coverage.json", coverage)

month_by_date = {r["period"]: r for r in monthly_results}
comparisons = []
for r in prelim_results:
    month = r["period"][:6]
    if month not in month_by_date:
        continue
    band = int(r["period"][6:])
    with (
        source(RAW / f"{month}.nc", "RhiresD") as f,
        source(RAW / f"{r['period']}.nc", "RprelimD") as p,
    ):
        final, pre = f.read(band, masked=True), p.read(1, masked=True)
        valid = ~(np.ma.getmaskarray(final) | np.ma.getmaskarray(pre)) & occupied
        a, b = np.asarray(final)[valid], np.asarray(pre)[valid]
        diff = b - a
        wet = a >= 20
        heavy = a >= 50
        peak = np.unravel_index(np.argmax(np.where(valid, np.asarray(final), -np.inf)), final.shape)
        revision_peak = np.unravel_index(
            np.argmax(np.where(valid, abs(np.asarray(pre) - np.asarray(final)), -np.inf)),
            final.shape,
        )
        entry = {
            "date": f"{r['period'][:4]}-{r['period'][4:6]}-{r['period'][6:]}",
            "cells": int(valid.sum()),
            "final_max_mm": float(a.max()),
            "preliminary_max_mm": float(b.max()),
            "final_mean_mm": float(a.mean()),
            "preliminary_mean_mm": float(b.mean()),
            "mean_absolute_revision_mm": float(abs(diff).mean()),
            "p95_absolute_revision_mm": float(np.quantile(abs(diff), 0.95)),
            "max_absolute_revision_mm": float(abs(diff).max()),
            "fraction_changed_over_5mm": float((abs(diff) > 5).mean()),
            "largest_revision_cell": {
                "row": int(revision_peak[0]),
                "col": int(revision_peak[1]),
                "final_mm": float(final[revision_peak]),
                "preliminary_mm": float(pre[revision_peak]),
            },
            "final_peak_cell": {
                "row": int(peak[0]),
                "col": int(peak[1]),
                "final_mm": float(final[peak]),
                "preliminary_mm": float(pre[peak]),
            },
            "final_at_least_20mm_cells": int(wet.sum()),
            "mean_abs_revision_where_final_at_least_20mm": float(abs(diff[wet]).mean())
            if wet.any()
            else None,
            "final_at_least_50mm_cells": int(heavy.sum()),
            "preliminary_at_least_50mm_cells": int((b >= 50).sum()),
            "final_50mm_missed_by_preliminary_cells": int(((a >= 50) & (b < 50)).sum()),
            "preliminary_50mm_not_in_final_cells": int(((b >= 50) & (a < 50)).sum()),
            "mean_abs_revision_where_final_at_least_50mm": float(abs(diff[heavy]).mean())
            if heavy.any()
            else None,
            "preliminary_source_sha256": r["source"]["sha256"],
            "final_source_sha256": month_by_date[month]["source"]["sha256"],
        }
        comparisons.append(entry)
comparison = {
    "scope": "Unweighted grid cells containing at least one CH address; geography fixed across dates. No extrapolation to other seasons/years.",
    "days": len(comparisons),
    "all_days": comparisons,
    "wettest_by_final_peak": sorted(comparisons, key=lambda r: r["final_max_mm"], reverse=True)[:5],
    "wettest_by_final_mean": sorted(comparisons, key=lambda r: r["final_mean_mm"], reverse=True)[
        :5
    ],
    "largest_revisions": sorted(
        comparisons, key=lambda r: r["max_absolute_revision_mm"], reverse=True
    )[:5],
}
save(OUT / "preliminary-final.json", comparison)
summary = {
    "checked_at_utc": datetime.now(UTC).isoformat(),
    "annual_files": len(annual_results),
    "annual_days": sum(r["days"] for r in annual_results),
    "annual_passed": sum(r["passed"] for r in annual_results),
    "monthly_files": len(monthly_results),
    "monthly_passed": sum(r["passed"] for r in monthly_results),
    "preliminary_files": len(prelim_results),
    "preliminary_passed": sum(r["passed"] for r in prelim_results),
    "all_source_bytes": sum(
        r["source"]["bytes"] for r in annual_results + monthly_results + prelim_results
    )
    + address_meta["bytes"],
    "annual_bytes": sum(r["source"]["bytes"] for r in annual_results),
    "latest_preliminary_date": max(r["first"] for r in prelim_results),
    "address_rows": coverage["rows"],
    "address_covered_every_day": coverage["covered_every_decoded_day"],
    "overlap_days": len(comparisons),
    "catalog_sha256": digest(RAW / "rain-catalog.json"),
    "address_catalog_sha256": digest(RAW / "addresses-catalog.json"),
    "script_sha256": digest(Path(__file__)),
    "numpy_version": np.__version__,
    "rasterio_version": rasterio.__version__,
}
save(OUT / "summary.json", summary)
print(json.dumps(summary, indent=2), flush=True)

if not all(r["passed"] for r in annual_results + monthly_results + prelim_results):
    raise SystemExit("Audit contains failed checks; inspect per-file results.")
