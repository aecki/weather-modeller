# Publishing aecki’s catastrophe lab on GitHub Pages

The app builds to a static `dist/` directory. GitHub Pages serves that directory; visitors need neither Python nor Conda. React, visx and every other runtime asset are bundled locally, alongside the official observation snapshot. There are no runtime code/CDN dependencies. Map/search services and historical day grids come from official online providers.

## Enable deployment

1. Push the repository to its GitHub destination.
2. In the GitHub repository, open **Settings → Pages**.
3. Set **Build and deployment → Source → GitHub Actions**.
4. Run **Publish aecki’s catastrophe lab** from the Actions tab, or push a commit to `main`.

The workflow in `.github/workflows/pages.yml` sets up the repository-local toolchain, runs the numerical and graphics tests, builds the static site, uploads only `dist/`, and deploys the resulting Pages artifact. Until Pages is enabled, the workflow still tests/builds/uploads the static artifact and skips deployment with a setup note. Deployment is separate from the cross-platform CI matrix. Remote CI/deployment must be observed before claiming it succeeded.

For a project repository, the usual URL is `https://<owner>.github.io/<repository>/`. Every asset, data fetch and internal anchor uses a relative URL, so the same artifact works under a repository subpath without hard-coding an owner or repository name. A custom domain can be configured later through Pages settings.

Public repositories can use Pages on GitHub Free; eligibility for private repositories depends on the account plan. Publishing this snapshot makes those official open observations and the frontend publicly accessible under the site's access settings. No credentials, raw download cache, Conda environment or repository-local CSV exports enter the artifact.

Official instructions: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Browser downloads and development preview

CSV downloads are generated in the browser in every environment. There is no runtime-mode switch, local export API or standalone app. `serve` is only a static development preview.

## Test a Pages build locally

```sh
python run.py setup
python run.py build
# Activate the repository-local environment, then serve the generated static directory:
conda activate ./.environments/weather-modeller
python -m http.server 8767 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8767`. This uses a plain static server, matching Pages behavior.

The workflow refreshes the recent 366-day release twice daily. Older days use the checked-in range index of verified final annual sources; the browser checks both raw and normalized day hashes. See [full calendar](full-calendar.md).
