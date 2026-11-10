import {mountRecipeHandoff} from './recipe-handoff.mjs';
import {createObservationSession} from './session.mjs';
import {catalog} from './catalog.mjs';
import {replaceComparison,visualOrder,routeAvailability} from './host-actions.mjs';
const get=id=>document.getElementById(id), sides=['left','right'];
const sessions=new Map(), panels=get('panels');let swapped=false,everMounted=false;
const recipeHandoff=mountRecipeHandoff(get('recipe-handoff'),document),tasksReady={left:false,right:false};
const caseForRoute=route=>catalog.routeSupport[route]?.caseKey??'ready';
const pages={index:'首頁',tasks:'待辦',care:'照顧記錄',chat:'助手',growth:'成長',memory:'記憶',guide:'指南',summary:'摘要',family:'家庭',profile:'孩子資料',photos:'照片',sources:'來源',contact:'聯絡',history:'歷史',settings:'設定',more:'更多',login:'登入畫面（不登入）',admin:'管理畫面（只讀）'};
for(const side of sides){const select=get(side+'-version');for(const version of catalog.versions)select.add(new Option(version.label,version.id));select.value=catalog.defaults[side];}
for(const [id,label] of Object.entries(pages)){const option=new Option(label+(catalog.routeSupport[id]?.status==='unavailable'?'（尚未適配）':''),id);option.disabled=catalog.routeSupport[id]?.status==='unavailable';get('route').add(option);}


