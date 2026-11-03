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

- Product name: aecki’s catastrophe lab. Keep repository/environment identifier `weather-modeller`.
- Build data graphics with visx in `web/graphics/`. Do not reintroduce manual chart-string rendering or CDN dependencies. Official swisstopo XYZ tiles are authorized for online map detail; retain bundled offline geography and offline builds/tests.
- Preserve GitHub Pages compatibility: relative asset/data paths, static build with browser exports, local serving with repository exports. Setup installs locked frontend dependencies; do not trigger npm installs during a build.

- The Model lab uses stationary annual-maxima GEV/Gumbel fits, with xi = -SciPy c. Read docs/modelling.md before altering the mathematics or confidence bands. Preserve worker cancellation, bootstrap failures, infinite bounds and model/observation separation.
- Verify mathematical changes against the versioned lmoments3/SciPy real-data references. Optional requirements-science.txt is only for fixture generation; do not add a scientific Python runtime dependency to the hosted site.

- The four-model comparison uses daily storm peaks for GPD/SMEV and forward held-out complete years. Preserve training-only thresholds/seeds, paired whole-year resampling, no overlapping retained peak windows, and null GPD estimates below its threshold. Run both reference suites, including `tests/test_comparison.mjs`; see docs/modelling.md.
