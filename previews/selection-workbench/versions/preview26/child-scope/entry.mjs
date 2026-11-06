import {createHost} from './host.mjs';
import {mount} from './view.mjs';
const host=createHost();
const view=mount(document.querySelector('#app'),host);
window.addEventListener('pagehide',()=>{view.destroy();host.dispose();},{once:true});
