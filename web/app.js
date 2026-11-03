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
  mapResetCount = 0,
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
  LabGraphics.rankings({
    rows: annual.slice(0, 5).map((row) => ({
      id: row.year,
      label: row.year,
      detail: dateLabel(row.date),
      value: row.value,
    })),
  });
  $('compare-duration').textContent = `${days}-day`;
  LabGraphics.comparisons({
    rows: data.events.map((entry) => ({
      id: entry.id,
      label: entry.id,
      value: eventPeak(entry)?.value ?? null,
    })),
    selectedId: event.id,
  });
  LabGraphics.modelLab({
    dates: data.dates,
    annual,
    station,
    stations: data.stations,
    days,
    event,
    eventPeak: peak,
    historyStart: data.historyStart,
    historyEnd: data.historyEnd,
    onStation: setStation,
    onDuration: setDuration,
  });
  updateCursor();
}
function setDuration(value) {
  days = value;
  document.querySelectorAll('#durations button').forEach((button) => {
    const active = +button.dataset.days === days;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  updateAnalysis();
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
  const first = Math.max(0, i - days + 1);
  LabGraphics.explanation({
    samples: data.dates
      .slice(first, i + 1)
      .map((date, index) => ({ date, value: station.values[first + index] })),
    total: rolled[i],
    days,
    stationName: station.name,
    ending: date,
  });
}
function resetMap() {
  mapResetCount++;
  updateMap();
}
function updateMap() {
  if (!data) return;
  LabGraphics.map({
    stations: data.stations.map((entry) => ({ ...entry, value: series(entry)[indices[cursor]] })),
    selected: station.id,
    onSelect: setStation,
    resetCount: mapResetCount,
  });
}
function selectDay(index) {
  cursor = index;
  updateCursor();
}
function rainChart() {
  LabGraphics.rainfall({
    dates,
    values: indices.map((index) => station.values[index]),
    cursor,
    label: `Daily rainfall at ${station.name}`,
    onSelect: selectDay,
  });
}
function riverChart() {
  const byDate = new Map(
    (river.events[event.id] || []).map((row) => [row.timestamp.slice(0, 10), row]),
  );
  LabGraphics.river({
    dates,
    values: dates.map((date) => byDate.get(date)?.value ?? null),
    releaseStates: dates.map((date) => byDate.get(date)?.releaseState ?? ''),
    cursor,
    label: `24-hour mean discharge at ${river.name}`,
    onSelect: selectDay,
  });
}
async function exportSelection() {
  const button = $('export');
  button.disabled = true;
  $('export-status').textContent = 'Preparing download…';
  try {
    const result = DataCore.selectionCSV(data, {
      event: event.id,
      station: station.id,
      river: river.id,
      days,
    });
    const blob = new Blob(['\uFEFF' + result.content], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = result.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $('export-status').textContent = 'CSV download prepared from the selected observations.';
  } catch (error) {
    $('export-status').textContent = 'Could not save selection: ' + error.message;
  } finally {
    button.disabled = false;
  }
}
let proStarted = false;
function applyMode() {
  const pro = [
    '#pro',
    '#pro-daily',
    '#station-lab',
    '#model-lab',
    '#model-comparison',
    '#how-it-works',
    '#explorer',
  ].includes(location.hash);
  const stationMode = [
    '#station-lab',
    '#model-lab',
    '#model-comparison',
    '#how-it-works',
    '#explorer',
  ].includes(location.hash);
  document.body.dataset.mode = pro ? 'pro' : 'overview';
  document.body.dataset.analysis = stationMode ? 'station' : 'address';
  $('overview-mode').toggleAttribute('aria-current', !pro);
  $('pro-mode').toggleAttribute('aria-current', pro);
  (pro ? $('pro-mode') : $('overview-mode')).setAttribute('aria-current', 'page');
  LabGraphics.daily({ mode: pro ? 'pro' : 'overview' });
  if (!pro && playing) stop();
  if (stationMode && !proStarted) {
    proStarted = true;
    init();
  }
  if (['#overview', '#pro', ''].includes(location.hash)) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', applyMode);
async function init() {
  try {
    const urls = ['data/observations.json'];
    const responses = await Promise.all(urls.map((url) => fetch(url)));
    for (const res of responses) if (!res.ok) throw Error('HTTP ' + res.status);
    const [observations] = await Promise.all(responses.map((res) => res.json()));
    data = observations;
    $('export').textContent = '↓ Download selection CSV';
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
      setDuration(+b.dataset.days);
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
    setEvent(data.events[0].id);
    if (
      ['#station-lab', '#how-it-works', '#model-lab', '#model-comparison'].includes(location.hash)
    )
      document.querySelector(location.hash).scrollIntoView({ behavior: 'instant' });
  } catch (err) {
    $('loading').textContent =
      'The observation snapshot could not be loaded. Please reload the page. ' + err.message;
    console.error(err);
  }
}
applyMode();
