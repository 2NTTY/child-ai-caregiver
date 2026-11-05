import { formatDate } from './host.mjs';
const roles = {owner:'管理員',caregiver:'照顧者',viewer:'唯讀成員'};
const kinds = {teachers:'教師空間',class:'班級',family:'家庭'};
const modules = {profile:'孩子概況',care:'照顧記錄',memory:'家庭記憶',tasks:'待辦',documents:'文件',growth:'成長',concerns:'關注',attachments:'附件'};
export function mount(root, host, actions = {}) {
  const doc = root.ownerDocument;
  const el = (tag, cls, text) => { const node=doc.createElement(tag); if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node; };
  const append = (parent,...children) => {children.flat().filter(Boolean).forEach(c=>parent.append(c));return parent;};
  const key = (node,value) => { node.dataset.key=value;return node; };
  function button(text, id, fn, {disabled=false, cls='', pressed}={}) {const b=key(el('button',cls,text),id);b.type='button';b.disabled=disabled;if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',fn);return b;}
  root.innerHTML = `<header class="masthead"><div class="brand-line"><span class="brand-mark" aria-hidden="true">✦</span><span>育伴港 · 選配工作台</span><span class="edition">FR / 01</span></div><div class="hero"><div><p class="eyebrow">SPACE & PEOPLE / 共享空間名冊</p><h1>把協作關係<br><span>看得清楚。</span></h1><p class="hero-copy">從空間脈絡，到每一筆名冊。<br>兩種閱讀方式，同一份已載入內容。</p></div><div class="orbit-art" aria-hidden="true"><i></i><b>共同<br>照顧</b><small>SPACE / ROSTER</small></div></div><div class="candidate-banner"><strong>全合成 · 只讀候選</strong><span>沒有連接正式帳戶、Server 或孩子資料。角色只作顯示，實際授權以 Server 為準。</span></div><div class="layout-picker" role="group" aria-label="比較閱讀布局"></div></header><main><div class="scope-strip"><div><p class="eyebrow">目前管理位置</p><h2 data-key="scope-heading" tabindex="-1">共享空間</h2></div><p class="child-note">目前閱讀孩子未變更<br><span>空間導航不會開啟孩子資料</span></p></div><p class="live-status" role="status" aria-live="polite" aria-atomic="true"></p><div data-workspace></div><details class="fault-lab"><summary>檢查合成狀態與邊界</summary><p>以下只控制本頁本地示例，沒有 API 或正式權限變更。一般閱讀請使用上方候選。</p><div class="lab-controls"></div><p class="lab-explanation">同一合成 host；不代表正式 SharingController 接線。身份／模式切換的本地重置、可控延遲、焦點保護均為候選提案。沒有邀請代碼或任何寫入功能。</p></details><footer><span>FR01 / ORIGINAL SYNTHETIC STUDY</span><p>來源固定 f0149b79 · 88 項清冊固定 e8918dd<br>模型與 DOM 檢查不代表瀏覽器、讀屏或真機驗收。</p></footer></main>`;
  const workspace=root.querySelector('[data-workspace]'), heading=root.querySelector('[data-key="scope-heading"]'), live=root.querySelector('.live-status'), lab=root.querySelector('.lab-controls');
  const picker=root.querySelector('.layout-picker');
  const layoutButtons=['atlas','desk'].map((layout,i)=>button(i?'B · 名冊工作區':'A · 關係航線',`layout-${layout}`,()=>host.setLayout(layout),{cls:'layout-choice'}));
  picker.append(...layoutButtons);
  let priorBinding=host.binding(), priorInspector=null;
  const selectSpace = (id,b) => { void host.selectSpace(id,b); };
  function navigation(s,b,isDesk) {
    const nav=el('nav',isDesk?'desk-sidebar':'atlas-map');nav.setAttribute('aria-label','合成空間導航');
    append(nav,el('p','section-code',isDesk?'空間索引 / 01':'01 / 空間航線'));
    const modeRow=el('div','mode-picker');modeRow.setAttribute('role','group');modeRow.setAttribute('aria-label','空間類型');
    for(const mode of ['teachers','class','family']) append(modeRow,button(kinds[mode],`mode-${mode}`,()=>{if(host.binding()!==b)return;host.setContext({mode});void host.loadSpaces();},{pressed:s.mode===mode}));
    nav.append(modeRow);
    const ul=el('ul','space-track');
    for(const [i,space] of s.spaces.items.entries()) {
      const li=el('li','space-node'), selected=s.selected?.id===space.id;
      const control=button('',`space-${space.id}`,()=>selectSpace(space.id,b),{disabled:s.busy||!s.online||!s.ready,cls:'space-link'});
      if(selected)control.setAttribute('aria-current','true');
      append(control,el('span','node-number',String(i+1).padStart(2,'0')),append(el('span','node-label'),el('strong','',space.name),el('small','',`${kinds[space.kind]} · ${roles[space.role]}`)),el('span','node-arrow','↗'));
      li.append(control);
      if(selected && space.kind==='teachers') {
        const sub=el('ul','class-branches');
        for(const classroom of s.teacherClasses.items) {
          const childLi=el('li','class-node');const childButton=button('',`space-${classroom.id}`,()=>selectSpace(classroom.id,b),{disabled:s.busy||!s.online,cls:'class-link'});
          append(childButton,el('span','branch-mark','↳'),append(el('span',''),el('strong','',classroom.name),el('small','','班級 · 由教師空間繼承')),el('span','node-arrow','→'));childLi.append(childButton);sub.append(childLi);
        }
        if(!s.teacherClasses.items.length)sub.append(el('li','empty',s.teacherClasses.nextCursor?'本頁沒有班級，仍有後續頁。':'目前載入窗口沒有班級。'));
        li.append(sub);
        li.append(el('p','coverage',`已載入 ${s.teacherClasses.items.length} 個班級${s.teacherClasses.nextCursor?' · 還有後續頁':' · 此窗口無續頁'}，不是全站總數。`));
        if(s.teacherClasses.nextCursor)li.append(button('載入更多班級','more-teacherClasses',()=>{void host.loadMore('teacherClasses',b);},{disabled:s.busy||!s.online,cls:'quiet-button'}));
      }
      ul.append(li);
    }
    nav.append(ul);
    if(!s.spaces.items.length)nav.append(el('p','empty',!s.loaded?'尚未載入空間，請讀取合成示例。':s.spaces.nextCursor?'本頁沒有空間，仍有後續頁。':'目前載入窗口沒有空間。'));
    append(nav,el('p','coverage',`空間窗口：已載入 ${s.spaces.items.length} 項${s.spaces.nextCursor?' · 尚有後續頁':' · 不提供全站總數'}`),button(s.loaded?'重讀空間列表':'載入空間示例','load-spaces',()=>{void host.loadSpaces(false,b);},{disabled:s.busy||!s.online||!s.ready,cls:'quiet-button'}));
    if(s.spaces.nextCursor)nav.append(button('載入更多空間','more-spaces',()=>{void host.loadSpaces(true,b);},{disabled:s.busy||!s.online,cls:'quiet-button'}));
    return nav;
  }
  function intro(s,b) {
    const selected=s.selected,section=el('section','space-intro');
    if(!selected) {append(section,el('h3','',s.busy?'正在讀取合成空間…':'選一個空間，開始閱讀'),el('p','',s.ready?'在空間航線或索引選擇項目。只會更換目前管理位置。':'合成帳戶尚未就緒，已隱藏先前資料。'));return section;}
    const top=el('div','intro-top');append(top,el('span','tag',`${kinds[selected.kind]} / ${roles[selected.role]}`),button(s.busy?'重讀中…':'重新讀取資料','refresh',()=>{void host.refresh(b);},{disabled:s.busy||!s.online||!s.ready,cls:'quiet-button'}));
    append(section,top,el('h3','space-title',selected.name));
    if(selected.teacherSpaceId) {
      const lineage=el('div','lineage');append(lineage,el('p','',`由教師空間繼承：${selected.teacherSpaceName ?? selected.teacherSpaceId}`),el('p','meta',`班級版本 ${selected.version} · 教師空間版本 ${selected.teacherSpaceVersion ?? '未提供'}`));
      if(s.mode==='teachers'&&s.spaces.items.some(t=>t.id===selected.teacherSpaceId))lineage.append(button('返回所屬教師空間','parent-space',()=>selectSpace(selected.teacherSpaceId,b),{disabled:s.busy||!s.online,cls:'text-button'}));section.append(lineage);
    } else section.append(el('p','meta',`空間版本 ${selected.version} · ${selected.kind==='teachers'?'教師空間沒有孩子儲存區':selected.kind==='class'?'班級名冊屬於班級儲存區':'家庭分享指向原分享者的私人原件'}`));
    append(section,el('p','authority','角色為合成 Server 投影；前端顯示不授權任何操作。'),el('p','meta',`更新時間 ${formatDate(selected.updatedAt)}`));return section;
  }
  function records(s,b) {
    const section=el('section','records-section');section.setAttribute('aria-label','已載入名冊與成員');
    if(!s.selected)return section;
    const row=el('div','records-heading');append(row,el('h3','',s.recordKind==='shares'?(s.selected.kind==='class'?'孩子名冊':'共享範圍'):'協作成員'),el('span','section-code','02 / READ'));
    section.append(row);
    const tabs=el('div','record-switch');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','閱讀內容');
    if(s.selected.kind!=='teachers')tabs.append(button(s.selected.kind==='class'?'孩子名冊':'共享範圍','kind-shares',()=>host.setRecordKind('shares',b),{pressed:s.recordKind==='shares'}));
    tabs.append(button('成員角色','kind-members',()=>host.setRecordKind('members',b),{pressed:s.recordKind==='members'}));section.append(tabs);
    const label=el('label','search-label','搜尋目前載入項目');label.htmlFor='roster-search';const input=key(el('input','search-input'),'search');input.id='roster-search';input.type='search';input.maxLength=160;input.value=s.query;input.placeholder=s.recordKind==='shares'?'孩子顯示名或完整 ID':'成員顯示名或 ID';input.setAttribute('aria-describedby','search-help');input.addEventListener('input',()=>host.setQuery(input.value,b));
    const help=el('p','search-help',`僅搜尋目前載入的${s.recordKind==='shares'?'孩子顯示名、childId':'成員顯示名、userId'}；不是 Server 全名冊搜尋。`);help.id='search-help';
    append(section,label,input,help);
    const items=host.visibleRecords(),loaded=s[s.recordKind];
    section.append(el('p','coverage',`目前顯示 ${items.length} / 已載入 ${loaded.items.length} 項${loaded.nextCursor?' · 尚有後續頁':' · 此窗口無續頁'}，不是總人數。`));
    const ul=el('ul',s.layout==='desk'?'record-ledger':'record-cards');
    for(const [i,item] of items.entries()) {
      const member=s.recordKind==='members',id=member?item.userId:item.childId,li=el('li','record');
      const title=el('h4','',member?item.label:item.childName);
      const identity=el('p','record-id',`${member?'userId':'childId'} · ${id}`);
      const body=append(el('div','record-copy'),title,identity);
      if(member)body.append(el('p','meta',`${roles[item.role]} · ${s.selected.teacherSpaceId?'由教師空間繼承':'直接成員'} · 版本 ${item.version}`));
      else {const pills=el('div','module-pills');for(const module of item.modules)pills.append(el('span','',modules[module]));body.append(pills);body.append(el('p','meta',s.selected.kind==='class'?'班級原件 · 不是個人分享':'分享原件 · 未複製孩子資料'));}
      const inspect=button('查看概要',`inspect-${s.recordKind}-${id}`,()=>{if(host.inspect(s.recordKind,id,b))root.querySelector('[data-inspector] h3')?.focus();},{cls:'inspect-button'});inspect.setAttribute('aria-label',`查看${member?item.label:item.childName}的${member?'成員':'名冊'}概要`);
      append(li,el('span','record-number',String(i+1).padStart(2,'0')),body,inspect);ul.append(li);
    }
    section.append(ul);
    if(!items.length)section.append(el('p','empty',s.query?'目前載入項目沒有符合結果；未搜尋尚未載入的頁。':loaded.nextCursor?'本頁沒有項目，仍有後續頁。':'目前載入窗口沒有項目。'));
    if(loaded.nextCursor)section.append(button('載入下一頁',`more-${s.recordKind}`,()=>{void host.loadMore(s.recordKind,b);},{disabled:s.busy||!s.online,cls:'load-more'}));
    return section;
  }
  function inspect(s,b) {
    const current=host.getInspector(),aside=el('aside',s.layout==='desk'?'desk-inspector':'atlas-inspector');aside.setAttribute('aria-label','目前項目概要');
    if(!current){append(aside,el('p','section-code','03 / INSPECT'),el('h3','','只看需要的細節'),el('p','','選擇一筆「查看概要」，核對來源 ID、角色或模組。這裡不會開啟孩子資料。'));return aside;}
    aside.dataset.inspector='';const item=current.item,member=current.kind==='members';
    const h=key(el('h3','',member?item.label:item.childName),'inspector-heading');h.tabIndex=-1;
    append(aside,el('p','section-code','03 / LIVE METADATA'),h,el('p','inspector-state',current.busy?'重讀中，以下保留上次載入的概要。':current.stale?'保留上次載入的概要，尚未重新確認。':'目前已載入概要 · 合成資料'));
    const dl=el('dl','metadata');
    function field(name,value){append(dl,el('dt','',name),el('dd','',String(value)));}
    field('所屬空間',current.selected.name);field(member?'成員 ID':'孩子 ID',member?item.userId:item.childId);field('版本',item.version);
    if(member){field('角色',roles[item.role]);field('加入時間',formatDate(item.joinedAt));field('原始時間',item.joinedAt);}else {field('可見模組',item.modules.map(m=>modules[m]).join('、'));field('來源識別',item.sharedBy);field('資料關係',current.selected.kind==='class'?'班級儲存區的原件':'原分享者的私人原件');}
    if(current.selected.teacherSpaceId)field('權限來源',`由教師空間繼承：${current.selected.teacherSpaceName}`);
    append(aside,dl,el('p','authority','只有概要，沒有讀取孩子內容或變更權限的能力。'),button('收起概要','close-inspector',()=>{
      const target=host.getSnapshot().inspector;if(!host.closeInspector(b))return;
      const match=[...root.querySelectorAll('[data-key]')].find(n=>n.dataset.key===`inspect-${target.kind}-${target.id}`);(match??heading).focus();
    },{cls:'quiet-button'}));return aside;
  }
  function render() {
    const s=host.getSnapshot(),b=host.binding(),active=doc.activeElement,wasIn=workspace.contains(active),activeKey=active?.dataset?.key;
    const selection=active?.tagName==='INPUT'?{start:active.selectionStart,end:active.selectionEnd}:null;
    const boundary=b!==priorBinding;const oldInspector=priorInspector;
    root.dataset.layout=s.layout;
    layoutButtons.forEach((node,i)=>node.setAttribute('aria-pressed',String(s.layout===['atlas','desk'][i])));
    heading.textContent=s.selected?.name??`${kinds[s.mode]} · ${s.ready?'選擇空間':'合成帳戶未就緒'}`;
    live.textContent=!s.ready?'合成帳戶尚未就緒。':!s.online?'合成離線狀態：保留上次載入，暫停讀取。':s.notice?.code==='access_denied'?'存取已失效，已清除所選空間詳情。':s.notice?.kind==='cleared'?'載入範圍或續頁已失效，請重新讀取空間列表。':s.notice?'讀取未完成，保留上次載入的內容。':s.busy?'正在讀取本地合成示例…':'全合成資料；授權由 Server 決定，本頁不接正式服務。';
    const frame=el('div',s.layout==='desk'?'desk-frame':'atlas-frame'),nav=navigation(s,b,s.layout==='desk'),main=el('div','reading-area');
    append(main,intro(s,b),records(s,b));const detail=inspect(s,b);
    if(s.layout==='desk')append(frame,nav,main,detail);else {frame.append(nav);const flow=el('div','atlas-reading');append(flow,main,detail);frame.append(flow);}
    workspace.replaceChildren(frame);workspace.setAttribute('aria-busy',String(s.busy));
    // Context changes replace controls and focus a stable non-action landmark.
    // No element gets rebound to the new identity or scope while still focused.
    if(wasIn) {
      const target=!boundary&&activeKey?[...workspace.querySelectorAll('[data-key]')].find(n=>n.dataset.key===activeKey&&!n.disabled):null;
      if(target){target.focus();if(selection&&target.tagName==='INPUT')target.setSelectionRange(selection.start,selection.end);}else heading.focus();
    }
    if(oldInspector&&!s.inspector&&wasIn&&active?.closest('[data-inspector]'))heading.focus();
    priorBinding=b;priorInspector=s.inspector;
  }
  const labButtons=[
    ['一般讀取失敗','lab-failure',()=>actions.fault?.('unavailable')],['存取失效','lab-denied',()=>actions.fault?.('access_denied')],['續頁失效','lab-cursor',()=>actions.fault?.('invalid_cursor')],
    ['空頁仍可續讀','lab-empty',()=>actions.fault?.('empty_page')],['慢讀取 · 可切換情境','lab-slow',()=>actions.fault?.('slow')],
    ['切換合成身份','lab-identity',()=>host.setContext({identity:host.getSnapshot().identity==='synthetic-account-a'?'synthetic-account-b':'synthetic-account-a'})],
    ['切換外部閱讀孩子','lab-child',()=>host.setContext({globalChild:host.getSnapshot().globalChild==='synthetic-reading-child'?'synthetic-reading-child-b':'synthetic-reading-child'})],
    ['切換連線狀態','lab-online',()=>host.setContext({online:!host.getSnapshot().online})],['重設合成示例','lab-reset',()=>actions.reset?.()],
  ];lab.append(...labButtons.map(([label,id,fn])=>button(label,id,fn,{cls:'quiet-button'})));
  const unsubscribe=host.subscribe(render);render();
  return { destroy(){unsubscribe();root.replaceChildren();} };
}
