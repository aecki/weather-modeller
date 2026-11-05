export function compareYear(years, rows, selectedYear, months, current = null) {
  if (!Number.isInteger(months) || months < 1 || months > 12)
    return { unavailable: 'No complete month is available for this year yet.' };
  const total = (row) =>
    row && row.slice(0, months).length === months && row.slice(0, months).every(Number.isFinite)
      ? row.slice(0, months).reduce((a, b) => a + b, 0)
      : null;
  const index = years.indexOf(selectedYear);
  const amount = total(index < 0 ? current : rows[index]);
  if (amount == null)
    return { unavailable: 'The rainfall record is incomplete for this year and period.' };
  const reference = years.flatMap((year, i) => {
    const value = total(rows[i]);
    return year === selectedYear || value == null ? [] : [{ year, value }];
  });
  if (reference.length < 20)
    return { unavailable: 'At least 20 complete comparison years are needed.' };
  const values = reference.map((r) => r.value).sort((a, b) => a - b),
    mean = values.reduce((a, b) => a + b, 0) / values.length;
  const quantile = (p) => {
    const at = (values.length - 1) * p,
      lo = Math.floor(at);
    return values[lo] + (values[Math.ceil(at)] - values[lo]) * (at - lo);
  };
  // Each monthly total is stored at 0.1 mm. Honour possible ties at that precision.
  const tolerance = 0.1 * months;
  const rank = [
    1 + values.filter((v) => v < amount - tolerance).length,
    1 + values.filter((v) => v <= amount + tolerance).length,
  ];
  const closest = [...reference].sort(
    (a, b) => Math.abs(a.value - amount) - Math.abs(b.value - amount) || a.year - b.year,
  )[0];
  return {
    amount,
    mean,
    percent: mean > 0 ? 100 * (amount / mean - 1) : null,
    rank,
    reference,
    range: [quantile(0.1), quantile(0.9)],
    closest,
    months,
    selectedYear,
  };
}
