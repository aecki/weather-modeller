import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { ComparisonCurve, HoldoutHistory, MODEL_COLORS } from './ComparisonCharts';
import {
  COMPARISON_VERSION,
  MODELS,
  LABELS,
  extractBlocks,
  modelLevel,
  comparisonInterval,
  observedRateInterval,
} from '../modelling/comparison.mjs';
const cache = new Map();
const fmt = (x, digits = 1) =>
  x === Infinity
    ? '∞'
    : typeof x === 'number' && Number.isFinite(x)
      ? x.toLocaleString('en-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : '—';
const subtract = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : null);
const ci = (bounds, digits = 1) =>
  bounds ? `${fmt(bounds[0], digits)}–${fmt(bounds[1], digits)}` : 'Unavailable';
function Plot({ component: Component, ...props }) {
  return (
    <ParentSize debounceTime={30}>
      {({ width }) => <Component {...props} width={Math.max(width, 200)} />}
    </ParentSize>
  );
}
export function ModelComparison({
  dates,
  station,
  stations,
  onStation,
  onDuration,
  onConfidence,
  days,
  selectedYears,
  confidence,
  repetitions,
  period,
  onPeriod,
  excludeTrainingYear,
}) {
  const [holdout, setHoldout] = useState(10),
    [tailQuantile, setTail] = useState(0.9),
    [censor, setCensor] = useState(0.8),
    [gapExtra, setGap] = useState(0),
    [bandModel, setBand] = useState('gev');
  const [status, setStatus] = useState({ pending: true, progress: 0 });
  const selection = selectedYears.join(',');
  const blocks = useMemo(() => {
    const allowed = new Set(selectedYears.map(String));
    return extractBlocks(dates, station.values, days, days + gapExtra).filter((b) =>
      allowed.has(b.year),
    );
  }, [dates, station.values, days, gapExtra, selection]);
  const key = JSON.stringify([
    COMPARISON_VERSION,
    station.id,
    days,
    holdout,
    excludeTrainingYear,
    tailQuantile,
    censor,
    gapExtra,
    repetitions,
    blocks.map((b) => [b.year, b.maximum, b.events]),
  ]);
  useEffect(() => {
    let worker,
      cancelled = false;
    if (blocks.length - holdout < 20) {
      setStatus({
        key,
        error: `${blocks.length} complete years selected. Reserve at least 20 training years plus ${holdout} held-out years; extend the fitting period or reduce the holdout.`,
      });
      return;
    }
    if (cache.has(key)) {
      setStatus({ key, result: cache.get(key) });
      return;
    }
    setStatus({ key, pending: true, progress: 0 });
    try {
      worker = new Worker(new URL('model-worker.js', document.baseURI));
      worker.onmessage = ({ data }) => {
        if (cancelled) return;
        if (data.result) {
          cache.set(key, data.result);
          if (cache.size > 8) cache.delete(cache.keys().next().value);
          setStatus({ key, result: data.result });
          worker.terminate();
        } else if (data.error) {
          setStatus({ key, error: data.error });
          worker.terminate();
        } else setStatus({ key, pending: true, progress: data.progress });
      };
      worker.onerror = () => {
        if (!cancelled)
          setStatus({
            key,
            error: 'Comparison worker failed. Reload to retry; no estimates have been substituted.',
          });
        worker.terminate();
      };
      worker.postMessage({
        kind: 'comparison',
        blocks,
        options: {
          holdout,
          tailQuantile,
          censor,
          repetitions,
          context: `${station.id}:${days}:${gapExtra}`,
          excludeTrainingYear,
        },
      });
    } catch (error) {
      setStatus({ key, error: error.message });
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [key]);
  const result = status.key === key ? status.result : null;
  const initialScroll = useRef(false);
  useEffect(() => {
    if (result && !initialScroll.current && window.location.hash === '#model-comparison') {
      document.getElementById('model-comparison')?.scrollIntoView({ behavior: 'instant' });
      initialScroll.current = true;
    }
  }, [result]);
  const observedBand = result
    ? observedRateInterval(result.observedExceedances, result.test.length, confidence / 100).map(
        (p) => p * 100,
      )
    : null;
  const computed = useMemo(() => {
    if (!result) return null;
    const bounds = (values) => comparisonInterval(result, values, confidence / 100);
    const rows = MODELS.map((model) => {
      const entry = result.fits[model];
      if (!entry.fit) return { model, error: entry.error };
      const level = modelLevel(entry.fit, period);
      const samples = entry.samples;
      const difference = samples.map((s, i) =>
        s && result.fits.gev.samples[i]
          ? subtract(modelLevel(s.fit, period), modelLevel(result.fits.gev.samples[i].fit, period))
          : null,
      );
      const scoreDifference = samples.map((s, i) =>
        s && result.fits.gev.samples[i]
          ? s.scores.pinball - result.fits.gev.samples[i].scores.pinball
          : null,
      );
      return {
        model,
        level,
        band: bounds(samples.map((s) => (s ? modelLevel(s.fit, period) : null))),
        delta:
          entry.fit && result.fits.gev.fit
            ? subtract(level, modelLevel(result.fits.gev.fit, period))
            : null,
        deltaBand: bounds(difference),
        probability: entry.scores.probability,
        probabilityBand: bounds(
          samples.map((s) =>
            s && s.scores.probability !== null ? 100 * s.scores.probability : null,
          ),
        ),
        brier: entry.scores.brier,
        brierBand: bounds(samples.map((s) => s?.scores.brier)),
        pinball: entry.scores.pinball,
        pinballBand: bounds(samples.map((s) => s?.scores.pinball)),
        scoreDeltaBand: bounds(scoreDifference),
        valid: samples.filter(Boolean).length,
      };
    });
    const curves = MODELS.filter((model) => result.fits[model].fit).map((model) => ({
      model,
      rows: Array.from({ length: 90 }, (_, i) => {
        const t = 2 * 250 ** (i / 89),
          entry = result.fits[model];
        const band =
          model === bandModel
            ? bounds(entry.samples.map((s) => (s ? modelLevel(s.fit, t) : null)))
            : null;
        return { period: t, value: modelLevel(entry.fit, t), lower: band?.[0], upper: band?.[1] };
      }),
    }));
    const finite = rows.map((r) => r.level).filter(Number.isFinite);
    return {
      rows,
      curves,
      spread: finite.length >= 2 ? Math.max(...finite) - Math.min(...finite) : null,
      predictions: MODELS.filter((model) => result.fits[model].fit).map((model) => ({
        model,
        level: modelLevel(result.fits[model].fit, 10),
      })),
    };
  }, [result, confidence, period, bandModel]);
  return (
    <section id="model-comparison" className="comparison-lab" aria-labelledby="comparison-title">
      <span className="eyebrow">FORWARD HOLDOUT EXPERIMENT</span>
      <h2 id="comparison-title">Compare GEV, Gumbel, GPD and SMEV</h2>
      <p>
        Fit the earlier complete years; reserve the latest complete years for testing. Station,
        rainfall duration and selected year range follow the controls above. Replay-year exclusion
        applies to training only; held-out observations are retained. These training-only estimates
        differ from the full-record explorer.
      </p>
      <div className="comparison-settings">
        <label>
          Station
          <select
            aria-label="Comparison station"
            value={station.id}
            onChange={(e) => onStation(e.target.value)}
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rainfall duration
          <select
            aria-label="Comparison rainfall duration"
            value={days}
            onChange={(e) => onDuration(+e.target.value)}
          >
            {[1, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}-day total
              </option>
            ))}
          </select>
        </label>

        <label>
          Held-out years
          <select
            aria-label="Held-out years"
            value={holdout}
            onChange={(e) => setHoldout(+e.target.value)}
          >
            {[5, 10, 15].map((n) => (
              <option key={n} value={n}>
                {n} latest complete years
              </option>
            ))}
          </select>
        </label>
        <label>
          Storm separation
          <select
            aria-label="Storm separation"
            value={gapExtra}
            onChange={(e) => setGap(+e.target.value)}
          >
            {[0, 1, 3].map((n) => (
              <option key={n} value={n}>
                {days + n} dry day{days + n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          GPD threshold
          <select
            aria-label="GPD threshold quantile"
            value={tailQuantile}
            onChange={(e) => setTail(+e.target.value)}
          >
            {[0.8, 0.9, 0.95, 0.975].map((n) => (
              <option key={n} value={n}>
                {100 * n}th event percentile
              </option>
            ))}
          </select>
        </label>
        <label>
          SMEV left-censoring
          <select
            aria-label="SMEV left-censoring"
            value={censor}
            onChange={(e) => setCensor(+e.target.value)}
          >
            {[0.7, 0.8, 0.9, 0.95].map((n) => (
              <option key={n} value={n}>
                Fit upper {Math.round(100 * (1 - n))}% of events
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="model-note">
        A wet day has ≥1 mm. One peak is retained per wet-day cluster; overlapping selected
        accumulation windows are merged. Dry gaps are sensitivity settings, not proof of storm
        independence. Windows and clusters stop at calendar-year boundaries. GPD requires at least
        20 threshold exceedances; SMEV requires at least 20 tail events.
      </p>
      {(status.key !== key || status.pending) && (
        <p className="model-state" role="status">
          Comparing training fits and paired year resamples…{' '}
          {Math.round((status.progress || 0) * 100)}%
        </p>
      )}
      {status.key === key && status.error && (
        <p className="model-state model-error" role="alert">
          {status.error}
        </p>
      )}
      {result && computed && (
        <>
          <div className="comparison-split">
            <p>
              <strong>
                Training: {result.training[0].year}–{result.training.at(-1).year}
              </strong>
              <br />
              {result.training.length} complete years · all parameters and thresholds estimated
              here.
            </p>
            <p>
              <strong>
                Held out: {result.test[0].year}–{result.test.at(-1).year}
              </strong>
              <br />
              {result.test.length} complete years · never used for fitting or threshold selection.
            </p>
          </div>
          <div className="comparison-settings">
            <label>
              Return period
              <select
                aria-label="Comparison return period"
                value={period}
                onChange={(e) => onPeriod(+e.target.value)}
              >
                {[...new Set([2, 5, 10, 20, 50, 100, 200, 500, period])]
                  .sort((a, b) => a - b)
                  .map((t) => (
                    <option key={t} value={t}>
                      {t} years
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Uncertainty band
              <select
                aria-label="Comparison uncertainty model"
                value={bandModel}
                onChange={(e) => setBand(e.target.value)}
              >
                {MODELS.map((model) => (
                  <option key={model} value={model}>
                    {LABELS[model]} · {confidence}% interval
                  </option>
                ))}
              </select>
            </label>
            <label>
              Confidence level
              <select
                aria-label="Comparison confidence level"
                value={confidence}
                onChange={(e) => onConfidence(+e.target.value)}
              >
                {[80, 90, 95].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="comparison-legend">
            {MODELS.map((model) => (
              <span key={model}>
                <i style={{ background: MODEL_COLORS[model] }} />
                {LABELS[model]}
                {result.fits[model].error ? ' · unavailable' : ''}
              </span>
            ))}
          </div>
          <div className="comparison-curve">
            <Plot
              component={ComparisonCurve}
              curves={computed.curves}
              bandModel={bandModel}
              years={result.training.length}
              period={period}
            />
          </div>
          <p className="model-note">
            All curves use training data only. The selected shading is a {confidence}% pointwise
            year-bootstrap confidence interval, not a prediction band or combined model uncertainty.
            Unavailable/non-finite bounds are not drawn; consult the table. Shading beyond{' '}
            {result.training.length} years marks extrapolation.
          </p>
          <p>
            <strong>
              Model spread at {period} years: {fmt(computed.spread)} mm
            </strong>{' '}
            across {computed.rows.filter((r) => Number.isFinite(r.level)).length} available models.
            This range describes disagreement; it is not a confidence interval.
          </p>
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <caption>
                Training estimates · mm / {days} day{days > 1 ? 's' : ''}
              </caption>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>{period}-year level</th>
                  <th>{confidence}% interval</th>
                  <th>Difference from GEV</th>
                  <th>{confidence}% paired difference interval</th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map((r) => (
                  <tr key={r.model}>
                    <th style={{ color: MODEL_COLORS[r.model] }}>{LABELS[r.model]}</th>
                    {r.error ? (
                      <td colSpan={4}>{r.error}</td>
                    ) : (
                      <>
                        <td>{fmt(r.level)}</td>
                        <td>{ci(r.band)}</td>
                        <td>{r.model === 'gev' ? 'Reference' : fmt(r.delta)}</td>
                        <td>{r.model === 'gev' ? 'Reference' : ci(r.deltaBand)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Held-out annual maxima</h3>
          <div className="comparison-history">
            <Plot
              component={HoldoutHistory}
              training={result.training}
              test={result.test}
              predictions={computed.predictions}
            />
          </div>
          <p className="model-note">
            Grey points are training observations; dark points are held-out observations. Coloured
            dashed lines are each model’s training-only 10-year return level (90th annual
            percentile). One exceedance per ten years is a probability, not a schedule.
          </p>
          <h3>Out-of-sample scores</h3>
          <p>
            Common rainfall threshold: <strong>{fmt(result.scoreThreshold)} mm</strong>, chosen from
            training only (the larger of its empirical 80th annual percentile and the fitted GPD
            threshold).{' '}
            <strong>
              {result.observedExceedances}/{result.test.length}
            </strong>{' '}
            held-out years exceeded it. The observed fraction has a {confidence}% Wilson interval of{' '}
            {ci(observedBand, 1)}%. Zero observed exceedances do not imply zero risk.
          </p>
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <caption>
                Lower scores are better · all models tested on the same held-out years
              </caption>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Annual chance above common threshold</th>
                  <th>
                    Brier score
                    <br />
                    {confidence}% interval
                  </th>
                  <th>
                    90th-percentile quantile loss (mm)
                    <br />
                    {confidence}% interval
                  </th>
                  <th>
                    Paired loss difference vs GEV
                    <br />
                    {confidence}% interval
                  </th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map((r) => (
                  <tr key={r.model}>
                    <th style={{ color: MODEL_COLORS[r.model] }}>{LABELS[r.model]}</th>
                    {r.error ? (
                      <td colSpan={4}>Unavailable: {r.error}</td>
                    ) : (
                      <>
                        <td>
                          {fmt(100 * r.probability, 2)}%
                          <small>
                            {r.probabilityBand
                              ? `${ci(r.probabilityBand, 2)}%`
                              : 'Interval unavailable'}
                          </small>
                        </td>
                        <td>
                          {fmt(r.brier, 4)}
                          <small>{ci(r.brierBand, 4)}</small>
                        </td>
                        <td>
                          {fmt(r.pinball, 2)}
                          <small>{ci(r.pinballBand, 2)}</small>
                        </td>
                        <td>
                          {r.model === 'gev'
                            ? 'Reference'
                            : fmt(r.pinball - result.fits.gev.scores?.pinball, 2)}
                          <small>{r.model === 'gev' ? '' : ci(r.scoreDeltaBand, 2)}</small>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="model-note">
            Brier score measures squared error of a probability forecast for exceeding the common
            threshold. Quantile loss evaluates the predicted 90th annual percentile; it penalises
            under- and over-prediction differently. A negative paired loss difference favours that
            model over GEV on this test. Changing GPD settings may change the common scoring
            threshold, so Brier scores across different thresholds are not directly comparable.
            Score intervals resample both training and held-out year blocks, using identical sampled
            years for every model. They are exploratory, not a formal model-selection test.
            Resampling a short test record cannot introduce types of outcomes absent from that
            record; score intervals can therefore understate uncertainty when exceedances are
            sparse.
          </p>
          <details className="model-details">
            <summary>Storm counts, fitted parameters and reproducibility</summary>
            {MODELS.map((model) => {
              const e = result.fits[model];
              return (
                <div key={model}>
                  <h4>{LABELS[model]}</h4>
                  {e.error ? (
                    <p>{e.error}</p>
                  ) : (
                    <>
                      <p>
                        {e.fit.eventCount ?? result.training.length}{' '}
                        {e.fit.eventCount ? 'ordinary events' : 'annual maxima'} ·{' '}
                        {e.fit.tailCount ?? result.training.length} fitted tail values ·{' '}
                        {e.samples.filter(Boolean).length}/{result.repetitions} valid bootstrap
                        fits.
                      </p>
                      <pre>{JSON.stringify(e.fit, null, 2)}</pre>
                    </>
                  )}
                </div>
              );
            })}
            <p>
              {result.training.reduce((n, b) => n + b.boundaryStorms, 0)} training wet-day clusters
              touch a year-boundary buffer. They are truncated within their calendar year; no event
              or window spans a training/test boundary. This is a daily-data storm approximation,
              not a meteorological storm catalogue.
            </p>
            <p>
              Method {result.version} · seed {result.seed}. GPD uses a fixed-zero excess L-moment
              fit and Poisson event rate. SMEV uses left-censored Weibull probability-plot
              regression with the ranks of all ordinary events retained and their mean annual count.
              The same observed training years are resampled with replacement for all four models;
              no storms are generated.
            </p>
          </details>
          <p className="model-warning">
            Intervals are withheld when fewer than 90% of paired attempts support the reported
            quantity. Sampling uncertainty excludes climate change, measurement, storm-definition
            and model-choice uncertainty. With only {result.test.length} held-out years, these
            scores cannot establish the correct 100- or 500-year level. Repeated tuning against this
            test can overfit it; treat comparisons as exploratory.
          </p>
        </>
      )}
    </section>
  );
}
