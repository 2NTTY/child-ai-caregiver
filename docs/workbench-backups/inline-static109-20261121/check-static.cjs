'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), {createHash}=require('node:crypto');
const {JSDOM}=require('../../caregiver_mermaid/node_modules/jsdom');
const root=path.resolve(__dirname,'..');
const release=path.join(__dirname,'embedded-109.html');
const candidate=path.resolve(process.argv[2]||path.join(__dirname,'out/index.html'));
const read=(p,encoding)=>fs.readFileSync(p,encoding);
const sha=(b,encoding='hex')=>createHash('sha256').update(b).digest(encoding);
const source=read(release,'utf8'), html=read(candidate,'utf8');
assert(!/data:image\//i.test(html),'HTML must not embed per-image data');
const base=new JSDOM(source,{runScripts:'outside-only',url:'https://test.invalid/experiments/workbench-compare/latest/'}).window;
const w=new JSDOM(html,{runScripts:'outside-only',url:'https://test.invalid/experiments/workbench-compare/latest/'}).window;
const doc=w.document, original=base.document;
const parseArtwork=d=>JSON.parse(d.scripts[1].textContent.match(/const artwork=(.*?);\n/s)[1]);
const old=parseArtwork(original), local=parseArtwork(doc);
const releaseReceipt=JSON.parse(read(path.join(__dirname,'embedded-receipt.json'),'utf8'));
const approvals=JSON.parse(read(path.join(__dirname,'batch-109.json'),'utf8'));
const pathShape=/^\.\/visuals\/([a-f0-9]{64})\.(png|webp)$/;
assert.equal(sha(source),releaseReceipt.htmlSha);
assert.equal(doc.scripts.length,2);
assert.equal(doc.scripts[0].textContent,original.scripts[0].textContent);
assert.equal(doc.querySelector('style').textContent,original.querySelector('style').textContent);
assert.equal(doc.querySelector('footer').outerHTML,original.querySelector('footer').outerHTML);
const meta=d=>Object.fromEntries(d.querySelector('meta[http-equiv=Content-Security-Policy]').content.split(';').map(s=>s.trim().split(/ (.+)/,2)));
assert.deepEqual(meta(doc),{...meta(original),'img-src':"'self'",'script-src':"'sha256-"+sha(doc.scripts[1].textContent,'base64')+"'"});
assert.equal(Object.keys(local).length,109);
assert.deepEqual(Object.keys(local),Object.keys(old));
const records=JSON.parse(doc.scripts[0].textContent), all=records.flatMap(topic=>topic.choices);
assert.deepEqual([records.length,all.length],[53,109]);
const used=new Set();
for (const e of approvals) {
 const matches=all.filter(c=>c.links[0].url===e.link&&(e.choice===undefined||e.choice===c.name));
 assert.equal(matches.length,1);
 const k=matches[0].name+'\n'+e.link;
 const {src,...detail}=local[k];
 const {src:previousSrc,...previousDetail}=old[k];
 assert.deepEqual(detail,previousDetail);
 const m=pathShape.exec(src);
 assert(m,src);
 assert.equal(m[1],e.sha256);
 assert.equal(m[2],e.mime==='image/webp'?'webp':'png');
 const bytes=read(path.resolve(path.dirname(candidate),src));
 assert.equal(sha(bytes),e.sha256);
 assert.deepEqual(bytes,read(path.resolve(root,e.file)));
 assert.deepEqual(bytes,Buffer.from(previousSrc.split(',')[1],'base64'));
 used.add(path.basename(src));
}
assert.equal(used.size,109);
assert.deepEqual(new Set(fs.readdirSync(path.join(path.dirname(candidate),'visuals'))),used);
const event=(win,type)=>new win.Event(type,{bubbles:true,cancelable:true});
// jsdom has no native dialog implementation. Shim only show/close; this still
// exercises production click, pointerdown, cancel, cleanup and focus handlers.
for (const win of [base,w]) {
 const dialog=win.document.getElementById('image-dialog');
 dialog.showModal=function(){this.setAttribute('open','')};
 dialog.close=function(){this.removeAttribute('open');this.dispatchEvent(event(win,'close'))};
 dialog.getBoundingClientRect=()=>({left:20,right:120,top:50,bottom:140});
 win.eval(win.document.scripts[1].textContent);
}
const id=(win,name)=>win.document.getElementById(name);
const gallery=win=>id(win,'gallery');
function state(win) {
 const d=win.document;
 return ['topic','position','current','count','viewtitle','gallery','summary','entries','out','view','list','modes'].map(i=>{
  const el=d.getElementById(i),cloned=el.cloneNode(true);
  for(const img of cloned.querySelectorAll('img'))img.removeAttribute('src');
  return [el.hidden,el.value,cloned.outerHTML];
 });
}
function both(action) {
 action(base);action(w);assert.deepEqual(state(w),state(base));
}
const change=(win,i)=>{const node=id(win,'topic');node.value=String(i);node.dispatchEvent(event(win,'change'))};
let imgCount=0;
for (let i=1;i<=records.length;i++) {
 both(win=>change(win,i));
 const cards=gallery(w).querySelectorAll('article');
 assert.equal(cards.length,records[i-1].choices.length);
 for(const [j,card] of cards.entries()) {
  const c=records[i-1].choices[j], row=local[c.name+'\n'+c.links[0].url], img=card.querySelector('img');
  assert.equal(Boolean(img),Boolean(row));
  if(row){assert.equal(img.getAttribute('src'),row.src);assert.equal(new URL(img.src).origin,w.location.origin);imgCount++}
 }
}
assert.equal(imgCount,109);
both(win=>id(win,'prev').click());
both(win=>id(win,'next').click());
both(win=>change(win,6));
both(win=>gallery(win).querySelector('[data-choose="1"]').click());
both(win=>id(win,'modes').children[2].click());
both(win=>id(win,'compare').click());
both(win=>id(win,'summary').click());
both(win=>id(win,'entries').querySelector('button').click());
both(win=>gallery(win).querySelector('[data-choose="1"]').click());
both(win=>id(win,'latest').click());
both(win=>change(win,1));
const dialog=id(w,'image-dialog'), full=id(w,'image-full'), imageButton=gallery(w).querySelector('button.image-preview');
assert.equal(dialog.querySelector('button'),null);
const point=(type,x,y)=>new w.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true});
imageButton.click();
assert(dialog.open);assert.equal(full.getAttribute('src'),imageButton.querySelector('img').getAttribute('src'));
dialog.dispatchEvent(point('pointerdown',50,70));dialog.dispatchEvent(point('click',0,0));
assert(dialog.open);
dialog.dispatchEvent(point('pointerdown',0,0));dialog.dispatchEvent(point('click',0,0));
assert(!dialog.open);assert(!full.hasAttribute('src'));assert.equal(doc.activeElement,imageButton);
imageButton.click();dialog.dispatchEvent(event(w,'cancel'));
assert(!dialog.open);assert.equal(doc.activeElement,imageButton);
const imageCard=imageButton.closest('article'), links=imageCard.querySelectorAll('a').length;
imageButton.querySelector('img').dispatchEvent(event(w,'error'));
assert(!imageCard.querySelector('img'));assert.equal(imageCard.querySelectorAll('a').length,links);
console.log(JSON.stringify({topics:records.length,options:all.length,verifiedRaster:imgCount,htmlBytes:Buffer.byteLength(html),originalBytes:Buffer.byteLength(source),runtime:'109-image all-topic DOM, selection/navigation, image dialog and fallback parity'}));

// Nonconforming source values never create an image. The HTML-level policy
// separately blocks network image origins and denies base element overrides.
const selected=records[0].choices.find(c=>local[c.name+'\n'+c.links[0].url]);
const selectedKey=selected.name+'\n'+selected.links[0].url;
for(const invalid of ['https://example.invalid/not-an-asset.png','./visuals/not-a-digest.webp',local[selectedKey].src+'?v=1',local[selectedKey].src+'\n']) {
 const altered=structuredClone(local);
 altered[selectedKey].src=invalid;
 const mutated=html.replace(/const artwork=.*?;\n/s,()=>`const artwork=${JSON.stringify(altered)};\n`);
 const sandbox=new JSDOM(mutated,{runScripts:'outside-only',url:w.location.href}).window;
 sandbox.eval(sandbox.document.scripts[1].textContent);
 const tested=Array.from(gallery(sandbox).querySelectorAll('article')).find(card=>card.querySelector('h3').textContent===selected.name);
 assert(tested&&!tested.querySelector('img'));
 assert(tested.querySelector('a'),'source link remains if local src rejected');
 sandbox.close();
}
console.log('PASS reject external, malformed, query and trailing newline image src values');
