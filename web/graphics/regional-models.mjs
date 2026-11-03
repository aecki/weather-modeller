import { verifiedBuffer } from './regional-data.mjs';
import { findCell } from './regional-history.mjs';
let manifestPromise;
const chunks = new Map();
export function validateRegionalRows(entry, manifest) {
  if (
    !entry ||
    !Number.isInteger(entry.halfWidthCells) ||
    entry.areaKm2 < 400 ||
    entry.years.length !== manifest.years.length
  )
    throw new Error('Invalid regional modelling record.');
  entry.years.forEach((row, i) => {
    if (row === null) return;
    const days =
      (Date.UTC(manifest.years[i] + 1, 0, 1) - Date.UTC(manifest.years[i], 0, 1)) / 86400000;
    if (
      row.length !== 8 ||
      !row.every(Number.isFinite) ||
      row.some((n) => n < 0) ||
      !Number.isInteger(row[1]) ||
      row[1] > days ||
      row[2] > row[4] + 1e-7 ||
      row[4] > row[6] + 1e-7 ||
      row[6] > row[0] + 1e-7 ||
      [3, 5, 7].some((j, k) => !Number.isInteger(row[j]) || row[j] < 2 * k || row[j] >= days)
    )
      throw new Error('Corrupt regional annual rainfall record.');
  });
  return entry;
}
export async function loadRegionalRecord(index) {
  const base = new URL('data/regional-models/', document.baseURI);
  if (!manifestPromise)
    manifestPromise = (async () => {
      const response = await fetch(new URL('manifest.json', base), { cache: 'no-cache' });
      if (!response.ok) throw new Error('Regional modelling history is temporarily unavailable.');
      const manifest = await response.json();
      if (
        manifest.schemaVersion !== 1 ||
        manifest.method !== 'swiss-area-mean-annual-maxima-v1' ||
        manifest.years.length < 20
      )
        throw new Error('Unsupported regional modelling reference.');
      const raw = await verifiedBuffer(
        await fetch(new URL('cells.u32', base)),
        manifest.cellsSha256,
        'Regional history',
      );
      const view = new DataView(raw);
      if (view.byteLength !== manifest.cellCount * 4)
        throw new Error('Invalid regional cell index.');
      const cells = Array.from({ length: manifest.cellCount }, (_, i) =>
        view.getUint32(i * 4, true),
      );
      if (cells.some((n, i) => i > 0 && n <= cells[i - 1]))
        throw new Error('Invalid regional cell order.');
      return { manifest, cells };
    })().catch((e) => {
      manifestPromise = null;
      throw e;
    });
  const { manifest, cells } = await manifestPromise;
  const position = findCell(cells, index);
  if (position < 0) throw new Error('Regional history does not cover this address.');
  const chunk = Math.floor(position / manifest.chunkSize),
    hash = manifest.chunks[chunk];
  let rows = chunks.get(hash);
  if (!rows) {
    const raw = await verifiedBuffer(
      await fetch(new URL(`chunks/${chunk}-${hash}.json.gz`, base)),
      hash,
      'Regional history',
    );
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    rows = JSON.parse(await new Response(stream).text());
    if (rows.length !== Math.min(manifest.chunkSize, cells.length - chunk * manifest.chunkSize))
      throw new Error('Incomplete regional model chunk.');
    rows.forEach((row, i) => {
      if (row.cell !== cells[chunk * manifest.chunkSize + i])
        throw new Error('Regional chunk cell mismatch.');
      validateRegionalRows(row, manifest);
    });
    chunks.set(hash, rows);
    if (chunks.size > 8) chunks.delete(chunks.keys().next().value);
  }
  return { manifest, cells, entry: rows[position % manifest.chunkSize] };
}
export function areaMean(buffer, grid, entry, cells) {
  const view = new DataView(buffer);
  if (view.byteLength !== grid.width * grid.height * 4)
    throw new Error('Incomplete regional field.');
  const row = Math.floor(entry.cell / grid.width),
    col = entry.cell % grid.width;
  let sum = 0,
    count = 0;
  for (const index of cells) {
    if (
      Math.abs(Math.floor(index / grid.width) - row) > entry.halfWidthCells ||
      Math.abs((index % grid.width) - col) > entry.halfWidthCells
    )
      continue;
    const value = view.getFloat32(index * 4, true);
    if (!Number.isFinite(value) || value < 0) return null;
    sum += value;
    count++;
  }
  if (count !== entry.areaKm2) throw new Error('Regional footprint mismatch.');
  return sum / count;
}
export function annualMaxima(record, duration) {
  const k = [1, 3, 5].indexOf(duration);
  if (k < 0) throw new Error('Unsupported rainfall duration');
  return record.entry.years.flatMap((row, i) =>
    row === null
      ? []
      : [
          {
            year: String(record.manifest.years[i]),
            value: row[2 + 2 * k],
            date: new Date(Date.UTC(record.manifest.years[i], 0, 1 + row[3 + 2 * k]))
              .toISOString()
              .slice(0, 10),
          },
        ],
  );
}
