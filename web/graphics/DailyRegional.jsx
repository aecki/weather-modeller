import { HistoricalOverview } from './HistoricalOverview';
import React, { useEffect, useRef, useState } from 'react';
import {
  addressesFromResponse,
  cellAt,
  amountAt,
  expectedRainDay,
  boundaryCoverage,
  verifiedBuffer,
} from './regional-data.mjs';

const statusLabels = {
  preliminary: 'Preliminary estimate',
  'consolidated-monthly': 'Consolidated monthly analysis',
  'annual-archive': 'Annual archive analysis',
};
const number = (n) =>
  n > 0 && n < 0.1
    ? '<0.1'
    : n.toLocaleString('en-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateText = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const timeText = (text) => new Date(text).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
function assetURL(path) {
  if (!/^(grids\/[a-f0-9]{64}\.f32|boundary-[a-f0-9]{64}\.json)$/.test(path))
    throw new Error('Invalid daily data asset');
  return new URL(`data/regional/${path}`, document.baseURI);
}

export function DailyRegional() {
  const [manifest, setManifest] = useState(null),
    [releaseError, setReleaseError] = useState('');
  const [reload, setReload] = useState(0),
    [date, setDate] = useState('');
  const [query, setQuery] = useState(''),
    [options, setOptions] = useState([]),
    [selected, setSelected] = useState(null);
  const [highlight, setHighlight] = useState(-1);
  const suggestionTimer = useRef(null);
  const [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState('');
  const [result, setResult] = useState(null);
  const searchRequest = useRef(null),
    grids = useRef(new Map()),
    boundary = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    setReleaseError('');
    setManifest(null);
    setResult(null);
    (async () => {
      const response = await fetch(new URL('data/regional/manifest.json', document.baseURI), {
        signal: controller.signal,
        cache: 'no-cache',
      });
      if (!response.ok)
        throw new Error(
          'Daily regional data is temporarily unavailable. Station analysis remains available below.',
        );
      const data = await response.json();
      if (data.schemaVersion !== 1 || !data.days?.length)
        throw new Error(
          'Daily regional data is temporarily unavailable. Station analysis remains available below.',
        );
      if (
        data.grid?.crs !== 'EPSG:2056' ||
        data.grid.encoding !== 'float32-le' ||
        data.grid.width !== 370 ||
        data.grid.height !== 265
      )
        throw new Error('Unsupported daily data release.');
      if (controller.signal.aborted) return;
      setManifest(data);
      setDate((current) =>
        current >= data.requestedFrom && current <= data.requestedThrough
          ? current
          : data.latestAvailable,
      );
    })().catch((error) => {
      if (!controller.signal.aborted) setReleaseError(error.message);
    });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => () => searchRequest.current?.abort(), []);
  const record = manifest?.days.find((day) => day.date === date);
  const resultKey =
    selected && record
      ? `${selected.id}:${selected.easting}:${selected.northing}:${record.sha256}:${manifest.boundary.sha256}`
      : '';
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    if (!resultKey) return () => controller.abort();
    (async () => {
      let geometry =
        boundary.current?.hash === manifest.boundary.sha256 ? boundary.current.geometry : null;
      if (!geometry) {
        const response = await fetch(assetURL(manifest.boundary.path), {
          signal: controller.signal,
        });
        const raw = await verifiedBuffer(response, manifest.boundary.sha256);
        geometry = JSON.parse(new TextDecoder().decode(raw));
        boundary.current = { hash: manifest.boundary.sha256, geometry };
      }
      const coverage = boundaryCoverage(geometry, selected);
      if (coverage.kind === 'outside')
        return {
          key: resultKey,
          unavailable:
            'This coordinate lies outside the supported Swiss region. No regional estimate is shown.',
        };
      let buffer = grids.current.get(record.sha256);
      if (!buffer) {
        buffer = await verifiedBuffer(
          await fetch(assetURL(record.path), { signal: controller.signal }),
          record.sha256,
        );
        grids.current.set(record.sha256, buffer);
        if (grids.current.size > 8) grids.current.delete(grids.current.keys().next().value);
      }
      const cell = cellAt(manifest.grid, selected);
      const value = amountAt(buffer, manifest.grid, cell);
      return {
        key: resultKey,
        value,
        cell,
        coverage,
        unavailable:
          value === null
            ? 'No precipitation estimate is available for this location. Missing data does not mean zero rainfall.'
            : null,
      };
    })()
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ key: resultKey, error: error.message });
      });
    return () => controller.abort();
  }, [resultKey]);
  const edit = (value) => {
    searchRequest.current?.abort();
    searchRequest.current = null;
    clearTimeout(suggestionTimer.current);
    setHighlight(-1);
    setQuery(value);
    setSelected(null);
    setOptions([]);
    setSearchError('');
    setSearching(false);
  };
  const search = async (event) => {
    event?.preventDefault();
    clearTimeout(suggestionTimer.current);
    searchRequest.current?.abort();
    const text = query.trim();
    if (text.length < 3 || text.split(/\s+/).length > 10) {
      setSearchError('Enter an address using 3 or more characters and at most 10 words.');
      return;
    }
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setHighlight(-1);
    setSearchError('');
    setOptions([]);
    setSelected(null);
    try {
      const url = new URL('https://api3.geo.admin.ch/rest/services/ech/SearchServer');
      url.search = new URLSearchParams({
        type: 'locations',
        origins: 'address',
        searchText: text,
        sr: '2056',
        geometryFormat: 'geojson',
        returnGeometry: 'true',
        limit: '8',
      });
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Address search is unavailable. Please try again.');
      const options = addressesFromResponse(await response.json());
      if (!controller.signal.aborted) {
        setOptions(options);
        if (!options.length)
          setSearchError('No matching address found. Try the street, house number and postcode.');
      }
    } catch (error) {
      if (!controller.signal.aborted) setSearchError(error.message);
    } finally {
      if (searchRequest.current === controller) setSearching(false);
    }
  };
  const choose = (option) => {
    clearTimeout(suggestionTimer.current);
    searchRequest.current?.abort();
    setSelected(option);
    setQuery(option.label);
    setOptions([]);
    setHighlight(-1);
    setSearching(false);
  };
  useEffect(() => {
    if (selected || query.trim().length < 3 || query.trim().split(/\s+/).length > 10) return;
    suggestionTimer.current = setTimeout(() => search(), 350);
    return () => {
      clearTimeout(suggestionTimer.current);
      searchRequest.current?.abort();
    };
  }, [query, selected]);
  const active = result?.key === resultKey ? result : null;
  const source = record && manifest.sources[record.sourceId];
  const expected = expectedRainDay();
  const dates = [];
  if (manifest)
    for (
      let d = new Date(`${manifest.requestedThrough}T12:00:00Z`);
      d.toISOString().slice(0, 10) >= manifest.requestedFrom;
      d.setUTCDate(d.getUTCDate() - 1)
    )
      dates.push(d.toISOString().slice(0, 10));
  return (
    <section className="daily-regional" aria-labelledby="daily-title">
      <p className="eyebrow">Daily regional precipitation</p>
      <h2 id="daily-title">Rainfall near your address: how does it compare?</h2>
      <p>
        Observation-based estimates for the surrounding area. These include rain and snowfall water
        equivalent; they are not measurements at individual buildings.
      </p>
      <form className="address-search" onSubmit={search}>
        <label htmlFor="daily-address">Swiss address</label>
        <div>
          <input
            id="daily-address"
            value={query}
            onChange={(event) => edit(event.target.value)}
            placeholder="Street, house number, postcode or town"
            maxLength={160}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls="address-suggestions"
            aria-activedescendant={highlight >= 0 ? `address-suggestion-${highlight}` : undefined}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && options.length) {
                event.preventDefault();
                setHighlight((i) => Math.min(options.length - 1, i + 1));
              } else if (event.key === 'ArrowUp' && options.length) {
                event.preventDefault();
                setHighlight((i) => Math.max(0, i - 1));
              } else if (event.key === 'Enter' && highlight >= 0 && options[highlight]) {
                event.preventDefault();
                choose(options[highlight]);
              } else if (event.key === 'Escape') {
                searchRequest.current?.abort();
                clearTimeout(suggestionTimer.current);
                setOptions([]);
                setHighlight(-1);
              }
            }}
          />
          <button type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search addresses'}
          </button>
        </div>
        <small>
          Suggestions are fetched from swisstopo as you type. We do not save your searches. Choose
          the matching address; nearby matches may also appear.
        </small>
      </form>
      {searchError && <p role="status">{searchError}</p>}
      {options.length > 0 && (
        <ul
          id="address-suggestions"
          className="address-results"
          role="listbox"
          aria-label="Address suggestions"
        >
          {options.map((option, i) => (
            <li
              key={option.id}
              id={`address-suggestion-${i}`}
              role="option"
              aria-selected={i === highlight}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {releaseError ? (
        <p role="status">{releaseError}</p>
      ) : !manifest ? (
        <p role="status">Loading the daily data release…</p>
      ) : (
        <>
          <div className="daily-date">
            <label htmlFor="daily-date">Rainfall day</label>
            <select id="daily-date" value={date} onChange={(event) => setDate(event.target.value)}>
              {dates.map((day) => (
                <option key={day} value={day}>
                  {dateText(day)}
                  {manifest.unavailableDates.includes(day) ? ' — unavailable' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="daily-freshness">
            Latest available rainfall day: <strong>{dateText(manifest.latestAvailable)}</strong>.{' '}
            {manifest.latestAvailable < expected && (
              <>The completed rainfall day {dateText(expected)} is not in this release yet. </>
            )}
            Last successful refresh: {timeText(manifest.generatedAt)}.
          </p>
          {selected && <h3>{selected.label}</h3>}
          {!record ? (
            <p role="status">
              No published field is available for this rainfall day. Select an available day above.
            </p>
          ) : !selected ? (
            <p>Select an address to see its regional estimate.</p>
          ) : !active ? (
            <p role="status">Loading regional estimate…</p>
          ) : active.error || active.unavailable ? (
            <p role="status">{active.error || active.unavailable}</p>
          ) : (
            <div className="daily-result" aria-live="polite">
              <span className={`regional-status ${record.status}`}>
                {statusLabels[record.status]}
              </span>
              <strong className="daily-amount">
                {number(active.value)} <span>mm</span>
              </strong>
              <p>
                {number(active.value)} litres per square metre · rainfall day {dateText(date)}
              </p>
              <p>
                {record.status === 'preliminary'
                  ? 'This preliminary regional estimate can change after more measurements and quality checks become available.'
                  : record.status === 'consolidated-monthly'
                    ? 'This monthly analysis is consolidated but can change during annual reprocessing.'
                    : 'This value comes from the annual archive analysis.'}
              </p>
              {active.coverage.kind === 'border' && (
                <p>
                  This coordinate is close to the Swiss boundary. The original coordinate is used
                  without moving it into another grid cell.
                </p>
              )}
              <HistoricalOverview
                cell={active.cell}
                amount={active.value}
                date={date}
                status={record.status}
              />
            </div>
          )}
          <p className="regional-limit">
            The rainfall day runs from 06:00 UTC on {dateText(date)} to 06:00 UTC the following day.
            A 1 km grid does not provide building-level accuracy: interpret recent estimates over
            roughly a 20–30 km neighbourhood. No address-specific return period is inferred here.
          </p>
          {source && (
            <details>
              <summary>Data source, version and observation period</summary>
              <dl className="regional-provenance">
                <dt>Provider / product</dt>
                <dd>
                  Source: MeteoSwiss · {source.product} · {source.version}
                </dd>
                <dt>Analysis status</dt>
                <dd>{statusLabels[source.status]}</dd>
                <dt>Provider file updated</dt>
                <dd>
                  {source.providerUpdatedAt ? timeText(source.providerUpdatedAt) : 'Not supplied'}
                </dd>
                <dt>Verified for this release</dt>
                <dd>{timeText(source.verifiedAt)}</dd>
                <dt>Original data</dt>
                <dd>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    MeteoSwiss NetCDF source
                  </a>
                </dd>
                <dt>Source SHA-256</dt>
                <dd className="source-hash">{source.sha256}</dd>
                {active?.cell && (
                  <>
                    <dt>Grid lookup</dt>
                    <dd>
                      Containing cell, row {active.cell.row}, column {active.cell.col}; EPSG:2056.
                      No nearest-station substitution.
                    </dd>
                  </>
                )}
              </dl>
              <p>
                <a href="data/regional/manifest.json" target="_blank" rel="noreferrer">
                  Full release provenance
                </a>{' '}
                · Boundary © swisstopo
              </p>
            </details>
          )}
        </>
      )}
      <button className="outline-button" onClick={() => setReload(reload + 1)}>
        Reload daily data
      </button>
      <p className="daily-station-link">
        <a href="#station-lab">
          Pro Mode: historical station observations and all four extreme-value models ↓
        </a>
      </p>
    </section>
  );
}
