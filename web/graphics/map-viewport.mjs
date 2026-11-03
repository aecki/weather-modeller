export const MAP_BOUNDS = [5.5, 45.5, 10.95, 48.0];
export function wheelZoomEnabled(event, fullscreen = false) {
  return Boolean(fullscreen || event.ctrlKey || event.metaKey);
}
// Mercator coordinates and constrained camera shared by pointer, touch and keyboard input.
const radians = Math.PI / 180;
export function project([lon, lat]) {
  return [lon * radians, -Math.log(Math.tan(Math.PI / 4 + (lat * radians) / 2))];
}
export function layout(bounds, width, height, view = { zoom: 1 }, maxZoom = 8) {
  const [left, bottom] = project(bounds.slice(0, 2));
  const [right, top] = project(bounds.slice(2));
  const zoom = Math.max(1, Math.min(maxZoom, view.zoom));
  const scale = Math.max(width / (right - left), height / (bottom - top)) * zoom;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const centre = view.centre || [(left + right) / 2, (top + bottom) / 2];
  const cx = clamp(centre[0], left + width / (2 * scale), right - width / (2 * scale));
  const cy = clamp(centre[1], top + height / (2 * scale), bottom - height / (2 * scale));
  return {
    zoom,
    centre: [cx, cy],
    scale,
    translate: [width / 2 - cx * scale, height / 2 - cy * scale],
  };
}
export function pan(bounds, width, height, view, dx, dy, maxZoom = 8) {
  const current = layout(bounds, width, height, view, maxZoom);
  return layout(
    bounds,
    width,
    height,
    {
      zoom: current.zoom,
      centre: [current.centre[0] - dx / current.scale, current.centre[1] - dy / current.scale],
    },
    maxZoom,
  );
}
export function zoomAt(
  bounds,
  width,
  height,
  view,
  factor,
  point = [width / 2, height / 2],
  maxZoom = 8,
) {
  const current = layout(bounds, width, height, view, maxZoom);
  const zoom = Math.max(1, Math.min(maxZoom, current.zoom * factor));
  const scale = (current.scale * zoom) / current.zoom;
  const offset = [point[0] - width / 2, point[1] - height / 2];
  return layout(
    bounds,
    width,
    height,
    {
      zoom,
      centre: current.centre.map((n, i) => n + offset[i] / current.scale - offset[i] / scale),
    },
    maxZoom,
  );
}
