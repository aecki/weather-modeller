// Work in SVG coordinates, after applying the inverse screen transform.
// Missing y values still have a date/x position and must remain inspectable.
export function nearestPlotPoint(points, position, axis = 'x') {
  let index = null;
  let distance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const next = Math.abs(points[i][axis] - position[axis]);
    if (Number.isFinite(points[i][axis]) && next < distance) {
      index = i;
      distance = next;
    }
  }
  return index;
}
export function stepPlotPoint(active, count, key) {
  if (!count) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return Math.max(0, Math.min(count - 1, (active ?? 0) + (key === 'ArrowRight' ? 1 : -1)));
}
