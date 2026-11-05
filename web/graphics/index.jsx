import React from 'react';
import { createRoot } from 'react-dom/client';
import { DailyRegional } from './DailyRegional';
import { StationNetwork } from './StationNetwork';
import { WaterWorkspace } from './WaterWorkspace';
import { routeForHash } from './routes.mjs';
const roots = new WeakMap();
function render(id, element) {
  const container = document.getElementById(id);
  if (!roots.has(container)) roots.set(container, createRoot(container));
  roots.get(container).render(element);
}
window.LabGraphics = {
  route: routeForHash,
  water: (props) => render('water-workspace', <WaterWorkspace {...props} />),
  network: () => render('station-network', <StationNetwork />),
  daily: (props) => render('regional-daily', <DailyRegional {...props} />),
};
