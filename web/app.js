'use strict';
const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-CH', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '—';
const dateLabel = (d, year = false) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
let data,
  event,
  station,
  river,
  days = 1,
  cursor = 0,
  map,
  markers = [],
  playing = null,
  dates = [],
  indices = [],
  annual = [],
  rolled = [],
  peak,
  cached = new Map();
function series(s) {
  const key = s.id + ':' + days;
  if (!cached.has(key)) cached.set(key, DataCore.rolling(s.values, days));
  return cached.get(key);
}
function eventIndices(e) {
  return [data.dates.indexOf(e.start), data.dates.indexOf(e.end)];
}
function eventPeak(e, s = station) {
  const [a, b] = eventIndices(e);
  return DataCore.peak(series(s), a, b);
}
function rainfallColor(v) {
  return v === null
    ? '#eef1ed'
    : v < 20
      ? '#bccfce'
      : v < 50
        ? '#6da9a2'
        : v < 100
          ? '#e5b36d'
          : v < 150
            ? '#d87a43'
            : '#a63c2e';
}
function stop() {
  clearInterval(playing);
  playing = null;
  $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Play event');
}
function setEvent(id) {
  stop();
  event = data.events.find((e) => e.id === id);
  dates = data.dates.filter((d) => d >= event.start && d <= event.end);
  indices = dates.map((d) => data.dates.indexOf(d));
  const wettest = eventPeak(event);
  cursor = wettest ? indices.indexOf(wettest.index) : Math.floor(dates.length / 2);
  $('timeline').max = dates.length - 1;
  document.querySelectorAll('.event').forEach((b) => {
    const active = b.dataset.id === id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active);
  });
  $('event-title').textContent = event.name;
  $('event-dates').textContent =
    `${dateLabel(event.start, true)} — ${dateLabel(event.end, true)} · ${dates.length} observation days`;
  $('range-start').textContent = dateLabel(event.start);
  $('range-end').textContent = dateLabel(event.end);
  updateAnalysis();
}
function setStation(id) {
  station = data.stations.find((s) => s.id === id);
  $('station').value = id;
  updateAnalysis();
}
function updateAnalysis() {
  $('export-status').textContent = '';
  rolled = series(station);
  annual = DataCore.annualMaxima(data.dates, station.values, rolled, days);
  peak = eventPeak(event);
  $('station-name').textContent = station.name;
  $('station-meta').textContent =
    `${station.id} · ${station.canton} · ${fmt(station.elevation, 0)} m a.s.l.`;
  $('peak-value').textContent = fmt(peak?.value);
  $('peak-date').textContent = peak
    ? `${days}-day window ending ${dateLabel(data.dates[peak.index])}`
    : 'No complete window in this event';
  const valid = indices.filter((i) => station.values[i] !== null).length;
  $('coverage').textContent = `${valid} / ${dates.length}`;
  $('coverage-note').textContent = 'daily rainfall values available';
  $('rain-title').textContent = `Daily rainfall · ${station.id}`;
  const count = peak ? annual.filter((x) => x.value >= peak.value).length : null;
  $('history-summary').textContent =
    peak && annual.length
      ? `${count} of ${annual.length} complete years had a ${days}-day maximum at least as large as this event’s ${fmt(peak.value)} mm at ${station.name}.`
      : 'Not enough complete records for a historical comparison.';
  const top = annual.slice(0, 5),
    max = top[0]?.value || 1;
  $('rankings').innerHTML =
    top
      .map(
        (r) =>
          `<div class="rank"><div class="rank-label"><b>${r.year} <small>· ${dateLabel(r.date)}</small></b><span>${fmt(r.value)} mm</span></div><div class="rank-track"><div style="width:${(r.value / max) * 100}%"></div></div></div>`,
      )
      .join('') || '<p>No complete years.</p>';
  $('compare-duration').textContent = `${days}-day`;
  const comparisons = data.events.map((e) => ({ e, p: eventPeak(e) })),
    cm = Math.max(...comparisons.map((x) => x.p?.value || 0), 1);
  $('compare-bars').innerHTML = comparisons
    .map(
      ({ e, p }) =>
        `<div class="compare-row ${e.id === event.id ? 'active' : ''}"><span>${e.id}</span><div class="compare-track"><div style="width:${((p?.value || 0) / cm) * 100}%"></div></div><b>${p ? fmt(p.value) + ' mm' : 'Missing'}</b></div>`,
    )
    .join('');
  updateCursor();
}
function updateCursor() {
  const date = dates[cursor],
    i = indices[cursor];
  $('timeline').value = cursor;
  $('timeline').setAttribute('aria-valuetext', dateLabel(date, true));
  $('cursor-date').textContent = dateLabel(date);
  $('map-day').textContent = `${days}-day window · ${dateLabel(date, true)}`;
  $('rain-value').textContent = fmt(rolled[i]);
  $('rain-duration').textContent = `${days}-day total ending ${dateLabel(date)}`;
  updateMap();
  rainChart();
  riverChart();
}
function initMap(countries, lakes) {
  map = L.map('map', {
    zoomControl: true,
    scrollWheelZoom: false,
    minZoom: 6,
    maxZoom: 13,
    maxBounds: [
      [44, 3],
      [50, 14],
    ],
    maxBoundsViscosity: 0.8,
  }).setView([46.82, 8.15], 7);
  L.geoJSON(countries, {
    style: (f) => ({
      color: f.properties.name === 'Switzerland' ? '#839d8d' : '#bcc8bc',
      weight: f.properties.name === 'Switzerland' ? 1.6 : 0.8,
      fillColor: f.properties.name === 'Switzerland' ? '#f1f1df' : '#e5e9de',
      fillOpacity: 1,
    }),
    interactive: false,
  }).addTo(map);
  L.geoJSON(lakes, {
    style: { color: '#9dbbb7', weight: 0.5, fillColor: '#bdd5d0', fillOpacity: 0.95 },
    interactive: false,
  }).addTo(map);
  map.attributionControl.addAttribution(
    'Geography: <a href="https://www.naturalearthdata.com/">Natural Earth</a>',
  );
  const labels = [
    ['SWITZERLAND', 46.8, 8.2],
    ['FRANCE', 46.9, 5.9],
    ['GERMANY', 47.9, 8.4],
    ['ITALY', 45.9, 8.2],
    ['AUSTRIA', 47.15, 10.5],
  ];
  labels.forEach(([name, lat, lon]) =>
    L.marker([lat, lon], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'country-label' + (name === 'SWITZERLAND' ? ' swiss-label' : ''),
        html: name,
        iconSize: [110, 15],
        iconAnchor: [55, 7],
      }),
    }).addTo(map),
  );
  data.stations.forEach((s) => {
    const m = L.circleMarker([s.lat, s.lon], {
      radius: 8,
      weight: 1.5,
      color: '#fff',
      fillOpacity: 0.9,
    }).addTo(map);
    m.on('click', () => setStation(s.id));
    markers.push({ s, m });
  });
  resetMap();
}
function resetMap() {
  map.fitBounds(L.latLngBounds(data.stations.map((s) => [s.lat, s.lon])).pad(0.13));
}
function updateMap() {
  if (!map) return;
  markers.forEach(({ s, m }) => {
    const v = series(s)[indices[cursor]],
      selected = s.id === station.id;
    m.setStyle({
      fillColor: rainfallColor(v),
      color: selected ? '#173b3e' : '#fff',
      weight: selected ? 3 : 1.5,
      radius: selected ? 12 : Math.min(11, 6 + Math.sqrt(v || 0) / 3),
    });
    m.unbindTooltip();
    m.bindTooltip(`${s.id} · ${fmt(v)} mm`, {
      permanent: selected,
      direction: 'top',
      className: selected ? 'selected' : '',
    });
    if (selected) m.bringToFront();
  });
}
function svgFrame(values, unit) {
  const w = 500,
    h = 175,
    l = 42,
    r = 12,
    t = 16,
    b = 30,
    pw = w - l - r,
    ph = h - t - b;
  const valid = values.filter(Number.isFinite),
    mx = Math.max(...valid, 1) * 1.15;
  const x = (i) => l + ((i + 0.5) * pw) / dates.length,
    y = (v) => t + ph - (v / mx) * ph;
  let body = '';
  for (let j = 0; j <= 3; j++) {
    const v = (mx * j) / 3,
      yy = y(v);
    body += `<line x1="${l}" x2="${w - r}" y1="${yy}" y2="${yy}" stroke="#e4e9e2"/><text x="${l - 7}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#7d8f87">${fmt(v, 0)}</text>`;
  }
  dates.forEach((d, i) => {
    if (i === 0 || i === dates.length - 1 || i === Math.floor(dates.length / 2))
      body += `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#7d8f87">${dateLabel(d)}</text>`;
  });
  body += `<line x1="${x(cursor)}" x2="${x(cursor)}" y1="${t}" y2="${h - b}" stroke="#6f8177" stroke-dasharray="3 3"/>`;
  return { w, h, l, r, t, b, pw, ph, mx, x, y, body, unit };
}
function svgWrap(f, body, label) {
  return `<svg viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="${label}" style="font-family:DM Sans,sans-serif">${f.body}${body}</svg>`;
}
function rainChart() {
  const vals = indices.map((i) => station.values[i]),
    f = svgFrame(vals, 'mm');
  let body = '';
  vals.forEach((v, i) => {
    const x = f.x(i),
      width = (f.pw / dates.length) * 0.65;
    if (v === null) {
      body += `<text x="${x}" y="${f.h - f.b - 4}" text-anchor="middle" font-size="12" fill="#84958c">×<title>Missing rainfall on ${dates[i]}</title></text>`;
      return;
    }
    body += `<rect class="bar" data-day="${i}" tabindex="0" role="button" aria-label="${dateLabel(dates[i], true)}: ${fmt(v)} mm" x="${x - width / 2}" y="${f.y(v)}" width="${width}" height="${Math.max(0.8, f.y(0) - f.y(v))}" rx="2" fill="${i === cursor ? '#ba6f40' : '#dfb98f'}"><title>${dateLabel(dates[i], true)}: ${fmt(v)} mm</title></rect>`;
  });
  $('rain-chart').innerHTML = svgWrap(
    f,
    body,
    `Daily rainfall at ${station.name}; cursor ${dates[cursor]}`,
  );
  $('rain-chart')
    .querySelectorAll('.bar')
    .forEach((el) => {
      const go = () => {
        cursor = +el.dataset.day;
        updateCursor();
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });
}
function riverChart() {
  const records = river.events[event.id] || [],
    byDate = new Map(records.map((r) => [r.timestamp.slice(0, 10), r])),
    vals = dates.map((d) => byDate.get(d)?.value ?? null);
  if (!vals.some(Number.isFinite)) {
    $('river-chart').innerHTML =
      '<div class="empty">No discharge observations for this gauge in this event window. Choose another gauge.</div>';
    return;
  }
  const f = svgFrame(vals, 'm³/s');
  let path = '',
    open = false;
  vals.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    path += `${open ? 'L' : 'M'}${f.x(i)},${f.y(v)} `;
    open = true;
  });
  let body = `<path d="${path}" fill="none" stroke="#397f7a" stroke-width="2.5"/>`;
  vals.forEach((v, i) => {
    if (v === null) return;
    const row = byDate.get(dates[i]);
    body += `<circle cx="${f.x(i)}" cy="${f.y(v)}" r="${i === cursor ? 5 : 3}" fill="${i === cursor ? '#173b3e' : '#fff'}" stroke="#397f7a" stroke-width="1.5"><title>${dateLabel(dates[i], true)}: ${fmt(v)} m³/s · release ${row.releaseState}</title></circle>`;
  });
  const v = vals[cursor];
  body += `<text x="${f.w - f.r}" y="11" text-anchor="end" font-size="10" fill="#397f7a">${fmt(v)} m³/s${byDate.get(dates[cursor]) ? ' · release ' + byDate.get(dates[cursor]).releaseState : ''}</text>`;
  $('river-chart').innerHTML = svgWrap(
    f,
    body,
    `Derived 24-hour mean discharge at ${river.name} on ${river.river}`,
  );
}
async function exportSelection() {
  const button = $('export');
  button.disabled = true;
  $('export-status').textContent = 'Saving in repository…';
  try {
    const response = await fetch('api/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: event.id, station: station.id, river: river.id, days }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Export failed');
    $('export-status').textContent = 'Saved to ' + result.path;
  } catch (error) {
    $('export-status').textContent = 'Could not save selection: ' + error.message;
  } finally {
    button.disabled = false;
  }
}
async function init() {
  try {
    const urls = [
      'data/observations.json',
      'geography/countries.geojson',
      'geography/lakes.geojson',
    ];
    const responses = await Promise.all(urls.map((url) => fetch(url)));
    for (const res of responses) if (!res.ok) throw Error('HTTP ' + res.status);
    const [observations, countries, lakes] = await Promise.all(responses.map((res) => res.json()));
    data = observations;
    station = data.stations.find((s) => s.id === 'MER') || data.stations[0];
    river = data.rivers.find((r) => r.id === '2135') || data.rivers[0];
    $('events').innerHTML = data.events
      .map(
        (e) =>
          `<button class="event" data-id="${e.id}"><span class="year">${e.id}</span><span class="ename">${e.name}<small>${e.subtitle}</small></span><span class="arrow">↗</span></button>`,
      )
      .join('');
    $('station').innerHTML = [...data.stations]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `<option value="${s.id}">${s.name} · ${s.id}</option>`)
      .join('');
    $('station').value = station.id;
    $('river').innerHTML = data.rivers
      .map((r) => `<option value="${r.id}">${r.river} · ${r.name} (${r.id})</option>`)
      .join('');
    $('river').value = river.id;
    $('events').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setEvent(b.dataset.id);
    });
    $('station').onchange = (e) => setStation(e.target.value);
    $('river').onchange = (e) => {
      river = data.rivers.find((r) => r.id === e.target.value);
      riverChart();
    };
    $('durations').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      days = +b.dataset.days;
      document.querySelectorAll('#durations button').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', x === b);
      });
      updateAnalysis();
    };
    $('timeline').oninput = (e) => {
      cursor = +e.target.value;
      updateCursor();
    };
    $('play').onclick = () => {
      if (playing) {
        stop();
        return;
      }
      if (cursor === dates.length - 1) cursor = -1;
      $('play').textContent = 'Ⅱ';
      $('play').setAttribute('aria-label', 'Pause event');
      playing = setInterval(() => {
        cursor++;
        updateCursor();
        if (cursor === dates.length - 1) stop();
      }, 850);
    };
    $('export').onclick = exportSelection;
    $('reset-map').onclick = resetMap;
    $('source-open').onclick = () => $('sources').showModal();
    $('source-close').onclick = () => $('sources').close();
    $('sources').addEventListener('click', (e) => {
      if (e.target === $('sources')) {
        const r = $('sources').getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          $('sources').close();
      }
    });
    $('snapshot').textContent =
      'Snapshot ' +
      new Date(data.generatedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/Zurich' });
    $('loading').hidden = true;
    $('content').hidden = false;
    initMap(countries, lakes);
    setEvent(data.events[0].id);
  } catch (err) {
    $('loading').textContent =
      'The observation snapshot could not be loaded. Please reload the page. ' + err.message;
    console.error(err);
  }
}
init();
