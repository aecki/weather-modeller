# Contributing

## Start with a local checkout

```sh
python run.py setup
python run.py serve
```

The `weather-modeller` Conda environment is created at `.environments/weather-modeller/`. Do not install project dependencies into base or global Python/Node locations. Setup also installs the locked frontend build dependencies in node_modules. No API keys or cloud services are needed to run the bundled observations.

## Developer tools

```sh
python run.py dev
python run.py quality
python run.py check
```

`dev` explicitly installs the pinned optional Ruff and Prettier tools inside the repository (network required). `quality` checks Python imports, common errors and formatting, plus frontend formatting. `check` runs offline regression/data checks and builds the app. Normal users do not need Ruff or Prettier; React/visx and esbuild are installed locally by setup.

To apply Python formatting, activate `conda activate ./.environments/weather-modeller`, then run `python -m ruff check . --fix` and `python -m ruff format .`. For frontend formatting run `npm run format` in that activated environment.

## Change boundaries

- Frontend source belongs in `web/` (visx components in `web/graphics/`); Python application code belongs in `src/weather_modeller/`.
- Station and event selection belongs in `config/catalog.json`, not in UI code.
- Keep new dependencies in `environment.yml`, `requirements-dev.txt`, or `package.json`/`package-lock.json`, according to their purpose.
- Keep `.environments/`, `.cache/`, `data/raw/`, `node_modules/`, `outputs/` and `dist/` out of Git.
- Build output is disposable. Edit source, then rebuild; never patch `dist/` manually.
- Keep all data preparation and export writes within this checkout. Build and serve must not trigger remote data downloads.

## Scientific correctness

Use official observations in the app. Preserve missing values, observed zeroes, units, timestamps, provider flags and source provenance. Do not present fitted values as observations. Small synthetic values in isolated unit tests are fixtures, not application data.

Add regression tests when changing missingness, aggregation, date windows, cache invalidation or file replacement. Do not use live provider endpoints in tests. When intentionally refreshing data, review the snapshot and provenance changes together and run both checks above.

## Reviewing a change

A change should describe the user-visible behavior, its reason, and the checks run. Keep commits focused and avoid unrelated generated-file or snapshot changes. The CI matrix runs the same environment setup, tests, build and quality checks on macOS, Ubuntu and Windows. Remote CI results must be observed before claiming those platforms passed.

Architecture and methodology: [docs/architecture.md](docs/architecture.md), [docs/data.md](docs/data.md), [docs/environment.md](docs/environment.md).

## Scientific model checks

`python run.py check` also verifies the browser EVT calculations against the versioned real-data fixtures and executes the bundled worker. To regenerate those fixtures only, activate the local environment, run `python -m pip install --isolated --no-user --cache-dir .cache/pip -r requirements-science.txt`, then `python scripts/reference_models.py`. SciPy/lmoments3 are optional and are not runtime or routine CI dependencies. Read [docs/modelling.md](docs/modelling.md) before changing the estimator, resampling, supports, plotting positions or uncertainty language.
