# Weather-conditioned lake recovery outlook

This research outlook covers Lake Zurich (FOEN 2209) and Upper Lake Constance (2032). A return is the **completion of seven consecutive daily mean levels within the moving middle-50% seasonal range**. A one-day rise, stopping a decline or crossing the lower edge once is not recovery. The current seasonal reference remains 1991–2020, calendar day ±15 days, requiring at least 20 distinct years. This is not an official warning or management target.

## Inputs and spatial coverage

- FOEN daily mean levels, original local-day labels, release flags, timestamps and exact GraphQL request/source versions. Daily observations and forecasts remain distinct. No observations are interpolated.
- FOEN *Topographical catchments of Swiss waterbodies*, edition 2024: basin 123466, Zurich outlet, 1,825.12 km²; basin 171668, Upper Lake Constance outlet at Konstanz, 10,989.20 km², 48.8% Swiss. The latter includes a small shore/outlet increment relative to the lake itself. It is a full transboundary topographic catchment, not a Swiss-only rainfall square and not the exact gauge-point drainage delineation. Engineered diversions and hydrogeology are not resolved.
- Four representative points per catchment, selected within four equal bounding-box quadrants. Each point has the area weight of its polygon intersection. This is coarse quadrature, not an exact integration of every meteorological grid cell. Exact unsimplified polygons determine weights; the public boundary is simplified by 75 m for inspection. Extraction verifies the summed polygon area against the official area.
- ECMWF ERA5 daily precipitation, mean temperature and reference evapotranspiration (ET₀), 1989–2025, via Open-Meteo, Swiss local calendar days. These are real **reanalysis estimates**, not rain-gauge observations, not synthetic weather and not forecasts. The existing RhiresD address and station analyses remain unchanged.
- For initialization after 2025, use archived ECMWF IFS first-hours analyses/forecasts through the last measured lake day. They are an initialization bridge, not the future-weather validation archive.
- Current ECMWF IFS 0.25° weather ensemble via Open-Meteo, up to 15 complete local days. The API does not pin a model run in the response. Record the retrieval time and exact response SHA rather than inventing an initialization timestamp. The current-day component may include updated ongoing-day information.

Hourly precipitation and ET₀ describe the preceding hour. Aggregate unique Unix interval-end timestamps into complete Europe/Zurich days, including 23/25-hour daylight-saving days. Require every expected interval and matching physical units. Reject missing/nonfinite/negative fluxes. If the ensemble provider supplies negative fluxes, exclude that entire member consistently at every catchment node; record its identifier/reason and retain the untouched raw response. Never clip negative rain to zero. Require at least 20 valid aligned members. Reject deterministic negative fluxes. Each retained member receives equal weight (ten parameter/error realizations per member).

## Lake response and uncertainty

A simple conceptual snow store partitions precipitation at 0 °C and melts at a fixed 3 mm/°C/day, limited by stored snow. It conserves water and uses only current/past temperatures. It is a model state, not observed snow water equivalent. Initialize in 1989; exclude the first year from fitting. Four coarse temperatures cannot represent the entire catchment elevation distribution, glacier processes or observed snowpack.

Ridge regression predicts daily lake-level changes from the previous level, 1/7-day changes, effective liquid water today and over seven days, 30-day antecedent precipitation, ET₀, temperature and annual sine/cosine. Recursive paths update levels, snow and antecedent weather, using no later weather before its simulated day. Zurich outlet management is represented only indirectly by historical levels and seasonality; no planned operations or explicit measured inflow/outflow balance is supplied. ET₀ is a predictor, not measured lake evaporation.

Fit 1990–2009. Select ridge penalty (1/10/100/1000) on 2010–2015 daily squared error; obtain consecutive seven-day residual blocks there. Refit once through 2015 and freeze the model for 2016–2025 tests and this first operational research version. Sixty paired-year parameter resamples retain year dependence. Trajectories combine these parameter draws, centered seven-day residual blocks and coherent weather members. Bands show the middle 90% of simulated **level paths**, not guaranteed calibrated coverage or a confidence interval on the recovery probability. Structural error, changed regulation, meteorological resolution and fixed melt parameters remain incompletely represented.

