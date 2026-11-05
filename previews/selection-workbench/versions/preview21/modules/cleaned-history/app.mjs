import { createSyntheticHost } from './fixture.mjs';
import { mountHistory, mountHarness } from './view.mjs';
const host = createSyntheticHost();
const view = mountHistory(document.querySelector('#candidate'), host);
const lab = mountHarness(document.querySelector('#fixture'), host);
document.querySelector('[data-skip]').addEventListener('click', event => {
  event.preventDefault(); const target = document.querySelector('[data-results-heading]'); target.focus(); target.scrollIntoView({ block: 'start' });
});
window.addEventListener('pagehide', event => { if (!event.persisted) { view.destroy(); lab.destroy(); host.dispose(); } });
