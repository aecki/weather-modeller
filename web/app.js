'use strict';
// Keep each workspace mounted: navigation must not discard selections or analysis state.
let networkStarted = false;
const remembered = {
  rainfall: { overview: '#rainfall', pro: '#rainfall-pro' },
  water: { overview: '#water-levels', pro: '#water-recovery' },
};
function applyMode() {
  const route = LabGraphics.route(location.hash);
  if (route.hash !== location.hash) history.replaceState(null, '', route.hash);
  remembered[route.section][route.mode] = route.hash;
  document.body.dataset.mode = route.mode;
  document.body.dataset.section = route.section;
  document.body.dataset.analysis = route.analysis;
  for (const section of ['rainfall', 'water']) {
    const link = document.getElementById(section + '-section');
    link.href = remembered[section][route.mode];
    link.toggleAttribute('aria-current', section === route.section);
    if (section === route.section) link.setAttribute('aria-current', 'page');
  }
  for (const mode of ['overview', 'pro']) {
    const link = document.getElementById(mode + '-mode');
    link.href = remembered[route.section][mode];
    link.removeAttribute('aria-current');
    if (mode === route.mode) link.setAttribute('aria-current', 'page');
  }
  for (const link of document.querySelectorAll('.rain-source-nav a')) {
    link.removeAttribute('aria-current');
    if ((link.hash === '#rainfall-stations') === (route.analysis === 'network'))
      link.setAttribute('aria-current', 'page');
  }
  document.getElementById('regional-daily').hidden =
    route.section !== 'rainfall' || route.analysis === 'network';
  document.getElementById('station-network').hidden =
    route.section !== 'rainfall' || route.analysis !== 'network';
  document.getElementById('water-workspace').hidden = route.section !== 'water';
  if (route.section === 'rainfall') {
    if (route.analysis === 'address') LabGraphics.daily({ mode: route.mode });
    if (route.analysis === 'network' && !networkStarted) {
      networkStarted = true;
      LabGraphics.network();
    }
  }
  if (route.section === 'water') {
    LabGraphics.water({ mode: route.mode, panel: route.panel });
  }
  if (
    [
      '#rainfall',
      '#rainfall-pro',
      '#rainfall-stations',
      '#water-levels',
      '#water-pro',
      '#water-recovery',
      '#water-validation',
    ].includes(route.hash)
  )
    window.scrollTo(0, 0);
}
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  const workspace = document.getElementById('workspace');
  workspace.focus();
  workspace.scrollIntoView({ behavior: 'instant' });
});
window.addEventListener('hashchange', applyMode);
applyMode();
