import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { compareHistory, referenceForCell, findCell } from '../web/graphics/regional-history.mjs';
const base = 'tests/fixtures/regional-history/';
const fixture = JSON.parse(readFileSync(base + 'reference.json', 'utf8'));
const compressed = readFileSync(base + 'november-bern.u8.gz');
assert.equal(createHash('sha256').update(compressed).digest('hex'), fixture.chunkSha256);
const raw = Uint8Array.from(gunzipSync(compressed));
const rows = referenceForCell(raw, fixture, fixture.localCell, 11);
for (const c of fixture.cases) {
  const result = compareHistory(rows, fixture.thresholds, c.amount, '2026-11-01', {
    resamples: fixture.resamples,
  });
  assert.equal(result.lowerCount, c.lowerCount);
  assert.equal(result.upperCount, c.upperCount);
  assert.ok(result.lowerCount <= c.exactCount && c.exactCount <= result.upperCount);
  assert.equal(result.total, 1950);
  assert.equal(result.yearCount, 65);
  if (c.interval) {
    assert.ok(Math.abs(result.interval[0] - c.interval[0]) < 1e-12);
    assert.ok(Math.abs(result.interval[1] - c.interval[1]) < 1e-12);
  } else assert.equal(result.interval, null);
  assert.ok(Math.abs(result.bands.reduce((n, b) => n + b.share, 0) - 1) < 1e-12);
}
const full = compareHistory(rows, fixture.thresholds, 10.3, '2026-11-01', {
  seed: fixture.referenceId,
});
assert.deepEqual(
  full,
  compareHistory(rows, fixture.thresholds, 10.3, '2026-11-01', { seed: fixture.referenceId }),
);
const leaveOut = compareHistory(rows, fixture.thresholds, 10.3, '2025-11-01');
assert.equal(leaveOut.yearCount, 64);
assert.equal(leaveOut.total, 1920);
assert.equal(leaveOut.excludedSelectedYear, true);
assert.ok(compareHistory(rows.slice(0, 19), fixture.thresholds, 1, '2026-11-01').unavailable);
assert.equal(findCell([1, 5, 9], 5), 1);
assert.equal(findCell([1, 5, 9], 8), -1);
const corrupt = raw.slice();
corrupt[fixture.localCell * 65 * fixture.thresholds.length] = 255;
assert.throws(
  () => referenceForCell(corrupt, fixture, fixture.localCell, 11),
  /Invalid historical counts/,
);
console.log(
  'Regional history verified against 65 independent real annual window reads and NumPy year-bootstrap intervals; exact frequency brackets, sparse tails, year exclusion and reproducibility passed.',
);
