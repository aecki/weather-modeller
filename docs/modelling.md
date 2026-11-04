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

Fitting and resampling run in a bundled Web Worker. Previous workers are terminated on changed fit settings; stale results are not displayed under a new configuration. The worker and numerical module are browser assets served by GitHub Pages; model fitting needs no Python backend. No raw observations or model selections are sent to another service.

`tests/fixtures/extreme-reference.json` contains independent lmoments3/SciPy calculations for all 18 stations, three durations and two distributions (108 cases), tied to the observation snapshot SHA256. Node checks compare annual maxima, parameter estimates, return levels and exceedance probabilities against these references, test deterministic bootstrap/support limits, and execute the actual bundled worker. SciPy/lmoments3 are **optional fixture-generation tools**, not browser or runtime requirements.

To intentionally regenerate references, activate the local environment, install `requirements-science.txt` with the repository-local pip cache, then run `python scripts/reference_models.py`. Review the fixture changes and rerun checks. The pinned science dependencies and their recorded versions make the comparison auditable.

## References

- [lmoments3 distribution and parameter conventions](https://lmoments3.readthedocs.io/stable/distributions.html)
- [SciPy GEV documentation and shape sign](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.genextreme.html)
- [MeteoSwiss extreme-value manual, Technical Report 255](https://www.meteosuisse.admin.ch/dam/jcr:7be312d2-7f2f-4adc-9f98-312ecf6dd904/nidex_technical_report_20181114.pdf): background on return levels, reliability and official analyses; the lab uses its separately documented L-moment/bootstrap method rather than claiming to reproduce the official methodology.

## Four-model forward holdout experiment

The comparison section is separate from the full-record GEV/Gumbel explorer. It uses the same station, duration and selected calendar-year range, but reserves the latest 5, 10 (default) or 15 **complete years** for validation. All earlier complete years are training data. At least 20 training years must remain. Replay-year exclusion removes a training year only; a held-out replay year is always retained. No storm, accumulation window, fitted parameter, fitting threshold or event rate uses data across the split. Complete years with missing observations remain excluded for all models.

### Daily storm approximation

Within each complete calendar year, wet days have daily rainfall ≥1 mm. Wet days are clustered unless separated by the selected number of dry days (dry means <1 mm). The separation must be at least the accumulation duration (1, 3 or 5 days); larger gaps are available for sensitivity analysis. For each cluster, retain its largest trailing duration-total, allowing windows ending up to duration−1 days after its last wet day. Every window stays within that calendar year and uses all measured daily amounts, including amounts below 1 mm. If adjacent selected peak windows overlap, merge those events and retain the larger peak (earlier on ties), repeating until the retained windows do not overlap. We do not count every overlapping running sum as an independent event.

This is a daily-data approximation, not a verified meteorological storm catalogue. A dry gap is not proof of independence. Clusters near calendar boundaries are truncated and counted in diagnostics; their omission/truncation effects, residual storm dependence and the choice of wet-day cutoff are not covered by sampling intervals. Year boundaries are fixed block boundaries throughout preparation and resampling. Zero-event years, if present, remain in the exposure count. Annual maxima for GEV/Gumbel are calculated separately from every valid duration window, and agree with the existing annual-maxima calculation.

### GPD peaks-over-threshold model

Choose u as the 80th, 90th (default), 95th or 97.5th percentile of **training ordinary-event peaks**, using linear interpolated sample quantiles. Fit strictly positive excesses y=x−u. Require at least 20 exceedances. With unbiased sample excess L-moments l1,l2, set `xi=2−l1/l2` and `sigma=l1*(1−xi)`; excess location is fixed at zero. This is a two-parameter L-moment fit, not SciPy's unconstrained location/scale/shape maximum-likelihood fit. This L-moment fit requires a finite mean (xi<1). Reject nonpositive scale, degenerate excesses and endpoints excluding observations.

The annual rate is `lambda=exceedance count / complete training years`. The excess survival is `S(y)=(1+xi*y/sigma)^(-1/xi)`, or `exp(-y/sigma)` at xi=0. The annual non-exceedance probability is `Fannual(x)=exp(-lambda*S(x−u))`, using a Poisson occurrence approximation. A return level solves `S(z−u)=−log(1−1/T)/lambda`. Below u the model does not specify a rainfall distribution: unsupported return levels/probabilities are **null/unavailable, not zero**. A fitted negative-shape endpoint implies zero exceedance at and above that endpoint; this is a model assumption, not a physical impossibility.

### SMEV challenger

The ordinary-event CDF is Weibull: `F(x)=1−exp(−(x/C)^w)`, with positive scale C and shape w. Its annual maximum CDF is `Fannual(x)=F(x)^nbar`, with nbar the mean count of all ordinary events per complete training year. This is the simplified constant-parent/mean-count formulation, not a full year-varying MEV mixture, a Poisson count formulation, or a climate-dependent model.

For all sorted ordinary events assign `Fi=rank/(N+1)`. Retain the upper 30%, 20% (default), 10% or 5% for fitting but retain their **original full-sample ranks**. Require at least 20 retained tail points. OLS regresses `log(−log(1−Fi))` on `log(x)`: slope w and intercept −w*log(C). This explicitly documented probability-plot regression is our fitting choice; we do not claim to reproduce every SMEV package or use an automatic Weibull-tail test. The return level is `C * [−log(1−(1−1/T)^(1/nbar))]^(1/w)`. Sample ranks, tail cutoff and mean event count are recomputed for each resampled training dataset.

### Held-out evaluation and paired uncertainty

No held-out value enters any point fit, fitted threshold, count rate or the training-derived bootstrap seed. The worker derives this seed after splitting; it never hashes held-out values into the seed. Training-only seed inputs include station, duration, selections, fitting settings and training observations; the UI cache identity separately includes the held-out observations. This prevents a held-out-data edit from changing the random training resamples.

The common scoring threshold is the larger of the empirical training annual-maxima 80th percentile and the valid fitted GPD threshold. Every model predicts the annual probability of exceeding this same amount. The observed held-out exceedance fraction is accompanied by a Wilson binomial interval at the selected confidence level, conditional on independent years and a fixed training-derived threshold; observing zero exceedances does not imply zero risk. The Brier score is the held-out mean of `(predicted probability−observed exceedance indicator)^2`; lower is better. Its target can change with GPD settings, so Brier scores from experiments with different scoring thresholds must not be compared directly.

All four models also predict the 10-year return level (annual 90th percentile). Quantile/pinball loss is the held-out mean of `(observed−predicted)*[0.9−I(observed<predicted)]`, in mm; lower is better. This is a proper quantile score, not a test of the true 100- or 500-year tail. The history plot shows measured training and held-out maxima and the training-only 10-year prediction lines.

In each of 500 or 1,000 attempts, sample complete **training year blocks** with replacement, using the same sampled years for all models. This preserves within-year clustering/count variability. Refit all models, including GPD threshold/rate and SMEV ranks/rate. Independently sample held-out year blocks with replacement, again using the same test indices for every model, to estimate variability of held-out scores. Held-out resampling affects scores only, never fits. Failed fits retain their paired slots. Differences from GEV use matching successful bootstrap slots, not subtraction of independently computed confidence endpoints.

Return-level bands and intervals are equal-tailed pointwise percentile confidence intervals from training refits. Score intervals additionally include held-out sampling variability. A nonparametric bootstrap cannot introduce outcomes absent from the held-out record, so short/zero-exceedance tests can understate score uncertainty; the observed-frequency Wilson interval provides a separate binomial reference. Intervals for a reported quantity are withheld if fewer than 90% of attempts support that quantity; e.g. a GPD bootstrap threshold can exceed the common scoring threshold even if its fit is otherwise valid. Failed/unsupported fits are not replaced, and available-fit counts are shown. Infinite bounds are retained. The descriptive range between the four point estimates is **model spread**, not a confidence interval combining model uncertainty.

These are exploratory comparisons, not a calibrated selection test or a declaration of a winning distribution. Five to fifteen held-out years cannot establish the true 100-/500-year level. Repeated manual tuning against the same holdout can overfit it. All models assume stationary probabilities and approximately independent year blocks; intervals exclude nonstationarity, measurement uncertainty, storm-definition choices and model misspecification.

### Independent verification

`tests/fixtures/comparison-reference.json` adds 54 real station/duration cases and 108 GPD/SMEV fits. Its separately implemented Python extraction is checked against browser extraction, while lmoments3 L-moments, SciPy linear regression, generalized Pareto and Weibull survival/inverse-survival functions verify parameters, quantiles, annual probabilities and held-out scores. The reference is tied to the unchanged observation snapshot SHA256. `python scripts/reference_comparison.py` regenerates it using the same optional `requirements-science.txt` environment. Routine checks require no SciPy or other scientific Python runtime.

Regression checks exercise nonoverlapping event windows, incomplete-year exclusion, bootstrap reproducibility, fixed pairing, endpoint/body handling, withheld intervals, holdout-only data mutations, replay-year exclusion semantics and the actual bundled comparison worker. The existing 108 GEV/Gumbel reference cases remain unchanged.

Additional sources:

- [SMEV equations, censoring and year bootstrap — pyTENAX tutorial](https://pytenax.readthedocs.io/en/latest/tutorials/Tutorial_04.html).
- [SciPy generalized Pareto conventions](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.genpareto.html).
