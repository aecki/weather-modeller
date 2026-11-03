# Architecture and development

The app has a static frontend and a small Python preparation/serving toolchain with a local CSV-export endpoint. There is no database or modelling backend. The map optionally loads official swisstopo XYZ tiles, without an offline raster fallback; observations and modelling remain independent of that service. A small esbuild step bundles React and visx; setup installs its pinned npm dependencies locally.

- `run.py` dispatches into `.environments/weather-modeller/`; `scripts/bootstrap.py` builds that isolated environment.
- `cli.py` routes commands; `build.py` stages and validates complete builds before replacing the last working app; `server.py` serves the app and handles local exports; `checks.py` runs verification.
- `catalog.py` validates event/station selection. `sources.py` handles cached downloads and provenance. `ingestion.py` prepares the observation snapshot. `validation.py` checks its contract before a refresh or build.
- `exports.py` produces CSV selections from the snapshot. `storage.py` provides unique temporary files and atomic replacement for exports and source caches.
- `aggregation.py` contains the river mean calculation shared by ingestion and Python tests.
- `web/data-core.js` contains the rainfall and annual-maxima calculations shared by the frontend and Node tests.
- `web/app.js` handles the map, event replay, charts, historical comparison and CSV export.
- `web/index.html` and `web/style.css` provide the responsive interface.
- `web/graphics/` contains React/visx visual components: the station map, observation charts, historical comparisons and the live accumulation explanation. `scripts/build_frontend.mjs` bundles them and generates third-party licence notices.
- `web/geography/` contains local geographic assets and provenance.
- `python run.py build` copies source and processed data into generated `dist/`.

## Validation

`python run.py check` runs offline Python tests, JavaScript syntax checks and numerical/data-integrity checks against the included snapshot, then builds and verifies required assets. Python tests cover exact UTC boundaries, duplicate/missing hours, null/nonfinite values, observed zeroes, release flags, leap days, source encoding, catalog consistency and local runtime assets. Node tests cover rainfall missingness, zeroes, cross-year windows, complete-year maxima, array alignment, event windows, and all derived river means against original hourly observations.

Manual browser checks additionally exercise event switching, accumulation controls, station selection, chart cursors, playback, exports and methodology. Responsive CSS supports both a narrow stacked layout and a desktop map/analysis layout. A passing desktop test does not imply every device/browser has been tested.

## Development conventions

Keep downloaded originals in `data/raw/`, editable source in `web/` or `src/`, and generated files in `dist/`. Never edit `dist/` as source. Use relative filesystem/asset paths, UTF-8 and LF line endings. Add numerical tests for calculations where missingness or time windows can change scientific meaning. Run checks after changing the catalog or refreshing data. Avoid adding dependencies until needed; add them to the repository's dependency files and install only locally.

Optional developer tools are pinned in `requirements-dev.txt` (Ruff) and `package-lock.json` (Prettier). `python run.py dev` installs both locally; `python run.py quality` checks both. `pyproject.toml` records Python project metadata and quality rules. `.npmrc` keeps the npm cache in the repository. These tools are not runtime dependencies.

## Failure handling

Builds validate the observation schema and required assets in a staging directory inside `.cache/build/`. An incomplete copy never deletes the working app; a failed promotion restores the previous directory. Staging directories are cleaned on exit. Builds should be run serially.

Exports and cache writes use unique temporary files in the destination directory and an atomic replace after writing/flushing. Replacement operations are serialised within the app process to avoid Windows sharing violations. Concurrent exports to the same name produce a complete last-writer-wins file. Source cache hits require both URL and request-body equality. Regression tests cover these behaviors and invalid observation values.

## Static hosting

`python run.py build` emits a complete static Pages artifact, with browser-side CSV downloads. `serve` selects repository exports in its generated runtime config. Neither build depends on a hosted API. Relative asset/data URLs support both a domain root and a GitHub repository subpath. See [GitHub Pages](github-pages.md).

Graphics use visx geometry, scales, axes, grids and shapes throughout. The UI controller keeps selections in one place and passes measured values/callbacks into React graphic components. visx never creates or interpolates missing weather observations; river line paths explicitly break at gaps.

## Browser extreme-value modelling

`web/modelling/extremes.mjs` implements pure L-moment GEV/Gumbel fitting, return levels, exceedance calculations and seeded resampling of observed annual maxima. `worker.mjs` runs refits off the main thread and is bundled as `model-worker.js`. `ModelLab.jsx` manages fit settings, worker cancellation, limited result caching and conditional uncertainty; `ModelCharts.jsx` renders visx return-level bands and diagnostics. The controller passes the existing complete-year maxima into the lab, preserving the observation/model distinction.

The generated worker is a required build asset. Node checks execute that worker and compare calculations to 108 versioned lmoments3/SciPy reference cases. No scientific Python dependency is needed to build, run or check the site; pinned optional science packages only regenerate the checked-in references. See [modelling.md](modelling.md).

`comparison.mjs` extracts daily storm/year blocks and implements GPD/SMEV annual tails, paired training-year bootstrap and forward-held-out scoring. The existing bundled worker dispatches comparison jobs separately from full-record GEV/Gumbel jobs. `ModelComparison.jsx` cancels stale jobs and caches limited results; `ComparisonCharts.jsx` renders model disagreement and held-out observations with visx. Independent SciPy/lmoments3 real-data comparisons run through `tests/test_comparison.mjs`.

## Daily regional release

`regional.py` discovers the current STAC inventory, selects annual/monthly/preliminary sources per date, verifies and decodes them with netCDF4, and stages a content-addressed static release. `build.py` validates any prepared release before copying it. The Pages workflow performs the explicit refresh before its normal offline checks/build. `DailyRegional.jsx` mounts independently of the station controller; `regional-data.mjs` owns coordinate, boundary and binary lookup logic. No regional values enter the station modelling worker. See [pipeline contracts and failure handling](regional-pipeline.md).

`regional_history.py` prepares lossless per-year/month threshold counts from the annual archive and restores an immutable pinned data artifact for deployment. The browser `regional-history.mjs` computes empirical frequency bounds and year-bootstrap ranges; `HistoricalOverview.jsx` renders plain-language context and visx category bars. These data never enter the station modelling worker. See [method](regional-history.md).
