import InteractiveChart, { chartNumber } from './InteractiveChart.jsx';
import React, { useEffect, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import LakeBenchmark from './LakeBenchmark.jsx';
import LakeRecoveryOutlook from './LakeRecoveryOutlook.jsx';
const shortDay = (d) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
export function WaterChart({
  width,
  rows,
  unit = 'm above sea level',
  label = 'Lake water level and usual seasonal range',
}) {
  const w = Math.max(280, width),
    height = 260,
    left = 58,
    bottom = 38,
    top = 14;
  if (!rows.length) return null;
  // A missing calendar day breaks both the observation line and the seasonal band.
  const supplied = new Map(rows.map((r) => [r[0], r]));
  const points = [];
  for (
    let t = Date.parse(rows[0][0] + 'T12:00:00Z');
    t <= Date.parse(rows.at(-1)[0] + 'T12:00:00Z');
    t += 86400000
  ) {
    const d = new Date(t).toISOString().slice(0, 10);
    points.push(supplied.get(d) ?? [d, null, null]);
  }
  const values = points.flatMap((r) => [r[1], ...(r[2] || [])]).filter(Number.isFinite);
  if (!values.length) return null;
  const lo = Math.min(...values),
    hi = Math.max(...values),
    padding = Math.max(0.02, (hi - lo) * 0.12);
  const x = scaleLinear({ domain: [0, Math.max(1, points.length - 1)], range: [left, w - 12] });
  const y = scaleLinear({ domain: [lo - padding, hi + padding], range: [height - bottom, top] });
  return (
    <InteractiveChart
      points={points.map((r, i) => ({
        x: x(i),
        y: Number.isFinite(r[1]) ? y(r[1]) : null,
        title: r[0],
        lines: [
          `Measured: ${chartNumber(r[1], 2)} ${unit}`,
          ...(r[2]
            ? [`Usual range: ${chartNumber(r[2][0], 2)}–${chartNumber(r[2][2], 2)} ${unit}`]
            : []),
        ],
      }))}
      viewBox={`0 0 ${w} ${height}`}
      role="img"
      aria-label={label}
      data-renderer="visx"
    >
      <AxisLeft
        left={left}
        scale={y}
        numTicks={4}
        tickFormat={(v) => Number(v).toFixed(2)}
        tickLabelProps={() => ({ fontSize: 12, fill: '#536c66', textAnchor: 'end', dx: -4 })}
      />
      <AxisBottom
        top={height - bottom}
        scale={x}
        tickValues={[0, Math.floor((points.length - 1) / 2), points.length - 1]}
        tickFormat={(i) => shortDay(points[i][0])}
        tickLabelProps={() => ({ fontSize: 12, fill: '#536c66', textAnchor: 'middle' })}
      />
      <AreaClosed
        data={points}
        defined={(r) => Boolean(r[2])}
        x={(_, i) => x(i)}
        y0={(r) => (r[2] ? y(r[2][0]) : 0)}
        y1={(r) => (r[2] ? y(r[2][2]) : 0)}
        yScale={y}
        fill="#dce9e3"
      />
      <LinePath
        data={points}
        defined={(r) => Number.isFinite(r[1])}
        x={(_, i) => x(i)}
        y={(r) => y(r[1] ?? 0)}
        stroke="#146e63"
        strokeWidth={2.5}
      />
      <text x={left} y={12} fontSize={11} fill="#536c66">
        {unit}
      </text>
    </InteractiveChart>
  );
}
export function LakeOverview({ id = '2209', onSelect, onDirectory, embedded = false }) {
  const [directory, setDirectory] = useState(null),
    [lake, setLake] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    fetch(new URL('data/water/manifest.json', document.baseURI), { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error('Lake observations are not available in this release.');
        return r.json();
      })
      .then((data) => {
        setDirectory(data);
        onDirectory?.(data);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!directory) return;
    const c = new AbortController();
    setLake(null);
    setError('');
    fetch(new URL(`data/water/${id}.json`, document.baseURI), { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error('Lake observations could not be loaded.');
        return r.json();
      })
      .then((r) => {
        if (!c.signal.aborted) setLake(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [directory, id]);
  const weatherModelled = ['2209', '2032'].includes(id);
  const HistoricalWrapper = weatherModelled ? 'details' : 'div';
  const a = lake?.analysis,
    r = a?.recovery;
  const priorDay = a?.latest
    ? new Date(Date.parse(a.latest + 'T12:00:00Z') - 7 * 86400000).toISOString().slice(0, 10)
    : null;
  const prior = a?.recent?.find((row) => row[0] === priorDay)?.[1];
  const weeklyChange = Number.isFinite(prior) ? (a.level - prior) * 100 : null;
  const stale = a?.latest && (Date.now() - Date.parse(a.latest + 'T12:00:00Z')) / 86400000 > 3;
  return (
    <section id="lake-levels" className="lake-overview" aria-label="Lake levels and recovery">
      {!embedded && (
        <>
          <p className="eyebrow">LAKE WATER LEVELS</p>
          <h2>When could lake levels return to normal?</h2>
          <p>
            Compare the latest measured level with the usual range for this time of year. A steady
            level can still be unusually low.
          </p>
        </>
      )}
      {directory && (
        <label>
          Lake{' '}
          <select
            aria-label="Overview lake"
            value={id}
            onChange={(e) => {
              onSelect?.(e.target.value);
            }}
          >
            {directory.lakes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error ? (
        <p role="status">{error}</p>
      ) : !a ? (
        <p role="status">Loading measured lake levels…</p>
      ) : a.unavailable ? (
        <p>{a.unavailable}</p>
      ) : (
        <>
          <div className="lake-reading">
            <strong>{a.level.toFixed(2)} m</strong>
            <span>
              above sea level · daily mean, {shortDay(a.latest)} {a.latest.slice(0, 4)}
            </span>
          </div>
          {stale && (
            <p role="status">
              This reading is more than three days old. It does not describe the current level.
            </p>
          )}
          {weeklyChange != null && (
            <p>
              Over the seven days to this reading, the level{' '}
              {Math.abs(weeklyChange) < 0.5
                ? 'was almost unchanged'
                : `${weeklyChange > 0 ? 'rose' : 'fell'} by ${Math.abs(weeklyChange).toFixed(1)} cm`}
              .
            </p>
          )}
          {a.band && (
            <p>
              {a.level < a.band[0]
                ? `${Math.round((a.band[0] - a.level) * 100)} cm below the lower edge of the usual seasonal range.`
                : a.level > a.band[2]
                  ? 'Above the usual seasonal range.'
                  : 'Within the usual seasonal range.'}{' '}
              The usual range here is {a.band[0].toFixed(2)}–{a.band[2].toFixed(2)} m.
            </p>
          )}
          <ParentSize style={{ height: 260 }}>
            {({ width }) => <WaterChart width={width} rows={a.recent} />}
          </ParentSize>
          <p className="chart-caption">
            Green line: measured daily level. Shaded band: the middle half of historical levels at
            this time of year, 1991–2020. Gaps remain gaps.
          </p>
          {weatherModelled && <LakeRecoveryOutlook lake={lake} />}
          <HistoricalWrapper id="water-history" className="lake-recovery">
            {weatherModelled && <summary>Historical comparison without a weather forecast</summary>}
            <h3>{weatherModelled ? 'Historical recovery comparison' : 'Recovery outlook'}</h3>
            {stale ? (
              <p>A recovery outlook is withheld because the observation is out of date.</p>
            ) : r?.unavailable ? (
              <p>
                {r.unavailable}
                {r.matches != null
                  ? ` Only ${r.matches} comparable historical years were found.`
                  : ''}
              </p>
            ) : r ? (
              <>
                <p>
                  {r.medianDays == null
                    ? 'Fewer than half of the comparable historical cases returned to the seasonal range during the observed follow-up.'
                    : `In comparable historical years, half had returned to the seasonal range after ${r.medianDays} days.`}
                </p>
                {r.medianInterval && (
                  <p>
                    95% sampling range for that median: {Math.floor(r.medianInterval[0])}–
                    {Math.ceil(r.medianInterval[1])} days.
                  </p>
                )}
                {!r.medianInterval && (
                  <p>The sampling range has no supported finite upper bound.</p>
                )}
                <p>
                  {r.matches} comparable years; {r.recovered} observed returns within 180 days.{' '}
                  {r.recoveredBy180 != null
                    ? `${Math.round(r.recoveredBy180 * 100)}% had returned by 180 days in the censored historical estimate.`
                    : ''}
                </p>
              </>
            ) : null}
            <p>
              This is an experimental historical comparison, not a weather-based forecast or a
              promised recovery date. Future rain, evaporation, inflows and regulated outflows can
              change the outcome. A return means seven consecutive days within the seasonal range.
            </p>
          </HistoricalWrapper>
          {weatherModelled ? (
            <details className="lake-disclosure">
              <summary>Earlier short-term model benchmark</summary>
              <LakeBenchmark id={id} />
            </details>
          ) : (
            <LakeBenchmark id={id} />
          )}
          <details className="lake-disclosure">
            <summary>Lake sources, uncertainty and method</summary>
            <p>
              Source: FOEN. {lake.station.riverName}, {lake.station.name}, station {lake.station.no}
              . Latest daily release flag: {lake.rows.at(-1)?.[3] ?? 'not supplied'}. Prepared{' '}
              {lake.generatedAt}. Lake selection is independent of the rainfall day; these are the
              latest available observations. A geographically nearby lake is not necessarily
              downstream of the address.
            </p>
            <p>
              {directory.method}. Historical analogues have not been validated as an operational
              forecast. Sampling intervals exclude future weather, regulation changes, climate
              trends and measurement uncertainty.
            </p>
            <a href={`data/water/${id}.json`}>
              Daily observations, original timestamps and source checksums
            </a>{' '}
            ·{' '}
            <a href={`https://www.hydrodaten.admin.ch/en/seen`}>
              Official hydrological information
            </a>
          </details>
        </>
      )}
    </section>
  );
}
