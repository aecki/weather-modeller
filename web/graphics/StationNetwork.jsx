import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { ModelLab } from './ModelLab';
import { ObservationChart } from './TimeSeries';
import { WaterChart } from './WaterOverview';
import { loadStation, largestWindows } from './station-data.mjs';

export function StationNetwork() {
  const [directory, setDirectory] = useState(null),
    [id, setId] = useState('smn:BER'),
    [query, setQuery] = useState(''),
    [series, setSeries] = useState(null),
    [error, setError] = useState(''),
    [days, setDays] = useState(1),
    [day, setDay] = useState(''),
    [annualId, setAnnualId] = useState('');
  useEffect(() => {
    const c = new AbortController();
    fetch(new URL('data/station-network.json', document.baseURI), { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error('The station directory is unavailable.');
        return r.json();
      })
      .then(setDirectory)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const station = directory?.stations.find((s) => s.id === id);
  useEffect(() => {
    if (!station) return;
    const c = new AbortController();
    setSeries(null);
    setError('');
    loadStation(station, c.signal)
      .then((r) => {
        if (!c.signal.aborted) {
          setSeries({ ...r, id });
          setDay('');
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [station]);
  const active = series?.id === id ? series : null;
  const extremes = useMemo(
    () => (active ? largestWindows(active.dates, active.values, days) : []),
    [active, days],
  );
  const chosen = day || extremes[0]?.date;
  const rolled = useMemo(
    () => (active ? window.DataCore.rolling(active.values, days) : []),
    [active, days],
  );
  const annual = useMemo(
    () => (active ? window.DataCore.annualMaxima(active.dates, active.values, rolled, days) : []),
    [active, rolled, days],
  );
  const at = active?.dates.indexOf(chosen) ?? -1;
  const selectedPeak =
    at >= 0 && Number.isFinite(rolled[at]) ? { index: at, value: rolled[at] } : null;
  const options =
    directory?.stations.filter((s) =>
      `${s.name} ${s.code} ${s.canton} ${s.type}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const nearby = active && at >= 0 ? active.dates.slice(Math.max(0, at - 10), at + 11) : [];
  return (
    <section className="station-network" aria-label="Precipitation network analysis">
      <p className="eyebrow">MEASURED PRECIPITATION</p>
      <h1>All precipitation stations</h1>
      <p>
        Choose any of the {directory?.stations.length ?? 'available'} stations with daily
        precipitation in the MeteoSwiss automatic and manual networks. Measurements are local to the
        gauge; the address estimates use a separate regional grid.
      </p>
      <div className="network-controls">
        <label>
          Find a station
          <input
            aria-label="Find precipitation station"
            placeholder="Station name, code or canton"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Station
          <select
            aria-label="All precipitation stations"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {station && !options.includes(station) && (
              <option value={station.id}>
                {station.name} · {station.code}
              </option>
            )}
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.code} · {s.network.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rainfall window
          <select
            aria-label="Station historical extreme window"
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setDay('');
            }}
          >
            {[1, 3, 5].map((d) => (
              <option key={d} value={d}>
                {d}-day total
              </option>
            ))}
          </select>
        </label>
      </div>
      {station && (
        <p>
          {station.type} · {station.canton} · {station.elevation} m above sea level. Record coverage
          varies by station; only complete years enter the models.
        </p>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : !active ? (
        <p role="status">Loading official daily station observations…</p>
      ) : (
        <>
          <h2>Historical extremes</h2>
          <p>
            The five largest non-overlapping {days}-day totals in the available station record,{' '}
            {active.dates[0]}–{active.dates.at(-1)}. Windows stay within calendar years.
          </p>
          <div className="extreme-buttons">
            {extremes.map((r, i) => (
              <button key={r.date} aria-pressed={chosen === r.date} onClick={() => setDay(r.date)}>
                <small>{i + 1}</small>
                <span>{r.date}</span>
                <strong>{r.value.toFixed(1)} mm</strong>
              </button>
            ))}
          </div>
          <label>
            Calendar day
            <input
              type="date"
              aria-label="Station calendar day"
              value={chosen || ''}
              min={active.dates[0]}
              max={active.dates.at(-1)}
              onChange={(e) => {
                if (e.target.validity.valid && e.target.value) setDay(e.target.value);
              }}
            />
          </label>
          <p>
            {chosen}:{' '}
            {selectedPeak
              ? `${selectedPeak.value.toFixed(1)} mm over ${days} day(s).`
              : 'No complete rainfall window at this date.'}
          </p>
          {nearby.length > 0 && (
            <ParentSize style={{ height: 260 }}>
              {({ width }) => (
                <ObservationChart
                  width={Math.max(width, 280)}
                  dates={nearby}
                  values={nearby.map((d) => active.values[active.dates.indexOf(d)])}
                  cursor={nearby.indexOf(chosen)}
                  kind="rain"
                  label={`Daily precipitation at ${station.name}`}
                  onSelect={(i) => setDay(nearby[i])}
                />
              )}
            </ParentSize>
          )}
          <ModelLab
            key={id}
            namespace="network"
            dates={active.dates}
            annual={annual}
            station={{ ...station, values: active.values }}
            stations={directory.stations}
            days={days}
            event={{ id: chosen || 'none', start: chosen || active.dates[0] }}
            eventPeak={selectedPeak}
            historyStart={active.dates[0]}
            historyEnd={active.dates.at(-1)}
            onStation={setId}
            onDuration={setDays}
          />
          <details>
            <summary>Station sources and quality</summary>
            <p>
              Source: MeteoSwiss, daily precipitation rre150d0, mm; labelled rainfall days
              06:00–06:00 UTC. Historical values take precedence over overlapping recent files.
              Recent measurements can be revised. Missing values remain missing. Gauge series are
              not homogenised climate-trend records. Monthly/annual-only totalisers cannot provide
              daily extremes and are not included in this daily selector.
            </p>
            {active.sources.map((s) => (
              <p key={s.url}>
                <a href={s.url}>{s.tier} source CSV</a> · SHA-256 {s.sha256} · loaded {s.loadedAt}
              </p>
            ))}
            <a href="data/station-network.json">Directory coverage and source versions</a>
          </details>
        </>
      )}
      {directory?.annualStations?.length > 0 && (
        <details className="annual-stations">
          <summary>Annual precipitation stations ({directory.annualStations.length})</summary>
          <p>
            These mountain totalisers measure an entire hydrological year, 1 October to 30
            September. They cannot supply daily extremes and are kept separate from the daily
            models.
          </p>
          <label>
            Annual station
            <select
              aria-label="Annual precipitation station"
              value={annualId}
              onChange={(e) => setAnnualId(e.target.value)}
            >
              <option value="">Choose a totaliser</option>
              {directory.annualStations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.code}
                </option>
              ))}
            </select>
          </label>
          {annualId && (
            <p>
              <a href={directory.annualStations.find((s) => s.id === annualId)?.url}>
                Open official annual precipitation observations (CSV)
              </a>
            </p>
          )}
        </details>
      )}
      <HydroNetwork />
    </section>
  );
}
export function HydroNetwork() {
  const [directory, setDirectory] = useState(null),
    [id, setId] = useState('2209'),
    [parameter, setParameter] = useState('W'),
    [rows, setRows] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [request, setRequest] = useState(null);
  const pending = useRef(null);
  const today = new Date().toISOString().slice(0, 10),
    [end, setEnd] = useState(today),
    [start, setStart] = useState(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  useEffect(() => {
    const c = new AbortController();
    fetch(new URL('data/water/stations.json', document.baseURI), { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error('The lake and river directory is unavailable.');
        return r.json();
      })
      .then(setDirectory)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const station = directory?.stations.find((s) => s.no === id),
    shown =
      directory?.stations.filter((s) =>
        `${s.no} ${s.name} ${s.riverName}`.toLowerCase().includes(query.toLowerCase()),
      ) || [];
  useEffect(() => {
    pending.current?.abort();
    setBusy(false);
    setRows(null);
    setRequest(null);
  }, [id, parameter, start, end]);
  async function load(e) {
    e.preventDefault();
    setRows(null);
    setError('');
    setBusy(true);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const span = (Date.parse(end) - Date.parse(start)) / 86400000;
      if (!Number.isFinite(span) || span < 0 || span > 366)
        throw Error('Choose a period of at most 367 calendar days.');
      const until = new Date(Date.parse(end + 'T00:00:00Z') + 86400000).toISOString();
      const q = `{ water { observations { data_1day_mean(where:{station:{no:{_eq:${JSON.stringify(id)}}},parameterName:{_eq:${JSON.stringify(parameter)}},timestamp:{_gte:${JSON.stringify(start + 'T00:00:00Z')},_lt:${JSON.stringify(until)}}}) {timestamp value unitSymbol releaseState} } } }`;
      const response = await fetch('https://data.bafu.admin.ch/api', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!response.ok) throw Error('FOEN observations could not be retrieved.');
      const payload = await response.json();
      if (payload.errors)
        throw Error('This gauge or parameter is not available for the selected period.');
      const result = payload.data.water.observations.data_1day_mean.sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      if (
        new Set(result.map((r) => r.timestamp)).size !== result.length ||
        result.some((r) => r.value !== null && !Number.isFinite(r.value))
      )
        throw Error('Invalid or duplicate gauge observations.');
      if (new Set(result.map((r) => r.unitSymbol)).size > 1)
        throw Error('Units changed within this period; no combined series is shown.');
      if (controller.signal.aborted) return;
      setRows(result);
      setRequest(q);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  // Gauge charts label the provider interval-start date in UTC, unlike lake recovery's local daily labels.
  const points = rows?.map((r) => [r.timestamp.slice(0, 10), r.value, null]) || [];
  return (
    <section className="hydro-network" aria-label="All lake and river gauges">
      <h2>Lake and river gauges</h2>
      <p>
        All {directory?.stations.length ?? 'available'} gauges in the FOEN directory, including
        retired sites. A listed gauge may not publish both water level and discharge.
      </p>
      <form onSubmit={load} className="network-controls">
        <label>
          Find a gauge
          <input
            aria-label="Find lake or river gauge"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Lake, river, place or number"
          />
        </label>
        <label>
          Gauge
          <select
            aria-label="All lake and river gauges"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {station && !shown.includes(station) && (
              <option value={id}>
                {station.riverName} · {station.name}
              </option>
            )}
            {shown.map((s) => (
              <option key={s.no} value={s.no}>
                {s.riverName} · {s.name} ({s.no}){s.status === 'Aufgehoben' ? ' · retired' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Measurement
          <select
            aria-label="Gauge measurement"
            value={parameter}
            onChange={(e) => setParameter(e.target.value)}
          >
            <option value="W">Water level</option>
            <option value="Q">Discharge</option>
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            aria-label="Gauge start date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </label>
        <label>
          Through
          <input
            type="date"
            aria-label="Gauge end date"
            value={end}
            min={start}
            max={today}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </label>
        <button disabled={busy}>{busy ? 'Loading…' : 'Load daily measurements'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {rows && (
        <>
          {rows.length ? (
            <>
              <p>
                {rows.length} daily values · unit as supplied: {rows[0].unitSymbol}.
              </p>
              <ParentSize style={{ height: 260 }}>
                {({ width }) => (
                  <WaterChart
                    width={width}
                    rows={points}
                    unit={rows[0].unitSymbol}
                    label={`${parameter === 'W' ? 'Water level' : 'Discharge'} at ${station.name}`}
                  />
                )}
              </ParentSize>
            </>
          ) : (
            <p>No published observations for this gauge, measurement and period.</p>
          )}
          <details>
            <summary>Gauge observations and source query</summary>
            <p>
              Source: FOEN. Values are provider daily means; dates below are the original
              interval-start timestamps. Water levels can use station-specific datums; do not
              compare absolute gauge heights as if they shared one datum. No catchment relationship
              with the precipitation station is assumed.
            </p>
            <pre>{request}</pre>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Interval start</th>
                    <th>Daily mean</th>
                    <th>Unit</th>
                    <th>Release flag</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.timestamp}>
                      <td>{r.timestamp}</td>
                      <td>{r.value ?? 'Missing'}</td>
                      <td>{r.unitSymbol}</td>
                      <td>{r.releaseState ?? 'Not supplied'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
