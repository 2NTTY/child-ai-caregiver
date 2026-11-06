import {PHASES} from './fixture.mjs';
const STATUS={running:'處理中',completed:'運行已結束',stopped:'運行已停止',unknown:'原結果未知'};
const CANCEL={idle:'尚未提出停止要求。',pending:'合成停止要求等待回報。',accepted:'停止要求已受理，不等於已停止；已保存的操作不會撤銷。',not_running:'回報沒有可停止的運行，仍須核對原結果。',unconfirmed:'未能確認停止要求，不能當作已停止。'};
const CHECK={idle:'查核只讀取原運行狀態，不重新執行。',pending:'正在模擬讀取原識別，尚無結果。',failed:'這次未能查核；可重試同一個原結果讀取。',missing:'尚未讀到原運行，仍屬未知；沒有建立新運行。',read:'已讀取合成運行狀態；不等於聊天已保存或照護已完成。'};
const currentPanel=prefix=>`<section class="current-panel" aria-labelledby="${prefix}-current-title"><h2 id="${prefix}-current-title" tabindex="-1">目前回覆</h2><div class="signal-art" aria-hidden="true"><svg viewBox="0 0 280 125"><path d="M15 92H62L89 45H153L181 73H264"/><path d="M15 105H69L96 58H145L174 86H264"/><circle cx="89" cy="45" r="9"/><circle cx="181" cy="73" r="9"/><path d="M199 20h50v20M24 19h32M24 19v19"/></svg></div><p class="status" id="${prefix}-status"></p><p class="phase" id="${prefix}-phase"></p><p class="stale" id="${prefix}-stale"></p><p class="helper" id="${prefix}-help"></p><div class="actions"><button id="${prefix}-stop" type="button">模擬停止回覆</button><button id="${prefix}-check" type="button">查核原運行（合成）</button></div><p class="notice" id="${prefix}-cancel"></p><p class="notice" id="${prefix}-check-note"></p><p class="limit" id="${prefix}-limit">工具返回不代表照護事項已完成。沒有可核對的完成百分比。</p></section>`;
export function mountProgress(document,fixture){
  const root=document.getElementById('app');
  root.innerHTML=`<div class="workbench" data-direction="a"><header class="top"><div><span class="candidate">AP01 合成候選</span><h1 id="workspace-title" tabindex="-1">公開進度</h1><p>知道現在看見甚麼，也知道仍未能確定甚麼。</p></div><div class="choices" role="group" aria-label="選擇資訊組織"><button id="direction-a" type="button" aria-pressed="true">A 訊號艦橋</button><button id="direction-b" type="button" aria-pressed="false">B 航跡時間線</button></div></header><p class="boundary">只有合成資料。沒有模型、真訊息、API、持久儲存或授權操作。</p><div class="identity-bar"><span id="scope-label"></span><span id="online-label"></span><details><summary>原識別與邊界</summary><dl id="identity"></dl><p>即時回覆屬 ChatController。已保存活動屬另一個 ProductAgentOwner，本候選未納。</p></details></div><div class="filter-bar"><label for="filter">搜尋本頁觀察</label><input id="filter" type="search" autocomplete="off" maxlength="120" placeholder="例如：讀取、工具"><button id="clear-filter" type="button">清除篩選</button><span id="filter-result"></span></div><main><div id="layout-a">${currentPanel('a')}<details id="a-disclosure" class="journal-disclosure"><summary>展開本頁觀察記錄 <span id="a-count"></span></summary><section aria-labelledby="a-journal-title"><h2 id="a-journal-title">本頁觀察到的合成事件</h2><p class="helper">按收到次序排列，不是完整事件串或正式歷史，沒有 Server 時間。</p><ol role="list" id="a-events" class="compact-events"></ol><p id="a-empty"></p></section></details></div><div id="layout-b" class="split" hidden><section id="b-journal" aria-labelledby="b-journal-title"><h2 id="b-journal-title">本頁觀察到的合成事件</h2><button id="b-jump-current" type="button">前往目前狀態與停止控制</button><p class="helper">一筆一筆核對收到的訊號。序號只是本頁順序，並非工作步數。</p><ol role="list" id="b-events" class="timeline"></ol><p id="b-empty"></p></section>${currentPanel('b')}</div><section id="event-detail" class="inspector" hidden aria-labelledby="detail-title"><div class="detail-top"><h2 id="detail-title" tabindex="-1">觀察詳情</h2><button id="close-detail" type="button">收起詳情，返回原事件</button></div><dl id="detail-body"></dl><p>這是公開事件欄位。沒有私有思考鏈、工具輸出正文或成功收據。</p></section></main><p id="log-limit" class="helper"></p><p id="live-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p><details id="lab" class="lab"><summary>合成情境控制</summary><p>下列按鈕只改本頁記憶體，沒有任何真請求。事件由你逐次注入，不按時間假裝推進。</p><div class="lab-group"><label for="phase-select">公開 phase</label><select id="phase-select">${Object.entries(PHASES).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select><button id="emit-phase" type="button">注入所選合成事件</button><button id="interrupt" type="button">模擬連線中斷</button><button id="online-toggle" type="button">切換離線</button></div><fieldset><legend>回報目前的合成停止要求</legend><button id="stop-accepted" type="button">回報：要求已受理</button><button id="stop-false" type="button">回報：沒有可停止運行</button><button id="stop-unknown" type="button">回報：未能確認</button></fieldset><fieldset><legend>回報目前的合成原結果讀取</legend><button id="check-running" type="button">原運行仍處理中</button><button id="check-completed" type="button">原運行已結束</button><button id="check-stopped" type="button">原運行已停止</button><button id="check-unknown" type="button">原結果未知</button><button id="check-failed" type="button">讀取失敗</button><button id="check-missing" type="button">尚無原運行</button></fieldset><fieldset><legend>切換場景會清除本頁觀察，並退休舊回呼</legend><button id="scenario-live" type="button">重設：公開進度</button><button id="scenario-interrupted" type="button">重設：已知原運行中斷</button><button id="scenario-no-run" type="button">重設：尚無 run ID</button><button id="scope-a" type="button">切換合成範圍 A</button><button id="scope-b" type="button">切換合成範圍 B</button></fieldset><p id="simulation-counts"></p></details><footer><p>獨立選配，不是正式功能已接通。畫面／鍵盤／真 owner 驗收仍待進行。</p><a href="./research.html">來源、兩種方向與未納邊界</a></footer></div>`;
  const el=id=>document.getElementById(id),shell=root.firstElementChild,rows={a:new Map(),b:new Map()},cleanups=new Set();
  let alive=true,layout='a',binding=fixture.binding(),query='',composing=false,selection=null,origin=null,focusIntent=0,renderedStatus='',lostFocus=false;
  const visible=node=>{
    if(!node?.isConnected||node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
    for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector('summary')?.contains(node))return false;
    return true;
  };
  const active=()=>alive&&!fixture.snapshot().disposed&&!fixture.snapshot().suspended;
  const listen=(node,type,handler)=>{node.addEventListener(type,handler);const off=()=>{node.removeEventListener(type,handler);cleanups.delete(off)};cleanups.add(off);return off};
  const text=(id,value)=>{const n=el(id);if(n.textContent!==value)n.textContent=value};
  const disable=(id,value)=>el(id).setAttribute('aria-disabled',String(value));
  const retireFocus=()=>{focusIntent++};
  listen(document,'focusin',()=>{lostFocus=false;retireFocus()});
  const focusLater=(target,expectedBinding=fixture.binding())=>{
    const intent=focusIntent;
    queueMicrotask(()=>{if(!active()||focusIntent!==intent||fixture.binding()!==expectedBinding)return;const node=typeof target==='function'?target():target;if(visible(node)&&!node.disabled)node.focus({preventScroll:true});});
  };
  const action=(id,fn)=>listen(el(id),'click',()=>{if(!active()||!visible(el(id))||el(id).getAttribute('aria-disabled')==='true')return;retireFocus();fn()});
  const details=(node,entries)=>{
    if(!node.firstChild)for(const [label] of entries){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;node.append(dt,dd)}
    [...node.querySelectorAll('dd')].forEach((dd,i)=>{if(dd.textContent!==entries[i][1])dd.textContent=entries[i][1]});
  };
  const currentSelection=()=>fixture.snapshot().observations.find(row=>row.id===selection);
  function render(){
    if(!alive)return;
    const s=fixture.snapshot(),focused=document.activeElement;
    if(binding!==s.binding){binding=s.binding;query='';el('filter').value='';selection=null;origin=null;retireFocus();for(const map of Object.values(rows)){for(const row of map.values()){row.off();row.li.remove()}map.clear()}}
    shell.dataset.direction=layout;el('layout-a').hidden=layout!=='a';el('layout-b').hidden=layout!=='b';
    for(const choice of ['a','b'])el(`direction-${choice}`).setAttribute('aria-pressed',String(choice===layout));
    text('scope-label',`合成範圍 ${binding.space} · 頁內世代 ${binding.epoch}`);text('online-label',s.online?'合成連線可用':'合成離線');
    details(el('identity'),[['run ID',s.runId??'尚未讀到，不補造'],['message ID',binding.messageId],['child ID',binding.childId],['user ID',binding.userId],['scope',`${binding.apiBase} / epoch ${binding.epoch} / view ${binding.view}`]]);
    const canStop=active()&&s.online&&s.status==='running'&&s.cancel==='idle'&&!s.pendingStop&&!s.pendingCheck;
    const canCheck=active()&&s.online&&s.stream!=='live'&&!s.pendingStop&&!s.pendingCheck;
    for(const p of ['a','b']){
      text(`${p}-status`,STATUS[s.status]);text(`${p}-phase`,s.stream==='live'?(s.phase?PHASES[s.phase]:'正在等候公開訊號'):'目前沒有即時進度');
      text(`${p}-stale`,s.stream==='live'?'公開狀態，不是內部思考。':s.phase?`上次觀察：${PHASES[s.phase]}。這不是目前仍在執行的證明。`:'尚未觀察到有效公開事件。');
      const help=s.observations.at(-1)?.event.card;text(`${p}-help`,help?`官方提示 ${help}：固定卡片正文在本候選未納，正式接線須保留原卡。`:'');
      text(`${p}-cancel`,CANCEL[s.cancel]);text(`${p}-check-note`,CHECK[s.checkState]);disable(`${p}-stop`,!canStop);disable(`${p}-check`,!canCheck);
      const map=rows[p],list=el(`${p}-events`),ids=new Set(s.observations.map(o=>o.id));
      for(const [id,row] of map)if(!ids.has(id)){row.off();row.li.remove();map.delete(id)}
      for(const observation of s.observations){
        let row=map.get(observation.id);
        if(!row){
          const li=document.createElement('li'),button=document.createElement('button'),label=document.createElement('span'),sequence=document.createElement('span');
          li.id=`${p}-event-${observation.id}`;button.id=`${p}-open-${observation.id}`;button.type='button';sequence.className='sequence';label.className='event-label';button.append(sequence,label);li.append(button);list.append(li);row={li,button,label,sequence};map.set(observation.id,row);
          const capturedBinding=binding,capturedRow=row;
          row.off=listen(button,'click',()=>{
            if(!active()||layout!==p||fixture.binding()!==capturedBinding||map.get(observation.id)!==capturedRow||!visible(button))return;
            retireFocus();selection=observation.id;origin={layout:p,id:observation.id,binding:capturedBinding};render();if(document.activeElement===button)focusLater(el('detail-title'),capturedBinding);
          });
        }
        row.label.textContent=PHASES[observation.event.phase];row.sequence.textContent=String(observation.id).padStart(2,'0');row.button.setAttribute('aria-pressed',String(selection===observation.id));row.button.setAttribute('aria-label',`查看第 ${observation.id} 筆觀察：${PHASES[observation.event.phase]}`);
        row.li.hidden=!!query&&!`${PHASES[observation.event.phase]} ${observation.event.phase}`.includes(query);
      }
      const count=[...map.values()].filter(row=>!row.li.hidden).length;text(`${p}-empty`,count?'':s.observations.length?'沒有符合篩選的本頁觀察。':'這個範圍尚無本頁觀察。');
      if(p==='a')text('filter-result',`顯示 ${count} 筆本頁觀察`);
    }
    text('a-count',`（${s.observations.length} 筆）`);text('log-limit',`只保留本頁最近 48 筆合成觀察${s.discarded?`；較早 ${s.discarded} 筆已移出本頁視窗`:''}。切換範圍／重設即清除，重新開頁不保留。`);
    const selected=currentSelection();if(!selected){selection=null;origin=null}el('event-detail').hidden=!selected;
    if(selected){text('detail-title',`第 ${selected.id} 筆公開觀察`);details(el('detail-body'),[['公開 phase',selected.event.phase],['公開說明',PHASES[selected.event.phase]],['run ID',selected.event.runId],['message ID',selected.event.messageId],['官方 card ID',selected.event.card??'無'],['收到次序',`本頁第 ${selected.id} 筆，非 Server 時間`]])}
    for(const id of ['stop-accepted','stop-false','stop-unknown'])disable(id,!active()||!s.pendingStop||!s.online);
    for(const id of ['check-running','check-completed','check-stopped','check-unknown','check-failed','check-missing'])disable(id,!active()||!s.pendingCheck||!s.online||(id==='check-missing'&&!!s.pendingCheck?.runId));
    disable('emit-phase',!active()||!s.online||s.stream!=='live'||s.status!=='running');disable('interrupt',!active()||s.stream!=='live');
    text('online-toggle',s.online?'切換合成離線':'恢復合成連線');text('simulation-counts',`本頁合成停止要求 ${s.stopCalls.length} 次；合成原結果讀取 ${s.readCalls.length} 次；啟動新運行 ${s.runsStarted} 次。`);
    const announcement=`${STATUS[s.status]}。${s.stream==='live'&&s.phase?PHASES[s.phase]:''}${s.cancel==='idle'?'':CANCEL[s.cancel]}${s.checkState==='idle'?'':CHECK[s.checkState]}`;
    if(announcement!==renderedStatus){text('live-status',announcement);renderedStatus=announcement}
    if((focused&&focused!==document.body&&!visible(focused)&&document.activeElement===focused)||(focused?.isConnected===false&&document.activeElement===document.body))lostFocus=true;
    if(lostFocus&&(document.activeElement===document.body||!visible(document.activeElement)))focusLater(el('workspace-title'));
  }
  for(const p of ['a','b']){
    action(`direction-${p}`,()=>{layout=p;selection=null;origin=null;render()});
    action(`${p}-stop`,()=>{if(layout===p)fixture.stop(fixture.binding())});action(`${p}-check`,()=>{if(layout===p)fixture.check(fixture.binding())});
  }
  listen(el('filter'),'compositionstart',()=>{composing=true});
  const filter=()=>{if(!active()||composing)return;retireFocus();query=el('filter').value;if(query)el('a-disclosure').open=true;render()};
  listen(el('filter'),'input',filter);listen(el('filter'),'compositionend',()=>{composing=false;filter()});
  action('b-jump-current',()=>{if(layout==='b')el('b-current-title').focus()});
  action('clear-filter',()=>{query='';el('filter').value='';render();focusLater(el('filter'))});
  action('close-detail',()=>{const anchor=origin,focused=document.activeElement===el('close-detail');selection=null;origin=null;render();if(focused){retireFocus();focusLater(()=>{const button=anchor&&anchor.binding===fixture.binding()&&anchor.layout===layout?rows[layout].get(anchor.id)?.button:null;return visible(button)?button:el('workspace-title')})}});
  action('emit-phase',()=>{const s=fixture.snapshot(),phase=el('phase-select').value;fixture.emit(fixture.binding(),{runId:s.runId??'33333333-3333-4333-8333-333333333333',messageId:fixture.binding().messageId,phase,...(phase==='help'?{card:'medical-consult-hk-v1'}:{})})});
  action('interrupt',()=>fixture.disconnect(fixture.binding()));action('online-toggle',()=>fixture.setOnline(!fixture.snapshot().online));
  for(const [id,outcome] of [['stop-accepted',true],['stop-false',false],['stop-unknown','unknown']])action(id,()=>fixture.settleStop(fixture.snapshot().pendingStop,outcome));
  for(const status of ['running','completed','stopped','unknown'])action(`check-${status}`,()=>{const t=fixture.snapshot().pendingCheck;if(t)fixture.settleCheck(t,{runId:t.runId??'33333333-3333-4333-8333-333333333333',status,...(!t.runId?{messageId:t.messageId}:{})})});
  action('check-failed',()=>fixture.settleCheck(fixture.snapshot().pendingCheck,'failed'));action('check-missing',()=>fixture.settleCheck(fixture.snapshot().pendingCheck,null));
  for(const name of ['live','interrupted','no-run'])action(`scenario-${name}`,()=>fixture.scenario(name));
  for(const space of ['A','B'])action(`scope-${space.toLowerCase()}`,()=>fixture.context(space));
  const unsubscribe=fixture.subscribe(render);render();
  return Object.freeze({render,retireFocus(){lostFocus=false;retireFocus()},destroy(){if(!alive)return;alive=false;lostFocus=false;retireFocus();unsubscribe();for(const cleanup of cleanups)cleanup();}});
}
