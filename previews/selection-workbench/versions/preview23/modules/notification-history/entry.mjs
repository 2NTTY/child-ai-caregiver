import {installNetworkGuard} from './network-guard.mjs';
import {createHost} from './host.mjs';
import {mount} from './app.mjs';
const root=document.getElementById('app');
try{
 installNetworkGuard(window);
 root.dataset.network='blocked';
 const host=createHost(),view=mount(root,host);
 window.addEventListener('pagehide',event=>{if(!event.persisted){view.dispose();host.dispose()}},{once:true});
}catch{
 root.textContent='合成頁面的隔離保護未能建立，已停止啟動。';
}
