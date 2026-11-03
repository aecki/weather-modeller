# Swiss rainfall archive audit

Completed 3 November 2026. Source: MeteoSwiss; address directory and national boundary: © swisstopo. This is a data investigation; the interface, production observation snapshot and modelling engine are unchanged.

## Decision for review

**Nationwide address-based regional precipitation context is technically feasible. Building-specific rainfall measurements and return periods are not established by these data.** Every listed coordinate inside the official Swiss polygon has a valid value on every decoded day. Preliminary amounts can change materially, and later annual consolidation changes some monthly analyses too.

Proceed to a data-layer prototype with explicit source versions, coverage checks and provisional status. Keep nearby-station measurements and models separately labelled. Do not yet implement or advertise calibrated building-scale probabilities.

## Full archive checks

| Dataset | Decoded files | Daily layers checked | Result |
|---|---:|---:|---|
| Annual RhiresD, 1961–2025 | 65 | 23,741 | All automated checks passed |
| Consolidated monthly RhiresD, December 2025–September 2026 | 10 | 304 | All automated checks passed |
| Preliminary RprelimD, 4 September–1 November 2026 | 59 | 59 | All automated checks passed |

Every file was downloaded and decoded, not merely listed. Every downloaded rainfall file and the address ZIP matched its provider SHA-256 multihash. Checks cover the exact expected time offsets and dates, leap days, grid dimensions and transform, CRS, units, nonempty daily fields, and absence of negative or nonfinite unmasked values. Fill values remain missing. All annual assets are RhiresD v2.0; latest preliminary assets are RprelimD v3.0.

The annual archive occupies **9.366 GB** compressed. All audited rainfall sources plus the address ZIP occupy 9.708 GB. They remain ignored under `data/raw/rainfall-audit/`, not in Git or the published website. The rectangular grid is 265×370 at 1,000 m spacing in EPSG:2056. Valid-cell counts vary from 55,954 to 63,185 across the annual archive; that domain includes foreign catchments, so these counts are not Swiss-area counts.

The annual data and available 2026 files collectively provide contiguous date coverage from 1 January 1961 through 1 November 2026 (24,046 unique dates). Some dates have multiple product versions. The catalogue snapshot had no rainfall asset for 2 November yet. This is an availability snapshot, not a publication-time guarantee.

Passing these checks establishes file integrity and structural/numerical consistency. It does not establish that every rainfall estimate is accurate, homogeneous through time, or suitable for point-scale extremes.

## Address coverage: census, not a sample

The 3 November 2026 CH-only official directory contains **3,307,655 rows**: 3,256,366 with status `real` and 51,289 `planned`. All have finite coordinates and lie inside the rectangular grid extent. There are 31,409 occupied grid cells across all 26 cantons.

Each coordinate was assigned to its containing LV95 grid cell without interpolation or nearest-valid-cell substitution. That cell was checked against the intersection of valid-data masks across all 134 decoded rainfall files. The national boundary check separately used the official swissBOUNDARIES3D CH polygon.

| Coverage result | Address rows |
|---|---:|
| Inside/on the official CH polygon | 3,307,651 |
| Inside/on CH polygon and missing on any decoded day | 0 |
| All directory rows covered on every decoded day | 3,307,654 |
| Directory rows outside the CH polygon | 4 |

One uncovered row is EuroAirport Basel Mulhouse Freiburg: a Basel postal address with its coordinate outside the national polygon. Its rainfall cell is missing on every decoded day. The other three polygon exceptions are near-border coordinates (about 2 m, 3 m and 25 m outside this service geometry) with rainfall coverage. They are flags for review, not a legal determination or proof of address errors.

Every canton’s counts are retained in [address-coverage.json](rainfall-audit/address-coverage.json); polygon exceptions are in [address-boundary.json](rainfall-audit/address-boundary.json). This census concerns present-day directory coordinates, including planned entries; it does not reconstruct where buildings existed in 1961. Bulk coordinate coverage also does not prove the search API can resolve every spelling or input. Keep ambiguous search selection and missing-data handling explicit. Avoid rejecting near-border addresses solely on a strict polygon test or silently snapping them elsewhere.

## Preliminary versus consolidated rainfall

The public inventory contains no annual RprelimD archive. Its retained daily files overlap consolidated monthly RhiresD on **27 days, 4–30 September 2026**. All 27 pairs were compared, with no dates selected after inspecting revisions. We ranked the wettest days two ways: by final-product peak and by final-product mean over valid cells containing at least one listed address. These are unweighted grid-cell summaries, not population-weighted or whole-Switzerland area averages.

Here “final” means **the RhiresD consolidated monthly analysis**, which itself can be revised by annual reprocessing. Neither product is independent ground truth.

Wettest days by consolidated peak, mm:

| Date | Preliminary peak | Consolidated peak | Mean absolute cell change | Largest absolute cell change |
|---|---:|---:|---:|---:|
| 2026-09-16 | 70.9 | 63.6 | 0.12 | 12.5 |
| 2026-09-09 | 46.6 | 46.6 | 0.34 | 16.9 |
| 2026-09-08 | 41.6 | 41.6 | 0.25 | 5.7 |
| 2026-09-10 | 22.8 | 30.1 | 0.09 | 10.0 |
| 2026-09-13 | 20.5 | 20.4 | 0.13 | 2.4 |

