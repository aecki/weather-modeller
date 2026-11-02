import { ComparisonCurve, HoldoutHistory } from '../web/graphics/ComparisonCharts';
import { fitStormModel, modelLevel } from '../web/modelling/comparison.mjs';
import { layout, pan, zoomAt, project } from '../web/graphics/map-viewport.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ObservationChart } from '../web/graphics/TimeSeries';
import { StationMap } from '../web/graphics/StationMap';
import { WindowExplanation } from '../web/graphics/WindowExplanation';

const snapshot = JSON.parse(readFileSync('data/processed/observations.json', 'utf8'));
const station = snapshot.stations.find((entry) => entry.id === 'MER');
const dates = ['2005-08-20', '2005-08-21', '2005-08-22'];
const observed = dates.map((date) => station.values[snapshot.dates.indexOf(date)]);
const rainfall = renderToStaticMarkup(
  <ObservationChart
    width={600}
    dates={dates}
    values={observed}
    cursor={2}
    kind="rain"
    label="Measured rainfall"
  />,
);
assert.ok(rainfall.includes('data-renderer="visx"'));
assert.ok(rainfall.includes('role="button"'));
assert.ok(rainfall.includes('110.9 mm'));
const missing = renderToStaticMarkup(
  <ObservationChart
    width={600}
    dates={dates}
    values={[observed[0], null, observed[2]]}
    cursor={1}
    kind="river"
    label="Discharge"
  />,
);
assert.ok(missing.includes('missing observation'));
assert.ok(!missing.includes('NaN'));
const map = renderToStaticMarkup(
  <StationMap width={600} stations={[{ ...station, value: null }]} selected="MER" />,
);
assert.ok(map.includes('missing rainfall'));
assert.ok(map.includes('tabindex="0"'));
const explanation = renderToStaticMarkup(
  <WindowExplanation
    width={500}
    samples={dates.map((date, index) => ({ date, value: observed[index] }))}
    days={3}
    total={observed.reduce((a, b) => a + b)}
    stationName={station.name}
    ending={dates[2]}
  />,
);
assert.ok(explanation.includes('06:00–06:00 UTC'));
assert.ok(explanation.includes('110.9'));
console.log(
  'visx graphics verified: real rainfall, accessible stations, explicit missing observations, and inspectable accumulation.',
);

const classicMap = JSON.parse(readFileSync('web/geography/classic-map.json', 'utf8'));
const classic = renderToStaticMarkup(
  <StationMap
    width={600}
    classicMap={classicMap}
    stations={[{ ...station, value: observed[2] }]}
    selected="MER"
  />,
);
assert.ok(classic.includes('href="geography/classic-map-overview.webp"'));
assert.ok(!classic.includes('Topographic map'));
assert.ok(classic.includes('Reset map view'));
assert.ok(classic.includes('Drag to pan'));
assert.ok(classic.includes('© swisstopo'));
assert.ok(classic.includes('110.9 mm'));
assert.ok(!classic.includes('NaN'));

// Navigation must never expose the bundled raster edge, even on narrow screens.

const bounds = classicMap.processing.bounds;
for (const [width, height] of [
  [1000, 560],
  [350, 460],
  [1600, 500],
]) {
  let camera = layout(bounds, width, height);
  for (let i = 0; i < 60; i++) {
    camera = zoomAt(bounds, width, height, camera, i % 3 ? 1.7 : 0.2, [
      (i * 31) % width,
      (i * 47) % height,
    ]);
    camera = pan(bounds, width, height, camera, i % 2 ? 100000 : -100000, i % 3 ? -100000 : 100000);
    const a = project(bounds.slice(0, 2)),
      b = project(bounds.slice(2));
    const [tx, ty] = camera.translate;
    assert.ok(a[0] * camera.scale + tx <= 1e-6);
    assert.ok(b[0] * camera.scale + tx >= width - 1e-6);
    assert.ok(b[1] * camera.scale + ty <= 1e-6);
    assert.ok(a[1] * camera.scale + ty >= height - 1e-6);
    assert.ok(camera.zoom >= 1 && camera.zoom <= 8);
  }
}
const initial = layout(bounds, 1000, 560, { zoom: 2 });
const anchor = [550, 300];
const zoomed = zoomAt(bounds, 1000, 560, initial, 1.4, anchor);
for (let i = 0; i < 2; i++) {
  assert.ok(
    Math.abs(
      (anchor[i] - initial.translate[i]) / initial.scale -
        (anchor[i] - zoomed.translate[i]) / zoomed.scale,
    ) < 1e-10,
  );
}
console.log('Map navigation verified: bounded panning, zoom limits and cursor anchoring.');

const comparisonReference = JSON.parse(
  readFileSync('tests/fixtures/comparison-reference.json', 'utf8'),
).cases[0];
const trainBlocks = comparisonReference.blocks.slice(0, -10),
  testBlocks = comparisonReference.blocks.slice(-10);
const predictions = ['gev', 'gumbel', 'gpd', 'smev'].map((model) => ({
  model,
  fit: fitStormModel(trainBlocks, model),
}));
const comparisonPlot = renderToStaticMarkup(
  <ComparisonCurve
    width={800}
    bandModel="gpd"
    years={35}
    period={100}
    curves={predictions.map((p) => ({
      model: p.model,
      rows: [2, 10, 100, 500].map((t) => ({ period: t, value: modelLevel(p.fit, t) })),
    }))}
  />,
);
assert.ok(comparisonPlot.includes('data-renderer="visx"'));
assert.ok(!comparisonPlot.includes('NaN'));
const heldoutPlot = renderToStaticMarkup(
  <HoldoutHistory
    width={800}
    training={trainBlocks}
    test={testBlocks}
    predictions={predictions.map((p) => ({ model: p.model, level: modelLevel(p.fit, 10) }))}
  />,
);
assert.ok(heldoutPlot.includes('held-out observation'));
assert.ok(heldoutPlot.includes('training-only 10-year'));
assert.ok(!heldoutPlot.includes('NaN'));
