import { archiveIndex, resolveRainDay, loadRainField } from './archive-data.mjs';
import { RainAmountGraphic } from './RainVisuals';
import { YearOverview } from './YearOverview';
import { ClimateOverview, HistoricalExtremes, useCellSummary } from './ClimateOverview';
import { LakeOverview } from './WaterOverview';
import { RegionalAddress } from './RegionalAddress';
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
function shiftDay(day, offset) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
function validDate(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}
function assetURL(path) {
  if (!/^(grids\/[a-f0-9]{64}\.f32|boundary-[a-f0-9]{64}\.json)$/.test(path))
    throw new Error('Invalid daily data asset');
  return new URL(`data/regional/${path}`, document.baseURI);
}

export function DailyRegional({ mode = 'overview' }) {
  const [manifest, setManifest] = useState(null),
    [releaseError, setReleaseError] = useState('');
  const [archive, setArchive] = useState(null),
    [resolved, setResolved] = useState(null),
    [dayError, setDayError] = useState('');
  const [reload, setReload] = useState(0),
    [analysisDate, setDate] = useState('');
  const expected = expectedRainDay();
  const date = analysisDate || expected;
  const calendarInput = useRef(null);
  useEffect(() => {
    if (calendarInput.current && calendarInput.current.value !== date)
      calendarInput.current.value = date;
  }, [date]);
  const commitCalendar = (event) => {
    const input = event.currentTarget;
    if (input.validity.valid && input.value) setDate(input.value);
  };
  const [query, setQuery] = useState(''),
    [options, setOptions] = useState([]),
    [selected, setSelected] = useState(null);
  const [highlight, setHighlight] = useState(-1);
  const [days, setDays] = useState(1);
  const suggestionTimer = useRef(null);
  const [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState('');
  const [result, setResult] = useState(null);
  const searchRequest = useRef(null),
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
          'Daily regional data is temporarily unavailable. Switch to Pro Mode for station analysis.',
        );
      const data = await response.json();
      if (data.schemaVersion !== 1 || !data.days?.length)
        throw new Error(
          'Daily regional data is temporarily unavailable. Switch to Pro Mode for station analysis.',
        );
      if (
        data.grid?.crs !== 'EPSG:2056' ||
        data.grid.encoding !== 'float32-le' ||
        data.grid.width !== 370 ||
        data.grid.height !== 265
      )
        throw new Error('Unsupported daily data release.');
      if (controller.signal.aborted) return;
      const historical = await archiveIndex();
      if (controller.signal.aborted) return;
      setArchive(historical);
      setManifest(data);
      setDate((current) => current || expectedRainDay());
    })().catch((error) => {
      if (!controller.signal.aborted) setReleaseError(error.message);
    });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => () => searchRequest.current?.abort(), []);
  useEffect(() => {
    if (!manifest || !validDate(date)) return;
    const controller = new AbortController();
    setResolved(null);
    setDayError('');
    resolveRainDay(manifest, date, controller.signal)
      .then((record) => {
        if (!controller.signal.aborted) setResolved({ date, record });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setDayError(e.message);
      });
    return () => controller.abort();
  }, [manifest, date]);
  const record = resolved?.date === date ? resolved.record : null;
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
      const buffer = await loadRainField(record, controller.signal);
      const cell = cellAt(manifest.grid, selected);
      const value = amountAt(buffer, manifest.grid, cell);
      return {
        key: resultKey,
        value,
        buffer,
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
  const goToSection = (event, id) => {
    event.preventDefault();
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'instant' });
    else document.getElementById('daily-address')?.focus();
  };
  const source = record?.source;
  const summary = useCellSummary(active?.cell?.index);
  return (
    <section
      className={`daily-regional ${selected ? 'has-address' : ''}`}
      aria-labelledby="daily-title"
    >
      <p className="eyebrow">Swiss Precipitation Analysis</p>
      <h1 id="daily-title">
        {mode === 'overview' ? 'How much did it really rain?' : 'Daily rainfall by address'}
      </h1>
      <p className="daily-intro">
        Choose a Swiss address and a date to see the estimated rainfall and compare it with records
        since 1961. Estimates describe the surrounding area, not measurements at the building.
      </p>
      {mode === 'overview' && (
        <nav className="overview-topics" aria-label="Overview sections">
          <a href="#daily-title" onClick={(e) => goToSection(e, 'daily-title')}>
            Daily rainfall
          </a>
          <a href="#monthly-rainfall" onClick={(e) => goToSection(e, 'monthly-rainfall')}>
            Monthly totals
          </a>
          <a href="#lake-levels" onClick={(e) => goToSection(e, 'lake-levels')}>
            Lake levels &amp; recovery
          </a>
        </nav>
      )}
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
          <div className="calendar-field">
            <label htmlFor="daily-date">Calendar day</label>
            <input
              id="daily-date"
              type="date"
              ref={calendarInput}
              defaultValue={date}
              min={archive?.from || '1961-01-01'}
              max={expected}
              onInput={commitCalendar}
              onChange={commitCalendar}
              onBlur={commitCalendar}
            />
          </div>
          <button type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search addresses'}
          </button>
        </div>
        <small>
          Select a matching address from the swisstopo suggestions. Searches are not saved.
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
            <button
              onClick={() => setDate(shiftDay(date, -1))}
              disabled={date <= (archive?.from || '1961-01-01')}
            >
              ← Previous day
            </button>
            <span>{dateText(date)}</span>
            <button onClick={() => setDate(shiftDay(date, 1))} disabled={date >= expected}>
              Next day →
            </button>
            <button onClick={() => setDate(expected)} disabled={date === expected}>
              Yesterday
            </button>
            {manifest.latestAvailable < expected && (
              <button
                onClick={() => setDate(manifest.latestAvailable)}
                disabled={date === manifest.latestAvailable}
              >
                Latest available day
              </button>
            )}
          </div>
          <p className="daily-freshness">
            Latest available rainfall day: <strong>{dateText(manifest.latestAvailable)}</strong>.{' '}
            {manifest.latestAvailable < expected && (
              <>Data for {dateText(expected)} has not been published in this release yet. </>
            )}
            Last successful refresh: {timeText(manifest.generatedAt)}.
          </p>
          {selected && <h3>{selected.label}</h3>}
          {dayError ? (
            <p role="status">{dayError}</p>
          ) : !resolved ? (
            <p role="status">Finding this rainfall day…</p>
          ) : !record ? (
            <p role="status">
              Rainfall data for {dateText(date)} is not available in this release. Choose another
              calendar day or use the latest available data.
            </p>
          ) : !selected ? (
            <div className="overview-welcome">
              <span className="welcome-mark" aria-hidden="true">
                ↗
              </span>
              <h3>Choose an address to see the rainfall</h3>
              <p>
                The result shows the estimated daily amount, how often similar rainfall occurred in
                the same month, and the uncertainty in that comparison. Pro Mode provides
                return-period models and a separate station explorer.
              </p>
              <div className="welcome-points">
                <span>65 years of history</span>
                <span>Every Swiss address</span>
                <span>Source: MeteoSwiss</span>
              </div>
            </div>
          ) : !active ? (
            <p role="status">Loading regional estimate…</p>
          ) : active.error || active.unavailable ? (
            <p role="status">{active.error || active.unavailable}</p>
          ) : (
            <div className="daily-result" aria-live="polite">
              <span className={`regional-status ${record.status}`}>
                {statusLabels[record.status]}
              </span>
              <div className="rain-hero">
                <div className="rain-hero-number">
                  <span className="result-kicker">ESTIMATED RAINFALL · {dateText(date)}</span>
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
                </div>
                <RainAmountGraphic amount={active.value} />
              </div>
              {active.coverage.kind === 'border' && (
                <p>
                  This coordinate is close to the Swiss boundary. The original coordinate is used
                  without moving it into another grid cell.
                </p>
              )}
              <HistoricalExtremes
                summary={summary}
                days={days}
                onDuration={setDays}
                onDate={setDate}
                date={date}
              />
              <HistoricalOverview
                cell={active.cell}
                amount={active.value}
                date={date}
                status={record.status}
              />
              <YearOverview summary={summary} date={date} release={manifest} />
              <ClimateOverview summary={summary} date={date} />
              {mode === 'pro' && (
                <RegionalAddress
                  cell={active.cell}
                  selected={selected}
                  date={date}
                  fieldBuffer={active.buffer}
                  release={manifest}
                  mode={mode}
                  days={days}
                  onDuration={setDays}
                />
              )}
            </div>
          )}
          <p className="regional-limit">
            The rainfall day runs from 06:00 UTC on {dateText(date)} to 06:00 UTC the following day.
            A 1 km grid does not provide building-level accuracy: interpret recent estimates over
            roughly a 20–30 km neighbourhood. These gridded estimates do not measure rainfall at
            individual buildings.
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
                <dd>
                  {source.verifiedAt
                    ? timeText(source.verifiedAt)
                    : 'Verified against the pinned historical source'}
                </dd>
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
      <p className="daily-station-link overview-only">
        <a href="#pro">Explore regional return periods and uncertainty in Pro Mode →</a>
      </p>
      {mode === 'overview' && <LakeOverview selected={selected} />}
    </section>
  );
}
