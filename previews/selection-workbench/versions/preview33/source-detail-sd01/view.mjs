import {deriveSourceView,deriveRevisionView} from './model.mjs';
const purpose={answer_reference:'回答參考',record_candidate:'記錄候選',track_topic:'追蹤主題'};
const nature={unspecified:'未指定性質',external_material:'外部資料',claimed_official:'自述官方資料',personal_observation:'個人觀察'};
const period={unspecified:'未指定期間',long_reference:'長期參考',recent:'近期',specific_period:'指定期間'};
const errors={transport:'連線模擬失敗',malformed:'資料形狀未通過',not_found:'合成來源不可讀；正式重核由原 owner 處理',denied:'合成權限已撤回，私人內容不可讀',cancelled:'這次合成讀取已取消'};
export function mountSourceDetail(root,host){
 const doc=root.ownerDocument,events=new WeakMap();let retired=false,frame=null,nodes=null,focusSequence=0;
 const el=(tag,text='',attrs={})=>{const n=doc.createElement(tag);n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const text=(n,value)=>{const s=String(value??'');if(n.textContent!==s)n.textContent=s;};
 const button=(action,label)=>el('button',label,{'type':'button','data-action':action});
 const heading=(label,id)=>el('h2',label,{id,tabindex:'-1'});
 const focusin=()=>{focusSequence++;};doc.addEventListener('focusin',focusin,true);
 function build(s){
  const mode=s.currentPresentation.mode,box=el('div','',{'class':`workspace mode-${mode}`});
  const header=el('header','',{'class':'masthead'}),eyebrow=el('p','育伴港 / SD01 / 私人來源閱讀實驗',{'class':'eyebrow'}),title=el('h1',mode==='A'?'原文檢閱台':'來源沿革台');
  const lead=el('p',mode==='A'?'從現在保存的文字開始，沿著管理修訂回看用途。':'先看管理設定如何改動，再對照現在保存的文字。',{'class':'lead'});
  const modes=el('nav','',{'aria-label':'閱讀路徑','class':'modes'});const modeA=button('mode-A','A · 保存文字先行'),modeB=button('mode-B','B · 管理沿革先行');modes.append(modeA,modeB);header.append(eyebrow,title,lead,modes);
  const identity=el('section','',{'class':'identity','aria-labelledby':'sd01-identity'}),identityHeading=heading('來源身份','sd01-identity');identityHeading.dataset.identityHeading='';
  const label=el('p','',{'class':'source-label'}),identityMeta=el('p'),sourceUrl=el('p','',{'class':'breakable'}),readSource=button('read-source','讀取這份來源（合成）'),detailStatus=el('p','',{'role':'status','aria-live':'polite'});
  identity.append(identityHeading,label,identityMeta,sourceUrl,readSource,detailStatus);
  const axes=el('section','',{'aria-label':'四種不同的來源狀態','class':'axes'});const originalAxis=el('p'),candidateAxis=el('p'),confirmedAxis=el('p'),referenceAxis=el('p');axes.append(originalAxis,candidateAxis,confirmedAxis,referenceAxis);
  const operation=el('p','',{'class':'notice'});
  const layout=el('div','',{'class':'reading-layout'});
  const original=el('section','',{'data-region':'original','aria-labelledby':'sd01-original','class':'original'}),originalHeading=heading('現在保存文字','sd01-original');
  const currentWarning=el('p','',{'data-current-warning':'','class':'notice'}),body=el('div','',{'data-body':'','tabindex':'0','aria-label':'保存文字閱讀區','class':'body-text'}),bodyReason=el('p');
  const techButton=button('technical','來源技術資料'),technical=el('div','',{'id':'sd01-technical','data-technical':'','class':'technical'});techButton.setAttribute('aria-controls','sd01-technical');
  const candidateButton=button('candidate','展開未確認候選'),candidate=el('div','',{'id':'sd01-candidate','class':'candidate'});candidateButton.setAttribute('aria-controls','sd01-candidate');
  const returnRevision=button('return-revision','返回所選管理修訂');original.append(originalHeading,currentWarning,body,bodyReason,techButton,technical,candidateButton,candidate,returnRevision);
  const history=el('section','',{'data-region':'history','aria-labelledby':'sd01-history','class':'history'}),historyHeading=heading('管理沿革','sd01-history'),historyIntro=el('p','只記用途與授權設定的變動。不是正文版本庫。'),readHistory=button('read-history','讀取管理沿革（合成）'),historyStatus=el('p','',{'role':'status','aria-live':'polite'}),revisionList=el('div','',{'class':'revision-list','aria-label':'已載管理修訂'}),revisionDetail=el('article','',{'data-revision-detail':'','class':'revision-detail'}),revisionDescription=el('div'),returnOriginal=button('return-original','返回保存文字讀點'),compare=button('compare-current','對照目前保存文字');
  revisionDetail.append(revisionDescription,returnOriginal,compare);history.append(historyHeading,historyIntro,readHistory,historyStatus,revisionList,revisionDetail);
  if(mode==='A')layout.append(original,history);else layout.append(history,original);
  const limits=el('section','',{'class':'limits','aria-labelledby':'sd01-limits'});limits.append(heading('能力邊界','sd01-limits'),el('p','只有合成保存文字；沒有原 PDF、照片、附件 bytes。SHA 僅描述文字完整性，不證明內容可信。',{id:'sd01-original-reason'}),el('p','正式 owner、adapter、API、原附件及寫入工具均未接線。所有以下動作停用，不會假成功。',{id:'sd01-action-reason'}));
  const unavailable=el('div','',{'class':'unavailable'});for(const label of ['開啟原網站','下載原附件','查看正式照顧記錄','編輯來源','採用候選','確認記錄','分享來源','取得網頁','模型提取','刪除來源','查核原收據']){const b=el('button',label,{'type':'button','disabled':'','data-unconnected':'','aria-describedby':label.includes('原')?'sd01-original-reason':'sd01-action-reason'});unavailable.append(b);}limits.append(unavailable);
  box.append(header,identity,axes,operation,layout,limits);
  return {box,modeA,modeB,identityHeading,label,identityMeta,sourceUrl,readSource,detailStatus,originalAxis,candidateAxis,confirmedAxis,referenceAxis,operation,original,originalHeading,currentWarning,body,bodyReason,techButton,technical,candidateButton,candidate,returnRevision,history,historyHeading,readHistory,historyStatus,revisionList,revisionDetail,revisionDescription,returnOriginal,compare,revisionButtons:new Map()};
 }
 function render(s){
  if(retired||!s.alive||host.snapshot().publicationRevision!==s.publicationRevision)return;
  const key=`${s.lifetime}:${s.currentPresentation.mode}`;
  if(frame?.key!==key){const next=build(s);if(retired||!host.snapshot().alive||host.snapshot().publicationRevision!==s.publicationRevision)return;frame={key};nodes=next;root.replaceChildren(nodes.box);}
  if(retired||!host.snapshot().alive||host.snapshot().publicationRevision!==s.publicationRevision)return;
  const n=nodes,p=s.currentPresentation,v=s.source,m=deriveSourceView(s),c=s.context,a=c.authority;
  n.modeA.setAttribute('aria-pressed',String(p.mode==='A'));n.modeB.setAttribute('aria-pressed',String(p.mode==='B'));
  text(n.label,v?.sourceLabel||'合成單一來源交接');text(n.identityMeta,`本人私人來源 · 合成資料 · ${v?`現在保存版本 v${v.version}`:'尚未讀取正文'} · ${c.allowedTargetId??'沒有來源目標'}`);text(n.sourceUrl,v?.sourceUrl?`保存網址（純文字，不外開）：${v.sourceUrl}`:'沒有可顯示的保存網址');
  const canRead=!!c.allowedTargetId&&a.online&&a.ownerReady&&a.privateRead&&a.role!==null&&!s.busy&&!Object.values(c.blockers).some(Boolean)&&s.detailRead.load!=='denied';
  n.readSource.disabled=!canRead; n.readHistory.disabled=!canRead||!v||!s.detailRead.fresh;
  text(n.readSource,v?'重新讀取詳情（合成）':'讀取這份來源（合成）');
  const reason=!a.privateRead||a.role===null?'合成權限已撤回，私人內容不可讀':!a.online?'離線合成情境；新讀取暫不可用':!a.ownerReady?'來源 owner 前置未 ready':Object.values(c.blockers).some(Boolean)?'原操作或衝突阻擋新讀取；仍可閱讀已載內容':'';
  text(n.detailStatus,reason||(s.detailRead.load==='loading'?'正在讀取合成來源；已載內容保持原閱讀意圖':s.detailRead.errorTag?`詳情讀取未成功：${errors[s.detailRead.errorTag]}${v?'；保留舊資料':''}`:v?`詳情${s.detailRead.fresh?'這次已核對':'尚待重新核對，顯示舊資料'}。`:'先讀取這份來源，再明確讀取管理沿革。'));
  text(n.originalAxis,`保存內容 / ${{saved_text:'只有保存文字',no_text:'沒有保存正文',disabled:'目前停用',unavailable:'尚未可讀',denied:'不可讀'}[m.originalCapability]}`);text(n.candidateAxis,`提取候選 / ${m.candidateLabel} · ${v?.extraction.state??'尚無資料'}`);text(n.confirmedAxis,`確認連結 / ${m.confirmedLabel}`);text(n.referenceAxis,`參考能力 / ${m.referenceLabel} · ${m.indexLabel}`);text(n.operation,m.operationLabel);
  text(n.currentWarning,v?`現在保存版本 v${v.version}；不是所選修訂的舊正文。${m.fetchLabel}。`:'尚未讀取現在保存文字。');
  text(n.body,m.originalCapability==='saved_text'?v.text:'');text(n.bodyReason,m.originalCapability==='disabled'?'目前來源已停用，保存正文不展開。':m.originalCapability==='no_text'?'這份來源沒有保存正文。':'');n.body.hidden=m.originalCapability!=='saved_text';
  n.original.hidden=p.mode==='B'&&(!v||p.selectedRevisionVersion===null||p.panel!=='original');
  n.techButton.disabled=!v;n.candidateButton.disabled=!v?.extraction.draft;n.techButton.setAttribute('aria-expanded',String(p.disclosures.technical));n.candidateButton.setAttribute('aria-expanded',String(p.disclosures.candidate));n.technical.hidden=!p.disclosures.technical;n.candidate.hidden=!p.disclosures.candidate;
  text(n.technical,v?`本站保存：${v.createdAt}\n取得正文：${v.retrievedAt??'未提供'}\n來源日期原文：${v.sourceDateText??'未提供'}\n私人備註：${v.sourceNotes}\n正文 SHA-256：${v.sha256??'未提供完整性資料'}`:'');
  const d=v?.extraction.draft;text(n.candidate,d?`未確認候選\n${d.text}\n數值：${d.rawValue||'未知'} · 單位：${d.unit||'未知'} · ${d.approximate?'包含約數':'未標記約數'}\n時間原文：${d.timeRaw||'未知'}\n${d.uncertainties.join('\n')}\n提取原片段：${v.extraction.excerpt??'未提供'}`:'');
  const h=s.historyRead;let status='尚未讀取管理沿革。';
  if(!v)status='先讀取這份來源；沿革沒有被暗中讀取。';else if(h.load==='loading')status='正在讀取管理沿革；已載修訂仍可選。';else if(h.load==='error')status=`沿革讀取失敗：${errors[h.errorTag]}；請明確重新讀取。`;else if(h.load==='ready')status=h.revisions.length?`這次已載 ${h.revisions.length} 筆管理修訂。${h.fresh?'':'另次舊資料，尚待重新核對。'}${h.hasMore?'較早記錄未載；沒有續頁 cursor。':''}`:h.fresh?'這次已載沒有管理修訂。':'沿革舊頁尚待重新核對，不能當成空結果。';
  if(v&&h.load==='ready'&&h.revisions.length&&p.selectedRevisionVersion===null)status+=' 尚未選取修訂，或原修訂已不在這次載入頁；請明確選擇。';
  text(n.historyStatus,status);
  const versions=new Set(h.revisions.map(r=>r.version));for(const [version,b]of n.revisionButtons)if(!versions.has(version)){b.remove();n.revisionButtons.delete(version);}
  h.revisions.forEach((r,index)=>{let b=n.revisionButtons.get(r.version);if(!b){b=button(`revision-${r.version}`,'');b.dataset.revision=String(r.version);n.revisionButtons.set(r.version,b);}text(b,`v${r.version} · ${r.changedAt.slice(0,10)}\n${r.reason}`);b.setAttribute('aria-pressed',String(p.selectedRevisionVersion===r.version));if(n.revisionList.children[index]!==b)n.revisionList.insertBefore(b,n.revisionList.children[index]??null);});
  const r=deriveRevisionView(s,p.selectedRevisionVersion);n.revisionDetail.hidden=!r||p.panel!=='history';
  text(n.revisionDescription,r?`管理修訂 v${r.version}\n${r.provenance}\n時間：${r.changedAt}\n原因：${r.reason}\n${r.managementLabel}\n${r.purpose?`${purpose[r.purpose]} · ${nature[r.nature]} · ${period[r.timeScope]}\n用途說明：${r.intention}\n適用期間／條件：${r.validityText||'未指定'}\n當時${r.enabled?'啟用':'停用'} · ${r.hasExcerpt?'有摘錄授權':'沒有摘錄授權'}`:''}`:'選擇一筆已載管理修訂。');
  n.returnOriginal.hidden=p.mode!=='A';n.compare.hidden=p.mode!=='B';n.returnRevision.hidden=p.mode!=='B';
 }
 const eligible=n=>!!n&&n.isConnected&&root.contains(n)&&!n.disabled&&!n.closest('[hidden],[inert]');
 function capture(e){if(retired)return;const s=host.snapshot();if(!s.alive)return;events.set(e,{ticket:host.ticket(),snapshot:s,frame,origin:doc.activeElement,focusSequence});}
 function handle(e){
  const captured=events.get(e);if(retired||!captured||frame!==captured.frame||e.defaultPrevented||e.isComposing)return;
  let b=e.target.closest?.('[data-action]'),action=b?.dataset.action;
  if(e.type==='keydown'){
   if(e.key==='Escape'){
    const p=captured.snapshot.currentPresentation;
    const region=p.mode==='A'?nodes.history:nodes.original;if(!region.contains(e.target))return;b=e.target;
    if(p.mode==='A'&&p.panel==='history')action='return-original';else if(p.mode==='B'&&p.panel==='original'&&p.selectedRevisionVersion!==null)action='return-revision';else return;
   }else if(!['Enter',' '].includes(e.key))return;
  }
  if(!eligible(b))return;if(e.type==='keydown')e.preventDefault();
  const {ticket:t,snapshot:s}=captured,p=s.currentPresentation;let accepted=false,target=null;
  if(action==='mode-A'||action==='mode-B'){accepted=host.setMode(action.slice(-1),t);target=()=>action==='mode-A'?nodes.modeA:nodes.modeB;}
  else if(action==='read-source'){accepted=host.readSource(s.context.allowedTargetId,t);target=()=>nodes.identityHeading;}
  else if(action==='read-history'){accepted=host.readHistory(t);target=()=>nodes.historyHeading;}
  else if(action==='technical'||action==='candidate')accepted=host.setDisclosure(action,!p.disclosures[action],t);
  else if(action?.startsWith('revision-'))accepted=host.selectRevision(Number(action.slice(9)),t);
  else if(action==='return-original'){accepted=host.setPanel('original',t);target=()=>eligible(nodes.readHistory)?nodes.readHistory:nodes.originalHeading;}
  else if(action==='compare-current'){accepted=host.setPanel('original',t);target=()=>nodes.originalHeading;}
  else if(action==='return-revision'){accepted=host.setPanel('history',t);target=()=>nodes.revisionButtons.get(p.selectedRevisionVersion)??nodes.historyHeading;}
  if(!accepted||!target||retired||focusSequence!==captured.focusSequence)return;
  const now=host.snapshot();if(!now.alive||now.publicationRevision!==s.publicationRevision+1||now.lifetime!==s.lifetime||now.inputRevision!==s.inputRevision)return;
  if(doc.activeElement!==captured.origin&&doc.activeElement!==doc.body)return;
  const landing=target();if(!eligible(landing))return;
  // Focus is deliberately the last operation: it may synchronously change scope or tear down.
  landing.focus();
 }
 root.addEventListener('click',capture,true);root.addEventListener('keydown',capture,true);root.addEventListener('click',handle);root.addEventListener('keydown',handle);
 const unsubscribe=host.subscribe(render);render(host.snapshot());
 return function disposeView(){if(retired)return;retired=true;unsubscribe();doc.removeEventListener('focusin',focusin,true);root.removeEventListener('click',capture,true);root.removeEventListener('keydown',capture,true);root.removeEventListener('click',handle);root.removeEventListener('keydown',handle);frame=null;nodes=null;root.replaceChildren();};
}
