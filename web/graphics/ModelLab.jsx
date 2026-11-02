import React, { useEffect, useMemo, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { ReturnLevelChart, DiagnosticChart } from './ModelCharts';
import {
  fitModel,
  returnLevel,
  returnPeriod,
  annualExceedance,
  atLeastOnce,
  interval,
  seedFor,
  MIN_YEARS,
} from '../modelling/extremes.mjs';

const cache = new Map();
const number = (value, digits = 1) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-CH', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : value === Infinity
      ? '∞'
      : '—';
const precise = (value, digits = 1) =>
  Number.isFinite(value) && value > 0 && value < 0.5 * Math.pow(10, -digits)
    ? value.toExponential(2)
    : number(value, digits);
const range = (bounds, unit) =>
  bounds
    ? bounds.every((value) => value === Infinity)
      ? 'No finite bounds'
      : `${precise(bounds[0], unit === '%' ? 2 : 1)}–${precise(bounds[1], unit === '%' ? 2 : 1)} ${unit}`
    : 'Interval unavailable';
const name = (model) => (model === 'gev' ? 'GEV' : 'Gumbel');
function ResponsiveChart({ component: Component, ...props }) {
  return (
    <ParentSize debounceTime={30}>
      {({ width }) => <Component {...props} width={Math.max(width, 200)} />}
    </ParentSize>
  );
}

export function ModelLab({
  annual,
  station,
  stations,
  days,
  event,
  eventPeak,
  historyStart,
  historyEnd,
  onStation,
  onDuration,
}) {
  const [model, setModel] = useState('gev'),
    [from, setFrom] = useState(+historyStart.slice(0, 4)),
    [to, setTo] = useState(+historyEnd.slice(0, 4));
  const [exclude, setExclude] = useState(false),
    [confidence, setConfidence] = useState(95),
    [period, setPeriod] = useState(100),
    [repetitions, setRepetitions] = useState(500);
  const [threshold, setThreshold] = useState(String(eventPeak?.value ?? 100)),
    [horizon, setHorizon] = useState(30),
    [status, setStatus] = useState({ pending: true, progress: 0 });
  const eventYear = +event.start.slice(0, 4);
  useEffect(() => {
    setThreshold(String(eventPeak?.value ?? 100));
  }, [station.id, days, event.id, eventPeak?.value]);
  const used = useMemo(
    () =>
      annual.filter(
        (row) => +row.year >= from && +row.year <= to && (!exclude || +row.year !== eventYear),
      ),
    [annual, from, to, exclude, eventYear],
  );
  const key = JSON.stringify([
    station.id,
    days,
    model,
    from,
    to,
    exclude ? eventYear : null,
    repetitions,
    used.map(({ year, value }) => [year, value]),
  ]);
  useEffect(() => {
    if (from > to) {
      setStatus({ fitKey: key, error: 'The fitting start year must not be after the end year.' });
      return;
    }
    if (used.length < MIN_YEARS) {
      setStatus({
        fitKey: key,
        error: `Only ${used.length} complete years remain. Select at least ${MIN_YEARS}; 30 or more is preferable.`,
      });
      return;
    }
    if (cache.has(key)) {
      setStatus({ fitKey: key, result: cache.get(key) });
      return;
    }
    let worker;
    let cancelled = false;
    setStatus({ fitKey: key, pending: true, progress: 0 });
    try {
      worker = new Worker(new URL('model-worker.js', document.baseURI));
      worker.onmessage = ({ data }) => {
        if (cancelled) return;
        if (data.error) {
          setStatus({ fitKey: key, error: data.error });
          worker.terminate();
        } else if (data.result) {
          cache.set(key, data.result);
          if (cache.size > 16) cache.delete(cache.keys().next().value);
          setStatus({ fitKey: key, result: data.result });
          worker.terminate();
        } else setStatus({ fitKey: key, pending: true, progress: data.progress });
      };
      worker.onerror = () => {
        if (cancelled) return;
        setStatus({
          fitKey: key,
          error:
            'The modelling worker could not run. Reload the page; no uncertainty estimate has been substituted.',
        });
        worker.terminate();
      };
      worker.postMessage({
        values: used.map((row) => row.value),
        options: { model, repetitions, seed: seedFor(key) },
      });
    } catch (error) {
      setStatus({ fitKey: key, error: error.message });
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [key]);
  const result = status.fitKey === key ? status.result : null;
  const calculations = useMemo(() => {
    if (!result) return null;
    let alternative = null;
    try {
      alternative = fitModel(
        used.map((row) => row.value),
        model === 'gev' ? 'gumbel' : 'gev',
      );
    } catch {
      /* An invalid alternative is reported rather than plotted. */
    }
    const band = (fn) =>
      result.intervalAvailable ? interval(result.fits.map(fn), confidence / 100) : null;
    const curve = Array.from({ length: 90 }, (_, index) => {
      const t = 2 * Math.pow(250, index / 89),
        bounds = band((fit) => returnLevel(fit, t));
      return {
        period: t,
        value: returnLevel(result.fit, t),
        lower: bounds?.[0],
        upper: bounds?.[1],
        other: alternative ? returnLevel(alternative, t) : null,
      };
    });
    const amount = returnLevel(result.fit, period);
    const target = threshold.trim() !== '' ? Number(threshold) : NaN;
    const targetValid = Number.isFinite(target) && target >= 0;
    const probability = targetValid ? annualExceedance(result.fit, target) : null;
    const t = targetValid ? returnPeriod(result.fit, target) : null;
    const qq = [...used]
      .sort((a, b) => a.value - b.value)
      .map((row, index) => ({
        ...row,
        x: returnLevel(result.fit, (used.length + 1) / (used.length - index)),
        y: row.value,
      }));
    return {
      curve,
      amount,
      amountBand: band((fit) => returnLevel(fit, period)),
      alternative,
      targetValid,
      beyondEndpoint:
        targetValid &&
        result.fit.xi < -1e-7 &&
        1 + (result.fit.xi * (target - result.fit.location)) / result.fit.scale <= 0,
      probability,
      probabilityBand: targetValid ? band((fit) => 100 * annualExceedance(fit, target)) : null,
      targetPeriod: t,
      targetPeriodBand: targetValid ? band((fit) => returnPeriod(fit, target)) : null,
      risk: targetValid ? atLeastOnce(probability, horizon) : null,
      riskBand: targetValid
        ? band((fit) => 100 * atLeastOnce(annualExceedance(fit, target), horizon))
        : null,
      qq,
    };
  }, [result, model, used, confidence, period, threshold, horizon]);
  const years = Array.from(
    { length: +historyEnd.slice(0, 4) - +historyStart.slice(0, 4) + 1 },
    (_, index) => +historyStart.slice(0, 4) + index,
  );
  return (
    <div className="model-lab">
      <div className="model-heading">
        <div>
          <span className="eyebrow">EXTREME-VALUE MODELLING</span>
          <h2>Return-period estimation</h2>
          <p>
            Fit GEV or Gumbel distributions to observed annual rainfall maxima. Estimate return
            levels and sampling uncertainty.
          </p>
        </div>
        <span className="model-badge">STATIONARY HAZARD MODEL</span>
      </div>
      <div className="model-controls">
        <label>
          Weather station
          <select
            aria-label="Model weather station"
            value={station.id}
            onChange={(e) => onStation(e.target.value)}
          >
            {stations.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rainfall window
          <select
            aria-label="Model rainfall window"
            value={days}
            onChange={(e) => onDuration(+e.target.value)}
          >
            {[1, 3, 5].map((value) => (
              <option key={value} value={value}>
                {value}-day total
              </option>
            ))}
          </select>
        </label>
        <label>
          Distribution
          <select
            aria-label="Extreme-value distribution"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="gev">GEV · fit tail shape</option>
            <option value="gumbel">Gumbel · fixed shape 0</option>
          </select>
        </label>
        <label>
          Fit from
          <select
            aria-label="Fitting start year"
            value={from}
            onChange={(e) => setFrom(+e.target.value)}
          >
            {years.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
        <label>
          Fit through
          <select aria-label="Fitting end year" value={to} onChange={(e) => setTo(+e.target.value)}>
            {years.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="model-settings">
        <label className="model-check">
          <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} />
          Leave replay year {eventYear} out of the fit
        </label>
        <label>
          Interval
          <select
            aria-label="Bootstrap confidence level"
            value={confidence}
            onChange={(e) => setConfidence(+e.target.value)}
          >
            {[80, 90, 95].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </label>
        <label>
          Bootstrap resamples
          <select
            aria-label="Bootstrap resamples"
            value={repetitions}
            onChange={(e) => setRepetitions(+e.target.value)}
          >
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
          </select>
        </label>
      </div>
      <p className="model-coverage">
        <strong>{used.length} complete annual maxima</strong> selected from {from}–{to}.{' '}
        {Math.max(0, to - from + 1 - used.length)} year(s) omitted for missing data or the
        replay-year exclusion. One maximum per year; multi-day windows stay within that calendar
        year.
      </p>
      {(status.pending || status.fitKey !== key) && (
        <div className="model-state" role="status">
          Fitting {name(model)} and resampling observed years…{' '}
          {Math.round((status.progress || 0) * 100)}%
        </div>
      )}
      {used.length >= MIN_YEARS && used.length < 30 && (
        <p className="model-warning">
          Only {used.length} complete years are selected. Tail fits and bootstrap intervals can be
          unstable with a short record; compare a longer fitting period.
        </p>
      )}
      {status.fitKey === key && status.error && (
        <div className="model-state model-error" role="alert">
          <strong>Estimate unavailable.</strong> {status.error}
        </div>
      )}
      {result && calculations && (
        <>
          <div className="model-summary">
            <div>
              <span className="stat-label">{period}-YEAR RETURN LEVEL</span>
              <strong>
                {number(calculations.amount)}{' '}
                <small>
                  mm / {days} day{days > 1 ? 's' : ''}
                </small>
              </strong>
              <p>
                {confidence}% interval: {range(calculations.amountBand, 'mm')}
              </p>
            </div>
            <div>
              <span className="stat-label">ANNUAL EXCEEDANCE PROBABILITY</span>
              <strong>
                {number(100 / period, period >= 200 ? 2 : 1)}
                <small>%</small>
              </strong>
              <p>For that fitted return level, under stationary independent years.</p>
            </div>
            <div className={period > used.length ? 'model-extrapolation' : ''}>
              <span className="stat-label">RECORD VERSUS RETURN PERIOD</span>
              <strong>{period > used.length ? 'Extrapolation' : 'Within record span'}</strong>
              <p>
                {period} years versus {used.length} observed annual blocks. Even estimates within
                the record span remain uncertain.
              </p>
            </div>
          </div>
          <div className="model-period">
            <label htmlFor="model-period">
              Return period <strong>{period} years</strong>
            </label>
            <input
              id="model-period"
              aria-label="Target return period"
              aria-valuetext={`${period} years`}
              type="range"
              min={Math.log(2)}
              max={Math.log(500)}
              step={0.01}
              value={Math.log(period)}
              onChange={(e) =>
                setPeriod(Math.max(2, Math.min(500, Math.round(Math.exp(+e.target.value)))))
              }
            />
            <div className="model-presets">
              {[2, 10, 20, 50, 100, 200, 500].map((value) => (
                <button
                  key={value}
                  className={period === value ? 'active' : ''}
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                >
                  {value} yr
                </button>
              ))}
            </div>
          </div>
          <div className="model-plot">
            <ResponsiveChart
              component={ReturnLevelChart}
              curve={calculations.curve}
              observations={used}
              period={period}
              level={calculations.amount}
              confidence={confidence}
              years={used.length}
              showBand={result.intervalAvailable}
              otherName={calculations.alternative ? name(calculations.alternative.model) : null}
            />
          </div>
          <div className="model-legend">
            <span>
              <i className="solid" />
              {name(model)} fit
            </span>
            <span>
              <i className="band" />
              {confidence}% pointwise bootstrap interval
            </span>
            {calculations.alternative && (
              <span>
                <i className="dashed" />
                {name(calculations.alternative.model)} comparison
              </span>
            )}
            <span>○ Observed maxima · Weibull plotting positions</span>
          </div>
          {!result.intervalAvailable && (
            <p className="model-warning">
              Too many bootstrap fits failed ({result.failed}/{result.repetitions}). The uncertainty
              band is withheld; the fitted line alone is not a reliable uncertainty assessment.
            </p>
          )}
          <p className="model-note">
            The shaded interval estimates sampling uncertainty, conditional on this distribution,
            stationary independent years, and the selected record. It is not a prediction interval
            or a simultaneous band. It excludes climate-change, measurement and model-choice
            uncertainty. Comparing the dashed model is a sensitivity check, not an additional
            confidence band.
          </p>
          <section className="model-threshold">
            <div>
              <span className="eyebrow">THRESHOLD ANALYSIS</span>
              <h3>Threshold exceedance probability</h3>
              <p>
                Estimate the return period of an observed or chosen threshold. A “100-year” event
                can happen in consecutive years.
              </p>
              <label>
                Rainfall threshold · mm / {days} day{days > 1 ? 's' : ''}
                <input
                  aria-label="Rainfall threshold"
                  type="number"
                  min="0"
                  step="0.1"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </label>
              <div className="model-shortcuts">
                <button onClick={() => setThreshold(String(eventPeak?.value ?? 100))}>
                  Use event maximum ({number(eventPeak?.value)} mm)
                </button>
                <button onClick={() => setThreshold(calculations.amount.toFixed(1))}>
                  Use selected return level
                </button>
              </div>
              <label>
                Planning horizon · years
                <input
                  aria-label="Planning horizon"
                  type="range"
                  min={1}
                  max={100}
                  value={horizon}
                  onChange={(e) => setHorizon(+e.target.value)}
                />
              </label>
            </div>
            <div className="threshold-results">
              {calculations.targetValid ? (
                <>
                  <article>
                    <span className="stat-label">THRESHOLD RETURN PERIOD</span>
                    <strong>
                      {Number.isFinite(calculations.targetPeriod)
                        ? `${number(calculations.targetPeriod)} years`
                        : calculations.beyondEndpoint
                          ? 'Beyond fitted upper endpoint'
                          : 'Beyond numerical resolution'}
                    </strong>
                    <p>
                      {confidence}% interval: {range(calculations.targetPeriodBand, 'years')}
                    </p>
                  </article>
                  <article>
                    <span className="stat-label">ANNUAL CHANCE OF EXCEEDING THRESHOLD</span>
                    <strong>{precise(100 * calculations.probability, 2)}%</strong>
                    <p>
                      {confidence}% interval: {range(calculations.probabilityBand, '%')}
                    </p>
                  </article>
                  <article>
                    <span className="stat-label">AT LEAST ONE EXCEEDANCE IN {horizon} YEARS</span>
                    <strong>{precise(100 * calculations.risk, 1)}%</strong>
                    <p>
                      {confidence}% interval: {range(calculations.riskBand, '%')}
                    </p>
                  </article>
                  {calculations.beyondEndpoint && (
                    <p className="model-warning">
                      This fitted bounded tail assigns zero probability above its endpoint. That is
                      a model assumption, not evidence the event cannot recur. Compare Gumbel and
                      the fitting period.
                    </p>
                  )}
                </>
              ) : (
                <p role="alert">Enter a finite, non-negative rainfall amount.</p>
              )}
            </div>
          </section>
          <div className="model-diagnostics">
            <article>
              <span className="eyebrow">FIT DIAGNOSTIC</span>
              <h3>Observed versus fitted maxima</h3>
              <div className="diagnostic-plot">
                <ResponsiveChart component={DiagnosticChart} points={calculations.qq} kind="qq" />
              </div>
              <p>
                Points near the diagonal agree with the fitted quantiles. Tail departures matter;
                this graphic is not a formal goodness-of-fit test.
              </p>
            </article>
            <article>
              <span className="eyebrow">STATIONARITY DIAGNOSTIC</span>
              <h3>Annual maxima over time</h3>
              <div className="diagnostic-plot">
                <ResponsiveChart
                  component={DiagnosticChart}
                  points={used.map((row) => ({ year: row.year, x: +row.year, y: row.value }))}
                  kind="history"
                />
              </div>
              <p>
                The fit assumes one unchanged distribution across these years. This view helps
                inspect patterns; it does not test or adjust for climate trends.
              </p>
            </article>
          </div>
          <details className="model-details">
            <summary>Fitted parameters, method and reproducibility</summary>
            <p>
              L-moment estimator · location μ = {number(result.fit.location, 4)} mm · scale σ ={' '}
              {number(result.fit.scale, 4)} mm · shape ξ = {number(result.fit.xi, 4)} (the opposite
              sign of SciPy’s c).
            </p>
            <p>
              {result.fits.length}/{result.repetitions} bootstrap fits retained; {result.failed}{' '}
              rejected for invalid or out-of-support fits. Method {result.version}; seed{' '}
              {result.seed}; deterministic Mulberry32 resampling, with replacement, of the observed
              annual maxima. Intervals are withheld if fewer than 90% of fits are valid. This is a
              numerical reliability guard, not a coverage guarantee.
            </p>
            <p>
              These are independent model estimates, not MeteoSwiss’s official extreme-value
              analyses. The record is not homogenised for climate-trend analysis. Changing
              confidence or the target period reuses the same fitted resamples.
            </p>
            <a
              href="https://lmoments3.readthedocs.io/stable/distributions.html"
              target="_blank"
              rel="noreferrer"
            >
              Estimator reference ↗
            </a>
          </details>
        </>
      )}
      <div className="model-method">
        <strong>Uncertainty interpretation</strong>
        <p>
          We keep the measured rainfall fixed, take one maximum from each complete year, and
          repeatedly resample those observed yearly maxima. Each resample is refitted. The central{' '}
          {confidence}% of its return-level estimates gives the pointwise percentile interval. No
          synthetic storm catalogue is used.
        </p>
        <p>
          A T-year level has annual exceedance probability 1/T under this stationary model. Across h
          independent years the chance of at least one exceedance is 1 − (1 − 1/T)<sup>h</sup>. A
          longer return period is an extrapolation, not a promise about timing. This is a rainfall
          hazard model; rainfall return periods are not river-flood or insurance-loss return
          periods.
        </p>
      </div>
    </div>
  );
}
