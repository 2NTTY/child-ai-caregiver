(function(root,factory){const api=factory(typeof module==='object'?require('./model.js'):root.CPModel);if(typeof module==='object')module.exports=api;else root.CPView=api;})(globalThis,function(M){
  'use strict';
  function mount(root,host){
    const d=root.ownerDocument;let mounted=true,rendered=null,focusIntent=null;
    const el=(tag,text,attrs={})=>{const e=d.createElement(tag);if(text!==null&&text!==undefined)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
    const button=(text,attrs,run)=>{const b=el('button',text,{type:'button',...attrs});b.addEventListener('click',run);return b;};
    const header=el('header',null,{class:'intro'});
    header.append(el('p','育伴港 · 選配候選 CP-P01',{class:'eyebrow'}),el('h1','完整孩子檔案'),el('p','原文保留，慢慢讀。',{class:'tagline'}),el('p','全合成資料 · 唯讀 · 未接正式帳戶或服務',{class:'synthetic-label'}));
    const toolbar=el('div',null,{class:'layout-toolbar',role:'group','aria-label':'閱讀架構'});
    for(const[key,label,caption]of [['passport','A 資料護照','全欄分組掃讀'],['index','B 欄位閱讀索引','一次專注一欄']]){
      const b=button(null,{'data-layout':key},()=>host.setLayout(key));b.append(el('strong',label),el('span',caption));toolbar.append(b);
    }
    const context=el('div',null,{class:'context-line','aria-label':'目前合成閱讀範圍'});
    const status=el('section',null,{class:'read-status','aria-labelledby':'status-title'});const statusTitle=el('h2','',{id:'status-title'});const statusBody=el('p');status.append(statusTitle,statusBody);
    const reader=el('section',null,{id:'reader',role:'region','aria-labelledby':'reader-title',tabindex:'-1'});
    const title=el('h2','',{id:'reader-title',class:'reader-title'});const content=el('div',null,{id:'reader-content'});reader.append(title,content);
    const announcement=el('p','',{class:'sr-only',role:'status','aria-live':'polite','aria-atomic':'true'});
    root.replaceChildren(header,toolbar,context,status,reader,announcement);
    const keyElement=(parent,key)=>[...parent.querySelectorAll('[data-focus]')].find(e=>e.dataset.focus===key);
    const admitted=(s,node)=>mounted&&node?.isConnected&&root.contains(node)&&host.getSnapshot().layout===s.layout&&host.getSnapshot().lifetime===s.lifetime&&!host.getSnapshot().disposed&&host.getSnapshot().access!=='lost'&&!host.getSnapshot().unavailable;
    function jump(s,id,control){
      if(!admitted(s,control)||!M.fields(host.getSnapshot().current).some(f=>f.id===id))return;
      focusIntent={lifetime:s.lifetime,id,origin:d.activeElement};
      const before=host.getSnapshot();const ok=host.selectField(id,s.lifetime);
      // A same-field selection does not publish. Apply its explicit reading jump once.
      if(ok&&host.getSnapshot()===before)render(before);
      if(!ok)focusIntent=null;
    }
    function definitionList(items,attrs={}){
      const dl=el('dl',null,attrs);for(const [label,value]of items){const row=el('div',null,{class:'definition-row'});row.append(el('dt',label),el('dd',value));dl.append(row);}return dl;
    }
    function fieldCard(f,s,headingLevel){
      const card=el('article',null,{class:'field-card','data-card-id':f.id,'aria-labelledby':`field-${f.id}`});
      const heading=el(headingLevel,f.label,{id:`field-${f.id}`,tabindex:'-1','data-focus':`heading:${f.id}`});
      const line=el('div',null,{class:'field-heading'});line.append(heading,el('span',f.state==='unknown'?'未知':f.state==='empty'?'空字串':'已提供',{class:`value-state ${f.state}`}));
      card.append(line,definitionList([['原有內容',f.value]],{class:'primary-value'}));
      const expanded=s.expandedFields.includes(f.id);const detailsId=`details-${f.id}`;
      const toggle=button(`${expanded?'收起':'展開'}「${f.label}」原值說明`,{'aria-expanded':expanded,'aria-controls':detailsId,'data-focus':`detail:${f.id}`,class:'disclosure'},(event)=>{if(admitted(s,event.currentTarget))host.toggleField(f.id,s.lifetime);});
      const details=el('div',null,{id:detailsId,class:'raw-details'});details.hidden=!expanded;details.append(definitionList(f.details),el('p',f.note,{class:'field-note'}));card.append(toggle,details);return card;
    }
    function render(s){
      if(!mounted||host.getSnapshot()!==s)return;
      const before=d.activeElement;const inside=content.contains(before);const oldKey=inside?before.getAttribute('data-focus'):null;const sameLife=rendered?.lifetime===s.lifetime;
      const intent=focusIntent;focusIntent=null;
      const fs=M.fields(s.current);const state=M.status(s);const fragment=d.createDocumentFragment();
      if(s.current?.data===null)fragment.append(el('p',`上次已讀結果：尚無已確認檔案（版本 ${s.current.version}）。以下只保留原有版本與確認標籤。`,{class:'empty-profile'}));
      if(fs.length){
        if(s.layout==='passport'){
          const nav=el('nav',null,{class:'group-index','aria-label':'跳到檔案分組'});
          for(const group of [...new Set(fs.map(f=>f.group))]){const first=fs.find(f=>f.group===group);nav.append(button(group,{'data-focus':`group:${group}`},(event)=>jump(s,first.id,event.currentTarget)));}
          fragment.append(nav);const groups=el('div',null,{class:'passport-groups'});
          for(const [i,group]of [...new Set(fs.map(f=>f.group))].entries()){
            const section=el('section',null,{class:'passport-group','aria-labelledby':`group-${i}`});const groupTitle=el('h3',null,{id:`group-${i}`});groupTitle.append(el('span',String(i+1).padStart(2,'0'),{'aria-hidden':'true'}),d.createTextNode(group));section.append(groupTitle);
            for(const f of fs.filter(f=>f.group===group)){const wrapper=el('div',null,{'data-field-id':f.id});wrapper.append(fieldCard(f,s,'h4'));section.append(wrapper);}groups.append(section);
          }fragment.append(groups);
        }else{
          const grid=el('div',null,{class:'index-layout'});const nav=el('nav',null,{class:'field-index','aria-labelledby':'index-title'});nav.append(el('h3','完整欄位索引',{id:'index-title'}));const list=el('ol');
          for(const f of fs){const li=el('li',null,{'data-field-id':f.id});const b=button(null,{'data-focus':`index:${f.id}`,'aria-current':s.selectedField===f.id?'true':'false'},(event)=>jump(s,f.id,event.currentTarget));b.append(el('span',f.label),el('small',f.state==='unknown'?'未知':f.state==='empty'?'空字串':'已提供'));li.append(b);list.append(li);}nav.append(list);grid.append(nav);
          const stage=el('div',null,{class:'reading-stage'});const selected=fs.find(f=>f.id===s.selectedField);if(selected)stage.append(fieldCard(selected,s,'h3'));
          const provenance=el('section',null,{class:'provenance','aria-labelledby':'provenance-title'});provenance.append(el('h3','與這份檔案一起閱讀',{id:'provenance-title'}),el('p','來源、期限與確認標籤，不因選讀哪一欄而隱藏。'),definitionList(fs.filter(f=>f.group==='來源與確認').map(f=>[f.label,f.value])));stage.append(provenance);grid.append(stage);fragment.append(grid);
        }
      }else{fragment.append(el('p','有可讀的目前檔案後，完整欄位會在這裡出現。',{class:'empty-reader'}));}
      // Commit every visible projection before any native focus callback can reenter.
      root.dataset.layout=s.layout;root.dataset.lifetime=String(s.lifetime);
      for(const b of toolbar.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.layout===s.layout));
      const access=s.access==='lost'?'存取失效':s.access==='editable'?'本候選唯讀（宿主可編輯）':'唯讀範圍';
      context.replaceChildren(el('strong',s.binding?.childName??'未提供孩子'),el('span',s.binding?`${access} · ${s.binding.scopeKey}`:'沒有目前範圍'),el('small',s.binding?`合成身份 ${s.binding.identityEpoch} · lifetime ${s.lifetime}`:'只顯示宿主明確提供的範圍'));
      status.dataset.state=state.code;statusTitle.textContent=state.title;statusBody.textContent=state.body;
      title.textContent=s.layout==='passport'?'資料護照 · 全欄閱讀':'欄位閱讀索引 · 專注閱讀';
      content.replaceChildren(fragment);announcement.textContent=`${state.title}。${s.current?`版本 ${s.current.version}。`:''}${s.current?.data===null?'尚無已確認檔案。':''}`;
      rendered=s;
      if(host.getSnapshot()!==s)return;
      let target=null;
      if(intent&&intent.lifetime===s.lifetime&&intent.id===s.selectedField&&(before===intent.origin||d.activeElement===intent.origin||d.activeElement===d.body))target=keyElement(content,`heading:${intent.id}`);
      else if(inside&&(d.activeElement===d.body||d.activeElement===before))target=sameLife&&oldKey?keyElement(content,oldKey):null;
      if(!target&&inside&&(d.activeElement===d.body||d.activeElement===before))target=reader;
      // No mutation follows focus. A focus handler may synchronously change context or selection.
      if(target&&host.getSnapshot()===s)target.focus({preventScroll:!intent});
    }
    const unsubscribe=host.subscribe(render);
    return function unmount(){if(!mounted)return;mounted=false;focusIntent=null;unsubscribe();root.replaceChildren();};
  }
  return Object.freeze({mount});
});
