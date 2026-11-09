// The owner inputs below are fixed synthetic fixtures, never production owners.
const ACTIVE=new Set(['saving','needs_confirmation','unknown','conflict','failed','confirmed_unread']);
export const context=s=>({identity:s.identity,scope:s.child==='none'?null:`${s.identity}/${s.child}`});
export function project(inputs,ctx){
 return inputs.flatMap(input=>{
  const current=input.kind==='identity'?ctx.identity:input.kind==='scope'?ctx.scope:null;
  if(!current||input.expected!==current||!input.available||!input.reviewable||!ACTIVE.has(input.state))return [];
  const status=input.state==='saving'?'進行中':input.state==='needs_confirmation'?'待確認':input.state==='failed'?'未完成':input.state==='conflict'?'需比較':'待核對';
  const tone=input.state==='saving'?'info':input.state==='failed'?'error':'warning';
  return [{...input,status,tone}];
 });
}
export function fixtures(s){
 const ctx=context(s),rows=[
  ['create-child','建立孩子','needs_confirmation','identity','/guide','create-child'],
  ['care','核對','unknown','scope','/care',null],
  ['profile','檔案','conflict','scope','/profile','profile'],
  ['tasks','待辦','none','scope','/tasks',null],
  ['growth','關注','failed','scope','/growth?tab=concerns',null],
  ['preparation','準備單','saved','scope','/growth?tab=preparation',null],
  ['contact','聯絡','saving','scope','/contact',null],
  ['model-settings','模型設定','confirmed_unread','identity','/settings?section=model',null],
 ];
 return rows.map(([id,page,state,kind,path,reveal],index)=>({
  id,page:s.scenario==='long'?`${page} · 合成長名稱，仍須保留完整頁面名稱及處理入口`:page,
  state:s.scenario==='quiet'?(index%2?'saved':'none'):state,kind,path,reveal,
  expected:s.scenario==='mismatch'&&id==='profile'?'retired-scope':ctx[kind],
  available:!(s.scenario==='lost'&&id==='care'),reviewable:true,
 }));
}
export const hints=s=>project(fixtures(s),context(s));
export function initial(){return {layout:'A',identity:'demo-user-A',child:'demo-child-A',scenario:'mixed',guard:'immediate',pending:null,held:null,route:null,reveal:null,sequence:0,feedback:'只顯示本次合成 owner 提供的操作狀態；點入口不會修正或清除它。'};}
function valid(s,ticket){return context(s)[ticket.kind]===ticket.expected;}
function arrive(s,ticket){
 if(!valid(s,ticket))return {...s,pending:null,feedback:'此導向回呼已失效，沒有跨範圍開啟入口。'};
 return {...s,pending:null,route:{...ticket,revealed:false},reveal:ticket.reveal?{key:ticket.key,target:ticket.reveal,kind:ticket.kind,expected:ticket.expected}:null,feedback:'已顯示合成處理入口，沒有保存、重試或批准，原 owner 狀態保持不變。'};
}
export function reduce(s,e){
 if(!e||typeof e!=='object')return s;
 if(e.type==='layout')return ['A','B'].includes(e.value)&&s.layout!==e.value?{...s,layout:e.value}:s;
 if(e.type==='identity')return ['demo-user-A','demo-user-B'].includes(e.value)&&s.identity!==e.value?{...s,identity:e.value,child:'demo-child-A',pending:null,route:null,reveal:null,feedback:'已切換合成身分並重設示例範圍、待決導向及入口。布局與示例種類保留；舊回呼不能沿用。'}:s;
 if(e.type==='child'){
  if(!['demo-child-A','demo-child-B','none'].includes(e.value)||s.child===e.value)return s;
  const pending=s.pending?.kind==='identity'?s.pending:null;
  return {...s,child:e.value,pending,route:null,reveal:null,feedback:pending?'已切換合成範圍；身分未變，因此身分層級的待決導向仍保留。範圍入口已清除。':'已切換合成範圍，並清除範圍待決導向及入口；舊範圍回呼失效。'};
 }
 if(e.type==='scenario')return ['mixed','quiet','lost','mismatch','long'].includes(e.value)&&s.scenario!==e.value?{...s,scenario:e.value,pending:null,route:null,reveal:null,feedback:e.value==='quiet'?'此合成 snapshot 只有 none／saved，因此沒有提示；不代表全站沒有事項或已全部完成。':'已替換合成 owner snapshot，待決導向及入口已清除，沒有修改正式資料。'}:s;
 if(e.type==='guard')return ['immediate','delayed'].includes(e.value)&&s.guard!==e.value?{...s,guard:e.value,feedback:'已修改接下來的合成導向方式；現有待決請求仍需明確處理。'}:s;
 if(e.type==='review'){
  const hint=hints(s).find(h=>h.id===e.id&&h.expected===e.expected);if(!hint)return s;
  const ticket={key:s.sequence+1,id:hint.id,page:hint.page,state:hint.state,status:hint.status,kind:hint.kind,expected:hint.expected,path:hint.path,reveal:hint.reveal};
  const next={...s,sequence:ticket.key};
  return s.guard==='delayed'?{...next,pending:ticket,held:ticket,route:null,reveal:null,feedback:'合成導向停在確認前，尚未開啟處理入口；此頁不是正式離頁保護。'}:arrive(next,ticket);
 }
 if(e.type==='resolve'){
  if(!s.pending||s.pending.key!==e.key||!s.held||s.held.key!==e.key)return {...s,feedback:'此導向回呼已失效或已消耗，沒有開啟新入口。'};
  return arrive(s,s.pending);
 }
 if(e.type==='cancel')return s.pending?{...s,pending:null,feedback:'已取消本次合成導向；owner 狀態不變。'}:s;
 if(e.type==='consume')return s.reveal&&s.route&&valid(s,s.reveal)?{...s,reveal:null,route:{...s.route,revealed:true},feedback:'已消耗一次本地展開意圖；這只展開示例區，沒有執行原 owner 操作。'}:s;
 if(e.type==='back')return s.route?{...s,route:null,reveal:null,feedback:'已返回操作提示，沒有清除原 owner 狀態。'}:s;
 return s;
}
