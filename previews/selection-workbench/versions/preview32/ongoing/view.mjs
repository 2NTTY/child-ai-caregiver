// Native DOM reading presentation. The only state here is a local reading choice.
export function mountOngoing(document, owner) {
  const root=document.querySelector('#ongoing'); if(!root) throw new Error('Missing ongoing root');
  const q=selector=>root.querySelector(selector), rows=q('[data-rows]'), chapters=q('[data-chapters]');
  let layout='A', selected=null, key='', disposed=false, latest, visible=[];
  const expanded=new Set(), rowNodes=new Map(), chapterNodes=new Map();
  const abort=new document.defaultView.AbortController();
  const eventAuthority=new WeakMap();
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function row(item,index){
    let node=rowNodes.get(item.id);
    if(!node){
      node=el('li');node.dataset.row=item.id;
      const button=el('button','row-toggle');button.type='button';button.dataset.expand=item.id;
      const number=el('span','row-number'),copy=el('span'),title=el('span','row-title'),status=el('span','row-status'),mark=el('span','row-mark');
      mark.setAttribute('aria-hidden','true');copy.append(title,status);button.append(number,copy,mark);
      const detail=el('p','row-detail');detail.id=`reason-${item.id}`;button.setAttribute('aria-controls',detail.id);node.append(button,detail);
      rowNodes.set(item.id,node);
    }
    node.querySelector('.row-number').textContent=String(index+1).padStart(2,'0');
    node.querySelector('.row-title').textContent=item.title;node.querySelector('.row-status').textContent=item.statusLabel;
    node.querySelector('.row-detail').textContent=item.detail;node.querySelector('.row-detail').hidden=!expanded.has(item.id);
    node.querySelector('button').setAttribute('aria-expanded',String(expanded.has(item.id)));
    node.querySelector('.row-mark').textContent=expanded.has(item.id)?'−':'+';
    return node;
  }
  function chapter(item,index){
    let node=chapterNodes.get(item.id);
    if(!node){node=el('li');const b=el('button');b.type='button';b.dataset.chapter=item.id;b.append(el('span'),el('span'));node.append(b);chapterNodes.set(item.id,node);}
    const b=node.firstElementChild;b.children[0].textContent=String(index+1).padStart(2,'0');b.children[1].textContent=item.title;
    if(item.id===selected)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
    return node;
  }
  function reconcile(parent,map,create){
    const ids=new Set(visible.map(i=>i.id));
    for(const [id,node] of map)if(!ids.has(id)){node.remove();map.delete(id);expanded.delete(id);}
    visible.forEach((item,index)=>{const node=create(item,index);if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index]??null);});
  }
  function render(){
    if(disposed)return;
    const focusInReading=q('[data-index]').contains(document.activeElement)||q('[data-reader]').contains(document.activeElement);
    latest=owner.snapshot();const nextKey=`${latest.scope}:${latest.generation}`,scopeChanged=nextKey!==key;
    if(scopeChanged){key=nextKey;selected=null;expanded.clear();}
    const section=latest.section;
    visible=['ready','stale','loading'].includes(section.state)?section.items.slice(0,3):[];
    if(!visible.some(item=>item.id===selected))selected=visible[0]?.id??null;
    q('[data-child]').textContent=latest.childName;
    q('[data-window]').textContent=visible.length?`已載入窗口 ${section.items.length} 筆，本頁展示前 ${visible.length} 筆 · 原來源次序，不代表全部關注`:'本頁僅呈現目前孩子的已載入窗口，不代表全部關注';
    const state=q('[data-state]');state.dataset.kind=section.state;
    state.textContent=section.detail??(section.items.length?'已讀取目前窗口；閱讀不會完成任何關注。':'本次已載入窗口沒有持續關注；不代表所有資料均已載入。');
    q('[data-operation]').hidden=!latest.operation;
    q('[data-operation]').textContent=latest.operation?'合成原操作結果仍未知。重新讀取只核對資料，不自動重送、不推定成功。':'';
    q('[data-index]').hidden=layout!=='A';q('[data-reader]').hidden=layout!=='B'||!visible.length;
    reconcile(rows,rowNodes,row);reconcile(chapters,chapterNodes,chapter);
    const chosen=visible.find(item=>item.id===selected),position=visible.findIndex(item=>item.id===selected);
    q('[data-reading-title]').textContent=chosen?.title??'';q('[data-reading-status]').textContent=chosen?.statusLabel??'';
    q('[data-reading-detail]').textContent=chosen?.detail??'';
    q('[data-reading-position]').textContent=chosen?`閱讀 ${String(position+1).padStart(2,'0')} / 本頁 ${visible.length} 項`:'';
    q('[data-position]').textContent=chosen?`${position+1} / ${visible.length}`:'';
    q('[data-action="previous"]').disabled=position<=0;q('[data-action="next"]').disabled=position<0||position>=visible.length-1;
    for(const button of root.querySelectorAll('[data-layout]'))button.setAttribute('aria-pressed',String(button.dataset.layout===layout));
    for(const button of root.querySelectorAll('[data-scope]'))button.setAttribute('aria-pressed',String(button.dataset.scope===latest.scope));
    q('[data-action="read"]').disabled=!latest.active||!latest.online||!!latest.pending;
    q('[data-action="deliver"]').disabled=!latest.pending;
    q('[data-action="open-growth"]').disabled=!latest.active;
    q('[data-action="offline"]').setAttribute('aria-pressed',String(!latest.online));
    q('[data-action="offline"]').textContent=latest.online?'模擬離線':'恢復示例連線';
    q('[data-pending]').textContent=latest.pending?'合成讀取等待回覆；可先切換孩子，舊回覆不得回流。':'沒有等待中的合成讀取';
    q('[data-receipt]').textContent=latest.receipts.length?'本頁已接收合成目的地 growth；尚未執行正式導航，也沒有傳送個別關注 ID。':'';
    if(focusInReading&&!visible.length)q('[data-state]').focus();
    else if(focusInReading&&scopeChanged)q('#reading-workspace').focus();
  }
  function select(id){if(!visible.some(item=>item.id===id))return;owner.invalidateIntents();selected=id;render();q('[data-reading-title]').focus();}
  const captureAuthority=event=>{
    const s=owner.snapshot();eventAuthority.set(event,{scope:s.scope,generation:s.generation,intentEpoch:s.intentEpoch});
  };
  const eventCurrent=event=>{
    const captured=eventAuthority.get(event),current=owner.snapshot();
    return !!captured&&captured.scope===current.scope&&captured.generation===current.generation&&captured.intentEpoch===current.intentEpoch;
  };
  root.addEventListener('click',captureAuthority,{capture:true,signal:abort.signal});
  root.addEventListener('keydown',captureAuthority,{capture:true,signal:abort.signal});
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(disposed||!b||!root.contains(b)||b.disabled)return;
    if(!eventCurrent(event))return;
    if(b.dataset.layout){if(b.dataset.layout!==layout){owner.invalidateIntents();layout=b.dataset.layout;b.focus();render();}return;}
    if(b.dataset.scope){owner.switchScope(b.dataset.scope);return;}
    if(b.dataset.expand&&layout==='A'&&visible.some(i=>i.id===b.dataset.expand)){
      owner.invalidateIntents();
      expanded.has(b.dataset.expand)?expanded.delete(b.dataset.expand):expanded.add(b.dataset.expand);render();return;
    }
    if(b.dataset.chapter&&layout==='B'){select(b.dataset.chapter);return;}
    const action=b.dataset.action;
    if(action==='previous'||action==='next'){
      if(layout!=='B')return;const index=visible.findIndex(i=>i.id===selected)+(action==='next'?1:-1);if(visible[index])select(visible[index].id);
    }else if(action==='open-growth')owner.captureNavigation()();
    else if(action==='read')owner.read(q('[data-outcome]').value);
    else if(action==='deliver')owner.settle(owner.snapshot().pending);
    else if(action==='unknown')owner.setUnknown();
    else if(action==='offline')owner.setOnline(!owner.snapshot().online);
  },{signal:abort.signal});
  root.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||disposed||layout!=='A')return;
    const row=event.target.closest('[data-row]');if(!row||!expanded.has(row.dataset.row))return;
    if(!eventCurrent(event)||rowNodes.get(row.dataset.row)!==row)return;
    owner.invalidateIntents();
    expanded.delete(row.dataset.row);render();row.querySelector('button').focus();event.preventDefault();
  },{signal:abort.signal});
  const unsubscribe=owner.subscribe(render);render();
  return {dispose(){if(disposed)return;disposed=true;abort.abort();unsubscribe();owner.invalidateIntents();},render};
}
