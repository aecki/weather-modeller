import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annualMaxima, areaMean, validateRegionalRows } from '../web/graphics/regional-models.mjs';
import { fitModel, returnLevel } from '../web/modelling/extremes.mjs';
const reference = JSON.parse(
  readFileSync(new URL('./fixtures/regional-models/reference.json', import.meta.url)),
);
for (const entry of reference.cells) {
  validateRegionalRows(entry, reference);
  for (const duration of [1, 3, 5]) {
    const rows = annualMaxima({ entry, manifest: reference }, duration);
    assert.equal(rows.length, 65);
    rows.forEach((row, i) => assert.equal(row.date.slice(0, 4), String(reference.years[i])));
  }
}
for (const sample of reference.fits) {
  if (!sample.supportValid) {
    assert.throws(() => fitModel(sample.values, sample.model));
    continue;
  }
  const fit = fitModel(sample.values, sample.model);
  for (const key of ['location', 'scale', 'xi'])
    assert.ok(Math.abs(fit[key] - sample.fit[key]) < 1e-5);
  for (const point of sample.levels)
    assert.ok(Math.abs(returnLevel(fit, point.period) - point.rainfall) < 1e-4);
}
const field = new Float32Array([1, 2, 3, 4]);
assert.equal(
  areaMean(
    field.buffer,
    { width: 2, height: 2 },
    { cell: 0, halfWidthCells: 1, areaKm2: 4 },
    [0, 1, 2, 3],
  ),
  2.5,
);
field[1] = NaN;
assert.equal(
  areaMean(
    field.buffer,
    { width: 2, height: 2 },
    { cell: 0, halfWidthCells: 1, areaKm2: 4 },
    [0, 1, 2, 3],
  ),
  null,
);
assert.throws(() => validateRegionalRows({ ...reference.cells[0], areaKm2: 1 }, reference));
const corrupt = structuredClone(reference.cells[0]);
corrupt.years[0][3] = 900;
assert.throws(() => validateRegionalRows(corrupt, reference));
console.log(
  'Regional maxima verified against independent Rasterio means at four Swiss regions and 24 lmoments3/SciPy model fits; missingness, dates and footprint consistency passed.',
);
