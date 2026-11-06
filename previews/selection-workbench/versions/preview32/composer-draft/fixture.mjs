// Offline, in-memory exhibition fixture. Never connect this to a production writer.
export const suggestions=['整理孩子的睡前流程','核對最近的睡眠記錄','先列出想問的問題'];
const blank=()=>({text:'',phase:'draft',operationId:null,originalText:null,savedMessageId:null,receipt:null,lastReceipt:null,runState:null,stopAccepted:false,notice:''});
const normalize=text=>text.replace(/\r\n?/gu,'\n').replace(/^(?:[^\S\n]*\n)+|(?:\n[^\S\n]*)+$/gu,'').replace(/\n(?:[ \t]*\n){2,}/gu,'\n\n');
export function createFixture(){
 let scope={user:'demo',child:'A',allowed:true,online:true,mediaGate:false},epoch=1,sequence=0,pending=null,book=new Map(),counts={save:0,check:0,reply:0,replyCheck:0},listeners=new Set();
 const draft=()=>{if(!book.has(scope.child))book.set(scope.child,blank());return book.get(scope.child)};
 const emit=()=>{for(const fn of listeners)fn()};
 const available=()=>scope.allowed&&!scope.mediaGate;
 const editable=()=>available()&&!pending&&draft().phase==='draft';
 const valid=()=>!!draft().text.trim()&&draft().text.length<=10000;
 const samePayload=()=>draft().originalText===null||normalize(draft().text)===draft().originalText;
 const canSend=()=>editable()&&scope.online&&valid()&&samePayload();
 function begin(kind){const d=draft();pending=Object.freeze({serial:++sequence,epoch,user:scope.user,child:scope.child,operationId:d.operationId,messageId:d.savedMessageId,kind});return pending}
 function current(t){return !!t&&!!pending&&t.serial===pending.serial&&t.epoch===epoch&&t.user===scope.user&&t.child===scope.child&&t.operationId===pending.operationId&&t.messageId===pending.messageId&&t.kind===pending.kind&&available()&&scope.online}
 function retire(){epoch++;pending=null;const d=draft();if(d.phase==='saving')d.phase='save_unknown';if(d.phase==='replying')d.phase='reply_failed'}
 const api={
 getSnapshot(){const d=draft();return structuredClone({...scope,...d,epoch,pending,counts,editable:editable(),canSend:canSend(),canCheck:available()&&scope.online&&!pending&&['save_unknown','checked'].includes(d.phase),canUnlock:available()&&scope.online&&!pending&&d.phase==='checked',canReply:available()&&scope.online&&!pending&&d.phase==='reply_failed'&&!!d.savedMessageId,canNew:available()&&!pending&&d.phase==='reply_failed',canClear:editable()&&!d.operationId,canRestore:editable()&&d.originalText!==null&&!samePayload(),canStop:available()&&scope.online&&!d.stopAccepted&&(d.phase==='replying'||d.runState==='running')})},
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
 setText(text){if(!editable())return false;draft().text=String(text);emit();return true},
 suggest(text){if(!editable()||draft().text.length)return false;return api.setText(text)},
 clear(){if(!api.getSnapshot().canClear)return false;draft().text='';draft().notice='合成草稿已清空；沒有刪除任何正式訊息。';epoch++;emit();return true},
 send(){if(!canSend())return null;const d=draft();if(!d.operationId){d.lastReceipt=d.receipt??d.lastReceipt;d.receipt=null;d.savedMessageId=null}d.text=normalize(d.text);d.originalText??=d.text;d.operationId??=`demo-op-${++sequence}`;d.phase='saving';d.notice='合成保存等待回報。回呼完成不代表取得收據。';counts.save++;const t=begin('save');emit();return t},
 callbackResolved(){/* Deliberately no state transition: resolution is not a receipt. */},
 check(){if(!api.getSnapshot().canCheck)return null;counts.check++;draft().notice='合成查核：沿用原操作識別，沒有重送文字。';const t=begin('check');emit();return t},
 unlock(){if(!api.getSnapshot().canUnlock)return false;draft().phase='draft';draft().notice='已明確解鎖合成原文重試。更改內容時不會另建新操作。';emit();return true},
 restoreOriginal(){if(!api.getSnapshot().canRestore)return false;draft().text=draft().originalText;emit();return true},
 retryReply(){if(!api.getSnapshot().canReply)return null;counts.replyCheck++;draft().notice='合成查核原回覆：有原運行就讀回，沒有才要求回覆。';const t=begin('reply-check');emit();return t},
 startNew(){if(!api.getSnapshot().canNew)return false;const old=draft();book.set(scope.child,{...blank(),lastReceipt:old.receipt,notice:'開始新的合成草稿。原已確認訊息並未撤銷。'});epoch++;emit();return true},
 stop(){if(!api.getSnapshot().canStop)return false;draft().stopAccepted=true;draft().notice='合成停止要求已受理；未證明已停止，亦不撤銷已保存內容。';emit();return true},
 settle(t,result){if(!current(t))return false;const d=draft();
  if(t.kind==='save'&&result==='unknown'){pending=null;d.phase='save_unknown';d.notice='合成保存結果未知。先查核原操作，暫不再次送出。'}
  else if(['save','check'].includes(t.kind)&&['saved','confirmed'].includes(result)){d.savedMessageId=`demo-msg-${d.operationId}`;d.receipt={operationId:d.operationId,result:{messageId:d.savedMessageId}};d.notice='合成收據確認原訊息已保存；回覆是另一階段。';pending=null;d.phase='reply_failed';if(t.kind==='save'){d.phase='replying';counts.reply++;begin('reply')}}
  else if(t.kind==='check'&&result==='unconfirmed'){pending=null;d.phase='checked';d.notice='合成查核尚無確認。這不是未保存證明；需明確解鎖才可沿原識別重試。'}
  else if(t.kind==='check'&&result==='unavailable'){d.receipt={operationId:d.operationId,result:null};d.lastReceipt=d.receipt;d.operationId=null;d.originalText=null;d.savedMessageId=null;d.text='';d.phase='draft';pending=null;d.notice='合成原操作已確認，但結果已不可用。不能推測哪則訊息已保存，也不自動重送。'}
  else if(t.kind==='check'&&result==='unknown'){pending=null;d.phase='save_unknown';d.notice='合成查核仍未知，原操作識別保留。'}
  else if(t.kind==='reply-check'&&['running','completed','stopped'].includes(result)){pending=null;d.runState=result;d.notice=result==='running'?'合成原回覆仍在處理，沒有再次執行。':'合成原運行已結束，應讀回其原結果；沒有再次執行。'}
  else if(t.kind==='reply-check'&&result==='absent'){pending=null;d.phase='replying';d.runState=null;d.stopAccepted=false;counts.reply++;begin('reply');d.notice='合成原運行不存在，現在等候這則已保存訊息的合成回覆。'}
  else if(t.kind==='reply'&&result==='reply-failed'){pending=null;d.phase='reply_failed';d.notice='合成回覆結果未確認；原訊息已保存。重試回覆不重新保存原文。'}
  else if(t.kind==='reply'&&result==='reply-complete'){const receipt=d.receipt;book.set(scope.child,{...blank(),lastReceipt:receipt,notice:'合成回覆已完成。這不是模型回答，也沒有寫入正式服務。'});pending=null}
  else return false;
  emit();return true;
 },
 context(patch){const changed=Object.entries(patch).some(([k,v])=>scope[k]!==v);if(!changed)return;const oldUser=scope.user;retire();if(patch.allowed===false)book.delete(scope.child);scope={...scope,...patch};if(!scope.allowed)book.delete(scope.child);if(scope.user!==oldUser)book.clear();emit()},
 reset(){retire();book.clear();scope={user:'demo',child:'A',allowed:true,online:true,mediaGate:false};counts={save:0,check:0,reply:0,replyCheck:0};emit()}
 };
 return api;
}
