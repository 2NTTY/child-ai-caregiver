import {createChoiceList,resolveChoice,TASK_PARTS,PAGE_LABELS,CHAT_CHOICE_VARIANTS} from './design-choices.mjs';
import {createObservationSession} from './session.mjs';
import {catalog} from './catalog.mjs';
import {replaceComparison,visualOrder,routeAvailability} from './host-actions.mjs';
const get=id=>document.getElementById(id),sides=['left','right'];
const sessions=new Map(),panels=get('panels'),choices=createChoiceList();
let swapped=false,everMounted=false,view='pair',mobileSide='left';
const caseForRoute=route=>catalog.routeSupport[route]?.caseKey??'ready';
const INITIAL_SURFACES=Object.freeze({tasks:Object.freeze(['tasks-reading-panel']),care:Object.freeze(['care-page-scroll','care-review-tabs-bar']),settings:Object.freeze(['account-settings']),growth:Object.freeze(['growth-scroll','growth-tabs-toolbar']),chat:Object.freeze(['chat-top-toolbar','chat-reading-panel'])});
const initialSurfaceIds=(route,version)=>route==='chat'&&!CHAT_CHOICE_VARIANTS.includes(version?.id)?null:INITIAL_SURFACES[route];
const chatChoiceLabel=CHAT_CHOICE_VARIANTS.map(id=>catalog.versions.find(version=>version.id===id).label.split(' · ')[0]).join('／');
for(const side of sides){
 const select=get(side+'-version');for(const version of catalog.versions)select.add(new Option(version.label,version.id));select.value=catalog.defaults[side];
 for(const part of TASK_PARTS)get(side+'-part').add(new Option(part.label,part.id));
}
for(const [id,label] of Object.entries(PAGE_LABELS)){
 const option=new Option(label+(catalog.routeSupport[id]?.status==='unavailable'?'（尚未適配）':id==='photos'?'（暫不可挑選）':id==='chat'?`（${chatChoiceLabel} 可挑選）`:''),id);
 option.disabled=catalog.routeSupport[id]?.status==='unavailable';get('route').add(option);
}
get('route').value='tasks';get('width').value=window.innerWidth<=700?'390':'1440';

