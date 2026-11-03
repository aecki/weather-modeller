// Pure lookup logic shared by the browser and offline regression checks.
export function addressesFromResponse(response) {
  const entries = response.features || response.results || [];
  return entries
    .map((entry) => {
      const p = entry.properties || entry.attrs;
      if (!p || p.origin !== 'address') return null;
      // GeoAdmin SearchServer reports x=northing, y=easting, even when sr=2056.
      // Its GeoJSON coordinates are also north/east; do not assume GeoJSON XY order here.
      const easting = p.y,
        northing = p.x;
      if (
        !Number.isFinite(easting) ||
        !Number.isFinite(northing) ||
        easting < 2400000 ||
        easting > 2900000 ||
        northing < 1000000 ||
        northing > 1400000
      )
        return null;
      return {
        id: String(p.featureId || entry.id),
        label: String(p.label || '')
          .replace(/<[^>]*>/g, '')
          .replaceAll('&amp;', '&'),
        easting,
        northing,
      };
    })
    .filter(Boolean);
}

export function cellAt(grid, point) {
  if (!Number.isFinite(point.easting) || !Number.isFinite(point.northing)) return null;
  const col = Math.floor((point.easting - grid.west) / grid.resolution);
  const row = Math.floor((grid.north - point.northing) / grid.resolution);
  return row >= 0 && row < grid.height && col >= 0 && col < grid.width
    ? { row, col, index: row * grid.width + col }
    : null;
}

export function amountAt(buffer, grid, cell) {
  if (buffer.byteLength !== grid.width * grid.height * 4)
    throw new Error('Incomplete regional grid');
  if (!cell) return null;
  const value = new DataView(buffer).getFloat32(cell.index * 4, true);
  if (Number.isNaN(value)) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid regional amount');
  return value;
}

export function expectedRainDay(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - (now.getUTCHours() < 6 ? 2 : 1) * 86400000).toISOString().slice(0, 10);
}

export function boundaryCoverage(geometry, point) {
  if (geometry.type !== 'MultiPolygon') throw new Error('Invalid Swiss boundary');
  const x = point.easting,
    y = point.northing;
  let closest = Infinity;
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j],
        [bx, by] = ring[i];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const dx = bx - ax,
        dy = by - ay,
        length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
      closest = Math.min(closest, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return inside;
  };
  for (const rings of geometry.coordinates) {
    const outer = inRing(rings[0]);
    const holes = rings.slice(1).map(inRing);
    if (outer && !holes.some(Boolean)) return { kind: 'inside', distance: 0 };
  }
  // Flag near-border directory coordinates without snapping them into Switzerland.
  return { kind: closest <= 50 ? 'border' : 'outside', distance: closest };
}

export async function verifiedBuffer(response, expectedHash) {
  if (!response.ok)
    throw new Error('Daily data could not be loaded. Reload daily data to try again.');
  const buffer = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== expectedHash)
    throw new Error('Daily data integrity check failed. Reload daily data.');
  return buffer;
}
