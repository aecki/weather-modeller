import InteractiveChart, { chartNumber } from './InteractiveChart.jsx';
import React, { useEffect, useMemo, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { verifiedBuffer } from './regional-data.mjs';
import { compareYear } from './year-comparison.mjs';
const currentCache = new Map();
const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const names = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function YearChart({ width, result }) {
  const w = Math.max(width, 280),
    height = 230,
    left = 48,
    bottom = 38;
  const data = [
    ...result.reference,
    { year: result.selectedYear, value: result.amount, selected: true },
  ].sort((a, b) => a.year - b.year);
  const x = scaleBand({ domain: data.map((r) => r.year), range: [left, w - 12], padding: 0.12 });
  const y = scaleLinear({
    domain: [0, Math.max(...data.map((r) => r.value)) * 1.12],
    range: [height - bottom, 12],
  });
  const ticks = [
    data[0].year,
    ...data.filter((r) => r.year % 20 === 0).map((r) => r.year),
    data.at(-1).year,
  ];
  return (
    <InteractiveChart
      points={data.map((r) => ({
        x: x(r.year) + x.bandwidth() / 2,
        y: y(r.value),
        title: String(r.year),
        lines: [
          `Rainfall: ${chartNumber(r.value)} mm`,
          `Same ${result.months} calendar months${r.selected ? ' · selected year' : ''}`,
        ],
      }))}
      viewBox={`0 0 ${w} ${height}`}
      role="img"
      aria-label={`Rainfall totals for the same ${result.months} calendar months in each comparison year; ${result.selectedYear} is highlighted`}
      data-renderer="visx"
    >
      <AxisLeft
        left={left}
        scale={y}
        numTicks={4}
        tickLabelProps={() => ({ fontSize: 12, fill: '#526570', textAnchor: 'end', dx: -4 })}
      />
      <AxisBottom
        top={height - bottom}
        scale={x}
        tickValues={
          w < 500
            ? [data[0].year, data[Math.floor(data.length / 2)].year, data.at(-1).year]
            : [...new Set(ticks)]
        }
        tickFormat={(year) => String(year)}
        tickLabelProps={() => ({ fontSize: 12, fill: '#526570', textAnchor: 'middle' })}
      />
      {data.map((r) => (
        <Bar
          key={r.year}
          x={x(r.year)}
          y={y(r.value)}
          width={x.bandwidth()}
          height={y(0) - y(r.value)}
          fill={r.selected ? '#b3332a' : '#a8bdcb'}
        >
          <title>
            {r.year}: {fmt(r.value)} mm
          </title>
        </Bar>
      ))}
      <text x={left} y={11} fontSize={11} fill="#526570">
        mm
      </text>
    </InteractiveChart>
  );
}
export function YearOverview({ summary, date, release }) {
  const year = Number(date.slice(0, 4));
  const [current, setCurrent] = useState(null),
    [error, setError] = useState('');
  const archived = summary?.manifest.years.includes(year);
  useEffect(() => {
    if (!summary || summary.error || archived) return;
    const controller = new AbortController();
    setCurrent(null);
    setError('');
    (async () => {
      const base = new URL('data/year-overview/', document.baseURI);
      const response = await fetch(new URL('manifest.json', base), {
        signal: controller.signal,
        cache: 'no-cache',
      });
      if (!response.ok)
        throw Error('The current-year comparison is not available in this release.');
      const m = await response.json();
      if (m.schemaVersion !== 1 || m.year !== year)
        throw Error('No complete annual record is available for this year yet.');
      if (m.releaseGeneratedAt !== release.generatedAt)
        throw Error(
          'The annual and daily releases do not match yet. Reload the data to try again.',
        );
      let raw = currentCache.get(m.sha256);
      if (!raw) {
        raw = await verifiedBuffer(
          await fetch(new URL(m.path, base), { signal: controller.signal }),
          m.sha256,
          'Current-year rainfall',
        );
        currentCache.set(m.sha256, raw);
        if (currentCache.size > 3) currentCache.delete(currentCache.keys().next().value);
      }
      const size = m.grid.width * m.grid.height;
      if (raw.byteLength !== 12 * size * 4) throw Error('Incomplete current-year rainfall field.');
      const view = new DataView(raw);
      const values = Array.from({ length: 12 }, (_, i) => {
        const v = view.getFloat32((i * size + summary.cell) * 4, true);
        return Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
      });
      return {
        cell: summary.cell,
        year,
        values,
        months: m.months,
        through: m.through,
        statuses: m.statuses,
      };
    })()
      .then((r) => {
        if (!controller.signal.aborted) setCurrent(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [summary, archived, year, release.generatedAt]);
  const active = current?.cell === summary?.cell && current?.year === year ? current : null;
  const months = archived ? 12 : active?.months;
  const result = useMemo(
    () =>
      summary?.entry.yearMonths && months != null
        ? compareYear(
            summary.manifest.years,
            summary.entry.yearMonths,
            year,
            months,
            active?.values,
          )
        : null,
    [summary, year, months, active],
  );
  if (summary?.error) return null;
  return (
    <section
      id="rainfall-year"
      className="year-overview overview-only"
      aria-label="How unusual was this year"
    >
      <h2>How unusual was {year}?</h2>
      {error ? (
        <p role="status">{error}</p>
      ) : !result ? (
        <p role="status">Comparing annual rainfall records…</p>
      ) : result.unavailable ? (
        <p>{result.unavailable}</p>
      ) : (
        <>
          <p>
            {archived
              ? 'January–December'
              : `January–${names[months - 1]}, through ${active.through}`}
            . Compared with those same calendar months in {result.reference.length} other complete
            years.
          </p>
          <div className="year-facts">
            <article>
              <strong>{fmt(result.amount)} mm</strong>
              <span>rainfall in this period</span>
            </article>
            <article>
              <strong>
                {result.percent == null ? '—' : `${Math.abs(Math.round(result.percent))}%`}
              </strong>
              <span>
                {result.percent == null
                  ? 'comparison unavailable'
                  : Math.abs(result.percent) < 0.5
                    ? 'close to the historical average'
                    : result.percent < 0
                      ? 'less than the historical average'
                      : 'more than the historical average'}
              </span>
              <p>Average: {fmt(result.mean)} mm.</p>
            </article>
            <article>
              <strong>
                {result.rank[0] === result.rank[1]
                  ? `${result.rank[0]} of ${result.reference.length + 1}`
                  : `${result.rank[0]}–${result.rank[1]} of ${result.reference.length + 1}`}
              </strong>
              <span>rank from driest to wettest, including {year}</span>
            </article>
          </div>
          <p>
            The closest recorded total was {result.closest.year}: {fmt(result.closest.value)} mm.
            The middle 80% of comparison years recorded {fmt(result.range[0])}–
            {fmt(result.range[1])} mm.
          </p>
          <ParentSize style={{ height: 230 }}>
            {({ width }) => <YearChart width={width} result={result} />}
          </ParentSize>
          <p className="chart-caption">
            Red: selected year. Grey: other years, 1961–2025. This compares precipitation totals,
            including snowfall water equivalent; it does not assess every aspect of the weather or
            predict next year.{' '}
            {archived
              ? 'The selected year is excluded from the average and historical range.'
              : 'Only complete months are included; the unfinished month is excluded. Current-year estimates may be revised.'}
          </p>
          <details>
            <summary>Year comparison: data and limits</summary>
            <p>
              Same smoothed regional grid cell as the daily result. Missing months make the period
              unavailable; no gaps are filled. Monthly totals are stored to 0.1 mm, and rank ranges
              retain possible rounding ties. The middle-80% range describes year-to-year variation,
              not a confidence interval or forecast. Leap years retain their extra day. Historical
              comparisons use complete calendar years; the current year uses complete months through
              the latest release.
            </p>
            <a href="data/rainfall-summary/manifest.json">Historical source versions</a>
            {!archived && (
              <>
                {' '}
                · <a href="data/year-overview/manifest.json">Current-year source versions</a>
              </>
            )}
          </details>
        </>
      )}
    </section>
  );
}
