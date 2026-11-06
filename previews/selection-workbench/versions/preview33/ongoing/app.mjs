import { createOngoingFixture } from './fixture-owner.mjs';
import { mountOngoing } from './view.mjs';

export function startOngoing(document, owner=createOngoingFixture()) {
  const view=mountOngoing(document,owner), win=document.defaultView;
  const abort=new win.AbortController();let disposed=false;
  win.addEventListener('pagehide',()=>owner.retire(),{signal:abort.signal});
  win.addEventListener('pageshow',()=>owner.activate(),{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{document.hidden?owner.retire():owner.activate();},{signal:abort.signal});
  return {owner,dispose(){if(disposed)return;disposed=true;abort.abort();view.dispose();owner.retire();}};
}
if(typeof document!=='undefined')startOngoing(document);
