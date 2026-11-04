export function parseCSV(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ';' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Incomplete station CSV.');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header?.includes('reference_timestamp') || !header.includes('rre150d0'))
    throw Error('This file does not contain daily precipitation.');
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
export function stationRows(text) {
  const lookup = new Map();
  for (const row of parseCSV(text)) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4}) \d{2}:\d{2}$/.exec(row.reference_timestamp);
    if (!match) throw Error('Unsupported station timestamp.');
    const day = `${match[3]}-${match[2]}-${match[1]}`;
    if (new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day || lookup.has(day))
      throw Error('Duplicate or invalid station date.');
    const value = row.rre150d0.trim() === '' ? null : Number(row.rre150d0);
    if (value !== null && (!Number.isFinite(value) || value < 0))
      throw Error('Invalid station precipitation.');
    lookup.set(day, value);
  }
  return lookup;
}
export function completeSeries(lookup) {
  const days = [...lookup.keys()].sort();
  if (!days.length) throw Error('No daily records available.');
  const dates = [],
    values = [];
  for (
    let t = Date.parse(days[0] + 'T12:00:00Z');
    t <= Date.parse(days.at(-1) + 'T12:00:00Z');
    t += 86400000
  ) {
    const day = new Date(t).toISOString().slice(0, 10);
    dates.push(day);
    values.push(lookup.get(day) ?? null);
  }
  return { dates, values };
}
export function largestWindows(dates, values, duration, count = 5) {
  const candidates = [];
  for (let i = duration - 1; i < values.length; i++) {
    const window = values.slice(i - duration + 1, i + 1);
    if (
      dates[i].slice(0, 4) !== dates[i - duration + 1].slice(0, 4) ||
      !window.every(Number.isFinite)
    )
      continue;
    candidates.push({ date: dates[i], index: i, value: window.reduce((a, b) => a + b, 0) });
  }
  candidates.sort((a, b) => b.value - a.value || a.date.localeCompare(b.date));
  const chosen = [];
  for (const c of candidates) {
    if (chosen.every((p) => Math.abs(p.index - c.index) >= duration)) chosen.push(c);
    if (chosen.length === count) break;
  }
  return chosen;
}
export async function loadStation(station, signal) {
  const lookup = new Map(),
    sources = [];
  for (const tier of ['historical', 'recent']) {
    const url = station.url.replace('_historical.csv', `_${tier}.csv`);
    const response = await fetch(url, { signal });
    if (!response.ok) {
      if (response.status === 404) continue;
      throw Error(`Station source unavailable (${response.status}).`);
    }
    const buffer = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    const rows = stationRows(new TextDecoder('windows-1252').decode(buffer));
    for (const [day, value] of rows) if (!lookup.has(day)) lookup.set(day, value);
    sources.push({ url, sha256: hash, tier, loadedAt: new Date().toISOString() });
  }
  return { ...completeSeries(lookup), sources };
}
