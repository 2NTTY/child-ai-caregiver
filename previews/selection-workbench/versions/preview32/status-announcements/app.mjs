import { createFixtureOwner } from './fixture-owner.mjs';
import { mountLive } from './live-adapter.mjs';
import { mountWorkbench } from './view.mjs';
const owner = createFixtureOwner();
const live = mountLive(document, document.querySelector('#announcements'), owner);
const view = mountWorkbench(document, document.querySelector('#workbench'), owner);
// Lifecycle is synchronous. No asynchronous focus, network, storage or speech API.
addEventListener('pagehide', event => {
  if (event.persisted) return; // A bfcache suspension is not a true teardown.
  view.dispose(); live.dispose(); owner.dispose();
});
