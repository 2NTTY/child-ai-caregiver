import {createOwner} from './owner.mjs';
import {motionPreferenceStorageKey} from './policy.mjs';

const scenes={arrive:{code:'CUT 01',title:'一張卡片抵達',copy:'內容先在原位完整顯示，移動只作局部裝飾。'},update:{code:'CUT 02',title:'一段內容更新',copy:'新文字立即可讀。示例結束不代表任何資料保存完成。'},select:{code:'CUT 03',title:'一個選項確認',copy:'文字與標記指出所選項目，不用移動作唯一提示。'}};
function reason(s){return !s.preferenceReady?'正在讀取合成系統及裝置偏好，先保持靜態。':s.systemReducedMotion===true?'合成系統已要求減少動畫，系統優先，這裏不能將它關閉。':s.systemReducedMotion===null?'合成系統設定未能確認，先以減少動畫方式顯示。':s.manualReducedMotion?'已為本頁示例額外減少動畫；內容與操作照常。':'本頁示例跟隨合成系統；尚未播放任何動效。';}
function storageCopy(s){return s.preferenceStorage==='loading'?'正在讀取合成儲存。':s.preferenceStorage==='browser'?'模擬瀏覽器儲存可用。選擇只保留在本頁記憶體，並非已儲存到你的瀏覽器或帳戶。':s.mode==='native'?'原生 session 合成示例：選擇只在本次模擬開啟期間有效。':'模擬儲存不可用，偏好只在本次模擬開啟期間套用；再次讀取可能回復先前值。';}

