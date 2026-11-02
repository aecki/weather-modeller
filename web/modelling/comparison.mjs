/** Training-only storm fits and forward holdout validation. No synthetic rainfall. */
import {
  fitModel,
  sampleLMoments,
  returnLevel,
  annualExceedance,
  percentile,
  seedFor,
} from './extremes.mjs';
export const COMPARISON_VERSION = 'swiss-storm-comparison-v1';
export const MODELS = ['gev', 'gumbel', 'gpd', 'smev'];
export const LABELS = { gev: 'GEV', gumbel: 'Gumbel', gpd: 'GPD', smev: 'SMEV' };

export function extractBlocks(dates, values, days = 1, dryGap = days) {
  if (![1, 3, 5].includes(days) || !Number.isInteger(dryGap) || dryGap < days)
    throw Error('Storm separation must be at least the rainfall duration.');
  if (dates.length !== values.length) throw Error('Dates and observations must align.');
  const groups = new Map();
  dates.forEach((date, i) => {
    const year = date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push({ date, value: values[i] });
  });
  const blocks = [];
  for (const [year, rows] of groups) {
    const leap = new Date(Date.UTC(+year, 1, 29)).getUTCMonth() === 1;
    if (
      rows.length !== (leap ? 366 : 365) ||
      rows[0].date !== `${year}-01-01` ||
      rows.at(-1).date !== `${year}-12-31` ||
      rows.some(
        (r, i) =>
          !Number.isFinite(r.value) ||
          r.value < 0 ||
          (i && Date.parse(r.date) - Date.parse(rows[i - 1].date) !== 86400000),
      )
    )
      continue;
    const totals = rows.map((_, i) =>
      i < days - 1 ? null : rows.slice(i - days + 1, i + 1).reduce((s, r) => s + r.value, 0),
    );
    const clusters = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].value < 1) continue;
      const last = clusters.at(-1);
      if (last && i - last.end - 1 < dryGap) last.end = i;
      else clusters.push({ start: i, end: i });
    }
    const peaks = [];
    for (const cluster of clusters) {
      let end = Math.max(days - 1, cluster.start);
      for (let i = end; i <= Math.min(rows.length - 1, cluster.end + days - 1); i++)
        if (totals[i] > totals[end]) end = i;
      let peak = { value: totals[end], start: end - days + 1, end };
      // Adjacent selected accumulation windows cannot count as separate events if they overlap.
      while (peaks.length && peak.start <= peaks.at(-1).end) {
        const previous = peaks.pop();
        if (previous.value >= peak.value) peak = previous;
      }
      peaks.push(peak);
    }
    blocks.push({
      year,
      maximum: Math.round(Math.max(...totals.filter(Number.isFinite)) * 10) / 10,
      events: peaks.map((p) => Math.round(p.value * 10) / 10),
      windows: peaks.map((p) => [rows[p.start].date, rows[p.end].date]),
      boundaryStorms: clusters.filter((c) => c.start < dryGap || c.end >= rows.length - dryGap)
        .length,
    });
  }
  return blocks.sort((a, b) => a.year.localeCompare(b.year));
}

