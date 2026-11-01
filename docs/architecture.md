# Architecture and development

The app has a static frontend and a small Python preparation/serving toolchain with a local CSV-export endpoint. There is no database, external runtime service, frontend build framework or required npm install.

- `run.py` dispatches into `.environments/weather-modeller/`; `scripts/bootstrap.py` builds that isolated environment.
- `src/weather_modeller/cli.py` implements build, serve, check and explicit data fetch commands.
- `ingestion.py` reads the catalog, downloads/caches official sources and emits a compact JSON snapshot plus provenance.
- `exports.py` produces CSV selections from the snapshot and writes only to repository-local outputs.
- `aggregation.py` contains the river mean calculation shared by ingestion and Python tests.
- `web/data-core.js` contains the rainfall and annual-maxima calculations shared by the frontend and Node tests.
- `web/app.js` handles the map, event replay, charts, historical comparison and CSV export.
- `web/index.html` and `web/style.css` provide the responsive interface.
- `web/vendor/` and `web/geography/` contain locally served assets and required attribution.
- `python run.py build` copies source and processed data into generated `dist/`.

## Validation

`python run.py check` runs offline Python tests, JavaScript syntax checks and numerical/data-integrity checks against the included snapshot, then builds and verifies required assets. Python tests cover exact UTC boundaries, duplicate/missing hours, null/nonfinite values, observed zeroes, release flags, leap days, source encoding, catalog consistency and local runtime assets. Node tests cover rainfall missingness, zeroes, cross-year windows, complete-year maxima, array alignment, event windows, and all derived river means against original hourly observations.

Manual browser checks additionally exercise event switching, accumulation controls, station selection, chart cursors, playback, exports and methodology. Responsive CSS supports both a narrow stacked layout and a desktop map/analysis layout. A passing desktop test does not imply every device/browser has been tested.

## Development conventions

Keep downloaded originals in `data/raw/`, editable source in `web/` or `src/`, and generated files in `dist/`. Never edit `dist/` as source. Use relative filesystem/asset paths, UTF-8 and LF line endings. Add numerical tests for calculations where missingness or time windows can change scientific meaning. Run checks after changing the catalog or refreshing data. Avoid adding dependencies until needed; add them to the repository's dependency files and install only locally.

The optional Prettier version is pinned by `package-lock.json`; `.npmrc` keeps its cache in the repository. It is a development tool, not a runtime dependency.
