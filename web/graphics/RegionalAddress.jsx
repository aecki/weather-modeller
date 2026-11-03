import React, { useEffect, useMemo, useState } from 'react';
import { loadRegionalRecord, areaMean, annualMaxima } from './regional-models.mjs';
import { resolveRainDay, loadRainField } from './archive-data.mjs';
import { WetDaysGraphic, RecordGraphic } from './RainVisuals';
import { ModelLab } from './ModelLab';
const fmt = (n) => n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
export function RegionalAddress({ cell, selected, date, fieldBuffer, release, mode }) {
  const [everPro, setEverPro] = useState(mode === 'pro');
  useEffect(() => {
    if (mode === 'pro') setEverPro(true);
  }, [mode]);
  const [loaded, setLoaded] = useState(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [days, setDays] = useState(1),
    [target, setTarget] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError('');
    loadRegionalRecord(cell.index)
      .then((r) => {
        if (!cancelled) setLoaded({ index: cell.index, ...r });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [cell.index, retry]);
  const record = loaded?.index === cell.index ? loaded : null;
  const years = useMemo(() => record?.entry.years.filter(Boolean) || [], [record]);
  const annual = useMemo(() => (record ? annualMaxima(record, days) : []), [record, days]);
  const targetKey = `${cell.index}:${date}:${days}:${release.generatedAt}`;
  useEffect(() => {
    if (!record || mode !== 'pro') return;
    const controller = new AbortController();
    (async () => {
      let amount = 0;
      const states = new Set();
      for (let i = 0; i < days; i++) {
        const day = new Date(new Date(`${date}T12:00:00Z`).getTime() - i * 86400000)
          .toISOString()
          .slice(0, 10);
        const source = await resolveRainDay(release, day, controller.signal);
        if (!source)
          return {
            unavailable:
              'The selected accumulation includes an unpublished day. Choose a threshold below to explore the historical model.',
          };
        const buffer = i === 0 ? fieldBuffer : await loadRainField(source, controller.signal);
        const mean = areaMean(buffer, release.grid, record.entry, record.cells);
        if (mean === null)
          return {
            unavailable:
              'Some cells in this fixed region have missing data on the selected day. No regional amount is substituted.',
          };
        amount += mean;
        states.add(source.status);
      }
      return { amount, preliminary: states.has('preliminary') };
    })()
      .then((value) => {
        if (!controller.signal.aborted) setTarget({ key: targetKey, ...value });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setTarget({ key: targetKey, unavailable: e.message });
      });
    return () => controller.abort();
  }, [record, targetKey, fieldBuffer, mode]);
  if (error)
    return (
      <p role="status">
        {error} <button onClick={() => setRetry(retry + 1)}>Retry regional history</button>
      </p>
    );
  if (!record) return <p role="status">Reading the real rainfall history around this address…</p>;
  const total = years.reduce((a, r) => a + r[0], 0) / years.length;
  const wet = years.reduce((a, r) => a + r[1], 0) / years.length;
  const wettest = annualMaxima(record, 1).sort((a, b) => b.value - a.value)[0];
  const current = target?.key === targetKey ? target : null;
  return (
    <section className="regional-address" aria-label="Selected address rainfall history">
      <div className="overview-only">
        <h3>A little rainfall perspective</h3>
        <p>
          In the surrounding region, based on {years.length} complete years from{' '}
          {record.manifest.years[0]}–{record.manifest.years.at(-1)}:
        </p>
        {years.length ? (
          <div className="rain-facts">
            <article>
              <strong>{fmt(total)} mm</strong>
              <p>fell in an average year — the same as {fmt(total)} litres on each square metre.</p>
            </article>
            <article>
              <WetDaysGraphic
                wet={wet}
                yearLength={
                  record.manifest.years.reduce(
                    (sum, y, i) =>
                      sum +
                      (record.entry.years[i]
                        ? (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000
                        : 0),
                    0,
                  ) / years.length
                }
              />
              <strong>{fmt(wet)} wet days a year</strong>
              <p>
                on average had at least 1 mm. Other days had less than 1 mm; they were not
                necessarily completely dry.
              </p>
            </article>
            <article>
              <RecordGraphic
                record={wettest.value}
                selected={areaMean(fieldBuffer, release.grid, record.entry, record.cells)}
              />
              <strong>{fmt(wettest.value)} mm in one day</strong>
              <p>
                was the wettest regional day in this record, on{' '}
                {new Date(`${wettest.date}T12:00:00Z`).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
                .
              </p>
            </article>
          </div>
        ) : (
          <p>There are no complete regional years at this location.</p>
        )}
      </div>
      <p className="footnote">
        This history describes a fixed {record.entry.areaKm2} km² nominal grid area around your
        address in Switzerland, not a rain gauge at the building. The search window is{' '}
        {record.entry.halfWidthCells * 2 + 1} km wide; near borders it expands to include enough
        Swiss grid cells. Rainfall includes snowfall water equivalent.
      </p>
      {everPro && (
        <section className="pro-only" aria-label="Regional return-period model">
          <h2>Extreme rainfall around {selected.label}</h2>
          <p>
            Explore the annual chance of heavy rainfall averaged across the same fixed{' '}
            {record.entry.areaKm2} km² region. These are experimental stationary regional models,
            not official MeteoSwiss estimates, point rainfall, flood risk or building-level return
            periods.
          </p>
          {current?.amount != null ? (
            <p>
              <strong>
                {current.amount.toLocaleString('en-GB', { maximumFractionDigits: 1 })} mm
              </strong>{' '}
              regional mean over {days} day(s) ending {date}.{' '}
              {current.preliminary
                ? 'This amount is preliminary; its estimated rarity can change.'
                : ''}
            </p>
          ) : (
            <p role="status">{current?.unavailable || 'Calculating the regional accumulation…'}</p>
          )}
          {current?.amount != null &&
            annual.length > 0 &&
            current.amount < Math.min(...annual.map((row) => row.value)) && (
              <p className="model-coverage">
                This amount is below every annual maximum in this record. An annual return period
                asks whether this amount is exceeded at least once in a year; it does not say how
                rare an individual rainy day is. The Overview comparison is more useful for ordinary
                days.
              </p>
            )}
          <p>
            The address estimate above is one gridded value. The model uses an area average instead,
            so its amount can differ. Sampling ranges exclude interpolation errors, changing
            measurement networks, model choice and climate change.
          </p>
          <ModelLab
            regional
            dates={[]}
            annual={annual}
            station={{
              id: `regional:${record.manifest.referenceId}:${cell.index}`,
              name: selected.label,
            }}
            stations={[]}
            days={days}
            onDuration={setDays}
            event={{ id: date, start: date }}
            eventPeak={current?.amount != null ? { value: current.amount } : null}
            historyStart={`${record.manifest.years[0]}-01-01`}
            historyEnd={`${record.manifest.years.at(-1)}-12-31`}
          />
        </section>
      )}
      <details>
        <summary>Regional history: sources and footprint</summary>
        <p>
          Reference: {record.manifest.referenceId}. Each year requires every day and every footprint
          cell. No missing values are filled; 1-, 3- and 5-day maxima stay inside calendar years.
          The fixed Swiss footprint is selected once from the national boundary; it does not change
          with weather or missing data.
        </p>
        <p>
          <a
            href="https://www.meteoswiss.admin.ch/dam/jcr%3A4f51f0f1-0fe3-48b5-9de0-15666327e63c/ProdDoc_RhiresD.pdf"
            target="_blank"
            rel="noreferrer"
          >
            MeteoSwiss explains regional interpretation and interpolation uncertainty
          </a>
        </p>
        <ul>
          {record.manifest.sources.map((s) => (
            <li key={s.year}>
              <a href={s.url}>
                {s.year} RhiresD {s.version}
              </a>{' '}
              · SHA-256: {s.sha256}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
