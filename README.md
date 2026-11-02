# aecki’s catastrophe lab

A standalone, local web app for exploring **real Swiss rainfall and river observations**. The application, Conda environment, package caches, data and build output stay inside this repository. No database, API key or internet connection is needed to explore the included snapshot after setup. The static build can also be published on GitHub Pages.

## Start here

From the repository root, with an existing Conda installation available:

```sh
python run.py setup
python run.py serve
```

Open **http://127.0.0.1:8765**. Stop the server with Ctrl+C.

`setup` creates **`.environments/weather-modeller/` inside this checkout**. It uses the existing Conda executable as a bootstrap tool; it does not install into or update `base`, write a global Conda configuration, or register the environment in your home directory. Its package cache and temporary files are also local. Initial setup installs the Conda environment and locked frontend build dependencies locally and needs internet access; subsequent serving, building and checking do not.

On macOS/Linux you can then use `.environments/weather-modeller/bin/python run.py serve` directly; on Windows use `.environments\weather-modeller\python.exe run.py serve`. `run.py` automatically uses that local interpreter. It works from any current directory when invoked with the path to the script.

## Commands

```sh
python run.py serve                 # Build and serve locally, loopback only
python run.py serve --port 8766     # Choose a different local port
python run.py build                 # Produce the complete offline app in dist/
python run.py check                 # Run numerical, data-integrity and asset checks
python run.py dev                   # Install optional repo-local developer tools
python run.py quality               # Check Python/frontend style and common errors
python run.py fetch                 # Explicitly download missing source data, reuse matching cache
python run.py fetch --refresh       # Explicitly re-download official source observations
python run.py setup --update        # Update this repository's environment from environment.yml
```

The **Save CSV in repository** button writes a selection to `outputs/` inside this checkout.

Neither `serve`, `build` nor `check` refreshes data. The downloaded snapshot is tracked so a fresh clone can run without downloading historical observations. Links to source documentation only contact those sites if you choose to open them.

## Repository structure

```text
weather-modeller/
├── environment.yml        # Portable Conda dependency specification
├── .condarc               # Project-only solver/channel settings
├── run.py                 # Portable local-environment launcher
├── config/catalog.json    # Station selection, history range, event windows
├── src/weather_modeller/  # Python ingestion, aggregation and app commands
├── web/                   # Editable HTML, CSS and JavaScript
│   ├── geography/         # Bundled topographic map + provenance
│   └── graphics/          # React + visx map, charts and interactive explanation
├── data/
│   ├── processed/         # Tracked observations and source provenance
│   └── raw/               # Original downloads and request metadata (ignored)
├── outputs/               # CSV selections saved by the local app (ignored)
├── tests/                 # Python and Node tests; no live network requests
├── scripts/               # Bootstrap and command entrypoints
├── docs/                  # Setup, architecture and data methodology
├── .github/workflows/     # Cross-platform checks for future pushes
├── .environments/
│   └── weather-modeller/  # Actual local environment (ignored)
├── .cache/                # Conda/npm/Python caches and temp files (ignored)
├── node_modules/          # Local frontend/compiler dependencies (ignored)
└── dist/                  # Generated self-contained web app (ignored)
```

## Working on another device

Clone the repository, then run the same two startup commands. Recreate `.environments/weather-modeller/` on each device—**do not copy an environment between operating systems or move it with the checkout**. Conda binaries embed their installation prefix. If you move the repository, remove/recreate its disposable `.environments/weather-modeller/` environment at the new location.

Python 3.12 and Node.js 22 are constrained in `environment.yml`, using conda-forge only. This file intentionally has no machine-specific prefix or platform build strings. `environment/locks/` contains an exact package snapshot for the platform tested here; it is not a cross-platform lock. See [environment notes](docs/environment.md).

## Included observations

- **MeteoSwiss / SwissMetNet:** daily rainfall (`rre150d0`), 18 selected stations, 1981–2025.
- **FOEN:** original hourly mean river discharge at six selected gauges for three replay windows: August 2005, July 2021 and June 2024.
- **Derived:** 1/3/5-day rainfall sums, complete-year annual maxima, and aligned 24-hour river means. No synthetic weather, flood depths or insurance losses.

Every source response has its exact URL/request, retrieval time and SHA256 recorded in `data/processed/provenance.json`. Missing observations stay missing. See [data methodology](docs/data.md) for time boundaries and limitations.

Source: [MeteoSwiss, Automatic weather stations](https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations). Source: [FOEN, Hydrological observations](https://data.bafu.admin.ch/en/dataproduct-water-observations). Map background: © swisstopo, bundled Swiss Map Raster 500 with relief and rivers. Source attribution and provenance are bundled locally. Graphics use React and visx, bundled with dependency notices in the generated site.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. Optional developer tools are installed locally and pinned separately from app dependencies:

```sh
python run.py dev
python run.py quality
python run.py check
```

`dev` requires internet access; the two check commands run offline. Python code is checked/formatted with Ruff (`pyproject.toml`); frontend formatting uses Prettier (`package-lock.json`). The same checks are configured in the cross-platform CI matrix. Frontend build dependencies are installed by setup. Site visitors need only a browser.

## GitHub Pages

The app is ready to build as a static website. See [GitHub Pages setup](docs/github-pages.md) for deployment. A checked-in Actions workflow builds/tests `dist/` and deploys it after Pages is enabled. Static hosting uses browser CSV downloads; local serving retains repository-local CSV saves.

The page includes a **How it works** section with a visx illustration driven by the selected real measurements. Maps, charts and comparison graphics all use visx.

## Extreme-value Model lab

Fit stationary GEV or Gumbel distributions to real complete-year rainfall maxima. Change the station, 1/3/5-day duration, fitting years, replay-year exclusion, return period and confidence level. The visx return-level curve shows pointwise bootstrap uncertainty and extrapolation; threshold probabilities and Q–Q/time diagnostics help inspect the fit. Computation stays in a browser worker, including on GitHub Pages.

The lab estimates rainfall hazard, not flood depths or insured losses. Its conditional sampling intervals exclude climate change and model-choice uncertainty. See [the full modelling method](docs/modelling.md) for assumptions, fitting equations, failed fits, infinite bounds and verification against independent scientific references.
