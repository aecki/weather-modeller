/** Stationary block-maxima models. Shape xi is the conventional GEV shape (=-SciPy c). */
export const MODEL_VERSION = 'annual-maxima-lmoments-v1';
export const MIN_YEARS = 20;
const EULER = 0.5772156649015329;
const LOG2 = Math.log(2);
const LOG3 = Math.log(3);

// Lanczos log-Gamma; only positive arguments are needed by the L-moment estimator.
export function logGamma(value) {
  if (!(value > 0)) throw Error('Gamma requires a positive argument.');
  if (value < 0.5)
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  const z = value - 1;
  let series = 0.9999999999998099;
  coefficients.forEach((coefficient, index) => {
    series += coefficient / (z + index + 1);
  });
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

export function sampleLMoments(values) {
  if (values.length < 3 || values.some((value) => !Number.isFinite(value)))
    throw Error('At least three finite maxima are required.');
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  sorted.forEach((value, index) => {
    b0 += value / n;
    b1 += ((index / (n - 1)) * value) / n;
    b2 += (((index * (index - 1)) / ((n - 1) * (n - 2))) * value) / n;
  });
  const l2 = 2 * b1 - b0,
    l3 = 6 * b2 - 6 * b1 + b0;
  if (!(l2 > 1e-10))
    throw Error('The maxima have too little variation to fit an extreme-value model.');
  return { l1: b0, l2, t3: l3 / l2 };
}
function theoreticalSkew(k) {
  return Math.abs(k) < 1e-9
    ? (2 * LOG3) / LOG2 - 3
    : (2 * Math.expm1(-k * LOG3)) / Math.expm1(-k * LOG2) - 3;
}
export function fitModel(values, model = 'gev') {
  if (!['gev', 'gumbel'].includes(model)) throw Error('Choose GEV or Gumbel.');
  const { l1, l2, t3 } = sampleLMoments(values);
  let xi = 0,
    scale = l2 / LOG2,
    location = l1 - EULER * scale;
  if (model === 'gev') {
    let low = -0.999999,
      high = 20;
    if (!(t3 < theoreticalSkew(low) && t3 > theoreticalSkew(high)))
      throw Error('The sample L-skewness is outside the supported GEV fitting range.');
    for (let iteration = 0; iteration < 80; iteration++) {
      const middle = (low + high) / 2;
      if (theoreticalSkew(middle) > t3) low = middle;
      else high = middle;
    }
    const k = (low + high) / 2;
    xi = -k;
    if (Math.abs(k) > 1e-7) {
      const lg = logGamma(1 + k);
      scale = (l2 * k) / (-Math.expm1(-k * LOG2) * Math.exp(lg));
      location = l1 + (scale * Math.expm1(lg)) / k;
    }
  }
  if (!(scale > 0) || ![xi, scale, location].every(Number.isFinite))
    throw Error('No valid model could be fitted.');
  const fit = { model, location, scale, xi };
  if (values.some((value) => 1 + (xi * (value - location)) / scale <= 0))
    throw Error(
      'The fitted GEV endpoint excludes an observed maximum. Try Gumbel or a longer fitting period.',
    );
  return fit;
}
export function returnLevel(fit, period) {
  if (!(period > 1) || !Number.isFinite(period))
    throw Error('Return periods must be finite and greater than one year.');
  const reduced = -Math.log(-Math.log1p(-1 / period));
  return (
    fit.location +
    fit.scale * (Math.abs(fit.xi) < 1e-7 ? reduced : Math.expm1(fit.xi * reduced) / fit.xi)
  );
}
export function annualExceedance(fit, rainfall) {
  if (!Number.isFinite(rainfall)) throw Error('Rainfall must be finite.');
  const z = (rainfall - fit.location) / fit.scale;
  let power;
  if (Math.abs(fit.xi) < 1e-7) power = Math.exp(-z);
  else {
    const support = 1 + fit.xi * z;
    if (support <= 0) return fit.xi < 0 ? 0 : 1;
    power = Math.exp(-Math.log1p(fit.xi * z) / fit.xi);
  }
  return Math.max(0, Math.min(1, -Math.expm1(-power)));
}
export function returnPeriod(fit, rainfall) {
  const probability = annualExceedance(fit, rainfall);
  return probability === 0 ? Infinity : 1 / probability;
}
export function atLeastOnce(probability, years) {
  if (!(probability >= 0 && probability <= 1) || !(Number.isInteger(years) && years >= 1))
    throw Error('Invalid annual probability or horizon.');
  return probability === 1 ? 1 : -Math.expm1(years * Math.log1p(-probability));
}
export function percentile(values, probability) {
  if (
    !values.length ||
    !(probability >= 0 && probability <= 1) ||
    values.some((value) => Number.isNaN(value))
  )
    return null;
  const sorted = [...values].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  const index = probability * (sorted.length - 1),
    lower = Math.floor(index),
    fraction = index - lower;
  if (fraction === 0) return sorted[lower];
  const a = sorted[lower],
    b = sorted[lower + 1];
  if (a === b) return a;
  if (!Number.isFinite(b)) return b;
  return a + fraction * (b - a);
}
export function interval(values, confidence = 0.95) {
  if (!(confidence > 0 && confidence < 1)) throw Error('Confidence must be between zero and one.');
  const alpha = (1 - confidence) / 2;
  return [percentile(values, alpha), percentile(values, 1 - alpha)];
}
export function seedFor(text) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function fitEnsemble(
  values,
  { model = 'gev', repetitions = 500, seed = 42 } = {},
  progress = () => {},
) {
  if (values.length < MIN_YEARS)
    throw Error(`Use at least ${MIN_YEARS} complete years; 30 or more is preferable.`);
  if (!Number.isInteger(repetitions) || repetitions < 100 || repetitions > 2000)
    throw Error('Use 100–2000 bootstrap resamples.');
  const fit = fitModel(values, model),
    random = randomGenerator(seed),
    fits = [];
  let failed = 0;
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    );
    try {
      fits.push(fitModel(sample, model));
    } catch {
      failed++;
    }
    if ((iteration + 1) % 100 === 0) progress((iteration + 1) / repetitions);
  }
  return {
    fit,
    fits,
    failed,
    repetitions,
    seed,
    intervalAvailable: fits.length >= 0.9 * repetitions,
    version: MODEL_VERSION,
  };
}
