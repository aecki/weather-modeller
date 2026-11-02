# Return-period modelling

The Model lab estimates **stationary point-rainfall hazard** from real SwissMetNet observations. It is not a river-flood, inundation, damage or financial-loss model. These independent lab estimates are not MeteoSwiss's official extreme-value analyses.

## Data selection

Use the selected station and 1-, 3- or 5-day rainfall duration. As in the observation explorer, a rainfall day runs 06:00–06:00 UTC. Take one maximum from each complete calendar year, allowing multi-day windows only when wholly inside that year. Empty readings are never filled. Partial years are excluded, not treated as small maxima. The fitting start/end years and optional replay-year exclusion are explicit controls.

The lab requires at least 20 complete annual maxima and highlights records shorter than 30. This is an application guard, not a claim that 20 or 30 observations ensure reliable tail estimates. Even the full 45-year snapshot leaves substantial uncertainty about a 100- or 500-year level. No climate trend correction or stationarity test is applied. The underlying station series are not homogenised climate trend records.

## Distributions and fitting

The GEV cumulative distribution is

`F(x) = exp(-(1 + xi * (x - mu) / sigma)^(-1 / xi))`,

on `1 + xi * (x - mu) / sigma > 0`, with positive scale `sigma`. The Gumbel limit fixes `xi = 0` and has `F(x) = exp(-exp(-(x - mu) / sigma))`. Positive xi denotes a heavy upper tail; negative xi a finite upper endpoint. **Our xi is the opposite sign of SciPy's genextreme shape c.**

Both models use sample L-moments, not maximum likelihood. For sorted observations with zero-based ranks i and sample size n, compute unbiased probability-weighted moments:

- `b0 = sum(x_i) / n`
- `b1 = sum(i / (n - 1) * x_i) / n`
- `b2 = sum(i * (i - 1) / ((n - 1) * (n - 2)) * x_i) / n`
- `l1 = b0`, `l2 = 2*b1 - b0`, `l3 = 6*b2 - 6*b1 + b0`, `tau3 = l3/l2`

For Gumbel, `sigma = l2 / log(2)` and `mu = l1 - EulerGamma*sigma`.

For GEV, solve `tau3 = 2*(1-3^(-k))/(1-2^(-k)) - 3` by bisection, with `k = -xi`. Then `sigma = l2*k / ((1-2^(-k))*Gamma(1+k))` and `mu = l1 + sigma*(Gamma(1+k)-1)/k`, using the Gumbel limits near zero. The implementation requires finite-mean GEV L-moments (`xi < 1`), positive scale and valid sample support. Degenerate samples, unsupported shape solutions and fits excluding an observed maximum are rejected visibly. No arbitrary finite return period is substituted.

L-moments provide a practical fitting method for the browser. A successful numerical fit does not establish that the distribution is an adequate scientific model. The Q–Q diagnostic and model comparison are intended to help inspect this issue, not to certify fit.

## Return levels and probabilities

A T-year return level is the quantile `F(z_T) = 1 - 1/T`, for `T > 1`. Under stationary independent annual blocks its annual exceedance probability is `1/T`. The inverse calculation estimates `T(x) = 1/(1-F(x))` for a chosen rainfall threshold.

The chance of at least one exceedance over h independent years is `1 - (1-p)^h`. It is not h/T and a T-year event need not arrive on a schedule. Calculations use stable log1p/expm1 forms to avoid subtraction errors in the tails.

Beyond a negative-shape GEV upper endpoint, that particular fit assigns zero exceedance probability and no finite return period. The interface explicitly identifies this assumption. It does not imply a real event cannot recur. Extremely small probabilities can also exceed floating-point resolution; those are identified separately from a fitted endpoint.

## Sampling uncertainty

Use a deterministic, nonparametric bootstrap: sample n observed annual maxima with replacement and refit each resample. These are **reused observations**, not generated weather or a synthetic storm catalogue. The default is 500 attempts, with 1,000 available. Reproducible seeds are derived from the complete station/duration/model/period/selection configuration. The sampler is Mulberry32; its version and the model method are in the code.

At each return period, show equal-tailed percentile intervals from the fitted resamples (80%, 90% or 95%). They are approximate **pointwise confidence intervals**, not prediction intervals, simultaneous curve bands, Bayesian credible intervals, or guarantees of nominal coverage in a short extreme-value record. Changing confidence or target period reuses the same resamples.

Fits failing the same numerical/support checks are counted and omitted. If fewer than 90% of attempts succeed, all bootstrap intervals are withheld and the reason is shown. This engineering guard avoids silently presenting an interval conditional on a large fraction of failed fits; it does not remove estimator bias or guarantee coverage when most fits succeed.

Threshold return-period intervals retain infinite bounds from bounded-tail bootstrap fits. The UI must not clip these into finite confidence limits. Sampling bands exclude model-choice uncertainty, nonstationarity/climate change, measurement uncertainty, dependence and spatial extrapolation. The dashed alternative model is a sensitivity comparison, not an uncertainty band combining distributions.

## Diagnostics and extrapolation

Observed points on the return-level plot use Weibull plotting positions `(n+1)/rank` in descending order. Only positions at least two years lie in the plot's displayed 2–500-year domain. The Q–Q plot shows all selected maxima against fitted quantiles; the annual-maxima plot shows the selected record through time. There is no formal goodness-of-fit or trend test.

Return periods longer than n annual observations are shaded as extrapolation. This is a visual reference to sample size, not a mathematical reliability boundary. The holdout-year control makes the leverage of a major replay event visible. Without that exclusion, its estimated rarity is an in-sample assessment, not an independent forecast validation.

## Execution and verification

Fitting and resampling run in a bundled Web Worker. Previous workers are terminated on changed fit settings; stale results are not displayed under a new configuration. The worker and numerical module are static assets, so the same model runs offline after loading and on GitHub Pages without a Python backend. No raw observations or model selections are sent to another service.

`tests/fixtures/extreme-reference.json` contains independent lmoments3/SciPy calculations for all 18 stations, three durations and two distributions (108 cases), tied to the observation snapshot SHA256. Node checks compare annual maxima, parameter estimates, return levels and exceedance probabilities against these references, test deterministic bootstrap/support limits, and execute the actual bundled worker. SciPy/lmoments3 are **optional fixture-generation tools**, not browser or runtime requirements.

To intentionally regenerate references, activate the local environment, install `requirements-science.txt` with the repository-local pip cache, then run `python scripts/reference_models.py`. Review the fixture changes and rerun checks. The pinned science dependencies and their recorded versions make the comparison auditable.

## References

- [lmoments3 distribution and parameter conventions](https://lmoments3.readthedocs.io/stable/distributions.html)
- [SciPy GEV documentation and shape sign](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.genextreme.html)
- [MeteoSwiss extreme-value manual, Technical Report 255](https://www.meteosuisse.admin.ch/dam/jcr:7be312d2-7f2f-4adc-9f98-312ecf6dd904/nidex_technical_report_20181114.pdf): background on return levels, reliability and official analyses; the lab uses its separately documented L-moment/bootstrap method rather than claiming to reproduce the official methodology.