export function mount(doc,owner,ports={}){
 const win=doc.defaultView,$=id=>doc.getElementById(id);let alive=true,layout='A',playing=false,generation=0,timer=null,renderRevision=0,intentRevision=0,initialToken=owner.initialRequest();const cleanups=[];
 let media=null;
 if(Object.hasOwn(ports,'mediaQuery'))media=ports.mediaQuery;else try{media=typeof win.matchMedia==='function'?win.matchMedia('(prefers-reduced-motion: no-preference)'):null;}catch{media=null;}
 const usable=!!media&&typeof media.matches==='boolean'&&((typeof media.addEventListener==='function'&&typeof media.removeEventListener==='function')||(typeof media.addListener==='function'&&typeof media.removeListener==='function'));
 const isVisible=ports.isVisible||(()=>!doc.hidden),setTimer=ports.setTimer||((fn,ms)=>win.setTimeout(fn,ms)),clearTimer=ports.clearTimer||(id=>win.clearTimeout(id));
 const ambientAllowed=()=>usable&&media.matches===true;
 function allowed(){return alive&&layout==='B'&&ambientAllowed()&&isVisible()&&owner.snapshot().enabled;}
 function text(id,value){const el=$(id);if(el.textContent!==value)el.textContent=value;}
 function playbackControls(){const can=allowed();$('play').disabled=playing||!can;$('stop').disabled=!playing;}
 function stop(message){generation++;if(timer!==null){clearTimer(timer);timer=null;}const wasPlaying=playing;playing=false;$('stage').classList.remove('playing');if(message&&(wasPlaying||message.force))text('play-status',typeof message==='string'?message:message.text);playbackControls();}
 function safety(){text('safety-status',!usable?'實際瀏覽器偏好未能確認，示例保持靜態。':!media.matches?'實際瀏覽器要求減少動畫，示例保持靜態。':!isVisible()?'頁面目前不可見，示例保持靜態。':'實際瀏覽器未要求減少動畫。仍須合成偏好允許及你主動播放，才會出現一次局部示例。');}
 function render(state,announce=false){if(!alive)return;const paint=++renderRevision,intent=intentRevision;stop('偏好或情境已變更，示例已停止。');const effective=state.reducedMotion?'減少動畫':'跟隨系統';text('effective-A',effective);text('effective-B',effective);text('reason-A',reason(state));text('reason-B',reason(state));text('storage-A',storageCopy(state));text('storage-B',storageCopy(state));$('manual-A').checked=state.reducedMotion;$('manual-A').disabled=!state.canChange;$('follow-B').checked=!state.manualReducedMotion;$('reduce-B').checked=state.manualReducedMotion;for(const id of ['follow-B','reduce-B'])$(id).disabled=!state.canChange;text('system-A',state.systemReducedMotion===null?'未確認':state.systemReducedMotion?'要求減少':'未要求減少');text('manual-value-A',state.manualReducedMotion?'額外減少':'依系統');text('storage-value-A',state.preferenceStorage==='browser'?'模擬瀏覽器 · 記憶體替身':state.preferenceStorage==='loading'?'讀取中':'只限本次模擬開啟');$('scenario').value=state.scenario;$('external').disabled=state.mode==='native'||state.mode==='read-fail';text('lab-status',`合成生命週期 ${state.lifetime} · 呈現 epoch ${state.epoch} · 所有示例儲存只在本頁記憶體內。`);safety();playbackControls();if(announce)text('announcement',`${effective}。${reason(state)} ${storageCopy(state)}`);retireFinishRead(state,paint,intent);}
 // Retire only this local control. Focus can synchronously publish, dispose or hand off again.
 function retireFinishRead(state,paint,intent){
  const finish=$('finish-read'),target=$('scenario');
  const current=()=>{const latest=owner.snapshot();return alive&&paint===renderRevision&&state.lifetime===latest.lifetime&&state.revision===latest.revision;};
  const visible=()=>target.isConnected&&!target.disabled&&!target.closest('[hidden]')&&!target.closest('details:not([open])');
  if(!current())return;
  const retiring=state.preferenceReady&&!finish.hidden&&doc.activeElement===finish;
  let diverted=false;
  if(retiring&&intent===intentRevision&&visible()){
   const observe=event=>{if(event.target!==target)diverted=true;};
   doc.addEventListener('focusin',observe);
   try{target.focus({preventScroll:true});}finally{doc.removeEventListener('focusin',observe);}
  }
  if(!current())return;
  finish.hidden=state.preferenceReady;
  if(retiring&&!diverted&&intent===intentRevision&&current()&&doc.activeElement===target&&visible())target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});
 }
 function on(el,type,fn){const listener=event=>{intentRevision++;fn(event);};el.addEventListener(type,listener);cleanups.push(()=>el.removeEventListener(type,listener));}
 function chooseLayout(value){if(!alive)return;stop('切換方向，示例已停止。');layout=value;$('shell').dataset.layout=value;for(const id of ['A','B']){$('panel-'+id).hidden=id!==value;$('layout-'+id).setAttribute('aria-pressed',String(id===value));}playbackControls();}
 on($('layout-A'),'click',()=>chooseLayout('A'));on($('layout-B'),'click',()=>chooseLayout('B'));
 on($('manual-A'),'change',()=>{owner.setManual($('manual-A').checked);render(owner.snapshot());});on($('follow-B'),'change',()=>{if($('follow-B').checked)owner.setManual(false);});on($('reduce-B'),'change',()=>{if($('reduce-B').checked)owner.setManual(true);});
 on($('scenario'),'change',()=>{owner.configure($('scenario').value);initialToken=owner.initialRequest();});on($('reload'),'click',()=>{owner.reload();initialToken=owner.initialRequest();});on($('reset'),'click',()=>{owner.configure('ready');initialToken=owner.initialRequest();});on($('finish-read'),'click',()=>owner.resolveInitial(initialToken,false));on($('external'),'click',()=>owner.externalStorage({key:motionPreferenceStorageKey,newValue:'1',storageArea:'same'}));
 for(const button of doc.querySelectorAll('[data-scene]'))on(button,'click',()=>{if(!alive)return;const key=button.dataset.scene,scene=scenes[key];if(!scene)return;stop({force:true,text:'分鏡已切換，尚未播放。'});for(const b of doc.querySelectorAll('[data-scene]'))b.setAttribute('aria-pressed',String(b===button));text('scene-code',scene.code);text('scene-title',scene.title);text('scene-copy',scene.copy);});
 on($('play'),'click',()=>{if(!allowed()||playing)return;playing=true;const token=++generation;$('stage').classList.add('playing');text('play-status','正在播放一次小範圍位移。可立即停止。');playbackControls();timer=setTimer(()=>{if(!alive||token!==generation)return;stop({force:true,text:'示例已結束，返回靜態分鏡。'});},1600);});
 on($('stop'),'click',()=>stop({force:true,text:'示例已停止，內容仍可完整閱讀。'}));
 const safetyChange=()=>{if(!alive)return;stop('實際偏好或可見狀態已變更，示例已停止。');safety();playbackControls();};
 if(usable){if(typeof media.addEventListener==='function'){media.addEventListener('change',safetyChange);cleanups.push(()=>media.removeEventListener('change',safetyChange));}else{media.addListener(safetyChange);cleanups.push(()=>media.removeListener(safetyChange));}}
 on(doc,'visibilitychange',safetyChange);on(win,'pagehide',safetyChange);on(win,'resize',()=>{if(alive)stop('視窗尺寸已變更，示例已停止。');});
 const unsubscribe=owner.subscribe(s=>render(s,true));render(owner.snapshot());
 return function dispose(){if(!alive)return;alive=false;stop();unsubscribe();for(const cleanup of cleanups)cleanup();};
}
if(typeof document!=='undefined'){
 const owner=createOwner();const dispose=mount(document,owner);
 // pagehide is already observed by mount to stop playback; the sample stays available on bfcache return.
 // A real page reload creates a new owner and discards all in-memory choices.
}
