// Original DOM projection. Only the synthetic host owns checklist intent.
const statusText={idle:'未有待同步勾選。',queued:'勾選只在合成草稿，停頓 3 秒後排入演練。',saving:'合成原操作等待回覆，可以繼續勾選。',unknown:'結果未確認。保留原操作，先核對，再明確重試。',conflict:'版本不符。草稿保留，讀回後才可重新套用。'};
const modeText={ready:'可核對',stale:'來源已有更新，保留舊版本供核對，暫停改動。',restricted:'來源權限已撤回，內容及草稿已清除。',invalidated:'來源已失效，內容已隱藏。','unknown-source':'來源狀態未明，內容已隱藏。','read-only':'目前為唯讀，可查看但不能勾選。',offline:'目前離線，保留已讀內容，暫停勾選與排隊。','refresh-failed':'重新讀取失敗，保留上次內容，暫停改動。'};
const groups=['安排','隨身物品','出發前核對'];
export function mountPreparation(document,fixture){
 const app=document.getElementById('app');let live=true,direction='A',query='',composing=false,review=false,current='ticket',away=false,epoch=-1,wasSuspended=false;
 const listeners=[],rowListeners=[],rows=new Map(),groupsDOM=new Map();
 const el=id=>document.getElementById(id);
 app.innerHTML=`<a class="skip" href="#workspace-title">跳到準備清單</a>
 <div class="demo-banner"><strong>全合成・離線演練</strong><span>沒有連接家庭資料、服務或模型；勾選只留在本頁記憶體。</span></div>
 <header class="topbar"><div class="wordmark"><span aria-hidden="true">✦</span> 育伴港 <span class="quiet">選配工作台</span></div><nav aria-label="選擇設計方向" class="directions"><button id="direction-a" type="button" aria-pressed="true">A 星航總覽</button><button id="direction-b" type="button" aria-pressed="false">B 逐項核對</button></nav></header>
 <main id="main"><section class="masthead"><div><p class="module-label">備診準備 · 勾選草稿</p><h1 id="workspace-title" tabindex="-1">把出發前的小事，<br>逐項放好。</h1><p class="intro">只核對示例安排與物品，不提供診斷、用藥或醫療建議。</p></div><svg class="orbit-art" viewBox="0 0 260 170" aria-hidden="true"><ellipse cx="130" cy="85" rx="110" ry="56"/><ellipse cx="130" cy="85" rx="58" ry="78" transform="rotate(45 130 85)"/><path d="M111 77h38v40h-38zM119 77v-9a11 11 0 0 1 22 0v9"/><path d="m118 96 8 8 16-19"/><circle cx="33" cy="61" r="9"/><circle cx="218" cy="113" r="6"/><path d="m208 27 4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/></svg></section>
 <section id="operation-panel" aria-labelledby="operation-title"><div><h2 id="operation-title">這一批勾選</h2><p id="save-status" role="status" aria-live="polite"></p><p id="receipt-note" class="quiet"></p></div><div class="operation-actions"><button id="flush" type="button">現在排入合成演練</button><button id="recheck" type="button">核對原操作／讀回</button><button id="retry" type="button">重試同一原操作</button><button id="reapply" type="button">按讀回版本重套</button><button id="discard" type="button">捨棄未送出勾選</button></div></section>
 <section id="away" hidden aria-labelledby="away-title"><h2 id="away-title" tabindex="-1">暫離清單（合成）</h2><p>離開清單只催送原草稿，不代表完成保存。原操作仍由同一合成宿主持有。</p><button id="return-demo" type="button">返回原準備單</button></section>
 <section id="workspace"><div class="document-heading"><div><h2 id="document-title"></h2><p id="document-meta" class="quiet"></p></div><button id="leave-demo" type="button">暫離清單演練</button></div><p id="gate-note" class="gate-note"></p>
 <div class="read-tools"><label for="search">找清單項目<input id="search" type="search" autocomplete="off" placeholder="例如：文件夾" aria-describedby="search-note"></label><button id="clear-search" type="button">清除搜尋</button><p id="search-note">只搜尋本頁合成清單，不改動草稿。</p></div>
 <div id="checklists"><section id="layout-a" aria-label="分區總覽"><div class="overview-heading"><h3>準備航圖</h3><p id="overall-count"></p></div><div class="check-grid" id="a-groups"></div></section>
 <section id="layout-b" hidden aria-label="逐項核對"><div class="stepbar"><div><h3 id="step-title">逐項核對</h3><p id="step-count"></p></div><button id="review-toggle" type="button" aria-expanded="false" aria-controls="review-list">查看勾選差異</button></div><div id="step-cards"></div><nav id="step-nav" aria-label="逐項前後導航"><button id="prev-item" type="button">上一項</button><button id="next-item" type="button">下一項</button></nav><div id="review-list" hidden><h3 tabindex="-1" id="review-title">逐項覆核</h3><p>左側是合成讀回；右側是本頁意圖。回到任何一項都不會自動重送。</p><ul id="review-rows"></ul></div></section></div>
 <p id="no-results" hidden>找不到符合的已載入項目。試試其他字詞。</p></section>
 <section class="fixture" aria-labelledby="fixture-title"><div><h2 id="fixture-title">合成情境控制</h2><p>下面只改這個示例。請先勾一項，再選擇這次回覆。</p></div><div class="fixture-actions"><button id="result-saved" type="button">回覆：合成確認</button><button id="result-unknown" type="button">回覆：結果未明</button><button id="result-conflict" type="button">回覆：版本不符</button></div><div class="fixture-settings"><label for="mode">文件可用狀態<select id="mode"><option value="ready">可核對</option><option value="stale">來源已更新</option><option value="read-only">唯讀</option><option value="offline">離線</option><option value="refresh-failed">讀取失敗</option><option value="restricted">撤回來源權限</option><option value="invalidated">來源失效</option><option value="unknown-source">來源狀態未知</option></select></label><button id="context-switch" type="button">切換合成孩子</button><button id="projection-update" type="button">更新同版本示例文字</button><button id="reset" type="button">重設本頁演練</button></div><p id="operation-ref" class="quiet"></p></section>
 <footer><strong>PC01：一個模組，兩個操作方向。</strong><p>正式功能只提供清單勾選；正文與文字編輯、建立文件、版本索引、PDF、分享及模型均不在此候選。正式 checkItem 回呼沒有成功收據，此處的「合成確認」不是正式保存證明。</p><p>重新載入會清除示例草稿。瀏覽器返回快取只暫停／恢復當前記憶體，不保證恢復或持久保存。</p></footer></main>`;
 document.body.dataset.direction='A';
 const on=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
 const onRow=(node,type,fn)=>{node.addEventListener(type,fn);rowListeners.push(()=>node.removeEventListener(type,fn));};
 const node=(tag,attrs={},text='')=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);n.textContent=text;return n;};
 const available=node=>live&&!fixture.snapshot().suspended&&node.isConnected&&!node.closest('[hidden]');
 const button=(id,fn)=>on(el(id),'click',event=>{if(!available(event.currentTarget))return;fn(event);});
 const mark=(id,allowed)=>el(id).setAttribute('aria-disabled',String(!allowed));
 const focusIfLost=(old)=>{if(!old||old===document.body)return;if((!old.isConnected||old.closest('[hidden]'))&&(document.activeElement===old||document.activeElement===document.body))el('workspace-title').focus();};
 const buildRows=state=>{
  for(const remove of rowListeners.splice(0))remove();rows.clear();groupsDOM.clear();el('a-groups').replaceChildren();el('step-cards').replaceChildren();el('review-rows').replaceChildren();
  for(const group of groups){const field=node('fieldset',{class:'group'}),legend=node('legend',{},group),count=node('p',{class:'group-count'}),list=node('div',{class:'group-items'});field.append(legend,count,list);el('a-groups').append(field);groupsDOM.set(group,{field,count,list});}
  for(const item of state.items){
   const rowEpoch=state.epoch,entry={};
   for(const layout of ['a','b']){
    const row=node(layout==='a'?'div':'article',{id:layout==='a'?`a-row-${item.id}`:`b-card-${item.id}`,class:layout==='a'?'check-row':'step-card'});
    const control=node('input',{id:`${layout}-${item.id}`,type:'checkbox','aria-describedby':`${layout}-state-${item.id}`});
    const label=node('label',{for:control.id}),text=node('span',{class:'item-text'}),stamp=node('span',{id:`${layout}-state-${item.id}`,class:'item-state'});
    label.append(control,text);row.append(label,stamp);
    if(layout==='b')row.prepend(node('p',{class:'step-group'},item.group));
    const fresh=()=>available(control)&&fixture.snapshot().epoch===rowEpoch&&direction===layout.toUpperCase()&&!away&&(layout==='a'||!review&&current===item.id);
    onRow(control,'click',e=>{if(!fresh()||!fixture.snapshot().canEdit)e.preventDefault();});
    onRow(control,'change',()=>{if(!fresh())return;fixture.edit(fixture.binding(),item.id,control.checked);render();});
    if(layout==='a')groupsDOM.get(item.group).list.append(row);else el('step-cards').append(row);
    entry[layout]={row,control,text,stamp};
   }
   const reviewRow=node('li',{class:'review-row'}),reviewText=node('span'),reviewState=node('span',{class:'review-state'}),jump=node('button',{id:`review-${item.id}`,type:'button'},'回到這項');
   onRow(jump,'click',()=>{if(!available(jump)||!review||direction!=='B'||fixture.snapshot().epoch!==rowEpoch)return;current=item.id;review=false;render();const target=rows.get(item.id)?.b.control;if(target&&available(target))target.focus();});
   reviewRow.append(reviewText,reviewState,jump);el('review-rows').append(reviewRow);entry.review={row:reviewRow,text:reviewText,state:reviewState,jump};entry.group=item.group;rows.set(item.id,entry);
  }
 };
 const matching=state=>state.items.filter(item=>(item.text+' '+item.group).toLocaleLowerCase('zh-HK').includes(query.trim().toLocaleLowerCase('zh-HK')));
 function render(){if(!live)return;const old=document.activeElement,state=fixture.snapshot();
  if(epoch!==state.epoch){epoch=state.epoch;query='';composing=false;el('search').value='';review=false;current='ticket';buildRows(state);}
  if(state.suspended||wasSuspended){composing=false;if(el('search').value!==query)el('search').value=query;}wasSuspended=state.suspended;
  // Revocation clears both visible and hidden projections; never just hide stale text.
  const ids=new Set(state.items.map(x=>x.id));for(const[id,row]of rows)if(!ids.has(id)){row.a.row.remove();row.b.row.remove();row.review.row.remove();rows.delete(id);}
  el('document-title').textContent=state.title||'準備單暫不可讀';el('document-meta').textContent=`合成孩子 ${state.context} · 文件 v${state.version} · 示範日期 2030 年 6 月 18 日`;
  el('save-status').textContent=state.receipt?`合成回覆已確認這批勾選（v${state.receipt.version}），只更新本頁示例。`:statusText[state.phase];
  el('receipt-note').textContent=state.receipt?`示例原操作 ${state.receipt.opId}。不是正式服務收據。`:'未取得這一批的合成確認。勾選外觀、等待結束或讀回都不代表保存。';
  el('gate-note').textContent=modeText[state.mode]||'';el('mode').value=state.mode;
  mark('flush',state.canEdit&&state.dirty&&!fixture.pending());mark('recheck',state.canRecheck);mark('retry',state.canRetry);mark('reapply',state.canReapply);mark('discard',state.canDiscard);
  for(const result of ['saved','unknown','conflict'])mark(`result-${result}`,!!fixture.pending()&&!state.suspended);
  el('operation-ref').textContent=`本頁合成寫入批次／嘗試：${state.writes}。${state.operationId?`保留原操作 ${state.operationId}。`:'沒有未確認原操作。'}`;
  el('workspace').hidden=away;el('away').hidden=!away;el('layout-a').hidden=direction!=='A';el('layout-b').hidden=direction!=='B';
  el('checklists').hidden=!state.items.length;el('read-tools')?.setAttribute('aria-disabled',String(!state.items.length));
  const matches=matching(state),shown=new Set(matches.map(x=>x.id));if(!shown.has(current))current=matches[0]?.id??'';
  el('no-results').hidden=matches.length>0||state.items.length===0;el('overall-count').textContent=`${state.items.filter(x=>x.checked).length} / ${state.items.length} 項已勾選 · 勾選不等於已同步`;
  for(const item of state.items){const row=rows.get(item.id);if(!row)continue;for(const layout of ['a','b']){const part=row[layout];part.text.textContent=item.text;if(part.control.checked!==item.checked)part.control.checked=item.checked;part.control.setAttribute('aria-disabled',String(!state.canEdit));part.stamp.textContent=item.draft?'本頁勾選意圖':item.savedChecked?'合成讀回：已勾選':'合成讀回：未勾選';part.row.dataset.checked=String(item.checked);part.row.hidden=layout==='a'?!shown.has(item.id):review||current!==item.id||!shown.has(item.id);}
   row.review.text.textContent=item.text;row.review.state.textContent=`讀回：${item.savedChecked?'已勾':'未勾'} ／ 本頁：${item.checked?'已勾':'未勾'}`;row.review.jump.setAttribute('aria-label',`回到這項：${item.text}`);row.review.row.hidden=!shown.has(item.id);
  }
  for(const[group,g]of groupsDOM){const values=state.items.filter(x=>x.group===group);g.count.textContent=`${values.filter(x=>x.checked).length} / ${values.length} 已勾選`;g.field.hidden=!matches.some(x=>x.group===group);}
  const index=matches.findIndex(x=>x.id===current);el('step-count').textContent=matches.length?`第 ${index+1} 項，共 ${matches.length} 項。可隨時查看差異。`:'沒有符合項目';
  mark('prev-item',!review&&index>0);mark('next-item',!review&&index>=0&&index<matches.length-1);el('step-nav').hidden=review||!matches.length;
  el('review-list').hidden=!review;el('review-toggle').setAttribute('aria-expanded',String(review));el('review-toggle').textContent=review?'返回逐項核對':'查看勾選差異';
  for(const value of ['A','B'])el(`direction-${value.toLowerCase()}`).setAttribute('aria-pressed',String(value===direction));
  focusIfLost(old);
 }
 const setDirection=value=>{if(!live||!['A','B'].includes(value))return;direction=value;document.body.dataset.direction=value;render();};
 button('direction-a',()=>setDirection('A'));button('direction-b',()=>setDirection('B'));
 on(el('search'),'compositionstart',event=>{if(available(event.currentTarget))composing=true;});on(el('search'),'compositionend',event=>{if(!available(event.currentTarget))return;composing=false;query=el('search').value;render();});
 on(el('search'),'input',event=>{if(!available(event.currentTarget)||composing||event.isComposing)return;query=el('search').value;render();});
 button('clear-search',()=>{composing=false;query='';if(el('search').value!=='')el('search').value='';render();el('search').focus();});
 button('review-toggle',()=>{if(direction!=='B'||away)return;review=!review;render();});
 for(const[buttonId,delta]of [['prev-item',-1],['next-item',1]])button(buttonId,()=>{if(direction!=='B'||review||away)return;const values=matching(fixture.snapshot()),index=values.findIndex(x=>x.id===current),next=values[index+delta];if(!next)return;current=next.id;render();});
 for(const[id,method]of [['flush','flush'],['recheck','recheck'],['retry','retry'],['reapply','reapply'],['discard','discard']])button(id,()=>{if(el(id).getAttribute('aria-disabled')==='true')return;fixture[method]();});
 for(const result of ['saved','unknown','conflict'])button(`result-${result}`,()=>fixture.settle(fixture.pending(),result));
 on(el('mode'),'change',()=>{if(available(el('mode')))fixture.project({mode:el('mode').value});});
 button('context-switch',()=>fixture.context(fixture.snapshot().context==='A'?'B':'A'));
 button('projection-update',()=>fixture.project({label:'同版本的合成到診準備',itemText:{id:'ticket',text:'再核對合成預約卡的示例安排'}}));
 button('reset',()=>fixture.context('A'));
 button('leave-demo',()=>{fixture.flush();away=true;render();el('away-title').focus();});
 button('return-demo',()=>{away=false;render();el('workspace-title').focus();});
 on(document.querySelector('.skip'),'click',event=>{event.preventDefault();el('workspace-title').focus();});
 const unsubscribe=fixture.subscribe(render);render();
 return {render,setDirection,destroy(){if(!live)return;live=false;unsubscribe();for(const remove of [...listeners,...rowListeners])remove();rows.clear();groupsDOM.clear();app.replaceChildren();}};
}
