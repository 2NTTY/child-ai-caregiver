(function(root,factory){const cjs=typeof module==='object';const api=factory(cjs?require('./host.js'):root.CPHost,cjs?require('./view.js'):root.CPView,cjs?require('./fixtures.js'):root.CPFixtures);if(cjs)module.exports=api;else{root.CPEntry=api;api.mountDemo(root.document);}})(globalThis,function(H,V,F){
  'use strict';
  function mountDemo(d){
    const host=H.createHost();const unmountView=V.mount(d.getElementById('app'),host);const demo=d.getElementById('demo');let ticket=null,spec=null;
    const el=(tag,text,attrs={})=>{const e=d.createElement(tag);if(text!=null)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
    demo.setAttribute('aria-labelledby','demo-title');demo.className='demo';
    const title=el('h2','合成示例控制',{id:'demo-title'});const note=el('p','以下只切換本頁的合成投影，不是帳戶、權限、模型或檔案操作。讀取接納 ticket 是候選契約，未接正式 callback。');
    const label=el('label','選擇合成情境',{for:'fixture'});const select=el('select',null,{id:'fixture'});for(const[value,text]of F.options)select.append(el('option',text,{value}));
    const controls=el('div',null,{class:'demo-actions'});const buttons={};
    const add=(id,text,fn)=>{const b=el('button',text,{type:'button','data-demo':id});b.addEventListener('click',fn);controls.append(b);buttons[id]=b;};
    add('read','開始合成重讀',()=>{if(buttons.read.getAttribute('aria-disabled')==='true')return;ticket=host.beginRead();});
    add('complete','完成合成重讀',()=>{if(!ticket)return;const accepted=ticket;ticket=null;host.settle(accepted,{current:spec.current??F.revision()});});
    add('fail','模擬讀取失敗',()=>{if(!ticket)return;const accepted=ticket;ticket=null;host.settle(accepted,{error:'合成重讀失敗；原有可讀內容仍保留。'});});
    add('online','切為離線示例',()=>{const online=!host.getSnapshot().online;if(!online)ticket=null;host.setOnline(online);});
    const output=el('p','',{class:'demo-readout'});demo.replaceChildren(title,note,label,select,controls,output);
    const stop=host.subscribe(s=>{
      buttons.read.setAttribute('aria-disabled',String(!s.binding||s.access==='lost'||!!s.unavailable||!s.online||s.pending));
      for(const key of ['complete','fail'])buttons[key].setAttribute('aria-disabled',String(!s.pending));
      buttons.online.textContent=s.online?'切為離線示例':'切回線上示例';
      output.textContent=`合成讀取：${s.pending?'等待手動完成或失敗':'沒有等候結果'} · ${s.online?'線上示例':'離線示例'} · 無外部資料傳送`;
    });
    function apply(id){
      ticket=null;spec=F.get(id);host.setContext(spec.binding,{access:spec.access,online:spec.online,unavailable:spec.unavailable??null});
      if(spec.current){const initial=host.beginRead();host.settle(initial,{current:spec.current});}
      if(spec.error){const failed=host.beginRead();host.settle(failed,{error:spec.error});}
      if(spec.loading)ticket=host.beginRead();if(spec.offlineAfterRead)host.setOnline(false);
    }
    select.addEventListener('change',()=>apply(select.value));apply('full');
    return Object.freeze({unmount(){ticket=null;stop();unmountView();host.dispose();demo.replaceChildren();}});
  }
  return Object.freeze({mountDemo});
});
