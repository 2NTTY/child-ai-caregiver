import {installTransportTripwire} from './transport-tripwire.mjs';
const network=installTransportTripwire(globalThis);
const [{createHost},{mountReading},{makeFixture,scriptedPage}]=await Promise.all([import('./host.mjs'),import('./view.mjs'),import('./fixtures.mjs')]);
const root=document.querySelector('#app');let scope='a';
const host=createHost(makeFixture(scope));const view=mountReading(root,host);
const lab=document.querySelector('#fixture-lab'),status=document.querySelector('#fixture-status');
let actions=[...lab.querySelectorAll('button[data-settle]')],displayedTicket=null;
function update(snapshot){
 if(snapshot.pending&&snapshot.pending!==displayedTicket){
  displayedTicket=snapshot.pending;const ticket=displayedTicket;
  actions=actions.map(old=>{const button=old.cloneNode(true);old.replaceWith(button);button.addEventListener('click',()=>{const live=host.getSnapshot();if(button.isConnected&&live.pending===ticket&&host.isCurrent(ticket.binding))host.settle(ticket,scriptedPage(live,button.dataset.settle));});return button;});
 }
 status.textContent=snapshot.pending?'有一個合成讀取等待接納。可選正常結果、沒有進展或失敗。':'示例控制台 · 所有操作只在這一頁的記憶體內生效。';
 actions.forEach(b=>b.setAttribute('aria-disabled',String(!snapshot.pending)));
 document.querySelector('#offline').textContent=snapshot.online?'切換離線示例':'恢復線上示例';
 if(snapshot.pending)lab.open=true;
}
host.subscribe(update);update(host.getSnapshot());
document.querySelector('#offline').addEventListener('click',()=>host.setOnline(!host.getSnapshot().online));
document.querySelector('#switch-scope').addEventListener('click',()=>{scope=scope==='a'?'b':'a';host.replaceContext(makeFixture(scope));});
document.querySelector('#revoke').addEventListener('click',()=>host.revoke());
document.querySelector('#reset').addEventListener('click',()=>host.replaceContext(makeFixture(scope)));
document.querySelector('#cursor-empty').addEventListener('click',()=>host.replaceContext(makeFixture(scope,'cursor-empty')));
document.querySelector('#empty').addEventListener('click',()=>host.replaceContext(makeFixture(scope,'empty')));
document.querySelector('#not-loaded').addEventListener('click',()=>host.replaceContext(makeFixture(scope,'not-loaded')));
document.querySelector('#skip').addEventListener('click',event=>{event.preventDefault();document.querySelector('#reader-scroll').focus();});
Object.defineProperty(globalThis,'CH01',{value:Object.freeze({host,view,makeFixture,scriptedPage,network}),writable:false});

if(new URL(document.URL).searchParams.get('ia')==='atlas')document.querySelector('#mode-atlas').click();