function present(side){
 const session=sessions.get(side),panel=get(side+'-panel'),frame=panel.querySelector('iframe'),notice=get(side+'-unavailable');
 let observation=null,actualRoute=null;
 try {
  const state=session?.gate.snapshot(),marker=frame.contentWindow.__HISTORICAL_COMPARE_OBSERVATION__;
  actualRoute=frame.contentWindow.location.pathname+frame.contentWindow.location.search;
  if(state && marker?.documentId===state.documentId && marker.mainSha256===session.version.mainSha256 && marker.epoch===frame.name.split(':').at(-1) && marker.caseKey===session.caseKey && marker.caseId===session.selectedCase.caseId && marker.caseSha256===session.selectedCase.caseSha256)observation=state;
 } catch { /* An unreadable or retired source remains unavailable. */ }
 const availability=routeAvailability(observation,actualRoute,session?.selectedCase.routes??[]);
 tasksReady[side]=availability.available&&/^\/tasks\/?$/.test(new URL(actualRoute,location.origin).pathname);
 recipeHandoff.setTasksScope(tasksReady.left&&tasksReady.right);
 const handoffFocus=!availability.available && !frame.inert && document.activeElement===frame;
 frame.inert=!availability.available;frame.tabIndex=availability.available?0:-1;frame.setAttribute('aria-hidden',String(!availability.available));frame.style.visibility=availability.available?'visible':'hidden';
 notice.hidden=availability.available;
 notice.textContent=availability.reason==='unavailable'?'這個路由未適配至目前固定案例，不能作為已支持的對照。原文檔及本地狀態保留；請使用瀏覽器返回。':'正在核對來源與路由，對照暫不可操作。';
 if(handoffFocus)notice.focus({preventScroll:true});
 get(side+'-route').textContent=(availability.route??'等待歷史版本載入')+' · '+panel.dataset.viewport;
}
function size(){
 const width=Number(get('width').value),mode=get('mode').value,narrow=window.innerWidth<=700;
 panels.classList.toggle('single',mode!=='pair');
 for(const side of sides){const panel=get(side+'-panel'),frame=panel.querySelector('iframe'),port=panel.querySelector('.viewport');
  const visible=mode==='pair'?!(narrow&&side==='right'):mode.startsWith(side);
  panel.classList.toggle('hidden',!visible);panel.inert=!visible;
  if(!visible)continue;
  const scale=mode.endsWith('-native')?1:Math.min(1,port.clientWidth/width);
  frame.style.width=width+'px';frame.style.height='900px';frame.style.transform=`scale(${scale})`;port.style.height=(900*scale)+'px';
  panel.dataset.viewport=width+' CSS px · '+Math.round(scale*100)+'% 展示比例';
  present(side);
 }
}
function replacePair(){
 tasksReady.left=false;tasksReady.right=false;recipeHandoff.setTasksScope(false);
 const route=get('route').value,caseKey=caseForRoute(route),selectedCase=catalog.cases[caseKey];
 everMounted=true;
 for(const side of sides){
  const version=catalog.versions.find(v=>v.id===get(side+'-version').value),panel=get(side+'-panel');
  sessions.get(side)?.gate.dispose();
  const old=panel.querySelector('iframe'),frame=document.createElement('iframe');
  for(const attribute of old.attributes)if(!['src','name'].includes(attribute.name))frame.setAttribute(attribute.name,attribute.value);
  const epoch=crypto.randomUUID().replaceAll('-','');frame.name=`historical-comparison:${side}:${version.id}:${caseKey}:${epoch}`;old.replaceWith(frame);
  const gate=createObservationSession({side,variant:version.id,origin:location.origin,epoch,mainSha256:version.mainSha256,caseKey,caseId:selectedCase.caseId,caseSha256:selectedCase.caseSha256},frame.contentWindow);
  sessions.set(side,{gate,frame,version,caseKey,selectedCase});
  frame.addEventListener('load',()=>{
    try {
      const m=frame.contentWindow.__HISTORICAL_COMPARE_OBSERVATION__;
      if(sessions.get(side)?.gate!==gate || !m || m.epoch!==epoch || m.mainSha256!==version.mainSha256 || m.caseKey!==caseKey || m.caseId!==selectedCase.caseId || m.caseSha256!==selectedCase.caseSha256) return;
      if(!gate.documentLoaded(m.documentId)) return;
      gate.accept({source:frame.contentWindow,origin:location.origin,data:m});
      get(side+'-route').textContent=(gate.snapshot()?.route??'來源標記未就緒')+' · '+panel.dataset.viewport;
    } catch { /* Keep an unverified document inert. */ } finally { present(side); }
  });
  get(side+'-title').textContent=(side==='left'?'A · ':'B · ')+version.label;
  get(side+'-source').textContent=`來源 ${version.sourceReference} · main ${version.main}\nSHA256 ${version.mainSha256}\n案例 ${selectedCase.caseId} · ${selectedCase.caseSha256} · 只供對照，非組合適配／渲染驗收收據`;
  if(!version.routes[route]){get(side+'-route').textContent='此版本未提供所選頁面';continue;}
  frame.src=(route==='index'?'/':'/'+route)+'?comparisonFrame=1';
 }
 get('case').textContent=caseKey==='signedout'?'未登入 signedout：只讀真實登入畫面，不會完成登入、註冊或發送電郵。':'共用 ready：原有小晴合成案例。';
 get('status').textContent='兩側已要求載入同一頁面及固定案例，各自持有獨立資料副本。尚待真瀏覽器驗證。';size();
}
window.addEventListener('message',event=>{
 for(const [side,s] of sessions){if(!s.gate.accept(event))continue;present(side);
  if([...sessions.values()].every(s=>s.gate.snapshot()))get('status').textContent='已收到兩側的來源／路由標記。這不是全站渲染或原生守衛通過的證明。';
 }
});
function openPair(){replaceComparison(everMounted,message=>window.confirm(message),replacePair);}
get('apply').addEventListener('click',openPair);get('swap').addEventListener('click',()=>{swapped=!swapped;const order=visualOrder(swapped);for(const side of sides)get(side+'-panel').style.order=order[side];});
get('width').addEventListener('change',size);get('mode').addEventListener('change',size);window.addEventListener('resize',size);
window.addEventListener('pagehide',event=>{if(event.persisted)return;for(const s of sessions.values())s.gate.dispose();sessions.clear();});
window.addEventListener('pageshow',event=>{if(event.persisted)size();});
openPair();
