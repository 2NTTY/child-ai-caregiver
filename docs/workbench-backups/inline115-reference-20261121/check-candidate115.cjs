'use strict';
// Independent read-only differential check: node check-candidate115.cjs /path/to/candidate-115/out
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {JSDOM}=require('../caregiver_mermaid/node_modules/jsdom');
const cwd=__dirname;
const oldDir=path.resolve(cwd,'../workbench-inline-pilot-20261121/candidate-109/out');
const dst=path.resolve(process.argv[2]||path.join(cwd,'candidate-115/out'));
const read=(p,enc)=>fs.readFileSync(p,enc);
const json=p=>JSON.parse(read(p,'utf8'));
const sha=(b,enc='hex')=>crypto.createHash('sha256').update(b).digest(enc);
const origin='https://verified.invalid/experiments/workbench-compare/latest/';
const relative=/^\.\/visuals\/([a-f0-9]{64})\.(png|webp)$/;
const approved=new Map();
function load(dir,name,selector,group) {
 const m=json(path.join(cwd,dir,name));
 for(const r of selector(m)) {
  const bytes=read(path.join(cwd,dir,r.file));
  assert(!approved.has(r.sha256)); assert.equal(sha(bytes),r.sha256,'draft manifest hash');
  approved.set(r.sha256,{...r,bytes,group});
 }
}
load('draft-archive','assets.json',m=>m.assets.map(r=>({...r,link:r.sources[0],previewLabel:r.label})),'archive');
load('draft-attachments','metadata.json',m=>m.previews.map(r=>({...r,link:r.sourceAnchors[0],previewLabel:m.label})),'attachments');
load('draft-teachers','assets.json',m=>m,'teachers');
assert.equal(approved.size,6);
const clean=read(path.join(oldDir,'index.html')), fresh=read(path.join(dst,'index.html'),'utf8');
assert.equal(sha(clean),'9a31627236474209fabdaf9008305eeafe7a25e776610abfa00db1ed83c8de88','trusted v116 HTML');
assert(!/data:image\//i.test(fresh),'no embedded rasters');
const open=source=>new JSDOM(source,{runScripts:'outside-only',url:origin}).window;
const old=open(clean.toString('utf8')), neu=open(fresh);
const d=neu.document,b=old.document;
function parse(doc) {
 assert.equal(doc.scripts.length,2,'only inert records and one inline runtime');
 assert.equal(doc.scripts[0].id,'records'); assert.equal(doc.scripts[0].type,'application/json');
 assert(!doc.scripts[1].hasAttribute('src'));
 const raw=doc.scripts[0].textContent,script=doc.scripts[1].textContent;
 const hit=script.match(/^const artwork=(\{.*\});$/m);assert(hit,'expected artwork map');
 return {raw,records:JSON.parse(raw),script,artRaw:hit[1],art:JSON.parse(hit[1])};
}
const next=parse(d), prev=parse(b), key=c=>c.name+'\n'+c.links[0].url;
const choices=n=>n.records.flatMap(r=>r.choices);
assert.deepEqual([next.records.length,choices(next).length,Object.keys(next.art).length],[56,115,115],'must be exactly 56 topics and 115 options/images');
assert.deepEqual([prev.records.length,choices(prev).length,Object.keys(prev.art).length],[53,109,109]);
assert.deepEqual(next.records.slice(0,53),prev.records,'old records changed');
assert(next.raw.startsWith(prev.raw.slice(0,-1)),'v116 record JSON prefix not byte-exact');
assert.equal(d.querySelectorAll('style').length,1);
const style=d.querySelector('style').textContent;
assert.equal(style,b.querySelector('style').textContent,'v116 CSS changed');
assert(next.artRaw.startsWith(prev.artRaw.slice(0,-1)),'v116 artwork serialization prefix changed');
const stripArtwork=s=>s.replace(/^const artwork=.*;$/m,'const artwork={};');
assert.equal(stripArtwork(next.script),stripArtwork(prev.script),'runtime code changed apart from artwork payload');
const noticeBlocks=doc=>[...doc.querySelectorAll('footer pre')].map(x=>x.textContent);
assert.equal(noticeBlocks(b).length,139);
assert.equal(noticeBlocks(d).length,142);
assert.deepEqual(noticeBlocks(d).slice(0,139),noticeBlocks(b),'v116 notice content changed');
function csp(doc) {
 const x=doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');assert.equal(x.length,1);
 const raw=x[0].content.split(';').filter(v=>v.trim()).map(v=>v.trim().split(/ (.+)/s,2));
 assert.equal(new Set(raw.map(kv=>kv[0])).size,raw.length,'duplicate CSP directives');
 return Object.fromEntries(raw);
}
const hash=v=>"'sha256-"+sha(v,'base64')+"'";
const c=csp(d);
assert.deepEqual(c,{...csp(b),'script-src':hash(next.script),'style-src':hash(style)},'CSP or literal JS/CSS hashes changed');
assert.equal(c['img-src'],"'self'");
assert.equal(c['connect-src'],"'none'");
assert.equal(c['base-uri'],"'none'");
assert.equal(d.querySelector('base,iframe,object,embed,script[src],link[rel="stylesheet"],img[src]'),null);
const names=new Set(), added=new Set(), draftOrder=['teachers','attachments','archive'];
for(const [i,t] of next.records.entries()){
 const group=new Set();
 for(const choice of t.choices){
  const k=key(choice),v=next.art[k];assert(v,'missing artwork: '+k);
  const m=relative.exec(v.src);assert(m&&m[0]===v.src,'not an exact relative raster URL: '+k);
  const n=path.basename(v.src),p=path.join(dst,'visuals',n);
  assert(!names.has(n)); names.add(n);
  assert(fs.lstatSync(p).isFile());
  const bytes=read(p);assert.equal(sha(bytes),m[1],'image not matching addressed SHA: '+k);
  if(i<53) {
   assert.deepEqual(v,prev.art[k],'v116 artwork changed: '+k);
   assert.deepEqual(bytes,read(path.join(oldDir,'visuals',n)),'v116 asset bytes changed: '+k);
  } else {
   const a=approved.get(m[1]);assert(a,'image absent from approved six: '+k);
   assert(!added.has(m[1]));added.add(m[1]);group.add(a.group);
   assert.equal(choice.links[0].url,a.link,'approved first link changed: '+k);
   assert.deepEqual(bytes,a.bytes);
   assert.equal(v.alt,a.alt,'approved alt changed: '+k);
   assert.equal(v.previewLabel,a.previewLabel,'approved nonofficial disclosure changed: '+k);
   assert(v.previewLabel.includes('非官方')&&v.credit,'missing disclosure or credit: '+k);
   if(a.choice)assert.equal(choice.name,a.choice,'approved teacher card name changed');
  }
 }
 if(i>=53) {
  assert.equal(t.choices.length,2);
  assert.deepEqual([...group],[draftOrder[i-53]],'wrong order or topic grouping');
 }
}
assert.equal(added.size,6);
assert.deepEqual(new Set(fs.readdirSync(path.join(dst,'visuals'))),names,'extra or missing static files');
function id(w,n){const out=w.document.getElementById(n);assert(out,'missing node '+n);return out}
function event(w,t){return new w.Event(t,{bubbles:true,cancelable:true})}
function go(w,n){const drop=id(w,'topic');drop.value=String(n);drop.dispatchEvent(event(w,'change'))}
function card(w,i){const node=w.document.querySelectorAll('#gallery article')[i];assert(node);return node}
function choose(w,i){const n=w.document.querySelector('[data-choose="'+i+'"]');assert(n);n.click()}
function apply(w,source) {
 const dialog=id(w,'image-dialog');
 // JSDOM has no native showModal, close, or screen geometry. Keep all
 // application handlers intact; test Escape via the native cancel event analogue.
 dialog.showModal=function(){this.setAttribute('open','')};
 dialog.close=function(){this.removeAttribute('open');this.dispatchEvent(event(w,'close'))};
 dialog.getBoundingClientRect=()=>({left:30,right:230,top:30,bottom:230});
 w.eval(source);
}
apply(old,prev.script);apply(neu,next.script);
const select=id(neu,'topic');
assert.equal(select.options.length,56);
assert.equal(id(neu,'latest').textContent.trim(),'直達第 56 題');
for(let i=0;i<next.records.length;i++){
 go(neu,i+1);
 if(i<53)assert.equal(select.options[i].textContent,id(old,'topic').options[i].textContent,'old selector key/label changed');
 assert.equal(id(neu,'viewtitle').textContent,next.records[i].title);
 const cards=[...d.querySelectorAll('#gallery article')];
 assert.equal(cards.length,next.records[i].choices.length);
 cards.forEach((n,j)=>{
  const k=next.records[i].choices[j],a=next.art[key(k)],im=n.querySelector('img');
  assert(im,'runtime image not rendered at topic '+(i+1));
  assert.equal(n.querySelector('[data-choose]').dataset.choose,String(j));
  assert.equal(im.getAttribute('src'),a.src);
  assert.equal(im.alt,a.alt);
  assert.equal(new URL(im.src).href,new URL(a.src,origin).href);
  assert([...n.querySelectorAll('a')].some(el=>el.getAttribute('href')===k.links[0].url),'runtime first source link missing');
 });
}
for(const w of [old,neu]){
 // Exercise the real selection handler on every prior topic, not just the
 // string formula: select in different positions and serialize the result.
 for(let n=1;n<=53;n++){
  go(w,n);
  const i=(n-1)%prev.records[n-1].choices.length;
  choose(w,i);
  assert.equal(card(w,i).querySelector('[data-choose]').getAttribute('aria-pressed'),'true');
 }
 id(w,'summary').click();assert(!id(w,'list').hidden);
 assert.equal(id(w,'entries').querySelectorAll('.entry').length,53);
}
assert.equal(id(neu,'out').value,id(old,'out').value,'v116 titles/keys/first-link selection export changed');
function latestFrom(n,{summary=false,single=false}={}) {
 go(neu,n);
 if(single)id(neu,'modes').children[1].click();
 if(summary)id(neu,'summary').click();
 const button=id(neu,'latest');
 assert(!button.hidden&&!button.disabled&&!button.closest('[hidden]'),'last-topic command is not unconditionally available');
 for(let el=button;el;el=el.parentElement){
  const s=neu.getComputedStyle(el);
  assert(s.display!=='none'&&s.visibility!=='hidden','CSS hides unconditional last-topic command');
 }
 button.click();
 assert.equal(select.value,'56');
 assert.equal(id(neu,'viewtitle').textContent,next.records[55].title);
 assert.equal(d.activeElement,id(neu,'viewtitle'));
 assert.equal(d.querySelectorAll('#gallery article').length,2);
 assert(id(neu,'next').disabled&&!id(neu,'prev').disabled);
}
latestFrom(1);latestFrom(52,{summary:true});latestFrom(54,{single:true});latestFrom(56);
id(neu,'prev').click();assert.equal(select.value,'55');
id(neu,'next').click();assert.equal(select.value,'56');

const dialog=id(neu,'image-dialog'), full=id(neu,'image-full');
assert.equal(dialog.querySelector('button'),null);
const point=(t,x,y)=>new neu.MouseEvent(t,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
for(let t=54;t<=56;t++)for(let i=0;i<2;i++){
 go(neu,t);
 const n=card(neu,i), im=n.querySelector('img'),trigger=im.closest('button');
 assert(trigger);trigger.focus();trigger.click();
 assert(dialog.open);
 assert.equal(full.getAttribute('src'),im.getAttribute('src'));
 assert.equal(full.alt,im.alt);
 assert(id(neu,'image-title').textContent.includes(next.records[t-1].choices[i].name));
 assert(id(neu,'image-title').textContent.includes('非官方'));
 assert.equal(d.activeElement,id(neu,'image-title'));
 dialog.dispatchEvent(point('pointerdown',100,100));dialog.dispatchEvent(point('click',0,0));
 assert(dialog.open,'press inside then release outside must not dismiss');
 dialog.dispatchEvent(point('pointerdown',0,0));dialog.dispatchEvent(point('click',0,0));
 assert(!dialog.open&&!full.hasAttribute('src'));assert.equal(d.activeElement,trigger);
 trigger.click();dialog.dispatchEvent(event(neu,'cancel'));assert(!dialog.open);assert.equal(d.activeElement,trigger);
 const links=n.querySelectorAll('a').length;
 im.dispatchEvent(event(neu,'error'));
 assert.equal(n.querySelector('img'),null);
 assert.equal(n.querySelectorAll('a').length,links,'failed raster removed source links');
}
console.log(JSON.stringify({topics:56,options:115,v116ExactImages:109,newExactImages:6,order:draftOrder,
 htmlSha256:sha(fresh),cssSha256:sha(style),runtimeSha256:sha(next.script),preservedNotices:139,appendedNotices:3,
 lastTopic:'56 from ordinary, summary, single-card and already-last states',dom:'all 115 cards and all six new open/dismiss/focus/failure'}));
