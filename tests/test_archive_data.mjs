import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  normalizeArchiveField,
  validCalendarDay,
  loadRainField,
} from '../web/graphics/archive-data.mjs';
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/rainfall-archive/reference.json', import.meta.url)),
);
const bytes = gunzipSync(
  readFileSync(new URL('./fixtures/rainfall-archive/2005-08-22.raw.gz', import.meta.url)),
);
const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const normalized = normalizeArchiveField(raw, fixture.archive);
assert.equal(createHash('sha256').update(new Uint8Array(normalized)).digest('hex'), fixture.sha256);
assert.equal(validCalendarDay('1961-01-01'), true);
assert.equal(validCalendarDay('2000-02-29'), true);
assert.equal(validCalendarDay('1900-02-29'), false);
assert.equal(validCalendarDay('2024-02-30'), false);
assert.equal(validCalendarDay('2024-2-1'), false);
let requested;
globalThis.fetch = async (url, options) => {
  requested = { url: String(url), options };
  return new Response(raw, { status: 206 });
};
const record = { sha256: fixture.sha256, archive: fixture.archive };
const field = await loadRainField(record);
assert.equal(field.byteLength, 392200);
assert.equal(requested.url, fixture.source.url);
assert.equal(
  requested.options.headers.Range,
  `bytes=${fixture.archive.offset}-${fixture.archive.offset + fixture.archive.length - 1}`,
);
// A server ignoring Range must never cause a full-year body read.
let cancelled = false;
globalThis.fetch = async () => ({
  status: 200,
  body: {
    cancel: async () => {
      cancelled = true;
    },
  },
});
await assert.rejects(
  () => loadRainField({ ...record, sha256: '0'.repeat(64) }),
  /No full-year download/,
);
assert.equal(cancelled, true);
globalThis.fetch = async () => new Response(new Uint8Array(32), { status: 206 });
await assert.rejects(() => loadRainField({ ...record, sha256: '1'.repeat(64) }), /integrity check/);
assert.throws(() => normalizeArchiveField(new ArrayBuffer(4), fixture.archive), /Incomplete/);
console.log(
  'Official archive range, raw and normalized SHA-256, north/south orientation, calendar leap days, truncated/corrupt responses and full-year-download prevention passed.',
);
