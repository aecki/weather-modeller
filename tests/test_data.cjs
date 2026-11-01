const assert = require('node:assert/strict');
const fs = require('node:fs');
const { rolling, peak, annualMaxima } = require('../web/data-core.js');
assert.deepEqual(rolling([0, 2, null, 4, 5, 6], 3), [null, null, null, null, null, 15]);
assert.deepEqual(rolling([0, 0, 0], 3), [null, null, 0]);
assert.deepEqual(peak([null, 0, 9, 1], 0, 2), { index: 2, value: 9 });
assert.equal(peak([null, null], 0, 1), null);
const dates = Array.from({ length: 731 }, (_, i) =>
  new Date(Date.UTC(2019, 0, 1 + i)).toISOString().slice(0, 10),
);
const values = dates.map(() => 1);
values[364] = 100;
values[365] = 100;
const maxima = annualMaxima(dates, values, rolling(values, 3), 3);
assert.equal(maxima.length, 2);
assert.equal(maxima[0].value, 102); // cross-year 201 cannot leak in
values[100] = null;
assert.equal(annualMaxima(dates, values, rolling(values, 3), 3).length, 1);
const d = JSON.parse(
  fs.readFileSync(require('node:path').join(__dirname, '../data/processed/observations.json')),
);
assert.equal(d.stations.length, 18);
assert.equal(d.rivers.length, 6);
assert.equal(d.dates.length, 16436);
assert.equal(d.dates[0], '1981-01-01');
assert.equal(d.dates.at(-1), '2025-12-31');
for (const s of d.stations) {
  assert.equal(s.values.length, d.dates.length);
  assert.ok(s.values.every((v) => v === null || (Number.isFinite(v) && v >= 0)));
  for (const days of [1, 3, 5]) {
    const r = rolling(s.values, days);
    for (const e of d.events) {
      const p = peak(r, d.dates.indexOf(e.start), d.dates.indexOf(e.end));
      assert.ok(p);
      assert.ok(p.value >= 0);
    }
  }
}
let means = 0;
for (const r of d.rivers)
  for (const e of d.events) {
    for (const row of r.events[e.id]) {
      if (row.value === null) continue;
      const a = Date.parse(row.timestamp),
        b = a + 86400000;
      const group = r.hourly[e.id].filter(
        (h) => Date.parse(h.timestamp) >= a && Date.parse(h.timestamp) < b,
      );
      assert.equal(group.length, 24);
      assert.equal(new Set(group.map((h) => h.timestamp)).size, 24);
      const mean = group.reduce((t, h) => t + h.value, 0) / 24;
      assert.ok(Math.abs(mean - row.value) < 0.00051);
      means++;
    }
  }
assert.ok(means > 200);
console.log(
  `Passed: missing values, zero rainfall, leap years, cross-year windows, all station arrays, event peaks and ${means} river means verified against hourly observations.`,
);
