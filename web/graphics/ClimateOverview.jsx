import React, { useEffect, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { verifiedBuffer } from './regional-data.mjs';
let indexPromise;
const cache = new Map();
export function useCellSummary(cell) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (cell == null) return;
    let cancelled = false;
    (async () => {
      const base = new URL('data/rainfall-summary/', document.baseURI);
      if (!indexPromise)
        indexPromise = fetch(new URL('manifest.json', base))
          .then((r) => {
            if (!r.ok) throw Error('Monthly rainfall history is unavailable.');
            return r.json();
          })
          .catch((e) => {
            indexPromise = null;
            throw e;
          });
      const manifest = await indexPromise;
      const chunk = manifest.chunks.find((c) => cell >= c.first && cell <= c.last);
      if (!chunk) throw Error('No monthly history at this address.');
      let rows = cache.get(chunk.sha256);
      if (!rows) {
        const raw = await verifiedBuffer(
          await fetch(new URL(chunk.path, base)),
          chunk.sha256,
          'Monthly history',
        );
        rows = await new Response(
          new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).json();
        cache.set(chunk.sha256, rows);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
      }
      const entry = rows.find((r) => r.cell === cell);
      if (!entry) throw Error('Monthly history does not cover this cell.');
      return { cell, entry, manifest };
    })()
      .then((r) => {
        if (!cancelled) setState(r);
      })
      .catch((e) => {
        if (!cancelled) setState({ cell, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [cell]);
  return state?.cell === cell ? state : null;
}
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (n) => n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
export function HistoricalExtremes({ summary, days, onDuration, onDate, date }) {
  if (!summary || summary.error) return null;
  const rows = summary.entry.extremes[String(days)];
  return (
    <section className="historical-extremes" aria-label="Historical extremes">
      <div className="section-heading">
        <h3>Historical extremes</h3>
        <label>
          Rainfall window{' '}
          <select
            aria-label="Historical extreme window"
            value={days}
            onChange={(e) => onDuration(Number(e.target.value))}
          >
            {[1, 3, 5].map((d) => (
              <option key={d} value={d}>
                {d}-day total
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        The five largest non-overlapping {days}-day totals in this address’s gridded history,
        1961–2025. Smoothed regional estimates, not building measurements.
      </p>
      <div className="extreme-buttons">
        {rows.map(([amount, offset], i) => {
          const day = new Date(
            Date.parse(summary.manifest.epoch + 'T12:00:00Z') + offset * 86400000,
          )
            .toISOString()
            .slice(0, 10);
          return (
            <button key={day} aria-pressed={date === day} onClick={() => onDate(day)}>
              <small>{i + 1}</small>
              <span>
                {new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </span>
              <strong>{amount.toFixed(1)} mm</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}
function MonthChart({ width, rows, selected }) {
  const w = Math.max(width, 280),
    left = 44,
    bottom = w < 500 ? 56 : 36,
    top = 12,
    height = 270;
  const x = scaleBand({ domain: months, range: [left, w - 12], padding: 0.3 });
  const y = scaleLinear({
    domain: [0, Math.max(1, ...rows.flatMap((r) => (r ? [r[3]] : []))) * 1.1],
    range: [height - bottom, top],
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      role="img"
      aria-label="Average monthly precipitation with the middle 80 percent of historical monthly totals"
      data-renderer="visx"
    >
      <AxisLeft
        left={left}
        scale={y}
        numTicks={4}
        tickLabelProps={() => ({ fontSize: 12, fill: '#526963', textAnchor: 'end', dx: -4 })}
      />
      <AxisBottom
        top={height - bottom}
        scale={x}
        tickLabelProps={() => ({
          fontSize: 12,
          fill: '#526963',
          textAnchor: w < 500 ? 'end' : 'middle',
          angle: w < 500 ? -50 : 0,
          dy: w < 500 ? 5 : 0,
        })}
      />
      {rows.map(
        (r, i) =>
          r && (
            <g key={months[i]}>
              <Bar
                x={x(months[i])}
                y={y(r[1])}
                width={x.bandwidth()}
                height={y(0) - y(r[1])}
                fill={i === selected ? '#146e63' : '#9ec5bc'}
              />
              <line
                x1={x(months[i]) + x.bandwidth() / 2}
                x2={x(months[i]) + x.bandwidth() / 2}
                y1={y(r[2])}
                y2={y(r[3])}
                stroke="#244d48"
                strokeWidth={2}
              />
              <title>
                {months[i]}: average {r[1].toFixed(1)} mm; 10th–90th percentiles {r[2].toFixed(1)}–
                {r[3].toFixed(1)} mm, {r[0]} complete months
              </title>
            </g>
          ),
      )}
      <text x={left} y={10} fontSize={11} fill="#526963">
        mm
      </text>
    </svg>
  );
}
export function ClimateOverview({ summary, date }) {
  const [chosen, setChosen] = useState(null);
  if (!summary) return <p role="status">Loading monthly and yearly rainfall totals…</p>;
  if (summary.error) return <p role="status">{summary.error}</p>;
  const { entry } = summary,
    month = chosen ?? Number(date.slice(5, 7)) - 1,
    row = entry.months[month],
    annual = entry.annual;
  const available = entry.months.map((r, i) => ({ r, i })).filter((x) => x.r);
  const wettest = available.reduce((a, b) => (a.r[1] > b.r[1] ? a : b)),
    driest = available.reduce((a, b) => (a.r[1] < b.r[1] ? a : b));
  return (
    <section
      id="monthly-rainfall"
      className="climate-overview overview-only"
      aria-label="Monthly and yearly rainfall"
    >
      <h2>Rainfall through the year</h2>
      <p>
        {months[wettest.i]} has the highest average rainfall ({fmt(wettest.r[1])} mm);{' '}
        {months[driest.i]} has the lowest ({fmt(driest.r[1])} mm).
      </p>
      <ParentSize style={{ height: 270 }}>
        {({ width }) => <MonthChart width={width} rows={entry.months} selected={month} />}
      </ParentSize>
      <p className="chart-caption">
        Bars show the average monthly total. Lines span the middle 80% of recorded totals: about
        eight in ten years fell within that range. They show year-to-year variation, not a forecast
        or a confidence interval.
      </p>
      <label>
        Month{' '}
        <select
          aria-label="Monthly rainfall statistics"
          value={month}
          onChange={(e) => setChosen(Number(e.target.value))}
        >
          {months.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {row && (
        <div className="climate-facts">
          <article>
            <strong>{fmt(row[1])} mm</strong>
            <span>average total in {months[month]}</span>
            <p>About {fmt(row[6])} days had at least 1 mm.</p>
          </article>
          <article>
            <strong>{fmt(row[4])} mm</strong>
            <span>
              wettest {months[month]}: {row[5]}
            </span>
            <p>
              Based on {row[0]} complete {months[month]} records.
            </p>
          </article>
          {annual && (
            <>
              <article>
                <strong>{fmt(annual[1])} mm</strong>
                <span>average annual rainfall</span>
                <p>{annual[0]} complete years.</p>
              </article>
              <article>
                <strong>{fmt(annual[4])} mm</strong>
                <span>wettest complete year: {annual[5]}</span>
              </article>
              <article>
                <strong>{fmt(annual[2])} mm</strong>
                <span>driest complete year: {annual[3]}</span>
              </article>
            </>
          )}
        </div>
      )}
      <p className="chart-caption">
        MeteoSwiss RhiresD, 1961–2025. These totals use the same smoothed grid cell as the daily
        address result. The 1 km grid spacing does not mean 1 km accuracy. Missing months and
        incomplete years are excluded; no gaps are filled.
      </p>
      <details>
        <summary>Monthly data sources and definitions</summary>
        <p>
          Totals sum every daily precipitation estimate in each complete calendar month. Annual
          records require all twelve complete months. Wet days have at least 1 mm. Snow is included
          as its water equivalent. Monthly ranges are the 10th and 90th percentiles across complete
          years.
        </p>
        <a href="data/rainfall-summary/manifest.json">
          Source versions, checksums and preparation method
        </a>
      </details>
    </section>
  );
}
