# Regional historical comparison

The address overview compares real regional precipitation estimates with **all days in the same calendar month**, using the frozen **1961–2025 RhiresD annual archive**. This is descriptive historical context, not a building measurement, future forecast or fitted return period. Station Pro Mode remains a separate dataset and modelling system.

## Reference and completeness

`prepare-history` checks provider SHA-256 values, NetCDF geometry, units, dates, masks and versions through the regional decoder. It processes all 65 complete annual sources. Cells intersecting the official Swiss national polygon buffered by 50 m are indexed, supporting the same near-border lookup policy as the daily view. No address is moved to a different cell.

For each cell, calendar month and year, store the count of days at or above each explicit precipitation threshold. Counts are exact integer statistics of the original float32 regional amounts; rainfall observations are not rounded, simulated or replaced. A month-year is included only if **every day is valid** for that cell. Threshold zero stores its valid-day denominator; an excluded month-year has denominator zero. Leap February denominators therefore remain 28/29. The selected year is excluded when it belongs to the reference period. Fewer than 20 eligible years yields an unavailable comparison.

The threshold list is recorded in the reference manifest. Canonical float32 threshold values prevent inconsistent equality tests across Python and JavaScript. For an amount between thresholds a and b, counts at b and a bound the exact number of historical days at least that wet. The headline uses the midpoint and says **about**; the method panel exposes the actual frequency bounds and thresholds. This resolution uncertainty is propagated into the displayed range. No interpolation is presented as an exact observed rank.

For amounts below 1 mm, the overview instead gives the exact frequency of **days with little or no precipitation (<1 mm)**, labelled explicitly. Positive amounts below 0.1 mm display as “<0.1” rather than as zero.

## Uncertainty and wording

Draw 1,000 samples of whole eligible years with replacement, using the same sampled years for the selected comparison and the rainfall-category graphic. Recompute the weighted day fraction (sum of counts / sum of valid days) in every sample. The displayed **95% year-resampling range** spans the 2.5th percentile of lower-frequency bounds to the 97.5th percentile of upper-frequency bounds. The seed derives from the immutable reference identity, cell and month; repeated lookups reproduce the result.

Resampling entire years preserves wet spells within each monthly record. Interpretation assumes years can serve as independent historical blocks; it does not establish guaranteed confidence coverage or future stationarity. Regional interpolation/measurement errors, revisions to a preliminary selected amount, changes in the observation network and changes in climate are not quantified by this sampling range. A preliminary amount therefore carries an explicit notice that its historical comparison can change.

A range is withheld unless at least five years certainly contain matching days and five contain non-matching days. This avoids zero-width reassurance in sparsely observed tails. Few or zero examples are not described as zero underlying risk. The overview exposes count bounds and says when there are too few examples, without extrapolating a return period.

Plain-language labels are descriptive: days with little or no precipitation are common when they constitute at least 20% of the reference days; “unusual” requires an upper resampling frequency below 5%; “wetter than most” requires the upper historical frequency bound below 20%. The counts, period and range remain visible alongside the label. These are not official warning categories.

The visx graphic groups actual days into <1, 1–<10, 10–<20, 20–<50 and ≥50 mm. These cutoffs exist exactly in the reference. Shares sum to 100%; supported year-resampling ranges appear as lines. The selected daily amount's category is highlighted.

## Data distribution and versions

The versioned reference is roughly 251 MB compressed, rather than publishing or fetching the 9.4 GB raw archive. `config/regional-history.json` pins a data-only GitHub release asset, archive SHA-256, manifest SHA-256 and reference identity. The manifest lists all 65 original annual URLs, hashes and provider versions. Cached references are checked before publishing; the daily workflow restores the pinned asset and does not recompute the national archive.

Static output contains a sorted little-endian uint32 flat-cell index and gzip-compressed uint8 count chunks. Within a chunk the order is cell / year / threshold. One chunk holds up to 256 cells for one month. The browser fetches only the needed month/chunk and verifies its SHA-256 before decompression, length and count checks. At most eight chunks are cached in memory. Changing location/month aborts pending requests and hides stale comparisons.

Preparation and restoration are explicit developer operations, kept inside the repository:

```sh
python run.py history-deps
python run.py prepare-history --start 1961 --end 2025
# Outputs: data/processed/regional-history/ and outputs/regional-history.tar.gz
```

Daily deployment uses `python run.py restore-history` with the workflow's repository-read GitHub token. The restore verifies archive and manifest identities, safely extracts into staging, validates all compressed assets and promotes only the complete reference. It never forwards GitHub authorization headers to a signed storage redirect. A local prepared reference needs no token. A new source snapshot requires deliberate regeneration and a new pinned data artifact; modifying the daily feed does not silently change the historical baseline.

## Independent checks

All months/chunks were decompressed and checked for correct denominators and monotone cumulative counts. A separate Rasterio 1.4.3 extraction reads 65 real November records at the public Bern grid cell. Every stored threshold count matches these independently read values. Fixed year-resample indices and NumPy 2.5.4 percentiles provide the regression reference for browser intervals, including sparse tails and exact bracketing. Tests also cover selected-year exclusion, missing-month exclusion, determinism and corrupt payloads. See `tests/fixtures/regional-history/`.

Data source and revision conventions: [MeteoSwiss grid documentation](https://opendatadocs.meteoswiss.ch/c-climate-data/c3-ground-based-climate-data). The [original feasibility audit](rainfall-audit.md) documents the spatial limitations of these observation-based analyses. The year-block principle is also used in [pyTENAX's precipitation bootstrap](https://pytenax.readthedocs.io/en/latest/tutorials/Tutorial_04.html); this overview uses empirical frequencies, not SMEV fits.
