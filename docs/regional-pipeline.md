# Daily regional precipitation and address lookup

The online page has a daily regional lookup and a separate historical station/Pro Mode laboratory. Address selection never changes a station measurement or supplies gridded values to the station models. GEV, Gumbel, GPD, SMEV, held-out comparisons, uncertainty, replay events, river charts and exports remain available.

## Published scope

A release requests the latest 90 complete rainfall-day labels by default. Recent data come from RprelimD; consolidated dates use RhiresD. These are observation-based regional estimates, including snowfall water equivalent, not measurements at buildings. Daily periods remain 06:00 UTC on D to 06:00 UTC on D+1. Dates missing from the provider inventory remain explicitly unavailable. The page defaults to the latest available day, rather than inventing yesterday's amount.

The lookup does not yet supply historical regional rankings or address-specific extreme estimates. Pro Mode retains the independently versioned 1981–2025 station snapshot. The full national historical archive remains outside the browser bundle; see the [audit](rainfall-audit.md).

## Explicit refresh

Activate the repository environment and install the optional ingestion dependencies there:

```sh
conda activate ./.environments/weather-modeller
python -m pip install --isolated --no-user --cache-dir .cache/pip -r requirements-regional.txt
python run.py fetch-regional
python run.py serve
```

`--days` accepts 1–366 days. `--through YYYY-MM-DD` selects an explicit final rainfall-day label, for research/reprocessing. Incomplete future rainfall windows are rejected. Ordinary `build`, `serve` and `check` do not contact providers. A checkout without a prepared regional release builds a small unavailable-data manifest; the station tools still run.

The pipeline uses pinned NumPy/netCDF4 dependencies, not a platform-dependent optional GDAL reader. It decodes NetCDF time, masks, units, coordinate arrays and required LV95 metadata; axes are normalized to north-to-south rows and west-to-east columns. Real single-day and 89-day outputs were checked byte for byte against an independent Rasterio/GDAL export. NetCDF packages are needed by ingestion only, not by visitors or the static site.

## Source selection and provenance

For each date, select the highest available consolidation tier:

1. Annual RhiresD archive.
2. Consolidated monthly RhiresD.
3. Preliminary daily RprelimD.

Provider modification timestamps do not override this hierarchy. Ambiguous same-tier sources fail rather than being selected arbitrarily. STAC pagination is followed; URLs and provider SHA-256 multihashes are validated. Cached source files are keyed by checksum, so revisions create a new source identity. Each used file is verified before decoding; corrupt caches fail explicitly.

The manifest records the product, provider version, status, original item/asset/URL, provider checksum and update time, and release verification time. New downloads record retrieval time. Reused audit downloads have an explicitly unknown retrieval time. A SHA-256 of the discovered catalogue identifies the inventory used.

Every derived float32 grid is independently content-addressed and hashed. Values retain their source precision; only masked cells become NaN. Negative, infinite and nonfinite unmasked source values fail validation. The displayed decimal rounding does not alter the stored field. Zero is a valid estimate; missing data remains unavailable.

## Atomic publication and failures

Sources and generated output live only under the repository:

- `data/raw/regional/`: checksummed NetCDF cache, download provenance and the previous successful manifest.
- `data/processed/regional/`: generated current release, ignored by Git.
- `.cache/regional-build/`: disposable staging directories.
- `dist/data/regional/`: static published release copied by the build.

All requested dates must be accounted for as available or unavailable. The full release, including payload hashes and lengths, is validated before directory promotion. Failed downloads, malformed inputs, checksums or decoding preserve the previous release; failed promotion rolls it back. A known previously published date cannot silently disappear or fall to a lower consolidation tier within the requested range. The previous manifest is included in the Actions source cache for this guard across runners. Data more than seven days behind the requested end date fail the refresh.

The published website is replaced only after ingestion, tests and the static build succeed. A failed scheduled job leaves the deployed website in place. The page exposes the last successful refresh and computes the latest completed rainfall day from the current UTC clock, so an old deployment remains visibly dated. Source/cache storage is not a permanent archival service; original provider URLs and GitHub caches can expire.

## Scheduling and hosting

The existing Pages workflow refreshes on pushes, manual dispatch and scheduled runs at **12:45 and 18:45 UTC**. The later run rechecks late publication and revisions. Actions schedules are best-effort, not a guaranteed publication SLA; inspect failed runs and rerun manually if needed. [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The workflow installs pipeline packages into `.environments/weather-modeller`, restores the content-addressed source cache, refreshes data, then runs the full checks and deploys the static artifact. No API key, separate database or application backend is required for this rolling lookup. Generated grids are published as static assets, not committed to Git. Cross-platform CI installs the ingestion dependencies and runs the real NetCDF regression checks on Linux, macOS and Windows.

## Address lookup

Search is submitted directly to the official [swisstopo SearchServer](https://docs.geo.admin.ch/access-data/search.html). Inputs are not stored by the app or added to URLs/browser history. swisstopo receives the submitted query. Up to eight candidates are presented for explicit selection; the first match is not assumed exact.

With `sr=2056`, the service's `x` is northing and `y` is easting; its returned GeoJSON coordinates also use north/east order in the captured real response. The client uses the explicit attributes and validates coordinate ranges. Regression tests pin this real public-address response to prevent a silent axis swap.

The selected coordinate is checked against the official Swiss national polygon. Points up to 50 m outside that service geometry are flagged as near-border, preserving their original coordinates; farther points are unsupported. This accommodates the audit's near-border cases without silently snapping a point. The containing rainfall cell is then selected; there is no nearest-station or nearest-valid-cell substitution. EuroAirport's Swiss postal label does not make its coordinate supported. National polygon checks are geographic screening, not legal boundary adjudication.

The browser verifies both boundary and selected grid SHA-256 values, fetches one daily field at a time and keeps at most eight decoded fields. Changing address/date aborts pending work and hides the previous result. Reloading refreshes the manifest. Address failures, missing days and failed integrity checks do not affect the station laboratory.

## Validation

Offline tests cover tier precedence, same-tier ambiguity, source corruption/revisions, loss/downgrade guards, actual provider values, missing versus zero, native axis reversal, invalid precipitation, date alignment, atomic rollback and release integrity. JavaScript checks cover a real SearchServer response, an independent real-data payload, UTC 06:00 day boundaries and polygon holes/border tolerance. Synthetic catalogue/geometry/corruption fixtures are isolated to tests and never served as observations.

The independent data references are documented under `tests/fixtures/regional/`. Builds without optional NetCDF dependencies skip only decoder-specific Python checks; the Pages and cross-platform workflows install those dependencies so they execute there.
