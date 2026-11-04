import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  stationRows,
  completeSeries,
  largestWindows,
  loadStation,
} from '../web/graphics/station-data.mjs';
const raw = readFileSync(new URL('fixtures/station-daily.csv', import.meta.url), 'utf8');
const parsed = stationRows(raw),
  { dates, values } = completeSeries(parsed);
assert.equal(parsed.size, 31);
assert.equal(parsed.get('2005-08-22'), 7.5);
for (const duration of [1, 3, 5]) {
  const expected = [];
  for (let i = duration - 1; i < dates.length; i++) {
    const v = values.slice(i - duration + 1, i + 1);
    if (v.every(Number.isFinite))
      expected.push({ date: dates[i], value: v.reduce((a, b) => a + b, 0), index: i });
  }
  expected.sort((a, b) => b.value - a.value || a.date.localeCompare(b.date));
  const chosen = [];
  for (const row of expected) {
    if (chosen.every((c) => Math.abs(c.index - row.index) >= duration)) chosen.push(row);
    if (chosen.length === 5) break;
  }
  assert.deepEqual(largestWindows(dates, values, duration), chosen);
}
assert.throws(() => stationRows(raw + raw.split('\n')[1] + '\n'), /Duplicate/);
assert.throws(() => stationRows('reference_timestamp;rre150d0\n31.02.2020 00:00;5\n'), /invalid/);
assert.throws(() => stationRows('reference_timestamp;rre150d0\n01.01.2020 00:00;-1\n'), /Invalid/);
const gaps = completeSeries(
  new Map([
    ['2020-01-01', 0],
    ['2020-01-03', 2],
  ]),
);
assert.deepEqual(gaps.values, [0, null, 2]);
assert.equal(largestWindows(gaps.dates, gaps.values, 3).length, 0);
assert.equal(largestWindows(['2019-12-31', '2020-01-01'], [100, 100], 2).length, 0);
console.log(
  'Station sources: real observations, missing versus zero, duplicate/invalid dates, non-overlapping extremes and calendar-year boundaries passed.',
);
// New gauges can have recent data before their first historical file is published.
const nativeFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) =>
    String(url).includes('_historical') ? new Response('', { status: 404 }) : new Response(raw);
  const loaded = await loadStation({ url: 'https://data.geo.admin.ch/example_d_historical.csv' });
  assert.equal(loaded.dates.length, 31);
  assert.equal(loaded.sources[0].tier, 'recent');
  assert.match(loaded.sources[0].sha256, /^[a-f0-9]{64}$/);
  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(
    loadStation({ url: 'https://data.geo.admin.ch/example_d_historical.csv' }),
    /No daily records/,
  );
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(
    loadStation({ url: 'https://data.geo.admin.ch/example_d_historical.csv' }),
    /source unavailable/,
  );
} finally {
  globalThis.fetch = nativeFetch;
}
