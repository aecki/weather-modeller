const aliases = new Map([
  ['#overview', '#rainfall'],
  ['#pro', '#rainfall-pro'],
  ['#network', '#rainfall-stations'],
  ['#station-lab', '#rainfall-stations'],
  ['#model-lab', '#rainfall-stations'],
  ['#model-comparison', '#network-comparison'],
  ['#how-it-works', '#network-methods'],
  ['#explorer', '#rainfall-stations'],
  ['#pro-daily', '#rainfall-pro'],
  ['#lake-levels', '#water-levels'],
  ['#water-current', '#water-levels'],
  ['#water-outlook', '#water-levels'],
  ['#water-history', '#water-levels'],
]);
export function routeForHash(hash) {
  const canonical = aliases.get(hash) || hash || '#rainfall';
  const water = ['#water-levels', '#water-pro', '#water-recovery', '#water-validation'].includes(
    canonical,
  );
  const network = ['#rainfall-stations', '#network-comparison', '#network-methods'].includes(
    canonical,
  );
  return {
    hash: canonical,
    section: water ? 'water' : 'rainfall',
    mode:
      network ||
      ['#rainfall-pro', '#water-pro', '#water-recovery', '#water-validation'].includes(canonical)
        ? 'pro'
        : 'overview',
    analysis: network ? 'network' : 'address',
    panel:
      canonical === '#water-validation'
        ? 'validation'
        : canonical === '#water-recovery'
          ? 'recovery'
          : 'records',
  };
}