The long-horizon scenario design follows the general principle of [Ensemble Streamflow Prediction](https://training.weather.gov/nwstc/Hydrology/HYDRO/RFS/RFS802.html), using historical weather sequences from an initialized hydrologic state; this statistical lake model is not the NWS model.

After the last complete weather forecast, use contiguous 90-day ERA5 sequences from seasonally matched starts (±15 calendar days, 1990–2015), with their within-sequence variability intact. A path uses the real forecast first, then the remaining seasonal sequence. Days beyond the weather horizon are **conditional historical-weather scenarios**, not a 90-day meteorological forecast. All scenario/reference years precede the held-out period.

Calculate first completion of the seven-day recovery event on each path. Unrecovered paths retain infinite event times. Inverse empirical CDF quantiles at 10/50/90% preserve that mass: an unsupported median or upper boundary stays beyond the 90-day horizon. Do not report a median among recovered paths alone. Near-zero/one probabilities are displayed as <1%/>99%, avoiding an implication of certainty. Warn when the starting level lies outside the model’s training range.

## Low-water testing

Episode origins use only observed past information: the seventh consecutive day below the seasonal lower bound. Require seven consecutive non-low days before a new episode can start, so brief rises do not create repeated drought episodes. Test origins in 2016–2025, including 2018 and 2022. Historical thresholds use **1970–2009 only**, avoiding future seasonal-reference data in old tests. Current thresholds use 1991–2020; these are related but different targets.

Missing follow-up stops observation at the first gap. End-of-2025 follow-up is right-censored. Keep censored cases and report their follow-up duration; score an event-by-horizon only if its outcome is known by that horizon. Report known-outcome counts. These complete-outcome Brier scores can be affected by informative censoring; they are not an inverse-censoring-weighted estimate. Initial-state gaps are separately listed as excluded origins.

The long historical comparison drives the model with **pre-2016 seasonal weather resamples**. It does not use actual future weather or claim to be an archived weather-forecast test. The baseline replays seasonally matched pre-2016 lake-level changes, shifted to the observed start level. Lower Brier scores are better. Recovery windows can overlap despite separated episodes; do not treat all daily errors as independent trials.

For origins from March 2024 onward, a second test uses genuine individual ECMWF IFS forecasts from the Single Runs API, the origin date’s 12 UTC run. The retrospective lake origin is the following day, when the previous local-day mean is assumed available. These weather runs precede that origin. Only complete subsequent local days replace the seasonal weather in the simulation. Source URL contains the run; response SHA, retrieval time and decoded daily catchment inputs remain inspectable. This is a **revised-observation retrospective experiment**, not verification of the precise historical publication latency of FOEN measurements.

The genuine forecast sample is small: the initial preparation includes five Zurich origins (one with only three follow-up days) and one Constance episode. Archived tests use deterministic 9 km IFS; the live outlook uses IFS ensembles. Their recovery probabilities are **not independently calibrated against a long ensemble-forecast archive**. Report this prominently and show empirical level-band coverage. The initial Zurich model improves full-period 30–90-day recovery Brier scores but not 14-day scores; Constance is worse than its lake-history baseline, so its outlook explicitly carries a low-confidence warning. Do not describe Constance as a demonstrated forecasting improvement.

## Reproduction and publication

All commands run inside the repository environment. One-time preparation:

```sh
python -m pip install --isolated --no-user --cache-dir .cache/pip -r requirements-lake.txt
python scripts/fetch_lake_catchments.py
python scripts/prepare_lake_catchments.py
python scripts/prepare_lake_weather.py
python scripts/fit_lake_recovery.py
```

The first command must use `.environments/weather-modeller/bin/python` (or the activated repository environment); never install into base. The pinned download requests only the official archive’s specified Deflate64 entry, checks HTTP 206/content range, compressed length, CRC and decoded SHA, then replaces the cache. The raw 1.7 GB GeoPackage remains ignored. Only small catchment geometry, real input series, baseline observations, frozen model and validation records are committed under `data/reference/lake-recovery/`. `requirements-lake.txt` is optional one-time tooling, not a visitor or daily dependency.

Daily publication installs the existing regional dependencies and runs:

```sh
python scripts/prepare_water.py
python scripts/prepare_lake_outlook.py
python run.py check
```

Outlooks are staged and promoted together with rollback; source/cache errors cannot publish a partial pair. An unsuccessful required preparation fails deployment and leaves the prior deployed site intact. The browser verifies each outlook checksum and requires exactly matching lake observation date/value. Outlooks older than 36 hours, or lake readings older than three days, suppress probabilities. Generated outlooks and all raw/cache data remain ignored; build/serve/tests never fetch weather automatically. The Pages job explicitly performs the network refresh, then publishes the static app. Cross-platform checks use repository-local NumPy and timezone data.

Tests verify snow conservation and causal melt, daylight-saving flux aggregation, missingness, frozen-model invariance to future targets/weather, recursive forecast causality/reproducibility, infinite recovery bounds, all input/model hashes and recomputation of genuine archived-forecast recovery probabilities from the saved real daily inputs. Existing station and regional EVT references remain unchanged.

Sources: [FOEN catchments](https://www.bafu.admin.ch/en/waterbody-catchment-areas), [FOEN hydrological data](https://www.hydrodaten.admin.ch/en/seen), [MeteoSwiss forecast retention](https://opendatadocs.meteoswiss.ch/e-forecast-data/e2-e3-numerical-weather-forecasting-model), [Open-Meteo ERA5](https://open-meteo.com/en/docs/historical-weather-api), [individual forecast runs](https://open-meteo.com/en/docs/single-runs-api), [ensemble forecasts](https://open-meteo.com/en/docs/ensemble-api). Weather API data require Open-Meteo/ECMWF attribution (CC BY 4.0). This research website uses the non-commercial API.
