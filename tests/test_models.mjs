import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  fitModel,
  returnLevel,
  annualExceedance,
  returnPeriod,
  fitEnsemble,
  interval,
  percentile,
  atLeastOnce,
  seedFor,
  MIN_YEARS,
} from '../web/modelling/extremes.mjs';
const require = createRequire(import.meta.url);
const { rolling, annualMaxima } = require('../web/data-core.js');
const raw = readFileSync('data/processed/observations.json');
const snapshot = JSON.parse(raw);
const reference = JSON.parse(readFileSync('tests/fixtures/extreme-reference.json', 'utf8'));
assert.equal(
  createHash('sha256').update(raw).digest('hex'),
  reference.sourceSha256,
  'Regenerate references after intentionally refreshing the snapshot.',
);
function near(actual, expected, relative = 2e-5) {
  assert.ok(
    Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)),
    `${actual} differs from independent reference ${expected}`,
  );
}
for (const example of reference.cases) {
  const station = snapshot.stations.find((entry) => entry.id === example.station);
  const annual = annualMaxima(
    snapshot.dates,
    station.values,
    rolling(station.values, example.days),
    example.days,
  );
  assert.deepEqual(
    [...annual]
      .sort((a, b) => a.year.localeCompare(b.year))
      .map(({ year, value }) => ({ year, value })),
    example.maxima,
  );
  const values = annual.map((row) => row.value);
  if (!example.supportValid) {
    assert.throws(() => fitModel(values, example.model));
    continue;
  }
  const fit = fitModel(values, example.model);
  ['location', 'scale', 'xi'].forEach((key) => near(fit[key], example.fit[key]));
  example.levels.forEach(({ period, rainfall }) => {
    near(returnLevel(fit, period), rainfall);
    near(annualExceedance(fit, returnLevel(fit, period)), 1 / period, 1e-9);
  });
  example.exceedances.forEach(({ rainfall, probability }) =>
    near(annualExceedance(fit, rainfall), probability, 1e-7),
  );
}
const gumbel = { location: 50, scale: 10, xi: 0 };
near(returnLevel(gumbel, 100), 96.00149226776579, 1e-12);
near(atLeastOnce(0.01, 30), 1 - Math.pow(0.99, 30), 1e-12);
assert.equal(returnPeriod({ ...gumbel, xi: -0.2 }, 100), Infinity);
assert.equal(annualExceedance({ ...gumbel, xi: 0.2 }, -1), 1);
assert.equal(percentile([3, Infinity], 0.95), Infinity);
assert.deepEqual(interval([0, 1, 2, 3, 4], 0.5), [1, 3]);
assert.throws(() => fitModel(Array(25).fill(50)));
assert.throws(() => fitEnsemble([1, 2, 3]));
assert.throws(() => returnLevel(gumbel, 1));
assert.equal(MIN_YEARS, 20);
const input = reference.cases
  .find((entry) => entry.station === 'MER' && entry.days === 1 && entry.model === 'gev')
  .maxima.map((row) => row.value);
const options = { model: 'gev', repetitions: 500, seed: seedFor('MER:1981-2025:1day') };
const a = fitEnsemble(input, options),
  b = fitEnsemble(input, options);
assert.deepEqual(a, b, 'Bootstrap must be reproducible for identical settings and seed.');
assert.equal(a.fits.length + a.failed, 500);
assert.ok(a.intervalAvailable);
const bands = interval(a.fits.map((fit) => returnLevel(fit, 100)));
assert.ok(bands[0] < returnLevel(a.fit, 100) && bands[1] > returnLevel(a.fit, 100));
const narrower = interval(
  a.fits.map((fit) => returnLevel(fit, 100)),
  0.8,
);
assert.ok(
  narrower[0] >= bands[0] && narrower[1] <= bands[1],
  'Changing interval level must reuse the ensemble and nest the percentile bounds.',
);
assert.throws(() => interval([1, 2, 3], 1.5));
assert.throws(() => atLeastOnce(0.01, Infinity));
// Run the actual bundled browser worker in a small Worker API adapter, off the main thread.
const worker = new Worker(
  `const {parentPort}=require('node:worker_threads'); global.self={postMessage:message=>parentPort.postMessage(message)}; require(${JSON.stringify(fileURLToPath(new URL('../dist/model-worker.js', import.meta.url)))}); parentPort.on('message',data=>self.onmessage({data}));`,
  { eval: true },
);
try {
  const result = await new Promise((resolve, reject) => {
    worker.on('message', (message) => {
      if (message.result) resolve(message.result);
      if (message.error) reject(Error(message.error));
    });
    worker.on('error', reject);
    worker.postMessage({ values: input, options: { ...options, repetitions: 100 } });
  });
  assert.equal(result.repetitions, 100);
  near(result.fit.xi, a.fit.xi, 1e-12);
} finally {
  await worker.terminate();
}
console.log(
  `Extreme-value models verified against ${reference.cases.length} lmoments3/SciPy real-data cases, bootstrap reproducibility, support limits, probabilities and the bundled worker.`,
);
