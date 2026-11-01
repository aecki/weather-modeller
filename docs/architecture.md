# Architecture and development

The app has a static frontend and a small Python preparation/serving toolchain with a local CSV-export endpoint. There is no database, external runtime service, frontend build framework or required npm install.

- `run.py` dispatches into `.environments/weather-modeller/`; `scripts/bootstrap.py` builds that isolated environment.
- `cli.py` routes commands; `build.py` stages and validates complete builds before replacing the last working app; `server.py` serves the app and handles local exports; `checks.py` runs verification.
- `catalog.py` validates event/station selection. `sources.py` handles cached downloads and provenance. `ingestion.py` prepares the observation snapshot. `validation.py` checks its contract before a refresh or build.
- `exports.py` produces CSV selections from the snapshot. `storage.py` provides unique temporary files and atomic replacement for exports and source caches.
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

Optional developer tools are pinned in `requirements-dev.txt` (Ruff) and `package-lock.json` (Prettier). `python run.py dev` installs both locally; `python run.py quality` checks both. `pyproject.toml` records Python project metadata and quality rules. `.npmrc` keeps the npm cache in the repository. These tools are not runtime dependencies.

## Failure handling

Builds validate the observation schema and required assets in a staging directory inside `.cache/build/`. An incomplete copy never deletes the working app; a failed promotion restores the previous directory. Staging directories are cleaned on exit. Builds should be run serially.

Exports and cache writes use unique temporary files in the destination directory and an atomic replace after writing/flushing. Concurrent exports to the same name produce a complete last-writer-wins file. Source cache hits require both URL and request-body equality. Regression tests cover these behaviors and invalid observation values.
