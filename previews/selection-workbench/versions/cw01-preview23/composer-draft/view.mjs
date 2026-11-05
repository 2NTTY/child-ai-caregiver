import {suggestions} from './fixture.mjs';
const copy={
 draft:['DRAFT / 本頁記憶體','還在草稿裏','尚未開始合成保存。可先編輯，再決定是否演示送出。'],
 saving:['SAVE / 等候收據','文字已交出，保存未確認','正在等待合成保存回報；不可把回呼返回當作收據。'],
 save_unknown:['UNKNOWN / 先核對原操作','保存結果未確認','原文和原識別仍保留。查核原操作後，才決定下一步。'],
 checked:['CHECKED / 需要明確決定','查過了，仍沒有確認','查不到確認不等於未保存。可明確解鎖原文重試，沿用原識別。'],
 replying:['REPLY / 與保存分開','原訊息已確認，等候回覆','這是合成回覆階段；沒有調用模型，也不會再保存一份相同訊息。'],
 reply_failed:['SAVED / 原訊息保留','訊息已確認，回覆待核對','可查核／重試這則原訊息的回覆，或明確開始新的合成草稿。']
};
export function mountComposer(doc,fixture,{frame=fn=>doc.defaultView.requestAnimationFrame(fn)}={}){
 const $=id=>doc.getElementById(id),input=$('draft'),win=doc.defaultView,cleanups=[];let composing=false,expanded=false,intent=0,lastEpoch=fixture.getSnapshot().epoch,focusTicket=null,lastPending=null,stale=null;
 const on=(el,event,fn,options)=>{el.addEventListener(event,fn,options);cleanups.push(()=>el.removeEventListener(event,fn,options))};
 const text=(id,value)=>{if($(id).textContent!==String(value))$(id).textContent=String(value)};
 const button=(id,show,enabled=true)=>{$(id).hidden=!show;$(id).disabled=!enabled};
 const invalidate=()=>{intent++;focusTicket=null};
 for(const event of ['pointerdown','wheel','touchmove','keydown'])on(doc,event,invalidate,{capture:true,passive:true});
 on(doc,'focusin',()=>{intent++;focusTicket=null},true);on(doc,'visibilitychange',()=>{if(doc.hidden)invalidate()});on(win,'blur',invalidate);
 function requestFocus(){const ticket={intent,epoch:fixture.getSnapshot().epoch};frame(()=>{const s=fixture.getSnapshot();if(ticket.intent===intent&&ticket.epoch===s.epoch&&s.editable&&!doc.hidden&&input.isConnected)input.focus({preventScroll:true})})}
 function send(keyboard=false){const before=fixture.getSnapshot();if(!before.canSend)return;const ticket=keyboard?{intent,epoch:before.epoch}:null;fixture.send();focusTicket=ticket}
 function completeCallback(){fixture.callbackResolved(fixture.getSnapshot().pending);const ticket=focusTicket;focusTicket=null;const s=fixture.getSnapshot();if(ticket&&ticket.intent===intent&&ticket.epoch===s.epoch&&s.editable&&!doc.hidden&&(doc.activeElement===doc.body||doc.activeElement===doc.documentElement))input.focus({preventScroll:true})}
 function setDirection(value){invalidate();const direction=value==='B'?'B':'A';doc.body.dataset.direction=direction;const editor=$('editor-panel'),status=$('operation-panel'),parent=editor.parentNode,first=direction==='B'?status:editor;if(parent.firstElementChild!==first)parent.insertBefore(first,parent.firstElementChild);for(const key of ['a','b'])$(`direction-${key}`).setAttribute('aria-pressed',String(key.toUpperCase()===direction));text('direction-copy',direction==='A'?'讓草稿留在視線中心；保存與回覆各自有清楚的訊號。':'先判讀原操作，再決定下一步。右側保留整份原稿，避免在恢復途中改錯內容。')}
 function render(){const s=fixture.getSnapshot();if(lastEpoch!==s.epoch){invalidate();composing=false;expanded=false;if(lastPending)stale=lastPending;lastEpoch=s.epoch}if(s.pending)lastPending=s.pending;
  if(input.value!==s.text)input.value=s.text;if(input.disabled!==!s.editable)input.disabled=!s.editable;
  text('context-label',`合成對象 ${s.child} · 身份 ${s.user==='demo'?'1':'2'}`);text('count',`${s.text.length.toLocaleString('en-US')} / 10,000`);
  text('validation',s.text.length>10000?'超出 10,000 個 UTF-16 字元，請縮短後再試。':s.canRestore?'這次內容已不同於原操作。請還原原文後再重試，系統不會另建操作。':'');input.setAttribute('aria-invalid',String(s.text.length>10000));
  $('send').disabled=!s.canSend;button('restore',s.canRestore);$('clear').disabled=!s.canClear;button('check',['save_unknown','checked'].includes(s.phase),s.canCheck);button('unlock',s.phase==='checked',s.canUnlock);button('reply',s.phase==='reply_failed',s.canReply);button('new',s.phase==='reply_failed',s.canNew);button('stop',s.phase==='replying'||s.runState==='running',s.canStop);
  if(s.text.length||!s.editable)expanded=false;$('suggest-toggle').disabled=!s.editable||!!s.text.length;$('suggest-toggle').setAttribute('aria-expanded',String(expanded));$('suggestions').hidden=!expanded;
  const [kicker,title,body]=copy[s.phase];text('status-kicker',kicker);text('status-title',s.runState==='running'?'原回覆仍在處理':title);text('status-body',s.notice||body);
  text('save-label',s.receipt?.result?'已獲合成收據':s.receipt?'原結果不可用':['saving','save_unknown','checked'].includes(s.phase)?'等待原確認':'尚未開始');text('reply-label',s.runState==='running'?'原運行處理中':s.phase==='replying'?'等候合成回覆':s.phase==='reply_failed'?'需查核／再要求':'尚未要求');
  $('stage-draft').dataset.state=s.phase==='draft'?'active':'done';$('stage-save').dataset.state=s.receipt?.result?'done':['saving','save_unknown','checked'].includes(s.phase)?'active':'idle';$('stage-reply').dataset.state=['replying','reply_failed'].includes(s.phase)?'active':'idle';
  const receipt=s.receipt;text('operation-id',s.operationId??receipt?.operationId??'未建立');text('receipt-label',receipt?(receipt.result?'合成收據：原訊息已確認':'合成收據：原結果不可用（null）'):'未取得；不能按相同文字猜測');text('message-id',s.savedMessageId??receipt?.result?.messageId??'未確認');text('previous-receipt',s.lastReceipt?`${s.lastReceipt.operationId} · 只供回顧，不是本稿保存確認`:'沒有');text('run-label',s.stopAccepted?'合成停止已受理，最後結果仍待核對':s.runState?`合成原運行：${s.runState}`:'沒有原運行確認');
  text('gate-note',!s.allowed?'模擬存取權已撤回，此對象草稿已清除。':s.mediaGate?'媒體原操作待核對：文字操作暫停。此頁不處理或移除媒體 reservation。':!s.online?'模擬離線：文字可留在本頁編輯，送出／查核暫停。':'正式接線仍須由原 owner 每次核對 scope、身份及寫入門檻。');
  $('scope-child').value=s.child;$('scope-user').value=s.user;$('online').checked=s.online;$('allowed').checked=s.allowed;$('media-gate').checked=s.mediaGate;
  const allowed={save:['unknown','saved'],check:['unknown','saved','unconfirmed','unavailable'],'reply-check':['running','absent'],reply:['reply-failed','reply-complete']};
  for(const b of doc.querySelectorAll('[data-result]'))b.disabled=!(s.pending&&allowed[s.pending.kind]?.includes(b.dataset.result));$('callback').disabled=!s.pending;$('late').disabled=!stale;
  text('lab-status',`合成保存 ${s.counts.save} · 原保存查核 ${s.counts.check} · 原回覆查核 ${s.counts.replyCheck} · 回覆要求 ${s.counts.reply}`);
 }
 on(input,'input',()=>{fixture.setText(input.value)});on(input,'compositionstart',()=>{composing=true});on(input,'compositionend',()=>{composing=false});
 on(input,'keydown',event=>{if(event.key!=='Enter'||event.shiftKey||composing||event.isComposing||event.keyCode===229)return;event.preventDefault();send(true)});
 on(input,'focus',()=>{expanded=false;render()});
 on($('send'),'click',event=>send(event.detail===0));
 on($('clear'),'click',()=>{invalidate();if(fixture.clear())requestFocus()});on($('restore'),'click',()=>{invalidate();if(fixture.restoreOriginal())requestFocus()});
 on($('suggest-toggle'),'click',()=>{const s=fixture.getSnapshot();if(!s.editable||s.text)return;expanded=!expanded;render()});for(const b of doc.querySelectorAll('[data-suggestion]'))on(b,'click',()=>{invalidate();if(fixture.suggest(suggestions[Number(b.dataset.suggestion)])){expanded=false;render();requestFocus()}});
 for(const [id,method] of [['check','check'],['unlock','unlock'],['reply','retryReply'],['new','startNew'],['stop','stop']])on($(id),'click',()=>{invalidate();fixture[method]()});
 for(const b of doc.querySelectorAll('[data-result]'))on(b,'click',()=>{const s=fixture.getSnapshot();const result=b.dataset.result==='saved'&&s.pending?.kind==='check'?'confirmed':b.dataset.result;fixture.settle(s.pending,result)});
 for(const [id,key] of [['scope-child','child'],['scope-user','user']])on($(id),'change',()=>fixture.context({[key]:$(id).value}));for(const [id,key] of [['online','online'],['allowed','allowed'],['media-gate','mediaGate']])on($(id),'change',()=>fixture.context({[key]:$(id).checked}));
 on($('reset'),'click',()=>{invalidate();fixture.reset();text('lab-status','合成情境已重設；沒有取消或刪除任何正式操作。')});on($('callback'),'click',completeCallback);on($('late'),'click',()=>{const accepted=fixture.settle(stale,'saved');text('lab-status',accepted?'合成舊結果已接納':'舊合成結果已拒絕：較新的身份／對象／權限優先。')});
 on($('direction-a'),'click',()=>setDirection('A'));on($('direction-b'),'click',()=>setDirection('B'));const unsubscribe=fixture.subscribe(render);render();
 return{render,setDirection,completeCallback,retireFocus:invalidate,destroy(){invalidate();unsubscribe();for(const cleanup of cleanups)cleanup()}};
}
