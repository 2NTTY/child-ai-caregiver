import { mountLab } from './lab.mjs';
const lab = mountLab(document);
function onPageHide(event) {
  // A bfcache page may return with this exact DOM. Do not leave it inert.
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  lab.dispose();
}
window.addEventListener('pagehide', onPageHide);
