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
const empty = { type: 'FeatureCollection', features: [] };
const map = renderToStaticMarkup(
  <StationMap
    width={600}
    countries={empty}
    lakes={empty}
    stations={[{ ...station, value: null }]}
    selected="MER"
  />,
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
