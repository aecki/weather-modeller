'use strict';
// One address analysis and one complete station workspace. Legacy URLs stay usable.
let networkStarted = false;
function applyMode() {
  const route = LabGraphics.route(location.hash);
  if (route.hash !== location.hash) history.replaceState(null, '', route.hash);
  document.body.dataset.mode = route.mode;
  document.body.dataset.analysis = route.analysis;
  const overview = document.getElementById('overview-mode');
  const pro = document.getElementById('pro-mode');
  overview.removeAttribute('aria-current');
  pro.removeAttribute('aria-current');
  (route.mode === 'overview' ? overview : pro).setAttribute('aria-current', 'page');
  for (const link of document.querySelectorAll('.pro-nav a')) {
    link.removeAttribute('aria-current');
    if ((link.hash === '#network') === (route.analysis === 'network'))
      link.setAttribute('aria-current', 'page');
  }
  LabGraphics.daily({ mode: route.mode });
  if (route.analysis === 'network' && !networkStarted) {
    networkStarted = true;
    LabGraphics.network();
  }
  if (['#overview', '#pro', '#network'].includes(route.hash)) window.scrollTo(0, 0);
}
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  const workspace = document.getElementById('workspace');
  workspace.focus();
  workspace.scrollIntoView({ behavior: 'instant' });
});
window.addEventListener('hashchange', applyMode);
applyMode();
