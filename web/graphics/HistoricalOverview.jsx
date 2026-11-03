import React, { useEffect, useMemo, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleLinear, scaleBand } from '@visx/scale';
import { Bar } from '@visx/shape';
import { verifiedBuffer } from './regional-data.mjs';
import { findCell, referenceForCell, compareHistory } from './regional-history.mjs';
const manifestCache = {};
const chunkCache = new Map();
const monthName = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const pct = (n) => (n * 100).toFixed(1);
const frequency = (n) => (n * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 });
function HistoryChart({ width, bands }) {
  const left = 106,
    right = 38,
    top = 8,
    bottom = 48,
    height = 240,
    inner = Math.max(20, width - left - right);
  const x = scaleLinear({ domain: [0, 100], range: [0, inner] });
  const y = scaleBand({
    domain: bands.map((b) => b.label),
    range: [0, height - top - bottom],
    padding: 0.35,
  });
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Historical rainfall categories and 95 percent year-resampling ranges"
      data-renderer="visx"
    >
      <g transform={`translate(${left},${top})`}>
        <AxisLeft
          scale={y}
          hideAxisLine
          hideTicks
          tickLabelProps={() => ({
            fontSize: 10,
            fill: '#475569',
            textAnchor: 'end',
            dy: 3,
            dx: -5,
          })}
        />
        <AxisBottom
          top={height - top - bottom}
          scale={x}
          numTicks={4}
          tickFormat={(n) => `${n}%`}
          tickLabelProps={() => ({ fontSize: 10, fill: '#64748b', textAnchor: 'middle' })}
        />
        {bands.map((b) => {
          const cy = y(b.label) + y.bandwidth() / 2;
          return (
            <g key={b.label}>
              <Bar
                x={0}
                y={y(b.label)}
                width={x(b.share * 100)}
                height={y.bandwidth()}
                fill={b.selected ? '#32776f' : '#cbd5e1'}
              />
              {b.interval && (
                <>
                  <line
                    x1={x(b.interval[0] * 100)}
                    x2={x(b.interval[1] * 100)}
                    y1={cy}
                    y2={cy}
                    stroke="#334155"
                  />
                  <line
                    x1={x(b.interval[0] * 100)}
                    x2={x(b.interval[0] * 100)}
                    y1={cy - 4}
                    y2={cy + 4}
                    stroke="#334155"
                  />
                  <line
                    x1={x(b.interval[1] * 100)}
                    x2={x(b.interval[1] * 100)}
                    y1={cy - 4}
                    y2={cy + 4}
                    stroke="#334155"
                  />
                </>
              )}
              <title>
                {b.label}: {pct(b.share)}%
                {b.interval
                  ? `, 95% resampling range ${pct(b.interval[0])}–${pct(b.interval[1])}%`
                  : '; too few examples for a stable resampling range'}
              </title>
            </g>
          );
        })}
        <text x={inner / 2} y={height - top - 5} textAnchor="middle" fontSize={10} fill="#64748b">
          Historical days (%)
        </text>
      </g>
    </svg>
  );
}
export function HistoricalOverview({ cell, amount, date, status }) {
  const [history, setHistory] = useState(null),
    [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const month = Number(date.slice(5, 7));
  const historyKey = `${cell.index}:${month}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setError('');
    (async () => {
      const base = new URL('data/regional-history/', document.baseURI);
      let manifest = manifestCache.data;
      if (!manifest) {
        const response = await fetch(new URL('manifest.json', base), {
          signal: controller.signal,
          cache: 'no-cache',
        });
        if (!response.ok) throw new Error('The historical reference is temporarily unavailable.');
        manifest = await response.json();
        if (
          manifest.schemaVersion !== 1 ||
          manifest.encoding !== 'uint8 counts at-or-above thresholds; cell/year/threshold'
        )
          throw new Error('Unsupported historical reference.');
        manifestCache.data = manifest;
      }
      let cells = manifestCache.cells;
      if (!cells || manifestCache.referenceId !== manifest.referenceId) {
        const buffer = await verifiedBuffer(
          await fetch(new URL('cells.u32', base), { signal: controller.signal }),
          manifest.cellsSha256,
          'Historical data',
        );
        const view = new DataView(buffer);
        cells = Array.from({ length: buffer.byteLength / 4 }, (_, i) =>
          view.getUint32(i * 4, true),
        );
        manifestCache.cells = cells;
        manifestCache.referenceId = manifest.referenceId;
      }
      const position = findCell(cells, cell.index);
      if (position < 0)
        throw new Error('This location is not covered by the historical reference.');
      const chunk = Math.floor(position / manifest.chunkSize),
        hash = manifest.chunks[String(month)][chunk];
      let raw = chunkCache.get(hash);
      if (!raw) {
        const buffer = await verifiedBuffer(
          await fetch(
            new URL(`months/${String(month).padStart(2, '0')}-${chunk}-${hash}.u8.gz`, base),
            { signal: controller.signal },
          ),
          hash,
          'Historical data',
        );
        const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
        raw = new Uint8Array(await new Response(stream).arrayBuffer());
        const count = Math.min(manifest.chunkSize, manifest.cellCount - chunk * manifest.chunkSize);
        if (raw.length !== count * manifest.years.length * manifest.thresholds.length)
          throw new Error('Incomplete historical reference chunk.');
        chunkCache.set(hash, raw);
        if (chunkCache.size > 8) chunkCache.delete(chunkCache.keys().next().value);
      }
      return {
        key: historyKey,
        manifest,
        rows: referenceForCell(raw, manifest, position % manifest.chunkSize, month),
      };
    })()
      .then((value) => {
        if (!controller.signal.aborted) setHistory(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [cell.index, month, reload]);
  const result = useMemo(
    () =>
      history?.key === historyKey
        ? compareHistory(history.rows, history.manifest.thresholds, amount, date, {
            seed: `${history.manifest.referenceId}:${cell.index}:${month}`,
          })
        : null,
    [history, historyKey, amount, date, cell.index, month],
  );
  const name = monthName(date);
  return (
    <section className="historical-overview" aria-label="Regional historical comparison">
      <h3>How unusual was this for {name}?</h3>
      {error ? (
        <>
          <p role="status">{error}</p>
          <button
            onClick={() => {
              delete manifestCache.data;
              setReload(reload + 1);
            }}
          >
            Retry historical comparison
          </button>
        </>
      ) : !result ? (
        <p role="status">Comparing with real historical {name} days…</p>
      ) : result.unavailable ? (
        <p role="status">{result.unavailable}</p>
      ) : (
        <>
          <p className="historical-headline">
            {result.dry
              ? `Days with little or no precipitation were ${result.estimate >= 0.2 ? 'common' : 'less common'} in ${name}.`
              : result.upperCount === 0
                ? 'No equally wet examples in this historical comparison.'
                : !result.interval
                  ? 'Very few historical examples at this amount.'
                  : result.interval[1] < 0.05
                    ? `Unusual for ${name}.`
                    : result.share[1] < 0.2
                      ? `Wetter than most ${name} days.`
                      : `Within the usual range of ${name} rainfall.`}
          </p>
          {result.interval ? (
            <>
              <p>
                {result.dry ? (
                  <>
                    Days with less than 1 mm made up about{' '}
                    <strong>{frequency(result.estimate)} out of 100</strong> historical {name} days.
                  </>
                ) : (
                  <>
                    At least this much precipitation occurred on about{' '}
                    <strong>{frequency(result.estimate)} out of 100</strong> historical {name} days.
                  </>
                )}
              </p>
              <p className="historical-range">
                <strong>
                  Uncertainty range (95%): {frequency(result.interval[0])}–
                  {frequency(result.interval[1])} out of 100 days.
                </strong>
              </p>
            </>
          ) : (
            <>
              <p>
                {result.lowerCount === result.upperCount
                  ? result.lowerCount
                  : `Between ${result.lowerCount} and ${result.upperCount}`}{' '}
                of {result.total.toLocaleString('en-GB')} reference days{' '}
                {result.dry ? 'had less than 1 mm' : 'were at least this wet'}. There are too few
                examples across years for a stable frequency range.
              </p>
              <p>Few or no observed examples do not mean the true chance is zero.</p>
            </>
          )}
          <p>
            Compared with {result.total.toLocaleString('en-GB')} days from {result.yearCount}{' '}
            complete historical {name} records, {history.manifest.years[0]}–
            {history.manifest.years.at(-1)}.
            {result.excludedSelectedYear && ' The selected year is excluded.'} This is a comparison
            with the past, not a forecast.
          </p>
          <ParentSize debounceTime={20}>
            {({ width }) =>
              width > 0 ? <HistoryChart width={width} bands={result.bands} /> : null
            }
          </ParentSize>
          <p className="history-caption">
            Lines show supported 95% year-resampling ranges. Categories with too few examples have
            no line.
          </p>
          <p className="history-limits">
            The range reflects limited historical years and the resolution of the comparison
            thresholds. It does not include errors in regional rainfall estimates or future climate
            change.
            {status === 'preliminary'
              ? ' This rainfall estimate is preliminary, so its historical comparison may change.'
              : ''}
          </p>
          <details>
            <summary>Historical comparison method and source versions</summary>
            <p>
              All days in the same calendar month are included, including dry days. Incomplete
              month/year records are omitted. We resample whole years 1,000 times, preserving wet
              spells within each month. At least five years must contain matching days and five must
              contain non-matching days before a range is shown.
            </p>
            <p>
              {result.dry
                ? 'Little or no precipitation means less than 1 mm for this comparison.'
                : `Counts use observed thresholds ${result.lowerThreshold.toFixed(2)}${result.upperThreshold === null ? ' mm and above' : `–${result.upperThreshold.toFixed(2)} mm`}; the frequency in the reference record lies between ${pct(result.share[0])}% and ${pct(result.share[1])}%. The headline uses their midpoint. Both bounds are propagated through the resampling range.`}{' '}
              No synthetic rainfall, tail distribution or building-specific return period is used.
            </p>
            <p>
              Reference: {history.manifest.referenceId}. Source: MeteoSwiss RhiresD annual archives.
              Product versions:{' '}
              {[...new Set(history.manifest.sources.map((s) => s.version))].join(', ')}.{' '}
              <a href="data/regional-history/manifest.json" target="_blank" rel="noreferrer">
                All 65 source files and checksums
              </a>
              .
            </p>
          </details>
        </>
      )}
    </section>
  );
}
