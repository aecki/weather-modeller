const aliases = new Map([
  ['#station-lab', '#network'],
  ['#model-lab', '#network'],
  ['#model-comparison', '#network-comparison'],
  ['#how-it-works', '#network-methods'],
  ['#explorer', '#network'],
  ['#pro-daily', '#pro'],
]);
export function routeForHash(hash) {
  const canonical = aliases.get(hash) || hash || '#overview';
  const network = ['#network', '#network-comparison', '#network-methods'].includes(canonical);
  return {
    hash: canonical,
    mode: network || canonical === '#pro' ? 'pro' : 'overview',
    analysis: network ? 'network' : 'address',
  };
}
