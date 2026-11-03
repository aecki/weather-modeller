# Repository-local environment

## Isolation

The installed Conda executable is used only to create/update the `.environments/weather-modeller/` prefix in this checkout. No packages are added to base. No user or system configuration is modified.

`scripts/bootstrap.py` selects the tracked `.condarc` for its subprocess only and sets:

| Setting | Location / value |
| --- | --- |
| Conda prefix | `.environments/weather-modeller/` |
| Conda package cache | `.cache/conda/` |
| Conda environment search path | `.environments/` |
| Environment registration | disabled (`CONDA_REGISTER_ENVS=false`) |
| Automatic base updates | disabled |
| External Conda plugins | disabled, avoiding user-installed plugin side effects |
| Conda solver | classic, available without additional plugins |
| Channel | conda-forge, no defaults |
| npm / pip caches | `.cache/npm/`, `.cache/pip/` |
| Python bytecode cache | `.cache/python/` |
| Temporary files | `.cache/tmp/` |

No HOME variable is changed. Existing OS/browser installations remain system prerequisites; a browser will still manage its own normal profile/cache. CSV exports are downloaded by the browser. Preparation artifacts stay in the repository’s ignored `outputs/` directory. Project code does not write application state outside the checkout.

## Portability versus exact package locks

`environment.yml` is the portable source of truth: Python 3.12, Node.js 22, curl 8 and CA certificates. It can resolve platform-appropriate packages on macOS (Intel/Apple Silicon), Linux and Windows. GitHub Actions is configured to run the same local setup/check flow on macOS, Ubuntu and Windows. A workflow file is not evidence those remote jobs have run.

`environment/locks/osx-arm64.explicit.txt` records the exact packages installed and tested on this machine. It is a platform-specific reference, not a portable environment. New platforms should solve `environment.yml` and run `python run.py check`; add their exact locks after successful verification. There is no claim that one binary environment works across operating systems.

## Rebuilding or moving

Conda environments embed absolute installation prefixes. Clone on another device or move the checkout, then recreate `.environments/weather-modeller/` at that location. Never commit `.environments/weather-modeller/`, caches, raw downloads, node_modules or dist. They are ignored. The checked-in processed snapshot and source code are sufficient to rebuild the app.

`python run.py setup` is idempotent and repairs a partial environment if required executables are missing. `python run.py setup --update` updates only this prefix. It can change transitive package versions; review/test before updating a platform lock.

## Serving

`python run.py serve` dispatches into the checkout's Python interpreter, builds `dist/`, and binds only `127.0.0.1`. It is only a static development preview, with no write endpoints, export server, runtime mode or standalone-app behavior. The browser requests official map/search services and historical rainfall ranges online. The content security policy permits only the specific official providers. Regional ingestion is an explicit network operation; ordinary build/check commands remain network-free. See [daily pipeline](regional-pipeline.md).

## Optional developer dependencies

`python run.py dev` explicitly installs Ruff from the pinned `requirements-dev.txt` into the repository environment and Prettier with `npm ci --ignore-scripts` into repository-local node_modules. It refuses to run under a different Python prefix. No global npm install is used. Python user-site packages are disabled in the launcher; developer pip installation explicitly disables user installs. `python run.py quality` checks Python and frontend style offline once installed. Normal app execution does not require Ruff or Prettier. Frontend compilation and graphic tests require the npm packages installed by setup.
