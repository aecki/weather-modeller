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
  const api = { rolling, peak, annualMaxima };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DataCore = api;
})(globalThis);
