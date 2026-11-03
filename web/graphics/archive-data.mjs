import { verifiedBuffer } from './regional-data.mjs';
let indexPromise;
const years = new Map(),
  fields = new Map();
export function validCalendarDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day;
}
export async function archiveIndex() {
  if (!indexPromise)
    indexPromise = (async () => {
      const response = await fetch(
        new URL('data/rainfall-archive/manifest.json', document.baseURI),
      );
      if (!response.ok) throw new Error('Historical calendar index is unavailable. Please retry.');
      const m = await response.json();
      if (m.schemaVersion !== 1 || !validCalendarDay(m.from) || !validCalendarDay(m.through))
        throw new Error('Unsupported historical calendar index.');
      return m;
    })().catch((e) => {
      indexPromise = null;
      throw e;
    });
  return indexPromise;
}
export async function resolveRainDay(release, day, signal) {
  if (!validCalendarDay(day)) throw new Error('Choose a valid calendar day.');
  const index = await archiveIndex(),
    year = day.slice(0, 4),
    slot = index.years[year];
  if (slot && day >= index.from && day <= index.through) {
    let m = years.get(slot.sha256);
    if (!m) {
      if (!/^\d{4}-[a-f0-9]{64}\.json$/.test(slot.path))
        throw new Error('Invalid annual index path.');
      const raw = await verifiedBuffer(
        await fetch(new URL(`data/rainfall-archive/${slot.path}`, document.baseURI), { signal }),
        slot.sha256,
        'Historical index',
      );
      m = JSON.parse(new TextDecoder().decode(raw));
      if (
        m.schemaVersion !== 1 ||
        m.year !== Number(year) ||
        m.grid.width !== 370 ||
        m.grid.height !== 265 ||
        m.length !== 392200
      )
        throw new Error('Unsupported historical daily grid.');
      years.set(slot.sha256, m);
    }
    const offset = (Date.parse(`${day}T00:00:00Z`) - Date.UTC(Number(year), 0, 1)) / 86400000;
    const tuple = m.days[offset];
    if (
      !tuple ||
      !Number.isSafeInteger(tuple[0]) ||
      tuple[0] < 0 ||
      !tuple.slice(1).every((h) => /^[a-f0-9]{64}$/.test(h))
    )
      throw new Error('No indexed field exists for this day.');
    return {
      date: day,
      status: 'annual-archive',
      sha256: tuple[2],
      sourceId: m.source.sha256,
      source: { ...m.source, status: 'annual-archive' },
      archive: { ...m, offset: tuple[0], rawSha256: tuple[1] },
    };
  }
  const record = release.days.find((r) => r.date === day);
  return record ? { ...record, source: release.sources[record.sourceId] } : null;
}
export function normalizeArchiveField(raw, meta) {
  const { width, height } = meta.grid;
  if (raw.byteLength !== width * height * 4) throw new Error('Incomplete historical daily field.');
  const input = new DataView(raw),
    output = new ArrayBuffer(raw.byteLength),
    view = new DataView(output);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const r = meta.flipNorth ? height - 1 - row : row,
        c = meta.flipEast ? width - 1 - col : col;
      let value = input.getFloat32((r * width + c) * 4, true);
      if (value === meta.fillValue || Number.isNaN(value)) value = NaN;
      else if (!Number.isFinite(value) || value < 0)
        throw new Error('Invalid historical rainfall value.');
      view.setFloat32((row * width + col) * 4, value, true);
    }
  return output;
}
export async function loadRainField(record, signal) {
  if (fields.has(record.sha256)) return fields.get(record.sha256);
  let buffer;
  if (record.archive) {
    const m = record.archive,
      url = new URL(m.source.url);
    if (url.origin !== 'https://data.geo.admin.ch' || !url.pathname.endsWith('.nc'))
      throw new Error('Invalid official archive source.');
    const response = await fetch(url, {
      headers: { Range: `bytes=${m.offset}-${m.offset + m.length - 1}` },
      signal,
    });
    if (response.status !== 206) {
      await response.body?.cancel();
      throw new Error(
        'The official archive could not serve this day. No full-year download was started. Please retry.',
      );
    }
    const raw = await verifiedBuffer(response, m.rawSha256, 'Historical rainfall');
    buffer = normalizeArchiveField(raw, m);
    // Verify the final normalized grid against the independent NetCDF decoding.
    await verifiedBuffer(new Response(buffer), record.sha256, 'Historical rainfall');
  } else {
    if (!/^grids\/[a-f0-9]{64}\.f32$/.test(record.path))
      throw new Error('Invalid recent field path.');
    buffer = await verifiedBuffer(
      await fetch(new URL(`data/regional/${record.path}`, document.baseURI), { signal }),
      record.sha256,
    );
  }
  fields.set(record.sha256, buffer);
  if (fields.size > 20) fields.delete(fields.keys().next().value);
  return buffer;
}
