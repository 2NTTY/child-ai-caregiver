import {createHost} from './host.mjs';
import {mountApp} from './app.mjs';
import {INITIAL_CONTEXT,INITIAL_PREFERENCES} from './fixtures.mjs';
const root=document.getElementById('app');
const host=createHost({context:INITIAL_CONTEXT,preferences:INITIAL_PREFERENCES});
const app=mountApp(root,host);
// pagehide does not persist or resend anything. This page has no external writer.
addEventListener('pagehide',event=>{if(!event.persisted){app.dispose();host.dispose();}},{once:true});
