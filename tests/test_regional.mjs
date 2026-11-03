import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addressesFromResponse,
  cellAt,
  amountAt,
  boundaryCoverage,
  expectedRainDay,
  verifiedBuffer,
} from '../web/graphics/regional-data.mjs';
const fixture = 'tests/fixtures/regional/';
const response = JSON.parse(readFileSync(fixture + 'address-response.json', 'utf8'));
const addresses = addressesFromResponse(response);
assert.equal(addresses[0].label, 'Bundesplatz 3 3011 Bern');
assert.equal(addresses[0].easting, 2600423.25);
assert.equal(addresses[0].northing, 1199521.125);
const grid = { width: 370, height: 265, west: 2474000, north: 1324000, resolution: 1000 };
assert.deepEqual(cellAt(grid, addresses[0]), { row: 124, col: 126, index: 46006 });
const reference = JSON.parse(readFileSync(fixture + 'reference.json', 'utf8'));
const raw = readFileSync(fixture + '20260916.f32');
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
for (const point of reference.points) {
  const cell = cellAt(grid, point);
  assert.equal(cell.row, point.row);
  assert.equal(cell.col, point.col);
  assert.equal(amountAt(buffer, grid, cell), point.value);
}
assert.equal(cellAt(grid, { easting: 2844000, northing: 1200000 }), null);
assert.equal(cellAt(grid, { easting: 2600000, northing: 1059000 }), null);
assert.equal(cellAt(grid, { easting: NaN, northing: 1200000 }), null);
assert.throws(() => amountAt(new ArrayBuffer(4), grid, { index: 0 }), /Incomplete/);
assert.equal(expectedRainDay(new Date('2026-11-03T05:59:59Z')), '2026-11-01');
assert.equal(expectedRainDay(new Date('2026-11-03T06:00:00Z')), '2026-11-02');
// Isolated geometry fixtures check hole handling and the explicit border tolerance.
const boundary = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [1000, 0],
        [1000, 1000],
        [0, 1000],
        [0, 0],
      ],
      [
        [300, 300],
        [700, 300],
        [700, 700],
        [300, 700],
        [300, 300],
      ],
    ],
  ],
};
assert.equal(boundaryCoverage(boundary, { easting: 200, northing: 200 }).kind, 'inside');
assert.equal(boundaryCoverage(boundary, { easting: 500, northing: 500 }).kind, 'outside');
assert.equal(boundaryCoverage(boundary, { easting: -20, northing: 200 }).kind, 'border');
assert.equal(boundaryCoverage(boundary, { easting: -51, northing: 200 }).kind, 'outside');
console.log(
  'Regional lookup verified: real swisstopo axes, real rainfall payload, missing versus zero, boundaries and UTC rainfall days.',
);

assert.deepEqual(
  new Uint8Array(await verifiedBuffer(new Response(raw), reference.payloadSha256)),
  new Uint8Array(buffer),
);
const corrupted = Uint8Array.from(raw);
corrupted[0] ^= 255;
await assert.rejects(
  verifiedBuffer(new Response(corrupted), reference.payloadSha256),
  /integrity check failed/,
);
await assert.rejects(
  verifiedBuffer(new Response(null, { status: 503 }), reference.payloadSha256),
  /could not be loaded/,
);
assert.equal(expectedRainDay(new Date('2024-03-01T06:00:00Z')), '2024-02-29');
