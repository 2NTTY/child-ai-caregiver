import { createQuickFixture } from './fixture-owner.mjs';
import { mountQuickApp } from './view.mjs';
const owner = createQuickFixture();
const view = mountQuickApp(document, document.querySelector('#qk'), owner);
// Cached pages keep one owner and listeners. Every hide retires older UI intents.
function hide(event) {
  view.retire();
  if (!event.persisted) { window.removeEventListener('pagehide', hide); view.dispose(); }
}
window.addEventListener('pagehide', hide);
