import data from './data.mjs';
import {selectPlacements} from './model.mjs';
const $=s=>document.querySelector(s);
const el=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const layers={'root-mount':'根層接入','dashboard-mount':'Dashboard 接入','route-composition':'頁面局部組合','conditional-render':'依條件呈現'};
for(const r of data.routes){const o=el('option',r.route==='/'?'首頁 /':r.route);o.value=r.route;$('#route').append(o);}
for(const [id,title] of Object.entries(data.moduleTitles)){const o=el('option',title);o.value=id;$('#module').append(o);}
$('#route-total').textContent=data.routes.length;$('#placement-total').textContent=data.placements.length;$('#family-total').textContent=Object.keys(data.moduleTitles).length;
$('#pin-link').textContent=data.masterSha.slice(0,12);$('#pin-link').href='https://github.com/2NTTY/child-ai-caregiver/tree/'+data.masterSha;$('#pin-link').target='_blank';$('#pin-link').rel='noopener noreferrer';
function card(p){
 const d=el('details',undefined,'placement');const summary=el('summary');
 const heading=el('span',undefined,'heading');heading.append(el('span',layers[p.level],'layer'),el('strong',p.title),el('span',p.platforms.join(' / '),'platforms'));summary.append(heading);
 const body=el('div',undefined,'detail-body');body.append(el('p',p.moduleIds.map(id=>data.moduleTitles[id]).join(' · '),'modules'));
 if(p.chain.length){const chain=el('ol',undefined,'chain');for(const s of p.chain)chain.append(el('li',s));body.append(chain);}
 const dl=el('dl');for(const [label,value] of [['掛載條件',p.mountCondition],['顯示條件',p.visibleCondition],['資料／生命週期範圍',p.scope]])dl.append(el('dt',label),el('dd',value));body.append(dl);
 if(p.notes.length){const notes=el('ul',undefined,'notes');for(const note of p.notes)notes.append(el('li',note));body.append(notes);}
 body.append(el('p','來源支持這條有條件的放置鏈；目前畫面、操作及無障礙仍需另外實測。','verification'));
 const proof=el('details',undefined,'proof');proof.append(el('summary','查看固定版本的 '+p.sources.length+' 段來源'));
 const links=el('ul');for(const s of p.sources){const li=el('li'),a=el('a',s.label);a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);links.append(li);}proof.append(links);body.append(proof);d.append(summary,body);return d;
}
function render(){
 const selection={route:$('#route').value,module:$('#module').value,level:$('#level').value,query:$('#query').value};
 const found=selectPlacements(data,selection);$('#list').replaceChildren(...found.map(card));$('#empty').hidden=found.length>0;
 $('#status').textContent='顯示 '+found.length+' / '+data.placements.length+' 條已追蹤放置鏈。沒有命中不等於不存在。';
 const route=data.routes.find(r=>r.route===selection.route);
 $('#context').textContent=route?(route.layout==='dashboard'?'此頁有根層與 Dashboard 祖先；局部畫面仍受各項條件限制。':'此頁只有根層路由祖先，不沿用 Dashboard 外殼。'):'每條放置鏈只列一次，不代表所有頁面同時掛載。';
}
for(const id of ['route','module','level'])$('#'+id).addEventListener('change',render);
$('#query').addEventListener('input',render);
$('#clear').addEventListener('click',()=>{for(const id of ['route','module','level'])$('#'+id).value='all';$('#query').value='';render();$('#route').focus();});
render();
