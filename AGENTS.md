# Repository conventions

- This is a standalone local app. Keep the Conda environment named `weather-modeller` inside `.environments/weather-modeller/` and all project caches/data/exports inside the checkout. Never install into base or change global configuration.
- Run commands through `python run.py`. Normal verification is `python run.py check`; when developer tools are installed, also run `python run.py quality`. Install optional tools with `python run.py dev`.
- Read CONTRIBUTING.md and the applicable docs before changing architecture or data interpretation.
- Edit `web/` and `src/weather_modeller/`, not generated `dist/`.
- Preserve real observations, missingness, units, UTC windows, release flags and provenance. Never substitute synthetic data into the app. Tests may use clearly isolated fixtures.
- Keep setup portable across macOS, Linux and Windows. Do not add absolute machine paths or mandatory hosted services.
- Data refreshes must be deliberate. Serving, building and tests remain offline.
- Keep scientific, cache and file-replacement regression tests meaningful. Do not add tests that merely mirror trivial presentation changes.
- Do not commit environments, caches, raw downloads, node_modules, exports or build output. Do not claim remote CI passed without observing it.
