import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import {
  extractBlocks,
  fitStormModel,
  modelLevel,
  modelProbability,
  compareModels,
  comparisonInterval,
  validationScores,
  MODELS,
  observedRateInterval,
} from '../web/modelling/comparison.mjs';
const raw = readFileSync('data/processed/observations.json');
const data = JSON.parse(raw),
  refs = JSON.parse(readFileSync('tests/fixtures/comparison-reference.json', 'utf8'));
assert.equal(createHash('sha256').update(raw).digest('hex'), refs.sourceSha256);
const { annualMaxima, rolling } = createRequire(import.meta.url)('../web/data-core.js');
function near(a, b, tolerance = 1e-8) {
  assert.ok(
    Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)),
    `${a} != independent reference ${b}`,
  );
}
for (const example of refs.cases) {
  const station = data.stations.find((s) => s.id === example.station);
  const blocks = extractBlocks(data.dates, station.values, example.days, example.days);
  assert.deepEqual(
    blocks.map(({ year, maximum, events }) => ({ year, maximum, events })),
    example.blocks,
  );
  const annual = annualMaxima(
    data.dates,
    station.values,
    rolling(station.values, example.days),
    example.days,
  ).sort((a, b) => a.year.localeCompare(b.year));
  assert.deepEqual(
    blocks.map((b) => ({ year: b.year, value: b.maximum })),
    annual.map(({ year, value }) => ({ year, value })),
  );
  for (const block of blocks)
    for (let i = 1; i < block.windows.length; i++)
      assert.ok(
        block.windows[i][0] > block.windows[i - 1][1],
        'Retained event accumulation windows must not overlap.',
      );
  const training = blocks.slice(0, -10),
    test = blocks.slice(-10);
  for (const reference of example.fits) {
    const fit = fitStormModel(training, reference.parameters.model);
    for (const [key, value] of Object.entries(reference.parameters))
      if (typeof value === 'number') near(fit[key], value);
    assert.equal(fit.tailCount, reference.tailCount);
    reference.levels.forEach(({ period, rainfall }) => {
      near(modelLevel(fit, period), rainfall);
      near(modelProbability(fit, modelLevel(fit, period)), 1 / period, 1e-10);
    });
    reference.exceedances.forEach(({ rainfall, probability }) =>
      near(modelProbability(fit, rainfall), probability),
    );
    const scores = validationScores(fit, test, example.scoreThreshold);
    near(scores.brier, reference.brier);
    near(scores.pinball, reference.pinball);
  }
}
const mer = data.stations.find((s) => s.id === 'MER');
const blocks = extractBlocks(data.dates, mer.values, 3, 3);
const options = { holdout: 10, repetitions: 100, seed: 12345 };
const a = compareModels(blocks, options),
  b = compareModels(blocks, options);
assert.deepEqual(a, b, 'Paired year bootstrap must be deterministic.');
assert.ok(a.training.at(-1).year < a.test[0].year);
for (const model of MODELS) {
  assert.ok(a.fits[model].fit);
  assert.equal(a.fits[model].samples.length, 100);
}
// Alter only held-out years (isolated test mutation, never application data).
const changed = blocks.map((b, i) =>
  i < blocks.length - 10
    ? b
    : { ...b, maximum: b.maximum + 100, events: b.events.map((x) => x + 100) },
);
const c = compareModels(changed, options);
assert.equal(
  a.scoreThreshold,
  c.scoreThreshold,
  'Scoring threshold must not use test observations.',
);
for (const model of MODELS) {
  assert.deepEqual(
    a.fits[model].fit,
    c.fits[model].fit,
    'Test data cannot influence fitted parameters.',
  );
  assert.deepEqual(
    a.fits[model].samples.map((s) => s?.fit),
    c.fits[model].samples.map((s) => s?.fit),
    'Test data cannot influence training bootstrap fits.',
  );
}
assert.notEqual(a.fits.smev.scores.pinball, c.fits.smev.scores.pinball);
const excludeTest = compareModels(blocks, { ...options, excludeTrainingYear: a.test[0].year });
assert.deepEqual(
  excludeTest.test,
  a.test,
  'Replay-year exclusion must not delete a held-out year.',
);
assert.deepEqual(excludeTest.training, a.training);
const excludeTrain = compareModels(blocks, { ...options, excludeTrainingYear: a.training[0].year });
assert.equal(excludeTrain.training.length, a.training.length - 1);
assert.deepEqual(excludeTrain.test, a.test);
assert.throws(() =>
  compareModels(blocks.slice(0, 25), {
    ...options,
    holdout: 5,
    excludeTrainingYear: blocks[0].year,
  }),
);

assert.equal(comparisonInterval({ repetitions: 100 }, Array(89).fill(1)), null);
assert.equal(comparisonInterval({ repetitions: 100 }, Array(100).fill(Infinity))[1], Infinity);
const gpd = { model: 'gpd', threshold: 20, scale: 10, xi: -0.2, rate: 2 };
assert.equal(modelProbability(gpd, 19), null);
assert.equal(modelProbability(gpd, 70), 0);
assert.equal(modelLevel({ ...gpd, rate: 0.01 }, 2), null);
assert.throws(() => compareModels(blocks.slice(0, 24), options));
assert.throws(() => extractBlocks(data.dates, mer.values, 5, 1));
const missing = [...mer.values];
missing[data.dates.indexOf('2000-06-01')] = null;
assert.ok(!extractBlocks(data.dates, missing).some((b) => b.year === '2000'));
// Exercise the actual bundled worker, including message dispatch and comparison payload.
const worker = new Worker(
  `const {parentPort}=require('node:worker_threads');global.self={postMessage:m=>parentPort.postMessage(m)};require(${JSON.stringify(fileURLToPath(new URL('../dist/model-worker.js', import.meta.url)))});parentPort.on('message',data=>self.onmessage({data}));`,
  { eval: true },
);
try {
  const result = await new Promise((resolve, reject) => {
    worker.on('message', (m) => {
      if (m.result) resolve(m.result);
      if (m.error) reject(Error(m.error));
    });
    worker.on('error', reject);
    worker.postMessage({ kind: 'comparison', blocks, options });
  });
  assert.deepEqual(result, a);
} finally {
  await worker.terminate();
}
console.log(
  `GPD/SMEV verified against ${refs.cases.length} independent real-data extraction cases and 108 reference fits; holdout isolation, paired bootstrap, support and bundled worker passed.`,
);

near(observedRateInterval(0, 10)[1], 0.2775327998628892, 1e-12);
assert.equal(observedRateInterval(0, 10)[0], 0);
assert.ok(observedRateInterval(10, 10)[0] < 1);
assert.ok(observedRateInterval(2, 10, 0.8)[0] > observedRateInterval(2, 10, 0.95)[0]);

const automaticA = compareModels(blocks, { holdout: 10, repetitions: 100, context: 'MER:3' });
const automaticB = compareModels(changed, { holdout: 10, repetitions: 100, context: 'MER:3' });
assert.equal(
  automaticA.seed,
  automaticB.seed,
  'Automatic seed must be derived exclusively from training data.',
);
for (const model of MODELS)
  assert.deepEqual(
    automaticA.fits[model].samples.map((s) => s?.fit),
    automaticB.fits[model].samples.map((s) => s?.fit),
  );
