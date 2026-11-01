import React from 'react';
import { createRoot } from 'react-dom/client';
import { ParentSize } from '@visx/responsive';
import { StationMap } from './StationMap';
import { HorizontalBars, ObservationChart } from './TimeSeries';
import { WindowExplanation } from './WindowExplanation';

const roots = new WeakMap();
function mount(id, Component, props) {
  const element = document.getElementById(id);
  if (!roots.has(element)) roots.set(element, createRoot(element));
  roots
    .get(element)
    .render(
      <ParentSize debounceTime={20}>
        {({ width }) => <Component {...props} width={Math.max(width, 100)} />}
      </ParentSize>,
    );
}
window.LabGraphics = {
  map: (props) => mount('map', StationMap, props),
  rainfall: (props) => mount('rain-chart', ObservationChart, { ...props, kind: 'rain' }),
  river: (props) => mount('river-chart', ObservationChart, { ...props, kind: 'river' }),
  rankings: (props) => mount('rankings', HorizontalBars, { ...props, compact: true }),
  comparisons: (props) => mount('compare-bars', HorizontalBars, props),
  explanation: (props) => mount('window-explanation', WindowExplanation, props),
};
