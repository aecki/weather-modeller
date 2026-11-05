# aecki's rainfall explorer

A static web app for **daily regional Swiss precipitation estimates** and a separate laboratory for **real historical station rainfall and river observations**. The published GitHub Pages site needs only a browser. Address estimates carry preliminary/consolidated status and source versions; station models remain separate. The development environment, caches, data and build output stay inside this repository.

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
python run.py build                 # Produce the static website in dist/
python run.py check                 # Run numerical, data-integrity and asset checks
python run.py dev                   # Install optional repo-local developer tools
python run.py quality               # Check Python/frontend style and common errors
python run.py fetch                 # Explicitly download missing source data, reuse matching cache
python run.py fetch --refresh       # Explicitly re-download official source observations
python run.py setup --update        # Update this repository's environment from environment.yml
```

CSV selections download directly from the browser. There is no standalone desktop app or local export API.

Neither `serve`, `build` nor `check` refreshes data. The original observation snapshot is retained as a scientific test reference and is excluded from the published site. The web app loads official station histories, swisstopo map/search services and verified MeteoSwiss range downloads online.

## Repository structure

```text
weather-modeller/
├── environment.yml        # Portable Conda dependency specification
├── .condarc               # Project-only solver/channel settings
├── run.py                 # Portable local-environment launcher
├── config/catalog.json    # Station selection, history range, event windows
├── src/weather_modeller/  # Python ingestion, aggregation and app commands
├── web/                   # Editable HTML, CSS and JavaScript
│   └── graphics/          # React + visx map, charts and interactive explanation
├── data/
│   ├── processed/         # Tracked observations and source provenance
│   └── raw/               # Original downloads and request metadata (ignored)
├── outputs/               # Data-preparation artifacts (ignored)
├── tests/                 # Python and Node tests; no live network requests
├── scripts/               # Bootstrap and command entrypoints
├── docs/                  # Setup, architecture and data methodology
├── .github/workflows/     # Cross-platform checks for future pushes
├── .environments/
│   └── weather-modeller/  # Actual local environment (ignored)
├── .cache/                # Conda/npm/Python caches and temp files (ignored)
├── node_modules/          # Local frontend/compiler dependencies (ignored)
└── dist/                  # Generated static web assets (ignored)
```

## Working on another device

Clone the repository, then run the same two startup commands. Recreate `.environments/weather-modeller/` on each device—**do not copy an environment between operating systems or move it with the checkout**. Conda binaries embed their installation prefix. If you move the repository, remove/recreate its disposable `.environments/weather-modeller/` environment at the new location.

Python 3.12 and Node.js 22 are constrained in `environment.yml`, using conda-forge only. This file intentionally has no machine-specific prefix or platform build strings. `environment/locks/` contains an exact package snapshot for the platform tested here; it is not a cross-platform lock. See [environment notes](docs/environment.md).

## Included observations

- **MeteoSwiss / SwissMetNet:** daily rainfall (`rre150d0`), 18 selected stations, 1981–2025.
- **FOEN:** original hourly mean river discharge at six selected gauges for three replay windows: August 2005, July 2021 and June 2024.
- **Derived:** 1/3/5-day rainfall sums, complete-year annual maxima, and aligned 24-hour river means. No synthetic weather, flood depths or insurance losses.

Every source response has its exact URL/request, retrieval time and SHA256 recorded in `data/processed/provenance.json`. Missing observations stay missing. See [data methodology](docs/data.md) for time boundaries and limitations.

Source: [MeteoSwiss, Automatic weather stations](https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations). Source: [FOEN, Hydrological observations](https://data.bafu.admin.ch/en/dataproduct-water-observations). Map background: © swisstopo, official online national-map tiles. The offline-map fallback has been removed. Graphics use React and visx, bundled with dependency notices in the generated site.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. Optional developer tools are installed locally and pinned separately from app dependencies:

```sh
python run.py dev
python run.py quality
python run.py check
```

`dev` requires internet access; the two check commands run offline. Python code is checked/formatted with Ruff (`pyproject.toml`); frontend formatting uses Prettier (`package-lock.json`). The same checks are configured in the cross-platform CI matrix. Frontend build dependencies are installed by setup. Site visitors need only a browser.

## GitHub Pages

The app is ready to build as a static website. See [GitHub Pages setup](docs/github-pages.md) for deployment. A checked-in Actions workflow builds/tests `dist/` and deploys it after Pages is enabled. Both the website and its development preview use browser CSV downloads.

The page includes a **How it works** section with a visx illustration driven by the selected real measurements. Maps, charts and comparison graphics all use visx.

## Extreme-value Model lab

Fit stationary GEV or Gumbel distributions to real complete-year rainfall maxima. Change the station, 1/3/5-day duration, fitting years, replay-year exclusion, return period and confidence level. The visx return-level curve shows pointwise bootstrap uncertainty and extrapolation; threshold probabilities and Q–Q/time diagnostics help inspect the fit. Computation stays in a browser worker, including on GitHub Pages.

The lab estimates rainfall hazard, not flood depths or insured losses. Its conditional sampling intervals exclude climate change and model-choice uncertainty. See [the full modelling method](docs/modelling.md) for assumptions, fitting equations, failed fits, infinite bounds and verification against independent scientific references.

### GPD / SMEV and held-out comparison

The Model lab also compares GEV, Gumbel, GPD and SMEV using earlier complete years for training and the latest 5/10/15 for testing. Inspect training-only return curves, year-bootstrap intervals, paired model differences and held-out Brier/quantile scores. Storm separation and tail-fitting settings are explicit. Computation stays in a bundled browser worker; only recorded Swiss observations and resampled observed year blocks are used. See [model methods](docs/modelling.md).

The published GitHub Pages site needs only a browser. Conda/Python are for local preparation, development and serving, not for visitors. Online map detail uses the official swisstopo XYZ service; turn off Online detail for bundled geography. Tile failure switches to that fallback. All observations and model calculations remain local to the browser.

## Daily regional data

The [daily pipeline](docs/regional-pipeline.md) publishes a rolling 366-day release plus a small index of every final annual archive day since 1961. Pages refreshes at 12:45 and 18:45 UTC (best-effort scheduling), with source checksums, consolidation precedence and atomic publication. Address searches use swisstopo; estimates describe the surrounding region, not individual buildings. Pro Mode retains the historical station snapshot and all four models.

For local preparation, run `python run.py regional-deps`, then `python run.py fetch-regional`. Both commands use the repository environment and caches. Ordinary builds remain network-free.

## Address history and online-only maps

The overview compares each supported address with real same-month regional days from 1961–2025, explains historical frequency in plain language and shows year-resampling uncertainty. [Historical method and pinned data reference](docs/regional-history.md). Address suggestions appear while typing. Normal scrolling over the online swisstopo map scrolls the page; Ctrl/Command + wheel zooms, and touch exploration is opt-in.

There is no bundled offline map or separate offline distribution. Conda, local preview and network-free tests are retained for development and reproducibility. Visitors use the online site.

Address-selected Pro Mode fits regional-average rainfall extremes from the real 1961–2025 archive, with GEV/Gumbel, 1/3/5-day windows and sampling ranges. Station analysis remains separate with all four models. Overview and Pro Mode share a selectable rainfall day; Overview adds clear historical context and regional rainfall facts. See [regional model methods](docs/regional-modelling.md).

### Monthly rainfall, full station access and lake levels

Overview includes monthly totals, historical variability, yearly records and the five largest non-overlapping rainfall windows. Pro Mode → **All stations & gauges** exposes every inventoried daily precipitation series in the automatic-weather, automatic-precipitation and manual networks, plus the complete FOEN gauge directory. Annual-only mountain totalisers are listed separately. The full-network map and all four models share this single workspace; the former sample-only explorer/model pages redirect to it.

The lake section shows measured levels for 25 selected lakes against their usual seasonal range. Where enough comparable historical years exist, it shows an experimental historical recovery-time comparison with sampling uncertainty. It withholds dates where evidence is insufficient. This is not an operational, weather-driven lake forecast. [Definitions, sources and limits](docs/overview-water-network.md).

Explicit preparation uses the repository environment:

```sh
conda activate ./.environments/weather-modeller
python scripts/prepare_station_directory.py
python scripts/prepare_water.py
```

The Pages workflow refreshes station metadata and FOEN lake observations. Local serving, checks and builds do not fetch data. The compact 1961–2025 monthly reference is versioned in the repository; its optional regeneration uses `scripts/prepare_overview_history.py` and the previously audited local annual sources.
