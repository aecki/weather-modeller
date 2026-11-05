import React, { useEffect, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { verifiedBuffer } from './regional-data.mjs';

const dayText = (day) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const addDays = (day, n) =>
  new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function OutlookChart({ width, data }) {
  const w = Math.max(280, width),
    height = 230,
    left = 62,
    bottom = 38;
  const rows = data.summary.trajectory;
  const values = [...rows.flat(), ...data.targetBands.flat()];
  const low = Math.min(data.level, ...values),
    high = Math.max(data.level, ...values);
  const padding = Math.max(0.02, (high - low) * 0.08);
  const x = scaleLinear({ domain: [0, rows.length], range: [left, w - 12] });
  const y = scaleLinear({ domain: [low - padding, high + padding], range: [height - bottom, 18] });
  const points = [[data.level, data.level, data.level], ...rows];
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      role="img"
      aria-label="Simulated lake levels: median and central 90 percent of paths, not observations"
      data-renderer="visx"
    >
      <AxisLeft
        left={left}
        scale={y}
        numTicks={4}
        tickFormat={(v) => Number(v).toFixed(2)}
        tickLabelProps={() => ({ fontSize: 11, fill: '#526570', textAnchor: 'end', dx: -4 })}
      />
      <AxisBottom
        top={height - bottom}
        scale={x}
        tickValues={[0, 30, 60, 90]}
        tickFormat={(v) => `${v}d`}
        tickLabelProps={() => ({ fontSize: 11, fill: '#526570', textAnchor: 'middle' })}
      />
      <AreaClosed
        data={data.targetBands}
        x={(_, i) => x(i)}
        y0={(r) => y(r[0])}
        y1={(r) => y(r[1])}
        yScale={y}
        fill="#dce9df"
      />
      <AreaClosed
        data={points}
        x={(_, i) => x(i)}
        y0={(r) => y(r[0])}
        y1={(r) => y(r[2])}
        yScale={y}
        fill="#b9ccde"
        fillOpacity={0.55}
      />
      {[0, 1].map((bound) => (
        <LinePath
          key={bound}
          data={data.targetBands}
          x={(_, i) => x(i)}
          y={(r) => y(r[bound])}
          stroke="#71836f"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      <LinePath
        data={points}
        x={(_, i) => x(i)}
        y={(r) => y(r[1])}
        stroke="#285c7a"
        strokeWidth={2}
      />
      <line
        x1={x(data.forecastDays)}
        x2={x(data.forecastDays)}
        y1={18}
        y2={height - bottom}
        stroke="#657783"
        strokeDasharray="4 4"
      />
      <text x={left} y={12} fontSize={11} fill="#526570">
        m above sea level
      </text>
    </svg>
  );
}
export default function LakeRecoveryOutlook({ lake }) {
  const id = lake.station.no;
  const [data, setData] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    (async () => {
      const base = new URL('data/lake-outlook/', document.baseURI);
      const response = await fetch(new URL('manifest.json', base), {
        cache: 'no-cache',
        signal: controller.signal,
      });
      if (!response.ok) throw Error('The weather-based outlook is not available in this release.');
      const manifest = await response.json();
      const entry = manifest.lakes.find((r) => r.id === id);
      if (!entry) throw Error('No weather-based outlook is available for this lake.');
      const raw = await verifiedBuffer(
        await fetch(new URL(entry.path, base), { signal: controller.signal }),
        entry.sha256,
        'Lake outlook',
      );
      const result = JSON.parse(new TextDecoder().decode(raw));
      if (
        result.id !== id ||
        result.observationDate !== lake.analysis.latest ||
        Math.abs(result.level - lake.analysis.level) > 1e-6
      )
        throw Error('The outlook and lake observations are from different releases.');
      if (!controller.signal.aborted) setData(result);
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [id, lake.analysis.latest, lake.analysis.level]);
  if (error) return <p role="status">{error}</p>;
  if (!data) return <p role="status">Loading the weather-based recovery outlook…</p>;
  const stale =
    (Date.now() - Date.parse(data.generatedAt)) / 3600000 > 36 ||
    (Date.now() - Date.parse(data.observationDate + 'T12:00:00Z')) / 86400000 > 3;
  if (stale)
    return (
      <p role="status">
        The outlook prepared on {dayText(data.generatedAt.slice(0, 10))} is out of date. Recovery
        probabilities are withheld until the next successful refresh.
      </p>
    );
  const recovery = data.summary.recoveryDays;
  const scores = data.validation.scores;
  const weakerThanBaseline =
    scores.reduce((sum, s) => sum + s.seasonalWeatherBrier - s.baselineBrier, 0) > 0;
  return (
    <div className="weather-recovery">
      <p className="eyebrow">EXPERIMENTAL WEATHER-BASED OUTLOOK</p>
      <h3>Chance of returning to the usual range</h3>
      <p>
        A return means seven consecutive days within the usual seasonal range. These estimates
        combine the weather forecast, past catchment weather and uncertainty in the lake’s response.
      </p>
      {weakerThanBaseline && (
        <p className="outlook-warning">
          This lake model was less accurate than the lake-history baseline in past low-water tests.
          Treat its recovery probabilities as low-confidence research estimates.
        </p>
      )}
      {data.state === 'within' && (
        <p>
          The latest reading is already in the usual range. The outlook tests whether levels remain
          in that range for a full week.
        </p>
      )}
      {data.outsideTrainingRange && (
        <p className="outlook-warning">
          The current level is outside the model’s training range. This is an extrapolation, with
          additional uncertainty that the shaded band may not capture.
        </p>
      )}
      <div className="recovery-probabilities">
        {data.summary.probabilities.map((p) => (
          <article key={p.days}>
            <strong>
              {p.probability < 0.01
                ? '<1%'
                : p.probability > 0.99
                  ? '>99%'
                  : `${Math.round(p.probability * 100)}%`}
            </strong>
            <span>within {p.days} days</span>
            <small>by {dayText(addDays(data.observationDate, p.days))}</small>
          </article>
        ))}
      </div>
      <p>
        {recovery[1] === null
          ? 'Fewer than half of the simulated paths complete a return within 90 days. A median recovery date is not supported.'
          : `Half of the simulated paths complete a return by ${dayText(addDays(data.observationDate, recovery[1]))}. This is a conditional estimate, not a promised date.`}
      </p>
      <p>
        {recovery[0] === null
          ? 'Even the faster 10% recovery-time boundary lies beyond 90 days.'
          : `The faster 10% boundary is ${dayText(addDays(data.observationDate, recovery[0]))}.`}{' '}
        {recovery[2] === null
          ? 'The slower 90% boundary lies beyond the 90-day horizon.'
          : `The slower 90% boundary is ${dayText(addDays(data.observationDate, recovery[2]))}.`}
      </p>
      <ParentSize style={{ height: 230 }}>
        {({ width }) => <OutlookChart width={width} data={data} />}
      </ParentSize>
      <p className="chart-caption">
        Green band: usual seasonal range. Blue line: median simulated level. Blue shading: middle
        90% of paths. Vertical dashed line: end of complete weather-forecast days. These are
        predictions, not measurements.
      </p>
      <p>
        {data.weatherMembers} of {data.sourceWeatherMembers} weather members are used.{' '}
        {data.excludedWeatherMembers.length > 0
          ? `${data.excludedWeatherMembers.length} were excluded because the provider returned invalid weather fluxes; no rainfall values were replaced.`
          : ''}
      </p>
      <p>
        Weather forecasts cover {dayText(data.forecastStart)}–{dayText(data.forecastThrough)}. After
        that, the outlook assumes seasonal weather drawn from past years; it is not a 90-day weather
        forecast.
      </p>
      <details>
        <summary>Past low-water tests and forecast limits</summary>
        <p>
          {data.validation.lowWaterEpisodes} low-water episodes tested in 2016–2025, including{' '}
          {data.validation.archivedForecastEpisodes} with genuine archived ECMWF forecasts from 2024
          onwards. Older tests use historical-weather scenarios. The lake model was fitted using
          data through 2015.
        </p>
        <p>
          The nominal 90% level band covered {(data.validation.coverage90 * 100).toFixed(1)}% of
          observed test days in the seasonal-weather tests, and{' '}
          {(data.validation.archivedCoverage90 * 100).toFixed(1)}% in the archived-forecast subset.
          These descriptive checks use a small, partly overlapping sample; they do not guarantee
          coverage for today’s outlook.
        </p>
        <div className="table-scroll">
          <table>
            <caption>
              Recovery probability error (Brier score). Lower is better; zero is perfect.
            </caption>
            <thead>
              <tr>
                <th>By day</th>
                <th>Seasonal weather</th>
                <th>Lake-history baseline</th>
                <th>Archived forecast</th>
                <th>Known outcomes</th>
              </tr>
            </thead>
            <tbody>
              {data.validation.scores.map((s) => (
                <tr key={s.days}>
                  <th>{s.days}</th>
                  <td>{s.seasonalWeatherBrier?.toFixed(3) ?? '—'}</td>
                  <td>{s.baselineBrier?.toFixed(3) ?? '—'}</td>
                  <td>{s.archivedForecastBrier?.toFixed(3) ?? '—'}</td>
                  <td>{s.knownOutcomes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The archived-forecast column uses a smaller, later subset and cannot be compared directly
          with the full-period columns. Archived tests use deterministic 9 km forecasts; today’s
          outlook uses an ensemble. The displayed probabilities are not independently calibrated for
          that ensemble.
        </p>
        <div className="table-scroll">
          <table>
            <caption>
              Episode start and observed return. One start per sustained low-water episode.
            </caption>
            <thead>
              <tr>
                <th>Start</th>
                <th>Observed return</th>
                <th>Archived forecast</th>
              </tr>
            </thead>
            <tbody>
              {data.validation.cases.map((c) => (
                <tr key={c.origin}>
                  <th>{dayText(c.origin)}</th>
                  <td>
                    {c.observedRecoveryDays !== null
                      ? `${c.observedRecoveryDays} days`
                      : c.observedFollowupDays < 90
                        ? `Unknown after ${c.observedFollowupDays} days`
                        : 'Not within 90 days'}
                  </td>
                  <td>
                    {c.archivedForecast
                      ? `${c.archivedForecast.forecastDays} weather days`
                      : 'Unavailable'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Catchment: {Math.round(data.catchment.areaKm2).toLocaleString('en-GB')} km²;{' '}
          {data.catchment.swissPercent}% in Switzerland. Weather is sampled at four area-weighted
          locations. Snow storage and melt are modelled, not measured.
        </p>
        <ul>
          {data.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p>
          {data.seasonalBaseline} Prepared{' '}
          {new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.
        </p>
        <p>
          Sources: <a href="https://www.hydrodaten.admin.ch/en/seen">FOEN lake observations</a>,{' '}
          <a href="https://www.bafu.admin.ch/en/waterbody-catchment-areas">FOEN catchments</a>,{' '}
          <a href="https://open-meteo.com/en/docs/ensemble-api">ECMWF forecasts via Open-Meteo</a>,
          and{' '}
          <a href="https://open-meteo.com/en/docs/historical-weather-api">
            ECMWF ERA5 reanalysis via Open-Meteo
          </a>{' '}
          (CC BY 4.0).
        </p>
        <a href="data/lake-outlook/manifest.json">Outlook data and versions</a> ·{' '}
        <a href="data/lake-recovery-reference/validation.json">Full validation results</a> ·{' '}
        <a href="data/lake-recovery-reference/catchments.json">FOEN catchment boundaries</a>
      </details>
    </div>
  );
}
