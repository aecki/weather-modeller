/* Shared numerical routines. Null observations never become dry days. */
(function (root) {
  'use strict';
  function rolling(values, days) {
    return values.map((v, i) => {
      if (i < days - 1) return null;
      let sum = 0;
      for (let j = i - days + 1; j <= i; j++) {
        if (!Number.isFinite(values[j])) return null;
        sum += values[j];
      }
      return Math.round(sum * 10) / 10;
    });
  }
  function peak(values, start, end) {
    let result = null;
    for (let i = start; i <= end; i++)
      if (Number.isFinite(values[i]) && (!result || values[i] > result.value))
        result = { index: i, value: values[i] };
    return result;
  }
  function annualMaxima(dates, raw, rolled, days) {
    const groups = new Map();
    dates.forEach((d, i) => {
      const y = d.slice(0, 4);
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(i);
    });
    const result = [];
    for (const [year, indices] of groups) {
      const y = +year;
      const expected = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365;
      if (indices.length !== expected || indices.some((i) => !Number.isFinite(raw[i]))) continue;
      const p = peak(rolled, indices[0] + days - 1, indices.at(-1));
      if (p) result.push({ ...p, year, date: dates[p.index] });
    }
    return result.sort((a, b) => b.value - a.value);
  }
  function selectionCSV(snapshot, selection) {
    const event = snapshot.events.find((entry) => entry.id === selection.event);
    const station = snapshot.stations.find((entry) => entry.id === selection.station);
    const river = snapshot.rivers.find((entry) => entry.id === selection.river);
    if (!event || !station || !river || ![1, 3, 5].includes(selection.days))
      throw Error('Invalid observation selection');
    const rolled = rolling(station.values, selection.days);
    const discharge = new Map(
      river.events[event.id].map((row) => [row.timestamp.slice(0, 10), row]),
    );
    const rows = [
      [
        'date',
        'rain_station',
        'rain_daily_mm',
        `rain_trailing_${selection.days}day_mm`,
        'rain_interval_utc',
        'river_station',
        'river_name',
        'river_derived_24hour_mean_m3s',
        'river_release_state',
        'river_interval_utc',
      ],
    ];
    snapshot.dates.forEach((date, index) => {
      if (date < event.start || date > event.end) return;
      const record = discharge.get(date);
      rows.push([
        date,
        station.id,
        station.values[index],
        rolled[index],
        '06:00 to next day 06:00',
        river.id,
        river.river,
        record?.value,
        record?.releaseState,
        '06:00 to next day 06:00',
      ]);
    });
    const quote = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    return {
      filename: `swiss-observations-${event.id}-${station.id}-${river.id}-${selection.days}day.csv`,
      content: rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n',
    };
  }
  const api = { rolling, peak, annualMaxima, selectionCSV };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DataCore = api;
})(globalThis);
