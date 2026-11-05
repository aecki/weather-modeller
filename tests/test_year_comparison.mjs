import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareYear } from '../web/graphics/year-comparison.mjs';
const fixture = JSON.parse(
  readFileSync(new URL('fixtures/overview-history.json', import.meta.url), 'utf8'),
);
const years = Array.from({ length: 65 }, (_, i) => 1961 + i);
for (const record of fixture.records) {
  const binned = record.yearMonths.map((row) =>
    row.map((v) => (v === null ? null : Math.round(v * 10) / 10)),
  );
  const year = record.annual[5];
  const result = compareYear(years, binned, year, 12);
  assert.equal(result.reference.length, 64);
  assert.ok(!result.reference.some((r) => r.year === year));
  assert.ok(Math.abs(result.amount - record.annual[4]) <= 0.601);
  assert.equal(result.rank[1], 65);
  const current = binned[0];
  const partial = compareYear(years, binned, 2026, 10, current);
  assert.equal(partial.reference.length, 65);
  assert.ok(Math.abs(partial.amount - current.slice(0, 10).reduce((a, b) => a + b, 0)) < 1e-8);
  assert.equal(
    compareYear(years, binned, 2026, 0, current).unavailable,
    'No complete month is available for this year yet.',
  );
  assert.ok(compareYear(years, binned, 2026, 10, [null, ...current.slice(1)]).unavailable);
}
const tie = compareYear(
  years,
  years.map(() => Array(12).fill(1)),
  2026,
  12,
  Array(12).fill(1),
);
assert.deepEqual(tie.rank, [1, 66]);
console.log(
  'Annual comparisons: independent Swiss records, selected-year exclusion, matched complete months, missingness and rounding ties passed.',
);
