import {createScenario,scenarioOptions,readSyntheticResource} from './fixtures.mjs';
import {deliverSynthetic} from './simulator.mjs';
const sections=['target','changes','scope','decide'];
const titles={target:'對象與原參照',changes:'具體改動',scope:'可見範圍與限制',decide:'作出決定'};
const kindNames={family_document_change:'家庭文件修改',task_create:'建立任務',task_change:'更改任務',memory_fact:'新增記憶事實',memory_fact_revise:'更正記憶事實',memory_fact_deactivate:'停用記憶事實',private_source_create:'新增私人來源',private_source_change:'修改私人來源',concern_create:'新增持續關注',concern_change:'更改持續關注',invalidated:'正文已失效',expired:'期限已過',accepted:'已接受＋原收據','accepted-no-result':'已接受、沒有收據',dismissed:'已略過','run-unknown':'run 未知、提案仍可決定','missing-visibility':'事實範圍缺失','task-resolve':'任務覆核為取消','source-disable':'停用私人來源','concern-archive':'結束關注','concern-restore':'恢復關注','concern-followup':'調整站內跟進'};
const labels={pending:'待明確決定',accepted:'原快照已接受',dismissed:'原快照已略過',expired:'提案已過期'};
const targetLabels=new Set(['原文件及版本','原事實與版本','原任務','原任務版本','來源及原版本','原關注與版本','負責人','負責人識別','本人原話參照']);
const scopeLabels=new Set(['範圍','邊界','接受後可見範圍','明確授權交模型的片段','適用性聲稱','用途','來源','來源連結','有效至']);
const group=r=>targetLabels.has(r.label)?'target':scopeLabels.has(r.label)?'scope':'changes';
export function renderDecision(root,host){
 const d=root.ownerDocument;let disposed=false,rendering=false,again=false,renderId=0,intent=null,intentSerial=0;
 const el=(tag,text,attrs={})=>{const n=d.createElement(tag);if(text!==null)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
 const add=(parent,...children)=>{for(const child of children)if(child)parent.append(child);return parent;};
 const button=(text,attrs,handler,disabled=false)=>{const n=el('button',text,{type:'button',...attrs});n.disabled=disabled;if(handler)n.addEventListener('click',handler);return n;};
 const header=el('header',null,{class:'masthead'}),eyebrow=el('p','育伴港 / 選配工作台 / AD01',{class:'eyebrow'}),hero=el('h1','建議核對\n與批准'),strap=el('p','看清將改什麼，再作一個明確決定。',{class:'strap'});
 add(header,eyebrow,hero,strap,el('p','純合成 · 不連接正式帳戶 · 不會真的批准或修改資料',{class:'safety'}));
 const layoutBar=el('div',null,{class:'layout-bar','aria-label':'比較兩種資訊架構'}),layoutButtons={};
 for(const [key,name,desc]of [['guided','A 核對路徑','四章閱讀 → 明確決定'],['board','B 影響展台','全部並列 → 同頁定位']]){const b=button(name,{'data-layout':key},()=>{if(!disposed)act(()=>host.setLayout(key));});add(b,el('small',desc));layoutButtons[key]=b;layoutBar.append(b);}
 const tools=el('details',null,{class:'lab-settings'});tools.append(el('summary','合成情境與邊界設定'));
 const picker=el('select',null,{id:'ad-scenario','aria-describedby':'ad-lab-help'});for(const id of scenarioOptions)picker.append(el('option',kindNames[id],{value:id}));
 add(tools,el('label','合成提案類型',{for:'ad-scenario'}),picker,el('p','切換樣例會清除本頁已結束的示例。原決定未解或讀取中時，先保留它。',{id:'ad-lab-help'}));
 const conditions=el('div',null,{class:'conditions'});for(const[k,name]of [['online','合成離線狀態'],['writesBlocked','合成互鎖狀態']]){const b=button(name,{'data-condition':k},()=>act(()=>{const s=host.getSnapshot();return host.setConditions({[k]:!s[k]},host.controlToken());}));conditions.append(b);}
 tools.append(conditions);picker.addEventListener('change',()=>act(()=>host.loadScenario(createScenario(picker.value),host.controlToken())));
 const nav=el('nav',null,{'aria-label':'核對內容索引',class:'chapter-nav'}),navButtons={};
 sections.forEach((key,i)=>{const b=button(`${String(i+1).padStart(2,'0')} ${titles[key]}`,{'data-nav':key},()=>act(()=>host.navigateSection(key),host.getSnapshot().layout==='board'?`ad-section-${key}`:null));navButtons[key]=b;nav.append(b);});
 const status=el('p','',{id:'ad-status',class:'status',role:'status','aria-live':'polite','aria-atomic':'true',tabindex:'-1'}),content=el('div',null,{id:'ad-content'}),lab=el('aside',null,{id:'ad-lab','aria-label':'手動合成結果注入'}),footer=el('footer','兩種架構共用同一份合成提案與原決定。沒有儲存、模型或網絡呼叫。');
 add(footer,el('a','來源與驗證界線',{href:'./sources.md'}));root.replaceChildren(header,layoutBar,tools,nav,status,content,lab,footer);
 function act(fn,destination=null){
  if(disposed)return false;
  const mine={id:++intentSerial,origin:d.activeElement,destination};intent=mine;
  try{return fn();}finally{if(intent===mine)intent=null;}
 }
 function validAction(t,revision){return !disposed&&host.getSnapshot().revision===revision&&host.getSnapshot().epoch===t.epoch&&host.getSnapshot().presentationEpoch===t.presentationEpoch;}
 function actionButton(text,attrs,fn,disabled,s,t){return button(text,attrs,()=>{if(validAction(t,s.revision))act(fn);},disabled);}
 function textBlock(parent,label,value){add(parent,el('dt',label),el('dd',String(value)));}
 function finalSummary(proposal){
  // A final read-only review region, distinct from the canonical chapter rows and from decision controls.
  const summary=el('section',null,{'data-final-summary':'true','aria-label':'最後核對：完整改動與限制'});
  add(summary,el('h3','最後核對：完整改動與限制'),el('p',proposal.content,{class:'proposal-content'}));
  const resource=readSyntheticResource(proposal),reference=el('dl',null,{'data-final-resource':'true',class:'identity'});
  if(!resource)textBlock(reference,'資源參照','未提供有效的結構化資源參照；不能推斷原資源識別或版本。');
  else if(resource.mode==='update'){textBlock(reference,'原資源識別',resource.id);textBlock(reference,'原資源版本',resource.originalVersion);}
  else {textBlock(reference,'資源操作','建立新資源');textBlock(reference,'合成新資源識別',resource.id);textBlock(reference,'原資源版本','沒有原資源版本');}
  summary.append(reference);
  proposal.details.forEach((row,index)=>{const detail=el('dl',null,{'data-summary-row':index,class:'detail-row'});textBlock(detail,row.label,row.value);summary.append(detail);});
  summary.append(el('p','以上整份提案一起決定；各項修改不能分開接受。以下按鈕只作一次合成決定。',{class:'boundary'}));
  return summary;
 }
 function draw(){
  if(disposed)return;
  if(rendering){again=true;return;}
  rendering=true;
  try{do{again=false;const s=host.getSnapshot(),t=host.controlToken(),g=host.gates(),rid=++renderId,mine=intent;
   if(disposed)break;
   const oldActive=d.activeElement,retiring=content.contains(oldActive)||lab.contains(oldActive);
   // Explicit activation may retire its currently focused control. Background publications never focus.
   if(mine&&retiring&&oldActive===mine.origin){status.focus();if(disposed)break;if(host.getSnapshot()!==s||intent!==mine||rid!==renderId){again=true;continue;}}
   root.dataset.layout=s.layout;for(const key of ['guided','board'])layoutButtons[key].setAttribute('aria-pressed',String(s.layout===key));
   for(const key of sections)navButtons[key].setAttribute('aria-current',s.navigation===key?'location':'false');
   picker.disabled=!!s.pendingDecision||!!s.busy||s.disposed;
   conditions.querySelector('[data-condition="online"]').setAttribute('aria-pressed',String(!s.online));conditions.querySelector('[data-condition="writesBlocked"]').setAttribute('aria-pressed',String(s.writesBlocked));
   status.textContent=s.notice;content.replaceChildren();lab.replaceChildren();
   if(s.disposed){content.append(el('p','本頁呈現已結束。'));continue;}
   const p=s.proposal,available=s.binding?.private&&p&&p.id===s.target?.id&&p.kind===s.target.kind&&p.scope===s.target.scope&&p.version>=s.target.version&&s.readState!=='denied';
   const overview=el('div',null,{class:'overview'});add(overview,el('span',s.readState==='denied'?'私人資料已隱藏':available?labels[p.status]:'原提案不可用',{class:'state-tag'}),el('span',`本地讀取 ${s.localCounters.reads} · 合成送出 ${s.localCounters.submits}`,{class:'counters'}));content.append(overview);
   if(s.pendingDecision){const pending=el('aside',null,{class:'original','aria-label':'原決定仍待確認'});add(pending,el('strong','原決定仍在這裡'),el('p',`${s.pendingDecision.attempt.input.decision==='accept'?'原接受':'原略過'} · 提案版本 ${s.pendingDecision.attempt.input.expectedVersion} · ${s.pendingDecision.reviewed?'已讀同版本，仍未確認結果':'尚未重新讀取'}`),el('p','未知不等於失敗。切換架構、收起頁面，都不會重建或改寫原決定。'));content.append(pending);}
   if(s.runStatus==='unknown')content.append(el('p','run 狀態未知，不等於原決定結果未知；提案是否可決定仍由當前條件判斷。',{class:'boundary'}));
   if(s.dataError)content.append(el('p',s.dataError,{class:'warning'}));
   if(!available){content.append(el('p',s.readState==='denied'?'私人正文與收據已隱藏。':'找不到原指定提案。不能換成相鄰提案，也不能把缺失當作已略過。',{class:'empty'}));}
   const grid=el('div',null,{class:'reading-grid'});
   function region(key){const r=el('section',null,{'data-section':key,class:'panel panel-'+key,'aria-labelledby':`ad-section-${key}`});add(r,el('p',`0${sections.indexOf(key)+1} / ${key.toUpperCase()}`,{class:'section-number'}),el('h2',titles[key],{id:`ad-section-${key}`,tabindex:'-1'}));return r;}
   if(available)for(const key of sections){if(s.layout==='guided'&&s.navigation!==key)continue;const r=region(key);grid.append(r);
    if(key==='target'){add(r,el('h3',p.title,{class:'proposal-title'}),el('p','原正文未提供；這裡不虛構「修改前」內容。',{class:'boundary'}));const dl=el('dl',null,{class:'identity'});textBlock(dl,'提案識別',p.id);textBlock(dl,'提案版本',p.version);textBlock(dl,'原 run',s.target.runId);textBlock(dl,'合成私人範圍',s.binding.childId);r.append(dl);}
    if(key==='changes')add(r,el('h3',p.title),el('p',p.content,{class:'proposal-content'}),el('p','以下保留已提供的完整細節；各列不能分開批准。',{class:'boundary'}));
    if(key==='scope'){add(r,el('p',p.scope==='family'?'接受後：家庭共享資料。共享不代表其他家庭讀者有權替原 run 所有人批准。':'接受後：只供本人。不是家庭共享，也不外發。',{class:'scope-statement'}),el('p',`確認期限：${p.expiresAt}`),el('p','只在當前身份與有效私人 child 範圍內演示。此頁不是正式批准入口。',{class:'boundary'}));}
    if(key!=='decide')p.details.forEach((row,index)=>{if(group(row)!==key)return;const dl=el('dl',null,{'data-row':index,class:'detail-row'});textBlock(dl,row.label,row.value);r.append(dl);});
    if(key==='decide'){
     add(r,el('h3',p.title),el('p',`具體操作：${p.details.find(x=>x.label==='操作')?.value??kindNames[p.kind]}。提案識別：${p.id}。提案版本 ${p.version}。`),s.layout==='guided'?null:el('p',p.content,{class:'decision-summary'}),el('p',p.scope==='family'?'可見範圍：家庭共享；只採納原提案列出的改動。':'可見範圍：只限本人。'));
     if(['accepted','dismissed'].includes(p.status))r.append(el('p',p.status==='dismissed'?'本次快照：原提案已略過，沒有以此決定執行候選事項。':p.result?`本次快照的原資源：${p.result.id} · 資源版本 ${p.result.version}。不證明資源現在狀態或照護完成。`:'已接受；本次快照未提供保存收據，不能據此確認已保存。',{'data-current-outcome':'true',class:'warning'}));
     if(s.layout==='guided'){r.append(finalSummary(p));add(r,actionButton('返回逐段原文核對',{'data-action':'review'},()=>host.navigateSection('changes'),false,s,t));}
     if(p.version>s.target.version)add(r,el('p','版本已更新，請重新核對這份內容；原共享確認不沿用。',{class:'warning'}));
     if(p.contentState==='invalidated')r.append(el('p','正文已失效並遮蔽；不可接受，但仍可按原條件明確略過。',{class:'warning'}));
     if(!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.now()||p.status==='expired')r.append(el('p','確認期限無效或已過期；不能接受，可核對後明確略過。',{class:'warning'}));
     if(p.scope==='family'&&['pending','expired'].includes(p.status)){const wrap=el('div',null,{class:'shared-check'}),cb=el('input',null,{type:'checkbox',id:'ad-shared','data-shared':'true'});cb.checked=s.sharedConfirmed;cb.disabled=!g.check;cb.addEventListener('change',()=>{if(validAction(t,s.revision))act(()=>host.setSharedConfirmation(cb.checked,t));});add(wrap,cb,el('label','我已核對內容及對象，明確同意寫入家庭共享資料（合成）',{for:'ad-shared'}));r.append(wrap);}
     const actions=el('div',null,{class:'decision-actions'});
     if(['pending','expired'].includes(p.status)){add(actions,actionButton(`合成接受 · ${kindNames[p.kind]}`,{'data-action':'accept'},()=>host.decide(p.id,'accept',t),!g.accept,s,t),actionButton('合成略過此提案',{'data-action':'dismiss'},()=>host.decide(p.id,'dismiss',t),!g.dismiss,s,t));}
     if(s.pendingDecision)add(actions,actionButton(`合成重試原${s.pendingDecision.attempt.input.decision==='accept'?'接受':'略過'}`,{'data-action':'retry'},()=>host.retryOriginal(t),!g.retry,s,t));
     r.append(actions);add(r,el('p',s.busy?'本地請求等待手動合成結果；沒有預設成功。':!s.online?'目前合成離線，不能開始新決定。':s.writesBlocked?'其他操作互鎖中，不能開始新決定。':s.pendingDecision?'先讀取原結果，再按同版本與共享核對條件重試原決定。':'導航不代表批准。只有明確按下合成接受或略過才建立本地決定。',{class:'gate-help',tabindex:'0'}));
    }
    if(s.layout==='guided'){const i=sections.indexOf(key),step=el('div',null,{class:'step-actions'});if(i>0)step.append(actionButton('上一章（只導航）',{'data-prev':sections[i-1]},()=>host.navigateSection(sections[i-1]),false,s,t));if(i<3)step.append(actionButton(i===2?'前往決定（只導航）':'下一章（只導航）',{'data-next':sections[i+1]},()=>host.navigateSection(sections[i+1]),false,s,t));r.append(step);}
   }
   content.append(grid);
   if(s.priorEvidence&&s.readState!=='denied'){const e=s.priorEvidence,box=el('aside',null,{'data-evidence':'true',class:'evidence','aria-label':'合成歷史快照'});add(box,el('h2','合成歷史快照'),el('p',s.evidenceStale?'舊快照，最新狀態未核對。':'這是原提案快照，不是資源現在狀態。',{class:'warning'}),el('p',`原提案 ${e.proposalId} · 提案版本 ${e.proposalVersion} · 取得時間 ${e.observedAt}`),el('p',e.status==='dismissed'?'原提案已略過，沒有以此決定執行候選事項。':e.result?`原資源 ${e.result.id} · 資源版本 ${e.result.version}。只證曾保存，不代表照護完成，也不保證現在仍為該版本。`:'原提案已接受；本次快照未提供保存收據，不能據此確認已保存。'));content.append(box);}
   content.append(actionButton('合成讀取原結果',{'data-action':'read'},()=>host.readOriginal(t),!g.read,s,t));
   if(s.request){add(lab,el('h2','合成結果控制台'),el('p','此處手動注入一個本地回應，不是 Server。未選結果前不會自行完成。'));const names=s.request.kind==='write'?{unknown:'結果未知',saved:'匹配原決定＋原收據','no-result':'匹配原決定、無收據','400':'明確拒絕 400','409':'需要重核 409','405':'方法拒絕 405'}:{same:'同版本原快照',new:'較新版本',missing:'原提案缺失',failed:'讀取失敗',denied:'失去此範圍存取權'};for(const[name,label]of Object.entries(names))lab.append(actionButton(`注入：${label}`,{'data-sim':name},()=>deliverSynthetic(host,s.request,name),false,s,t));}
   if(mine?.destination&&mine.origin===d.activeElement&&intent===mine&&host.getSnapshot()===s){const destination=d.getElementById(mine.destination);if(destination)destination.focus();}
  }while(again&&!disposed);}finally{rendering=false;}
 }
 const unsubscribe=host.subscribe(draw);draw();
 return {dispose(){if(disposed)return;disposed=true;intent=null;intentSerial++;unsubscribe();root.replaceChildren();},retire(){if(disposed)return;intent=null;intentSerial++;host.retirePresentation();},isDisposed:()=>disposed};
}
