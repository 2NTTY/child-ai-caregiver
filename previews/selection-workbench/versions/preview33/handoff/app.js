import {initialItems,toggleItem,filterItems,progress} from './model.mjs';
let items=initialItems(),history=[],filter='all';
const $=s=>document.querySelector(s);
function announce(text){$('#announcement').textContent=text;}
function render(focusId){
 const open=new Set([...document.querySelectorAll('details[data-item][open]')].map(x=>x.dataset.item));
 $('#items').replaceChildren(...filterItems(items,filter).map((item,index)=>{
  const article=document.createElement('article');article.className='item'+(item.done?' is-done':'');
  const top=document.createElement('div');top.className='item-top';const time=document.createElement('span');time.className='item-time';time.textContent=item.time;const tag=document.createElement('span');tag.textContent=item.tag;top.append(time,tag);
  const title=document.createElement('h4');title.textContent=item.title;
  const details=document.createElement('details');details.dataset.item=item.id;details.open=open.has(item.id);const summary=document.createElement('summary');summary.textContent='查看交接內容';const detail=document.createElement('p');detail.textContent=item.detail;details.append(summary,detail);
  const bottom=document.createElement('div');bottom.className='item-bottom';const owner=document.createElement('span');owner.textContent=item.owner;const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.checked=item.done;input.id='check-'+item.id;input.setAttribute('aria-label',item.title+'：標記已讀');input.addEventListener('change',()=>{history.push(items);items=toggleItem(items,item.id);render(input.id);announce(item.title+(input.checked?'，已在本頁標記已讀。':'，已取消本頁已讀標記。'));});label.append(input,document.createTextNode('已讀'));bottom.append(owner,label);article.append(top,title,details,bottom);return article;
 }));
 const p=progress(items);$('#done-count').textContent=p.done;$('#progress').value=p.done;$('#progress').textContent=p.done+' / '+p.total;$('#remaining').textContent=p.done===p.total?'這份合成交接已全部閱讀。':'尚有 '+(p.total-p.done)+' 項可查看。';$('#undo').disabled=!history.length;$('#empty').hidden=filterItems(items,filter).length>0;
 if(focusId){const el=document.getElementById(focusId);if(el)el.focus();else $('#filter').focus();}
}
for(const mode of ['bridge','journal'])$('#'+mode).addEventListener('click',()=>{document.body.dataset.mode=mode;for(const m of ['bridge','journal'])$('#'+m).setAttribute('aria-pressed',String(mode===m));announce('已切換到'+(mode==='bridge'?'任務艦橋':'溫暖交接簿')+'，本頁勾選狀態保留。');});
$('#filter').addEventListener('change',e=>{filter=e.target.value;render();announce('顯示 '+filterItems(items,filter).length+' 項。');});
$('#undo').addEventListener('click',()=>{if(!history.length)return;items=history.pop();render();announce('已撤銷上一次本頁勾選。');if($('#undo').disabled)$('#reset').focus();});
$('#reset').addEventListener('click',()=>{items=initialItems();history=[];filter='all';$('#filter').value='all';render();announce('合成示例已重設。');});render();