export function fitStormModel(blocks, model, options = {}) {
  if (!MODELS.includes(model)) throw Error('Unknown comparison model.');
  const maxima = blocks.map((b) => b.maximum);
  if (model === 'gev' || model === 'gumbel') return fitModel(maxima, model);
  const values = blocks.flatMap((b) => b.events).sort((a, b) => a - b);
  if (values.length < 40) throw Error('At least 40 separated ordinary events are required.');
  if (model === 'gpd') {
    const q = options.tailQuantile ?? 0.9;
    if (!(q >= 0.8 && q <= 0.975)) throw Error('GPD threshold quantile must be 80–97.5%.');
    const threshold = percentile(values, q);
    const excesses = values.filter((x) => x > threshold).map((x) => x - threshold);
    if (excesses.length < 20)
      throw Error(
        'Fewer than 20 GPD threshold exceedances. Lower the threshold or use more training years.',
      );
    const { l1, l2 } = sampleLMoments(excesses);
    const xi = 2 - l1 / l2,
      scale = l1 * (1 - xi);
    if (!(scale > 0) || !Number.isFinite(xi) || excesses.some((x) => 1 + (xi * x) / scale <= 0))
      throw Error('Invalid GPD fit or endpoint excludes an observed excess.');
    return {
      model,
      threshold,
      scale,
      xi,
      rate: excesses.length / blocks.length,
      tailCount: excesses.length,
      eventCount: values.length,
    };
  }
  const censor = options.censor ?? 0.8;
  if (!(censor >= 0.5 && censor <= 0.95)) throw Error('SMEV left-censoring must be 50–95%.');
  const tail = values
    .map((x, i) => ({
      x: Math.log(x),
      y: Math.log(-Math.log1p(-(i + 1) / (values.length + 1))),
      p: (i + 1) / (values.length + 1),
    }))
    .filter((p) => p.p >= censor);
  if (tail.length < 20)
    throw Error(
      'Fewer than 20 SMEV tail events. Reduce left-censoring or use more training years.',
    );
  const mx = tail.reduce((s, p) => s + p.x, 0) / tail.length,
    my = tail.reduce((s, p) => s + p.y, 0) / tail.length;
  const shape =
    tail.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) /
    tail.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const scale = Math.exp(mx - my / shape);
  if (!(shape > 0 && scale > 0) || ![shape, scale].every(Number.isFinite))
    throw Error('Invalid SMEV Weibull tail regression.');
  return {
    model,
    shape,
    scale,
    rate: values.length / blocks.length,
    tailCount: tail.length,
    eventCount: values.length,
    censor,
  };
}
export function modelLevel(fit, period) {
  if (!Number.isFinite(period) || period <= 1) throw Error('Return period must exceed one year.');
  if (fit.model === 'gev' || fit.model === 'gumbel') return returnLevel(fit, period);
  if (fit.model === 'gpd') {
    const survival = -Math.log1p(-1 / period) / fit.rate;
    if (survival > 1) return null; // The GPD only specifies the tail above its fitted threshold.
    return (
      fit.threshold +
      fit.scale *
        (Math.abs(fit.xi) < 1e-7
          ? -Math.log(survival)
          : Math.expm1(-fit.xi * Math.log(survival)) / fit.xi)
    );
  }
  return (
    fit.scale * Math.pow(-Math.log(-Math.expm1(Math.log1p(-1 / period) / fit.rate)), 1 / fit.shape)
  );
}
export function modelProbability(fit, amount) {
  if (!Number.isFinite(amount)) throw Error('Rainfall must be finite.');
  if (fit.model === 'gev' || fit.model === 'gumbel') return annualExceedance(fit, amount);
  if (fit.model === 'gpd') {
    if (amount < fit.threshold) return null;
    const z = (amount - fit.threshold) / fit.scale;
    const support = 1 + fit.xi * z;
    const sf =
      support <= 0
        ? 0
        : Math.abs(fit.xi) < 1e-7
          ? Math.exp(-z)
          : Math.exp(-Math.log1p(fit.xi * z) / fit.xi);
    return -Math.expm1(-fit.rate * sf);
  }
  if (amount <= 0) return 1;
  const power = Math.pow(amount / fit.scale, fit.shape);
  return -Math.expm1(fit.rate * Math.log(-Math.expm1(-power)));
}
export function validationScores(fit, heldout, threshold) {
  const probability = modelProbability(fit, threshold),
    level = modelLevel(fit, 10);
  const brier =
    probability === null
      ? null
      : heldout.reduce((s, b) => s + (probability - +(b.maximum > threshold)) ** 2, 0) /
        heldout.length;
  const pinball =
    level === null
      ? null
      : heldout.reduce((s, b) => {
          const d = b.maximum - level;
          return s + d * (0.9 - +(d < 0));
        }, 0) / heldout.length;
  return { probability, brier, pinball };
}
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function compareModels(blocks, options = {}, progress = () => {}) {
  const { holdout = 10, repetitions = 500 } = options;
  if (!Number.isInteger(holdout) || holdout < 5 || blocks.length - holdout < 20)
    throw Error(
      'Reserve at least 5 held-out years and 20 training years. Extend the selected record or reduce the holdout.',
    );
  if (!Number.isInteger(repetitions) || repetitions < 100 || repetitions > 1000)
    throw Error('Use 100–1000 paired year resamples.');
  const ordered = [...blocks].sort((a, b) => a.year.localeCompare(b.year));
  if (new Set(ordered.map((b) => b.year)).size !== ordered.length)
    throw Error('Year blocks must be unique before splitting.');
  const training = ordered
      .slice(0, -holdout)
      .filter((b) => String(b.year) !== String(options.excludeTrainingYear)),
    test = ordered.slice(-holdout),
    fits = {};
  if (training.length < 20)
    throw Error('At least 20 training years must remain after excluding the replay year.');
  for (const model of MODELS) {
    try {
      fits[model] = { fit: fitStormModel(training, model, options), samples: [] };
    } catch (error) {
      fits[model] = { error: error.message, samples: [] };
    }
  }
  const baseThreshold = percentile(
    training.map((b) => b.maximum),
    0.8,
  );
  const scoreThreshold = Math.max(baseThreshold, fits.gpd.fit?.threshold ?? 0);
  for (const model of MODELS)
    if (fits[model].fit)
      fits[model].scores = validationScores(fits[model].fit, test, scoreThreshold);
  const seed =
    options.seed ??
    seedFor(
      JSON.stringify([
        COMPARISON_VERSION,
        options.context ?? '',
        holdout,
        options.tailQuantile ?? 0.9,
        options.censor ?? 0.8,
        repetitions,
        training.map((b) => [b.year, b.maximum, b.events]),
      ]),
    );
  const random = generator(seed);
  for (let i = 0; i < repetitions; i++) {
    const sampled = Array.from(
      { length: training.length },
      () => training[Math.floor(random() * training.length)],
    );
    const testSample = Array.from(
      { length: test.length },
      () => test[Math.floor(random() * test.length)],
    );
    for (const model of MODELS) {
      let row = null;
      if (!fits[model].error)
        try {
          const fit = fitStormModel(sampled, model, options);
          row = { fit, scores: validationScores(fit, testSample, scoreThreshold) };
        } catch {
          /* retain the paired slot as a failed fit */
        }
      fits[model].samples.push(row);
    }
    if ((i + 1) % 25 === 0) progress((i + 1) / repetitions);
  }
  return {
    version: COMPARISON_VERSION,
    fits,
    training,
    test,
    scoreThreshold,
    seed,
    repetitions,
    observedExceedances: test.filter((b) => b.maximum > scoreThreshold).length,
  };
}
// Keep infinities when meaningful; unsupported GPD body estimates are null, never zero.
export function comparisonInterval(result, values, confidence = 0.95) {
  const valid = values.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (valid.length < 0.9 * result.repetitions) return null;
  return [percentile(valid, (1 - confidence) / 2), percentile(valid, 1 - (1 - confidence) / 2)];
}

// Observed holdout frequency is especially uncertain when only 0–1 events occurred.
export function observedRateInterval(count, years, confidence = 0.95) {
  if (
    !Number.isInteger(count) ||
    !Number.isInteger(years) ||
    years <= 0 ||
    count < 0 ||
    count > years
  )
    throw Error('Invalid observed count.');
  const z = { 80: 1.2815515655446004, 90: 1.6448536269514722, 95: 1.959963984540054 }[
    Math.round(confidence * 100)
  ];
  if (!z) throw Error('Use an 80%, 90% or 95% Wilson interval.');
  const p = count / years,
    denominator = 1 + (z * z) / years;
  const centre = (p + (z * z) / (2 * years)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / years + (z * z) / (4 * years * years))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
