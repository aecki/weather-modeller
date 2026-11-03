// Historical empirical frequencies; no fitted tail or future-event probability.
export function percentile(values, probability) {
  const a = [...values].sort((x, y) => x - y),
    position = (a.length - 1) * probability;
  const lo = Math.floor(position),
    hi = Math.ceil(position);
  return a[lo] + (a[hi] - a[lo]) * (position - lo);
}
export function seededIndices(years, repetitions, seedText) {
  let seed = 2166136261;
  for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  seed ||= 1;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  return Array.from({ length: repetitions }, () =>
    Array.from({ length: years }, () => Math.floor(random() * years)),
  );
}
export function findCell(cells, target) {
  let lo = 0,
    hi = cells.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cells[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return cells[lo] === target ? lo : -1;
}
export function referenceForCell(raw, manifest, localCell, month) {
  const levels = manifest.thresholds.length,
    years = manifest.years.length;
  const start = localCell * years * levels;
  if (start + years * levels > raw.length) throw new Error('Incomplete historical cell');
  return manifest.years.map((year, i) => {
    const counts = Array.from(raw.slice(start + i * levels, start + (i + 1) * levels));
    const expected = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      (counts[0] !== 0 && counts[0] !== expected) ||
      counts.some((n, j) => n > counts[0] || (j && n > counts[j - 1]))
    )
      throw new Error('Invalid historical counts');
    return { year, counts };
  });
}
export function compareHistory(rows, thresholds, amount, selectedDate, options = {}) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid selected rainfall');
  const selectedYear = Number(selectedDate.slice(0, 4));
  const valid = rows.filter((row) => row.year !== selectedYear && row.counts[0] > 0);
  if (valid.length < 20)
    return {
      unavailable:
        'Fewer than 20 complete historical years are available for this location and month.',
    };
  const index = (value) => thresholds.findIndex((t) => Math.abs(t - value) < 1e-7);
  const dry = amount < 1;
  let lo = thresholds.findLastIndex((t) => t <= amount),
    hi = thresholds.findIndex((t) => t >= amount);
  if (lo < 0) lo = 0;
  const exact = hi >= 0 && thresholds[hi] === amount;
  if (exact) lo = hi;
  const bounds = valid.map((row) =>
    dry
      ? [row.counts[0] - row.counts[index(1)], row.counts[0] - row.counts[index(1)], row.counts[0]]
      : [hi < 0 ? 0 : row.counts[hi], row.counts[lo], row.counts[0]],
  );
  const total = bounds.reduce((n, row) => n + row[2], 0);
  const lowerCount = bounds.reduce((n, row) => n + row[0], 0),
    upperCount = bounds.reduce((n, row) => n + row[1], 0);
  const enough = (values) =>
    values.filter((r) => r[0] > 0).length >= 5 && values.filter((r) => r[1] < r[2]).length >= 5;
  const resamples =
    options.resamples ||
    seededIndices(valid.length, options.repetitions || 1000, options.seed || 'regional-history-v1');
  const intervals = (values) => {
    if (!enough(values)) return null;
    const lower = [],
      upper = [];
    for (const sample of resamples) {
      let a = 0,
        b = 0,
        n = 0;
      for (const i of sample) {
        a += values[i][0];
        b += values[i][1];
        n += values[i][2];
      }
      lower.push(a / n);
      upper.push(b / n);
    }
    return [percentile(lower, 0.025), percentile(upper, 0.975)];
  };
  const groups = [
    { label: 'Under 1 mm', lo: null, hi: 1 },
    { label: '1 to under 10', lo: 1, hi: 10 },
    { label: '10 to under 20', lo: 10, hi: 20 },
    { label: '20 to under 50', lo: 20, hi: 50 },
    { label: '50 mm or more', lo: 50, hi: null },
  ];
  const bands = groups.map((group) => {
    const counts = valid.map((row) => {
      const n =
        (group.lo === null ? row.counts[0] : row.counts[index(group.lo)]) -
        (group.hi === null ? 0 : row.counts[index(group.hi)]);
      return [n, n, row.counts[0]];
    });
    return {
      label: group.label,
      share: counts.reduce((n, row) => n + row[0], 0) / total,
      interval: intervals(counts),
      selected:
        (group.lo === null || amount >= group.lo) && (group.hi === null || amount < group.hi),
    };
  });
  return {
    dry,
    yearCount: valid.length,
    total,
    lowerCount,
    upperCount,
    share: [lowerCount / total, upperCount / total],
    estimate: (lowerCount + upperCount) / (2 * total),
    interval: intervals(bounds),
    lowerThreshold: thresholds[lo],
    upperThreshold: hi < 0 ? null : thresholds[hi],
    excludedSelectedYear: rows.some((row) => row.year === selectedYear),
    bands,
  };
}
