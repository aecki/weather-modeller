# Repository conventions

- The product is an online web app with a repository-local development environment. Keep the Conda environment named `weather-modeller` inside `.environments/weather-modeller/` and all project caches/data/exports inside the checkout. Never install into base or change global configuration.
- Run commands through `python run.py`. Normal verification is `python run.py check`; when developer tools are installed, also run `python run.py quality`. Install optional tools with `python run.py dev`.
- Read CONTRIBUTING.md and the applicable docs before changing architecture or data interpretation.
- Edit `web/` and `src/weather_modeller/`, not generated `dist/`.
- Preserve real observations, missingness, units, UTC windows, release flags and provenance. Never substitute synthetic data into the app. Tests may use clearly isolated fixtures.
- Keep setup portable across macOS, Linux and Windows. Do not add absolute machine paths or mandatory hosted services.
- Data refreshes must be deliberate. Serving, building and tests remain offline.
- Keep scientific, cache and file-replacement regression tests meaningful. Do not add tests that merely mirror trivial presentation changes.
- Do not commit environments, caches, raw downloads, node_modules, exports or build output. Do not claim remote CI passed without observing it.

- Product name: aeckis rainfall explorer. Keep repository/environment identifier `weather-modeller`.
- Build data graphics with visx in `web/graphics/`. Do not reintroduce manual chart-string rendering or CDN dependencies. Official swisstopo XYZ tiles are authorized for online map detail; the product map is online-only; builds and tests remain network-free.
- Preserve GitHub Pages compatibility: relative asset/data paths, static build with browser exports, static development preview with browser downloads. Setup installs locked frontend dependencies; do not trigger npm installs during a build.

- The Model lab uses stationary annual-maxima GEV/Gumbel fits, with xi = -SciPy c. Read docs/modelling.md before altering the mathematics or confidence bands. Preserve worker cancellation, bootstrap failures, infinite bounds and model/observation separation.
- Verify mathematical changes against the versioned lmoments3/SciPy real-data references. Optional requirements-science.txt is only for fixture generation; do not add a scientific Python runtime dependency to the hosted site.

- The four-model comparison uses daily storm peaks for GPD/SMEV and forward held-out complete years. Preserve training-only thresholds/seeds, paired whole-year resampling, no overlapping retained peak windows, and null GPD estimates below its threshold. Run both reference suites, including `tests/test_comparison.mjs`; see docs/modelling.md.

- Daily regional ingestion is explicit (`fetch-regional`) and scheduled by the Pages workflow. Read docs/regional-pipeline.md before altering source precedence, time/axis conventions, release schemas or address lookup. Keep regional data separate from the station snapshot and modelling worker; do not commit generated releases or raw sources.

- Historical regional summaries and year-bootstrap overview follow docs/regional-history.md. Preserve completeness, same-month comparisons, threshold bounds, sparse-tail guards, selected-year exclusion and immutable artifact/manifest hashes. Keep all station models separate. The bundled offline map was explicitly removed by the user; preserve development tools.

- Regional address models follow docs/regional-modelling.md: fixed ≥400-cell Swiss footprints, complete daily area means before 1/3/5-day maxima, no year-crossing windows, GEV/Gumbel only. Keep area-average thresholds separate from containing-cell daily values and all station analyses. Preserve pinned reference hashes and the independent regional fixtures.

- The full calendar uses docs/full-calendar.md. Keep the pinned official raw byte-range index, per-day raw/normalized SHA-256, 206-only requests, axes/fill rules and 366-day recent bridge. Never fall back to full-year browser downloads or fake unavailable dates. The standalone app, local export API and runtime switch have been removed; keep only static development preview and build/data tools.

- Expanded overview and full station/lake access follow docs/overview-water-network.md. Never shrink the ≥400-cell return-period footprint to imply local precision. Monthly cell summaries are descriptive smoothed estimates. Historical extremes are five non-overlapping real windows, not editorial event names or annual-maxima-only ranks. Keep overlapping station network histories separate; annual totalisers are not daily series. Lake historical analogues remain a sparse-guarded, right-censored comparison. Zurich/Constance additionally use the experimental weather-conditioned outlook documented in docs/lake-recovery.md. Preserve training/forecast availability cutoffs, full transboundary catchments, missingness, unrecovered paths, and explicit weak-skill/uncalibrated-ensemble warnings. Preserve source timestamps, height datums, unknown release flags, stale-data warnings and missing follow-up.

- Pro Mode navigation is intentionally minimal: Address analysis and Stations & gauges only. Keep all station tools in the unified network workspace, preserve legacy URL redirects, and never mark unloaded map locations as measured missing rainfall. The map groups station codes; separate network histories remain separate in the finder.
