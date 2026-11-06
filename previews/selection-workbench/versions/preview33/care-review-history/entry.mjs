import {installIsolation} from './isolation.mjs';
const isolation=installIsolation(window);
const [{createHost},{mount},{makeInput}]=await Promise.all([import('./host.mjs'),import('./view.mjs'),import('./fixtures.mjs')]);
const root=window.document.querySelector('#app');
const host=createHost({input:makeInput(),readPort:async ticket=>{
 const next=makeInput();next.model.list.activeQuery=ticket.ownerQuery;next.model.list.activeKind=ticket.ownerKind;
 return {model:next.model};
}});
const view=mount(root,host);
const diagnostic=window.document.querySelector('#crh-isolation');
if(diagnostic)diagnostic.textContent=`合成隔離已啟用 · 網絡嘗試 ${isolation.snapshot().networkAttempts} · 儲存嘗試 ${isolation.snapshot().storageAttempts}`;
const page=window;
export function dispose(){page.removeEventListener('pagehide',dispose);view.dispose();host.dispose();}
page.addEventListener('pagehide',dispose,{once:true});
