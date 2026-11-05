(function(global){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 function fresh(r){return {scope:r.scope,q:'',group:'all',ready:'all',page:0,selected:'',compare:[],details:false,sources:false,sourceQ:'',sourcePage:0,version:false};}
 function allowedPath(r,value){return typeof value==='string'&&/^(?:[a-z0-9-]+\/)*index\.html$/.test(value)&&r.paths.includes(value);}
 function href(r,key){if(typeof key!=='string'||!own(r.options,key))return null;const o=r.options[key];return allowedPath(r,o.path)?'../'+o.path+o.query:null;}
 function validCatalog(cat,r){
  if(!cat||cat.masterSha!==r.masterSha||cat.modules?.length!==88)return false;
  const actual=cat.modules.flatMap(m=>m.candidates.map(c=>[m.id,c.id,c.url]));
  return actual.length===r.candidates.length&&actual.every((v,i)=>v.every((x,j)=>x===r.candidates[i][j]))&&new Set(cat.modules.map(m=>m.id)).size===88;
 }
 function filter(cat,s){const q=s.q.trim().toLocaleLowerCase();return cat.modules.filter(m=>
  (s.group==='all'||m.group===s.group)&&(s.ready==='all'||(s.ready==='ready'?m.candidates.length>0:m.candidates.length===0))&&
  (!q||(/^[a-z]{1,2}\d{2}$/.test(q)?m.candidates.some(c=>[c.id,c.title].join(' ').toLowerCase().split(/[^a-z0-9]+/).includes(q)):[m.id,m.title,m.group,m.dataBoundary,m.operationBoundary,...m.directions,...m.candidates.flatMap(c=>[c.id,c.title])].join(' ').toLocaleLowerCase().includes(q))));}
 function compare(s,key,add,r){if(!href(r,key))return s;const next=s.compare.filter(x=>x!==key);if(add){if(s.compare.includes(key)||s.compare.length>=4)return s;next.push(key)}return {...s,compare:next};}
 function encode(s,r){const p=new URLSearchParams({v:r.scope});if(s.selected)p.set('m',s.selected);if(s.compare.length)p.set('c',s.compare.join(','));if(s.page)p.set('p',String(s.page));if(s.group!=='all')p.set('g',String(r.groups.indexOf(s.group)));if(s.ready!=='all')p.set('r',s.ready);return '?'+p.toString();}
 function decode(query,cat,r){
  const s=fresh(r),p=new URLSearchParams(query);if(p.get('v')!==r.scope)return s;
  const selected=p.get('m');if(cat.modules.some(m=>m.id===selected))s.selected=selected;
  const n=p.get('p');if(n&&/^\d{1,3}$/.test(n))s.page=Math.min(7,Number(n));
  const g=p.get('g');if(g&&/^\d{1,2}$/.test(g)&&r.groups[Number(g)])s.group=r.groups[Number(g)];
  if(['ready','mapped'].includes(p.get('r')))s.ready=p.get('r');
  for(const key of (p.get('c')||'').split(','))if(href(r,key)&&!s.compare.includes(key)&&s.compare.length<4)s.compare.push(key);
  return s;
 }
 global.CompactCore=Object.freeze({fresh,allowedPath,href,validCatalog,filter,compare,encode,decode});
})(window);
