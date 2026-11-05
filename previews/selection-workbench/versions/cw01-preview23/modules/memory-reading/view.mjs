// Original DOM renderer: nodes survive ordinary publications and layout changes.
let instance=0;
const names={facts:'孩子事實',personal:'私人脈絡',references:'公共參考'};
const explanations={facts:'事實狀態、可見範圍及適用狀態分開核對。已確認不代表目前仍適用。',personal:'只供本人閱讀的工作、原訊息與整理摘要。不是模型的隱藏脈絡，也不會因共享孩子而公開。',references:'公共來源目錄，未逐項判定適用於這位孩子；來源存在不表示支持任何一項事實或某句回答。'};
const labels={ready:'已讀回這個窗口',stale:'顯示上次讀取，最新狀態尚未確認',loading:'正在讀取合成資料',error:'暫時讀不到合成資料',unknown:'合成讀取未確認，沒有可採用結果',unavailable:'此閱讀範圍尚未提供'};
export function mountMemory(root,host){
  const doc=root.ownerDocument,prefix=`mr${++instance}`;let live=true,epoch=null,cleanup=[],ui=null,rows=new Map(),current=null,query='',rowSerial=0,focusSerial=0;
  const noteFocus=()=>{focusSerial++};doc.addEventListener('focusin',noteFocus,true);
  const el=(tag,text='',cls='')=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
  const text=(node,value)=>{if(node.textContent!==String(value))node.textContent=String(value)};
  function on(node,type,fn){node.addEventListener(type,fn);cleanup.push(()=>node.removeEventListener(type,fn))}
  function button(label,key,fn){const n=el('button',label);n.type='button';n.dataset.key=key;on(n,'click',()=>{if(live)fn()});return n}
  const same=t=>live&&host.getSnapshot().epoch===t.epoch&&!host.getSnapshot().disposed;
  const focusTicket=t=>({...t,revision:host.getSnapshot().revision+1,serial:focusSerial,element:doc.activeElement});
  function continueFocus(t,target,destination){const s=host.getSnapshot();if(same(t)&&s.revision===t.revision&&focusSerial===t.serial&&doc.activeElement===t.element&&destination(s)&&target.isConnected&&!target.closest('[hidden]'))target.focus({preventScroll:true})}
  function build(s){
    for(const f of cleanup)f();cleanup=[];rows=new Map();query='';epoch=s.epoch;const ticket=host.ticket();
    const main=el('main','','memory-shell');
    const hero=el('header','','memory-hero'),eyebrow=el('p','育伴港 · 選配工作台 / MR01','eyebrow'),title=el('h1','記憶與來源閱覽室'),subtitle=el('p','三個範圍，各有依據。先看來源，再準備問題。','hero-deck'),child=el('p','','child-label');
    const synthetic=el('p','純合成投影 · 未接正式 owner · 不發模型、不寫入資料','synthetic-banner');hero.append(eyebrow,title,subtitle,child,synthetic);
    const layout=el('div','','layout-switch');layout.setAttribute('aria-label','資訊架構選項');
    const rooms=button('A 三室索引館','layout:rooms',()=>host.setLayout('rooms',ticket)),dossier=button('B 核對案卷','layout:dossier',()=>host.setLayout('dossier',ticket));layout.append(rooms,dossier);
    const nav=el('nav','','scope-nav');nav.setAttribute('aria-label','閱讀資料範圍');const sections={};
    for(const kind of Object.keys(names)){const n=button(names[kind],`section:${kind}`,()=>{if(!same(ticket))return;query='';ui.search.value='';host.setSection(kind,ticket)});sections[kind]=n;nav.append(n)}
    const scopeExplanation=el('p','','scope-explanation');
    const tools=el('div','','read-tools'),searchLabel=el('label','篩選目前已載入的文字'),search=el('input');search.type='search';search.dataset.key='search';search.id=prefix+'-search';searchLabel.htmlFor=search.id;search.placeholder='只查這個範圍的已載窗口';
    on(search,'input',()=>{if(!same(ticket))return;query=search.value;render(host.getSnapshot())});
    const reload=button('重新讀取此範圍','reload',()=>{if(same(ticket))void host.read(host.getSnapshot().section,{ticket})}),more=button('載入更多','more',()=>{if(same(ticket))void host.read(host.getSnapshot().section,{more:true,ticket})});
    tools.append(searchLabel,search,reload,more);
    const status=el('p','','read-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const count=el('p','','coverage'),empty=el('p','','empty-notice');
    const board=el('div','','reading-board'),index=el('aside','','memory-index');index.setAttribute('aria-label','目前窗口索引');const indexHeading=el('h2','已載索引'),indexRows=el('div');index.append(indexHeading,indexRows);
    const reader=el('section','','memory-reader');reader.setAttribute('aria-label','資料內容');board.append(index,reader);
    const summary=el('section','','summary-panel'),summaryHeading=el('h2','私人對話摘要'),summaryText=el('p');summary.append(summaryHeading,summaryText,el('p','整理內容不是原訊息，亦不是公共引用。'));
    const draftPane=el('section','','draft-pane');draftPane.setAttribute('aria-label','合成 Agent 草稿');const draftHeading=el('h2','合成草稿入口'),draftLabel=el('label','未送出的問題'),draft=el('textarea');draft.id=prefix+'-draft';draft.dataset.key='draft';draftLabel.htmlFor=draft.id;draft.rows=7;draft.maxLength=10000;
    on(draft,'input',()=>{if(same(ticket))host.setDraft(draft.value,ticket)});
    const draftNotice=el('p','','draft-notice'),close=button('回到來源閱讀','close-draft',()=>{if(same(ticket)){const focus=focusTicket(ticket);if(host.closeDraft(ticket))continueFocus(focus,ui.search,s=>s.route==='reader')}});
    draftPane.append(draftHeading,el('p','這是本地合成草稿。沒有送出按鈕，也沒有呼叫模型。'),draftLabel,draft,draftNotice,close);
    const readerWrap=el('div','','reader-wrap');readerWrap.append(scopeExplanation,tools,status,count,empty,board,summary);main.append(hero,layout,nav,readerWrap,draftPane,el('footer','閱讀候選，不含記憶管理、確認、分享或刪除。原資料與操作仍由正式 owner 負責。'));
    root.replaceChildren(main);
    ui={main,child,rooms,dossier,sections,scopeExplanation,search,reload,more,status,count,empty,index,indexRows,reader,summary,summaryText,draftPane,draft,draftNotice,readerWrap};
  }
  function makeRow(kind,item,s){
    const number=++rowSerial,t=host.ticket(kind,item.id),key=`${kind}:${item.id}:${item.version}`,article=el('article','','memory-article');article.dataset.row=key;
    const heading=el('h2',item.title);heading.tabIndex=-1;heading.id=prefix+'-title-'+number;
    const badge=el('p','','row-badge'),body=el('p',item.text,'row-body'),sourceButton=button('查看來源與版本',`source:${kind}:${item.id}`,()=>{if(!same(t))return;r.details=!r.details;updateRow(r,host.getSnapshot())});
    const sourcePanel=el('section','','source-panel');sourcePanel.id=prefix+'-source-'+number;sourceButton.setAttribute('aria-controls',sourcePanel.id);
    const sourceText=el('p'),sourceMeta=el('p');sourcePanel.append(el('h3','來源依據'),sourceText,sourceMeta);
    let historyButton=null,historyPanel=null,historyBody=null,historyMore=null;
    if(kind==='facts'){
      historyButton=button('查看版本記錄',`history:${item.id}`,()=>{if(!same(t))return;r.historyOpen=!r.historyOpen;updateRow(r,host.getSnapshot());if(r.historyOpen&&!host.getSnapshot().histories[item.id])void host.history(item.id,t)});
      historyPanel=el('section','','history-panel');historyPanel.id=prefix+'-history-'+number;historyButton.setAttribute('aria-controls',historyPanel.id);historyBody=el('div');
      historyMore=button('載入更多版本',`history-more:${item.id}`,()=>{if(same(t))void host.history(item.id,t,{more:true})});historyPanel.append(el('h3','版本記錄'),historyBody,historyMore);sourcePanel.append(historyButton,historyPanel);
    }
    const actions=el('div','','row-actions');actions.append(sourceButton);
    let prepare=null;
    if(kind!=='references'&&!s.context.shared){prepare=button('請 Agent 核對',`prepare:${kind}:${item.id}`,()=>{if(!same(t))return;const focus=focusTicket(t),accepted=host.prepare(kind,item.id,t);if(accepted)continueFocus(focus,ui.draft,s=>s.route==='draft')});actions.append(prepare)}
    const content=el('div','','fact-content');content.append(badge,body,actions);const columns=el('div','','evidence-columns');columns.append(content,sourcePanel);article.append(heading,columns);
    const select=button(item.title,`select:${kind}:${item.id}`,()=>{if(!same(t))return;const focus=focusTicket(t);if(host.select(kind,item.id,t))continueFocus(focus,heading,s=>s.route==='reader'&&s.section===kind&&s.selection===item.id)});
    const r={key,kind,item,t,article,heading,badge,body,sourceButton,sourcePanel,sourceText,sourceMeta,historyButton,historyPanel,historyBody,historyMore,select,prepare,details:false,historyOpen:false,historySignature:''};return r;
  }
  function updateRow(r,s){
    const x=r.item,dossier=s.layout==='dossier';text(r.heading,x.title);text(r.body,x.text);
    const stateLabel=x.status==='confirmed'?'已確認':x.status==='candidate'?'待核對':x.status==='inactive'?'已停用':'私人工作';
    text(r.badge,r.kind==='references'?'公共參考 · 未判定孩子適用性':`${x.visibility==='family'?'家庭可見':'私人'} · ${r.kind==='facts'?stateLabel+' · '+(x.applicable?'來源投影為適用':'目前不適用，須核對'):'原訊息／工作脈絡'}`);
    text(r.sourceText,x.source||'來源未提供');text(r.sourceMeta,`版本 ${x.version} · ${r.kind==='references'?'最近覆核：'+(x.checkedAt||'未提供'):'來源狀態：'+(x.sourceState==='changed'?'已變更，須核對':'僅依原來源投影')}`);
    const details=dossier||r.details;r.sourcePanel.hidden=!details;r.sourceButton.hidden=dossier;r.sourceButton.setAttribute('aria-expanded',String(details));text(r.sourceButton,details?'收起來源與版本':'查看來源與版本');
    if(r.historyPanel){
      r.historyPanel.hidden=!r.historyOpen;r.historyButton.setAttribute('aria-expanded',String(r.historyOpen));text(r.historyButton,r.historyOpen?'收起版本記錄':'查看版本記錄');
      const h=s.histories[x.id],signature=JSON.stringify(h??null);
      if(signature!==r.historySignature){r.historySignature=signature;const list=[];
        if(!h)list.push(el('p','版本尚未讀取。'));
        else{list.push(el('p',labels[h.state]||'版本資料尚未提供'));for(const v of h.items){const entry=el('div','','history-entry');entry.append(el('h4',`版本 ${v.version}`),el('p',v.text));list.push(entry)}if(h.state==='ready'&&!h.items.length)list.push(el('p',h.cursor?'此頁暫無版本，仍有頁面未載入。':'已載版本窗口暫無資料。'))}
        r.historyBody.replaceChildren(...list);
      }
      r.historyMore.hidden=!h?.cursor;r.historyMore.disabled=!!h?.pending;
    }
  }
  function render(s){
    if(!live||s.disposed)return;if(epoch!==s.epoch)build(s);current=s;
    ui.main.dataset.layout=s.layout;text(ui.child,`${s.context.childName} · ${s.context.shared?'共享閱讀':'私人閱讀'} · ${s.context.access==='active'?'合成身份有效':'合成權限已撤回'}`);
    ui.rooms.setAttribute('aria-pressed',String(s.layout==='rooms'));ui.dossier.setAttribute('aria-pressed',String(s.layout==='dossier'));
    for(const[k,n]of Object.entries(ui.sections)){n.setAttribute('aria-pressed',String(s.section===k));n.disabled=s.context.access!=='active'||s.context.shared&&k!=='facts'}
    ui.draftPane.hidden=s.route!=='draft'||s.context.shared||s.context.access!=='active';ui.readerWrap.hidden=s.route==='draft'&&!ui.draftPane.hidden;
    if(ui.draft.value!==s.draft)ui.draft.value=s.draft;text(ui.draftNotice,s.notice);
    text(ui.scopeExplanation,explanations[s.section]);const read=s.reads[s.section],active=s.context.access==='active',available=active&&(!s.context.shared||s.section==='facts');
    ui.search.disabled=!available;ui.reload.disabled=!available||read.pending;ui.more.disabled=!available||read.pending||!read.cursor;
    text(ui.status,!active?'權限已撤回，已清除資料。':labels[read.state]+(read.pending?' · 讀取中':''));
    text(ui.count,`目前已載入 ${read.items.length} 項${read.cursor?' · 尚有更多頁面':' · 只代表本次讀窗，不代表完整歷史'}`);
    const q=query.trim().toLocaleLowerCase(),filtered=read.items.filter(x=>(x.title+' '+x.text).toLocaleLowerCase().includes(q));
    text(ui.empty,!available?'目前沒有可閱讀權限。':filtered.length?'':q?'目前已載入窗口沒有符合篩選的資料。':read.state==='ready'?(read.cursor?'此頁暫無資料，仍有頁面未載入。':'本次已載窗口暫無資料。'):'尚未取得可確認的最新資料。');ui.empty.hidden=!!filtered.length;
    ui.index.hidden=s.layout==='dossier';const wanted=new Set();
    for(const item of read.items){const key=`${s.section}:${item.id}:${item.version}`;wanted.add(key);let r=rows.get(key);if(!r){r=makeRow(s.section,item,s);rows.set(key,r);ui.reader.append(r.article);ui.indexRows.append(r.select)}r.item=item;const match=filtered.some(x=>x.id===item.id),selected=(filtered.some(x=>x.id===s.selection)?s.selection:filtered[0]?.id)===item.id;updateRow(r,s);r.select.hidden=!match;r.select.setAttribute('aria-pressed',String(selected));r.article.hidden=!match||s.layout==='rooms'&&!selected;}
    for(const[key,r]of rows){if(!wanted.has(key)){r.article.remove();r.select.remove();rows.delete(key)}}
    ui.summary.hidden=s.section!=='facts'||!s.summary||s.context.shared;text(ui.summaryText,s.summary||'');
  }
  const unsubscribe=host.subscribe(render);render(host.getSnapshot());
  return{destroy(){if(!live)return;live=false;unsubscribe();doc.removeEventListener('focusin',noteFocus,true);for(const f of cleanup)f();cleanup=[];rows.clear();root.replaceChildren()}};
}