function pageKey(route){
 try{let key=decodeURIComponent(new URL(route,location.origin).pathname).replace(/^\/+|\/+$/g,'').replace(/\.html$/,'')||'index';return key.startsWith('(dashboard)/')?key.slice(12):key;}catch{return null;}
}
function matchesSession(session,marker){
 return marker?.protocol==='historical-comparison-observation-v2' && marker.side===session.side && marker.variant===session.version.id && marker.epoch===session.frame.name.split(':').at(-1) && marker.mainSha256===session.version.mainSha256 && marker.caseKey===session.caseKey && marker.caseId===session.selectedCase.caseId && marker.caseSha256===session.selectedCase.caseSha256;
}
function pageName(route){const key=pageKey(route);return Object.hasOwn(PAGE_LABELS,key)?PAGE_LABELS[key]:'未辨識頁面';}
function lockPick(session,reason,detail=''){
 session.pickLocked=true;
 session.pickLockNote??=`選擇核對：${reason}。${session.acceptedSequence>0?'首次接受文件後':'首次接受文件前'}。${detail}`;
}
function initialSurfaceReady(frame,root,route,version){
 const ids=initialSurfaceIds(route,version),ready=root?.querySelector('[data-testid="frontend-preview-ready"]');
 if(!ids || !ready || ready.getAttribute('data-startup-state')!=='ready' || ready.getAttribute('data-startup-data')!=='ready' || ready.getAttribute('aria-busy')!=='false')return false;
 return ids.every(id=>{
  const surface=ready.querySelector(`[data-testid="${id}"]`);
  if(!surface || ![...surface.getClientRects()].some(rect=>rect.width>0&&rect.height>0))return false;
  // Inspect only the child document. The host iframe is intentionally inert
  // while waiting and must not make its own readiness condition impossible.
  for(let node=surface;node;node=node.parentElement){
   const style=frame.contentWindow.getComputedStyle(node);
   if(node.hidden || node.inert || node.getAttribute('aria-hidden')==='true' || style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0')return false;
   if(node===root)return true;
  }
  return false;
 });
}
function present(side){
 const session=sessions.get(side),panel=get(side+'-panel'),frame=panel.querySelector('iframe'),notice=get(side+'-unavailable');
 let observation=null,actualRoute=null,rendered=false;
 try {
  const state=session?.gate.snapshot(),marker=frame.contentWindow.__HISTORICAL_COMPARE_OBSERVATION__;
  const root=frame.contentWindow.document.getElementById('root'),text=root?.textContent?.trim()??'';
  const surfaceReady=!!session && initialSurfaceReady(frame,root,session.initialRoute,session.version);
  actualRoute=frame.contentWindow.location.pathname+frame.contentWindow.location.search;
  if(session && matchesSession(session,marker)){
   if(state && marker.documentId===state.documentId)observation=state;
   if(!session.pickArmed && !session.pickLocked && surfaceReady && observation && session.pickDocumentId===marker.documentId && marker.sequence===session.acceptedSequence && pageKey(observation.route)===session.initialRoute && pageKey(actualRoute)===session.initialRoute && pageKey(marker.route)===session.initialRoute){
    session.pickArmed=true;session.pickArmSequence=marker.sequence;
   }
   if(session.pickArmed && (pageKey(actualRoute)!==session.initialRoute || pageKey(marker.route)!==session.initialRoute))lockPick(session,'頁面與開啟目標不同',`開啟目標：${PAGE_LABELS[session.initialRoute]}；目前頁面：${pageName(actualRoute)}；標記頁面：${pageName(marker.route)}。`);
  }
  // Existing page witnesses include only admitted Harbour/Care Chat. Only the
  // initial page is armed; subsequent cross-page visits remain permanently locked.
  const initialPage=observation && session.pickArmed && session.pickDocumentId===marker.documentId && !session.pickLocked && pageKey(observation.route)===session.initialRoute && marker.sequence===session.acceptedSequence && (!initialSurfaceIds(session.initialRoute,session.version)||surfaceReady);
  rendered=!!initialPage && !!root?.childElementCount && !!text && !/something went wrong|application error|uncaught error|minified react error|對照環境未能安全啟動|SOURCE_UNAVAILABLE/i.test(text) && !/^(?:正在載入[.…。]*|loading[.…。]*)$/i.test(text);
 }catch{ /* An unreadable or retired source remains unavailable. */ }
 const availability=routeAvailability(observation,actualRoute,session?.selectedCase.routes??[]);
 const waiting=!!session && initialSurfaceIds(session.initialRoute,session.version) && !session.pickArmed,interactive=availability.available&&!waiting;
 const handoffFocus=!interactive && !frame.inert && document.activeElement===frame;
 frame.inert=!interactive;frame.tabIndex=interactive?0:-1;frame.setAttribute('aria-hidden',String(!interactive));frame.style.visibility=availability.available?'visible':'hidden';
 notice.hidden=interactive;
 notice.textContent=waiting?`正在等候所選${PAGE_LABELS[session.initialRoute]}畫面完成顯示，暫不可操作或挑選。`:availability.reason==='unavailable'?'這個頁面未適配至目前合成案例，暫不可比較或選擇。原畫面狀態保留；請使用瀏覽器返回。':'正在核對來源與路由，對照暫不可操作。';
 if(handoffFocus)notice.focus({preventScroll:true});
 const context={version:session?.version,observation,actualRoute,rendered,visible:!panel.hidden && availability.available};
 const choice=resolveChoice(context),isTasks=choice?.route==='tasks';
 get(side+'-pick').disabled=!choice;get(side+'-part-pick').disabled=!isTasks;get(side+'-parts').hidden=!isTasks;
 get(side+'-route').textContent=choice?.pageLabel??(actualRoute?PAGE_LABELS[actualRoute.split('?')[0].replace(/^\/+|\/+$/g,'')]??'等待可比較頁面':'正在載入');
 get(side+'-pick-note').textContent=choice?'可選整個頁面'+(isTasks?'，或展開只選其中一部分。':'。'):session?.pickLocked?'你已在這側切換頁面。若要選這頁的設計，請在上方選好頁面，再按「開啟比較」。':waiting&&session.initialRoute==='chat'?`正在等候所選${PAGE_LABELS[session.initialRoute]}畫面就緒，暫不可加入選擇。`:pageKey(actualRoute)==='chat'&&!CHAT_CHOICE_VARIANTS.includes(session?.version.id)?'這個版本的助手畫面暫不可加入選擇。':pageKey(actualRoute)==='photos'?'這個頁面尚未通過可用畫面驗收，暫不可加入選擇。':'畫面未就緒或無法核對，暫不可加入選擇。';
 get(side+'-viewport').textContent=panel.dataset.viewport??'';
 get(side+'-source').textContent=(session?.sourceText??'')+'\n'+(session?.pickLockNote??'選擇核對：尚未鎖定。');
 return context;
}
function size(){
 const width=Number(get('width').value),narrow=window.innerWidth<=700,visibleView=narrow&&view==='pair'?mobileSide:view;
 panels.classList.toggle('single',visibleView!=='pair');
 get('view-pair').hidden=narrow;
 for(const key of ['pair',...sides])get('view-'+key).setAttribute('aria-pressed',String(visibleView===key));
 get('view-note').textContent=narrow?`目前顯示 ${visibleView==='left'?'A':'B'}，可切換另一側比較。`:'兩側可各自瀏覽不同頁面。';
 for(const side of sides){
  const panel=get(side+'-panel'),frame=panel.querySelector('iframe'),port=panel.querySelector('.viewport'),visible=visibleView==='pair'||visibleView===side;
  const handoffFocus=!visible && panel.contains(document.activeElement);
  panel.hidden=!visible;panel.inert=!visible;
  if(handoffFocus)get('view-'+(visibleView==='pair'?'left':visibleView)).focus({preventScroll:true});
  if(visible){
   const scale=get('mode').value==='native'?1:Math.min(1,port.clientWidth/width);
   frame.style.width=width+'px';frame.style.height='900px';frame.style.transform=`scale(${scale})`;port.style.height=(900*scale)+'px';
   panel.dataset.viewport=width+' CSS px · '+Math.round(scale*100)+'% 展示比例';
  }
  present(side);
 }
}
function replacePair(){
 const route=get('route').value,caseKey=caseForRoute(route),selectedCase=catalog.cases[caseKey];
 everMounted=true;
 for(const side of sides){
  const version=catalog.versions.find(v=>v.id===get(side+'-version').value),panel=get(side+'-panel');
  sessions.get(side)?.observer?.disconnect();sessions.get(side)?.gate.dispose();
  const old=panel.querySelector('iframe'),frame=document.createElement('iframe');
  for(const attribute of old.attributes)if(!['src','name'].includes(attribute.name))frame.setAttribute(attribute.name,attribute.value);
  const epoch=crypto.randomUUID().replaceAll('-','');frame.name=`historical-comparison:${side}:${version.id}:${caseKey}:${epoch}`;old.replaceWith(frame);
  const gate=createObservationSession({side,variant:version.id,origin:location.origin,epoch,mainSha256:version.mainSha256,caseKey,caseId:selectedCase.caseId,caseSha256:selectedCase.caseSha256},frame.contentWindow);
 const session={gate,frame,version,caseKey,selectedCase,side,initialRoute:route,pickDocumentId:null,pickLocked:false,pickArmed:!initialSurfaceIds(route,version),pickArmSequence:0,acceptedSequence:0,observer:null};sessions.set(side,session);
  frame.addEventListener('load',()=>{
   try {
    session.observer?.disconnect();session.observer=null;
    const m=frame.contentWindow.__HISTORICAL_COMPARE_OBSERVATION__;
    if(sessions.get(side)?.gate!==gate || !matchesSession(session,m))return;
    if(!gate.documentLoaded(m.documentId))return;
    const config=frame.contentWindow.__HISTORICAL_COMPARE_CONFIG__;
    if(session.pickDocumentId && session.pickDocumentId!==m.documentId)lockPick(session,'文件已重新載入');
    if(!config || !Object.isFrozen(config) || config.route!==route || config.variant!==version.id || config.main!==version.main || config.mainSha256!==version.mainSha256 || config.caseKey!==caseKey || config.caseId!==selectedCase.caseId || config.caseSha256!==selectedCase.caseSha256){
     let failedConfig=['config'];
     try{const checks={config:!!config,frozen:!!config&&Object.isFrozen(config),route:config?.route===route,variant:config?.variant===version.id,main:config?.main===version.main,mainSha256:config?.mainSha256===version.mainSha256,caseKey:config?.caseKey===caseKey,caseId:config?.caseId===selectedCase.caseId,caseSha256:config?.caseSha256===selectedCase.caseSha256};failedConfig=Object.keys(checks).filter(key=>!checks[key]);}catch{ /* Diagnostics must not change the failed check. */ }
     lockPick(session,'畫面來源核對未通過','未吻合欄位：'+failedConfig.join('、')+'。');
    }
    session.pickDocumentId??=m.documentId;
    if(gate.accept({source:frame.contentWindow,origin:location.origin,data:m}))session.acceptedSequence=m.sequence;
    // DOM changes can reject blank/error screens, but never unlock a navigated document.
    session.observer=new MutationObserver(()=>{if(sessions.get(side)===session)present(side);});
    session.observer.observe(frame.contentWindow.document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-testid','data-startup-state','data-startup-data','aria-busy','aria-hidden','hidden','inert','style','class']});
   }catch{ /* Keep an unverified document unpickable. */ }finally{present(side);}
  });
  get(side+'-title').textContent=(side==='left'?'A · ':'B · ')+version.label;
  session.sourceText=`版本 ${version.id}\n來源 ${version.sourceReference}\nmain ${version.main}\nSHA256 ${version.mainSha256}\n只供歷史設計對照，非組合適配或渲染驗收收據。`;get(side+'-source').textContent=session.sourceText;
  if(!version.routes[route]){get(side+'-route').textContent='此版本未提供所選頁面';continue;}
  frame.src=(route==='index'?'/':'/'+route)+'?comparisonFrame=1';
 }
 get('case').textContent=caseKey==='signedout'?'未登入 signedout：只讀登入畫面，不會登入、註冊或發送電郵。':'共用 ready：原有小晴合成案例。';
 get('status').textContent='正在載入所選比較。已選設計清單會保留。';size();
}
function renderChoices(){
 const items=choices.items(),list=get('choice-list');list.replaceChildren();
 for(const choice of items){
  const row=document.createElement('li'),body=document.createElement('div'),title=document.createElement('strong'),label=document.createElement('p'),details=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('p'),remove=document.createElement('button');
  title.textContent=choice.versionLabel;label.textContent=choice.pageLabel+' · '+choice.partLabel;summary.textContent='來源識別';source.className='source';source.textContent=`版本 ${choice.variantId} · ${choice.actualPath} · ${choice.partId}\n來源 ${choice.sourceReference}\nmain ${choice.main}\nSHA256 ${choice.mainSha256}\n頁面來源 ${choice.payloadPath}\n頁面 SHA256 ${choice.payloadSha256}\ncatalog SHA256 ${choice.catalogSha256}`;
  details.append(summary,source);body.append(title,label,details);remove.type='button';remove.textContent='移除';remove.setAttribute('aria-label',`移除 ${choice.versionLabel} ${choice.pageLabel} ${choice.partLabel}`);
  remove.addEventListener('click',()=>{
   const index=choices.items().findIndex(item=>item.id===choice.id);choices.remove(choice.id);renderChoices();
   get('choice-status').textContent='已移除這項選擇。';
   const remaining=get('choice-list').querySelectorAll('button');(remaining[Math.min(index,remaining.length-1)]??get('choice-link')).focus();
  });row.append(body,remove);list.append(row);
 }
 get('choice-empty').hidden=items.length>0;get('choice-count').textContent=String(items.length);get('choice-link').textContent=`我的選擇（${items.length}）`;get('copy-choices').disabled=items.length===0;
 get('copy-fallback').hidden=true;get('copy-text').value='';
}
function pick(side,part='page'){
 const result=choices.add(present(side),part);
 if(result.status==='unavailable'){get('choice-status').textContent='畫面未就緒或不在可選範圍，沒有加入清單。';return;}
 renderChoices();get('choice-status').textContent=result.status==='duplicate'?'這個設計已在清單中。':`已加入 ${result.choice.versionLabel} · ${result.choice.pageLabel} · ${result.choice.partLabel}。`;
}
for(const side of sides){
 get(side+'-pick').addEventListener('click',()=>pick(side));get(side+'-part-pick').addEventListener('click',()=>pick(side,get(side+'-part').value));
 get('view-'+side).addEventListener('click',()=>{view=side;mobileSide=side;size();});
}
get('view-pair').addEventListener('click',()=>{view='pair';size();});
get('copy-choices').addEventListener('click',async()=>{
 if(!choices.items().length)return;
 const text=choices.summary();
 try {
  if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);get('copy-fallback').hidden=true;get('choice-status').textContent='已複製。請貼回對話，dot 才能收到你的選擇。';
 }catch{
  get('copy-fallback').hidden=false;get('copy-text').value=text;get('copy-text').focus();get('copy-text').select();get('choice-status').textContent='未能自動複製，請複製下方已選取文字並貼回對話。';
 }
});
window.addEventListener('message',event=>{
 for(const [side,session]of sessions){
  // Known surface-ready routes start only at their verified first surface. Ignore queued bootstrap
  // observations through that sequence, never a later cross-page observation.
  if(session.pickArmed && event.data?.sequence>session.pickArmSequence && event.source===session.frame.contentWindow && event.origin===location.origin && matchesSession(session,event.data)){
   try{const marker=session.frame.contentWindow.__HISTORICAL_COMPARE_OBSERVATION__;if(marker?.documentId===event.data.documentId && matchesSession(session,marker) && pageKey(event.data.route)!==session.initialRoute)lockPick(session,'收到頁面變更標記',`開啟目標：${PAGE_LABELS[session.initialRoute]}；標記頁面：${pageName(event.data.route)}。`);}catch{ /* No pick authority from an unreadable frame. */ }
  }
  if(!session.gate.accept(event))continue;
  session.acceptedSequence=event.data.sequence;present(side);
  if([...sessions.values()].every(session=>session.gate.snapshot()))get('status').textContent='比較已開啟。可各自瀏覽，選擇目前畫面的設計。';
 }
});
function openPair(){replaceComparison(everMounted,message=>window.confirm(message),replacePair);}
get('apply').addEventListener('click',openPair);get('swap').addEventListener('click',()=>{swapped=!swapped;const order=visualOrder(swapped);for(const side of sides)get(side+'-panel').style.order=order[side];});
get('width').addEventListener('change',size);get('mode').addEventListener('change',size);window.addEventListener('resize',size);
window.addEventListener('pagehide',event=>{if(event.persisted)return;for(const session of sessions.values()){session.observer?.disconnect();session.gate.dispose();}sessions.clear();});
window.addEventListener('pageshow',event=>{if(event.persisted)size();});
renderChoices();openPair();