Peak columns are each field’s maximum; the maximizing cell can differ. Change columns compare the same paired cells. There are 31,408 valid address-containing cells per paired day.

Wettest days by consolidated mean, mm:

| Date | Consolidated mean over address cells | Mean absolute cell change |
|---|---:|---:|
| 2026-09-08 | 9.53 | 0.25 |
| 2026-09-09 | 8.49 | 0.34 |
| 2026-09-16 | 6.09 | 0.12 |
| 2026-09-13 | 3.36 | 0.13 |
| 2026-09-10 | 0.51 | 0.09 |

On 9 September, the cell with the largest revision changed from **10.08 to 27.00 mm**. On 16 September, **88 cells** were at least 50 mm in the preliminary product, compared with **66** after consolidation; 22 fell below that threshold, with no reverse crossings. These are spatially dependent cells, not independent trials. The 50 mm threshold is a transparent descriptive check, not an official warning category.

Small mean changes can hide much larger local revisions. This overlap contains one day with a consolidated peak above 50 mm over address cells. It is **not a multi-season validation or a test of the historic 2005/2021 floods**, and it cannot calibrate rare-event probabilities. The complete daily comparisons and source hashes are in [preliminary-final.json](rainfall-audit/preliminary-final.json).

## Consolidated monthly data also changes

December 2025 is present in both the monthly series and the fully consolidated annual archive. All 31 dates and masks align. The largest amount difference is **7.45 mm**, including in an address-containing cell on 7 December: monthly **5.83 mm**, annual **13.28 mm**. This was independently re-read using annual bands 335–365 and monthly bands 1–31. See [consolidated-overlaps.json](rainfall-audit/consolidated-overlaps.json) and [consolidated-address-check.json](rainfall-audit/consolidated-address-check.json).

The monthly asset was updated on 22 January 2026; the annual archive on 2 February 2026. Use the intended consolidation hierarchy, not whichever duplicate was downloaded last: **annual archive → consolidated month → preliminary day**. Preserve product, version, provider checksum and acquisition time, and rebuild affected historical summaries when authoritative data change.

## What we can reliably publish next

- An observation-based **regional precipitation estimate around a selected address**, with source, period, status and freshness.
- Historical context using a consistent final-product reference record, with the recent selected amount clearly marked preliminary. Rankings may change after consolidation; do not imply exact certainty.
- Separate nearby-station measurements and station-based model results, with station distance/elevation and conditional uncertainty.
- Explicit “not available” for uncovered locations/days. A Swiss postal label does not guarantee the coordinate is inside Switzerland or covered by the rainfall mask.

The products measure precipitation, including snowfall water equivalent. Their daily window is **06:00 UTC on D to 06:00 UTC on D+1**, not Swiss midnight-to-midnight. The headline must make that period clear. Grid spacing does not establish building-scale spatial accuracy; the earlier [feasibility review](data-feasibility.md) documents those scientific limits.

Do not publish “a 50-year event at this house” from a grid-cell fit. This audit did not validate gridded return levels, remove smoothing bias, quantify interpolation uncertainty, or test model performance across spatially independent gauges. All four existing models can remain research tools with their current safeguards, but deploying address-selected extreme claims needs a separate scientific validation step.

## Reproduction and evidence

The scripts are explicit research/download tools and are not called by setup, build, serving or routine tests. Run in the repository’s `weather-modeller` environment. Optional packages are pinned in `requirements-audit.txt`; no packages were installed during this audit.

```sh
conda activate ./.environments/weather-modeller
python -m pip install --isolated --no-user --cache-dir .cache/pip -r requirements-audit.txt
python scripts/audit_rainfall_archive.py
python scripts/audit_address_boundary.py
```

First execution freezes catalogue snapshots and downloads data. Later runs reuse files only with matching provider checksums; per-file summaries also depend on the script SHA. To select a newer release, deliberately replace the two catalogue snapshots. These scripts describe this audit, not a production daily pipeline. Mutable URLs can change or expire; exact reproduction requires the retained matching source files and catalogue snapshots. A cold checkout fetches the then-current inventory, and a future archive year requires reviewing the explicit expected-year guard. Failed checks are retained for inspection and cause a nonzero exit. No invalid values are repaired into observations.

[Summary](rainfall-audit/summary.json), [annual files](rainfall-audit/annual-files.json), [monthly files](rainfall-audit/monthly-files.json), [preliminary files](rainfall-audit/preliminary-files.json), [address coverage](rainfall-audit/address-coverage.json), [boundary census](rainfall-audit/address-boundary.json), [daily revisions](rainfall-audit/preliminary-final.json).

Official sources: [MeteoSwiss grid delivery and revision cycle](https://opendatadocs.meteoswiss.ch/c-climate-data/c3-ground-based-climate-data), [rainfall STAC collection](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-surface-derived-grid), [swisstopo address directory](https://www.swisstopo.admin.ch/en/official-directory-of-building-addresses), [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d). Catalogue, file and boundary-response hashes are recorded in the evidence.
