'use strict';
// Independent read-only differential check. No network resources or export.
// node workbench-coverage-20261121/check-candidate125.cjs [candidate-125/out]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {JSDOM} = require('../caregiver_mermaid/node_modules/jsdom');
const base = __dirname;
const original = path.join(base, 'candidate-123/out');
const candidate = path.resolve(process.argv[2] || path.join(base, 'candidate-125/out'));
const originalSha = '220d897ae04d15d93b4e7533c9316b59102965aa60bb780a0d425b60740848a5';
const topic = {old:60, fresh:61};
const images = {old:123, fresh:125};
const read = x => fs.readFileSync(x);
const sha = (x, encoding='hex') => crypto.createHash('sha256').update(x).digest(encoding);
const quotedHash = x => "'sha256-" + sha(x, 'base64') + "'";
const relativeRaster = /^\.\/visuals\/([a-f0-9]{64})\.(png|webp)$/;
const exactPin = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[a-f0-9]{40}\/.+#L\d+(?:-L\d+)?$/;
const origin = 'https://verified.invalid/experiments/workbench-compare/latest/';
const synthetic = '依開源實作重繪 · 非官方截圖';
const choiceKey = c => c.name + '\n' + c.links[0].url;
function approvedJson(file, digest) {
  const bytes = read(path.join(base,file));
  assert.equal(sha(bytes),digest,'approved draft manifest changed: '+file);
  return JSON.parse(bytes);
}
const contact = approvedJson('draft-contact-results/assets.json','3d26728a46d0a36063ff76124473fd7f86262daf659d444a42ccc63457a8c3e0');
const approved = [{title:'聯絡及收到紀錄：按投遞或事件查結果',dir:'draft-contact-results',rows:contact.map(r=>{
  const pin='https://github.com/'+r.sourceRepository+'/blob/'+r.sourceCommit+'/';
  for(const ref of [r.link,...r.sourceLinks])assert(ref.startsWith(pin)&&exactPin.test(ref));
  const license=r.variant==='A'?'MIT-LICENCE':'LICENSE';
  return {variant:r.variant,file:r.file,name:r.choice,link:r.link,links:[r.link,...r.sourceLinks,pin+license],
    alt:r.alt,label:r.previewLabel,credit:r.credit,digest:r.sha256,dimensions:r.dimensions};
})}];
for(const group of approved) {
  assert.deepEqual(group.rows.map(c=>c.variant),['A','B']);
  for(const row of group.rows) {
    assert(exactPin.test(row.link),'not an exact line pin: '+row.link);
    assert.equal(row.label,synthetic);
    assert.match(row.file,/^[a-z0-9-]+\.png$/);
    row.bytes = read(path.join(base,group.dir,row.file));
    assert.deepEqual([row.bytes.readUInt32BE(16),row.bytes.readUInt32BE(20)],row.dimensions);
    assert.equal(sha(row.bytes),row.digest,'draft raster hash');
  }
}
const baseBytes = read(path.join(original,'index.html'));
assert.equal(sha(baseBytes),originalSha,'sealed candidate-123 HTML');
const bytes = read(path.join(candidate,'index.html'));
const fresh = bytes.toString('utf8');
assert.equal(Buffer.from(fresh).compare(bytes),0,'invalid UTF-8');
// outside-only, no resource loader: scripts are evaluated manually only after
// comparison to the sealed runtime; source links are inspected, never followed.
const windowFor = html => new JSDOM(html,{runScripts:'outside-only',url:origin}).window;
const baseline = windowFor(baseBytes.toString('utf8')), next = windowFor(fresh);
function parse(w) {
  const d=w.document;
  assert.equal(d.scripts.length,2,'unexpected scripts');
  assert.equal(d.scripts[0].id,'records');
  assert.equal(d.scripts[0].type,'application/json');
  assert(!d.scripts[1].hasAttribute('src')&&!d.scripts[1].hasAttribute('type'));
  assert.equal(d.querySelectorAll('style').length,1);
  const raw=d.scripts[0].textContent,script=d.scripts[1].textContent,style=d.querySelector('style').textContent;
  const artworkMatch=script.match(/^const artwork=(\{.*\});$/m);
  assert(artworkMatch,'missing exact artwork declaration');
  const artRaw=artworkMatch[1];
  return {raw,records:JSON.parse(raw),script,style,artRaw,art:JSON.parse(artRaw),doc:d};
}
const p=parse(baseline), n=parse(next);
const allChoices = x=>x.records.flatMap(r=>r.choices);
const totals = x=>[x.records.length,allChoices(x).length,Object.keys(x.art).length];
assert.deepEqual(totals(p),[topic.old,images.old,images.old]);
assert.deepEqual(totals(n),[topic.fresh,images.fresh,images.fresh],'not exactly 61 topics and 125 cards/artworks');
assert.deepEqual(n.records.slice(0,topic.old),p.records,'old record changed');
assert(n.raw.startsWith(p.raw.slice(0,-1)+','),'old records JSON not an exact prefix');
assert(n.artRaw.startsWith(p.artRaw.slice(0,-1)+','),'old artwork JSON not an exact prefix');
assert.equal(n.style,p.style,'CSS changed');
const stripArtwork = x=>x.replace(/^const artwork=.*;$/m,'const artwork={};');
assert.equal(stripArtwork(n.script),stripArtwork(p.script),'runtime changed outside the artwork data');
assert(!/data:image\//i.test(fresh),'embedded raster');
const d = n.doc;
assert.equal(d.querySelector('base,iframe,frame,object,embed,source,img[src],link[rel="stylesheet"],script[src],[srcset],[onload],[onclick],[onerror]'),null);
const cspElement=d.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
assert.equal(cspElement.length,1);
const expectedCsp=[
  "default-src 'none'",'script-src '+quotedHash(n.script),'style-src '+quotedHash(n.style),
  "img-src 'self'","connect-src 'none'","media-src 'none'","object-src 'none'",
  "frame-src 'none'","base-uri 'none'","form-action 'none'"
].join('; ');
assert.equal(cspElement[0].content,expectedCsp,'CSP mismatch');
const oldNotice = p.doc.querySelector('footer details'), newNotice = d.querySelector('footer details');
assert(oldNotice&&newNotice);
assert.equal(oldNotice.querySelectorAll('pre').length,146);
const rawNotices=x=>[...x.children].map(el=>el.outerHTML);
assert.deepEqual(rawNotices(newNotice).slice(0,oldNotice.childElementCount),rawNotices(oldNotice),'existing attribution/notice changed');
const addedNotice=[...newNotice.children].slice(oldNotice.childElementCount);
assert(addedNotice.length>=2,'missing attribution and disclaimer for new comparison');
const addedCopy=addedNotice.map(x=>x.textContent).join('\n');
for(const term of ['非官方','Postal','OnCall','已讀']) assert(addedCopy.includes(term),'missing new attribution/disclaimer '+term);
// Require the complete static shell to be unchanged apart from the four data
// rows, the added notice, updated counters, CSP and the last-topic label.
for(const [page,q,a] of [[p,topic.old,images.old],[n,topic.fresh,images.fresh]]){
  const fig=page.doc.querySelector('.figures');
  assert.equal(fig.getAttribute('aria-label'),`共 ${q} 個主題，${a} 個方案`);
  assert.deepEqual([...fig.querySelectorAll('b')].map(x=>x.textContent),[String(q),String(a)]);
}
assert.equal(d.title,'育伴港選配工作台','browser title must be current and not hardcode a stale topic count');
function staticShell(x, keepNotice) {
  const root=x.doc.documentElement.cloneNode(true);
  root.querySelector('meta[http-equiv="Content-Security-Policy"]').removeAttribute('content');
  for(const script of root.querySelectorAll('script'))script.textContent='';
  const notice=root.querySelector('footer details');
  while(notice.childElementCount>keepNotice) notice.lastElementChild.remove();
  root.querySelector('#latest').textContent='';
  const figures=root.querySelector('.figures');
  figures.removeAttribute('aria-label');
  for(const count of figures.querySelectorAll('b'))count.textContent='';
  return root.outerHTML;
}
assert.equal(sha(staticShell(n,oldNotice.childElementCount)),sha(staticShell(p,oldNotice.childElementCount)),'unexpected static shell change');
const files = new Set();
for(const [i,r] of n.records.entries()){
  if(i>=topic.old) {
    const group=approved[i-topic.old];
    assert.equal(r.title,group.title,'new topic order/title');
    assert.equal(r.choices.length,group.rows.length);
  }
  for(const [j,c] of r.choices.entries()){
    const key=choiceKey(c),a=n.art[key]; assert(a,'missing artwork: '+key);
    const match=relativeRaster.exec(a.src);
    assert(match&&match[0]===a.src,'invalid same-origin raster URL '+key);
    const filename=path.basename(a.src);
    assert(!files.has(filename),'duplicate artwork filename');
    files.add(filename);
    const filenamePath=path.join(candidate,'visuals',filename);
    assert(fs.lstatSync(filenamePath).isFile(),'not a regular file: '+filename);
    const picture=read(filenamePath);
    assert.equal(sha(picture),match[1],'content-address mismatch: '+key);
    assert(match[2]==='png' ? picture.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      picture.toString('ascii',0,4)==='RIFF' && picture.toString('ascii',8,12)==='WEBP','raster magic mismatch');
    if(i<topic.old){
      assert.deepEqual(a,p.art[key],'sealed artwork metadata changed: '+key);
      assert.deepEqual(picture,read(path.join(original,'visuals',filename)),'prior asset changed: '+key);
    } else {
      const app=approved[i-topic.old].rows[j];
      assert.equal(c.name,app.name,'approved choice name/order changed');
      assert.equal(c.links[0].url,app.link,'approved first-source pin changed');
      assert.deepEqual(c.links.map(l=>l.url),app.links,'approved additional pins or code-license pin changed');
      assert.equal(a.src,'./visuals/'+app.digest+'.png','new art does not match its approved raster');
      assert.deepEqual(picture,app.bytes);
      assert.equal(a.alt,app.alt,'approved accessible description changed');
      assert.equal(a.previewLabel,app.label,'approved synthetic disclosure changed');
      assert.equal(a.credit,app.credit,'approved source credit changed');
      assert(!a.original&&!a.replacement,'misleading source-art links');
    }
  }
}
assert.equal(files.size,images.fresh);
assert.deepEqual(new Set(fs.readdirSync(path.join(candidate,'visuals'))),files,'extra/missing visuals');
assert.deepEqual(new Set(fs.readdirSync(candidate)),new Set(['index.html','visuals']),'extra or missing static outputs');
function id(w,i){const el=w.document.getElementById(i);assert(el,'missing #'+i);return el}
function e(w,t){return new w.Event(t,{bubbles:true,cancelable:true})}
function go(w,num){const el=id(w,'topic');el.value=String(num);el.dispatchEvent(e(w,'change'))}
function cards(w){return [...w.document.querySelectorAll('#gallery article')]}
function apply(w,script,enhanced=true) {
  const dialog=id(w,'image-dialog');
  // Keep app handlers intact. JSDOM lacks native dialog/Escape geometry.
  if(enhanced){
    dialog.showModal=function(){this.setAttribute('open','')};
    dialog.close=function(){this.removeAttribute('open');this.dispatchEvent(e(w,'close'))};
    dialog.getBoundingClientRect=()=>({left:30,right:230,top:30,bottom:230});
  } else {
    Object.defineProperty(dialog,'showModal',{value:undefined});
  }
  w.eval(script);
}
apply(baseline,p.script);apply(next,n.script);
const sel=id(next,'topic'), last=id(next,'latest');
assert.equal(sel.options.length,topic.fresh);
assert.equal(last.textContent.trim(),'直達第 61 題');
for(let i=0;i<n.records.length;i++){
  const record=n.records[i];
  go(next,i+1);
  assert.equal(sel.value,String(i+1));
  if(i<topic.old) {
    const before=id(baseline,'topic').options[i];
    assert.equal(sel.options[i].outerHTML,before.outerHTML,'old selector title/key changed');
  }
  assert.equal(id(next,'viewtitle').textContent,record.title);
  const nodes=cards(next);assert.equal(nodes.length,record.choices.length);
  nodes.forEach((node,j)=>{
    const c=record.choices[j], a=n.art[choiceKey(c)], im=node.querySelector('img');
    assert(im,'image not rendered #'+(i+1)+' choice '+j);
    assert.equal(im.getAttribute('src'),a.src);
    assert.equal(im.alt,a.alt);
    assert.equal(new URL(im.src).href,new URL(a.src,origin).href);
    assert.equal(node.querySelector('[data-choose]').dataset.choose,String(j));
    const src=[...node.querySelectorAll('a')].find(x=>x.getAttribute('href')===c.links[0].url);
    assert(src,'first source absent from DOM');assert.equal(src.rel,'noopener noreferrer');
    assert.equal(src.referrerPolicy,'no-referrer');assert.equal(src.target,'_blank');
    if(i>=topic.old) {
      assert.equal(node.querySelector('h3').textContent,c.name);
      assert.equal(node.querySelector('a'),src,'approved primary link must precede supplementary links');
      assert.deepEqual([...node.querySelectorAll('a')].map(a=>a.getAttribute('href')),c.links.map(l=>l.url));
      assert([...node.querySelectorAll('.image-caption')].some(x=>x.textContent===synthetic));
      assert.equal(im.closest('button').getAttribute('aria-label'),'放大 '+c.name+' '+synthetic);
    }
  });
}
function selectionEntries(w) {
  return [...id(w,'entries').querySelectorAll('.entry')].map(el=>el.outerHTML);
}
for(const w of [baseline,next]){
  for(let i=0;i<topic.old;i++){
    go(w,i+1);
    const j=i % p.records[i].choices.length;
    cards(w)[j].querySelector('[data-choose]').click();
    const choose=cards(w)[j].querySelector('[data-choose]');
    assert.equal(choose.getAttribute('aria-pressed'),'true');
    assert.equal(w.document.activeElement,choose);
  }
  id(w,'summary').click();
  assert(!id(w,'list').hidden);
  assert.equal(selectionEntries(w).length,topic.old);
}
assert.deepEqual(selectionEntries(next),selectionEntries(baseline),'old selection rows changed');
// Summary inspection only: no click of #copy, no export or file creation.
const row=id(next,'entries').querySelectorAll('.entry')[topic.old-1];
row.querySelector('button').click();
assert.equal(sel.value,'60');
assert.equal(cards(next).length,1,'old selected choice lookup regressed');
for(const [from,state] of [[1,'ordinary'],[60,'summary'],[60,'single'],[61,'ordinary']]){
  go(next,from);
  if(state==='summary')id(next,'summary').click();
  if(state==='single')id(next,'modes').children[1].click();
  assert(!last.hidden&&!last.disabled&&!last.closest('[hidden]'),'last command unavailable from '+state);
  for(let el=last;el;el=el.parentElement){
    const styles=next.getComputedStyle(el);
    assert(styles.display!=='none'&&styles.visibility!=='hidden',"last shortcut's rendered position hidden");
  }
  last.click();
  assert.equal(sel.value,'61');
  assert.equal(id(next,'viewtitle').textContent,approved[0].title);
  assert.equal(d.activeElement,id(next,'viewtitle'));
  assert.equal(cards(next).length,2);
  assert(id(next,'next').disabled&&!id(next,'prev').disabled);
}
id(next,'prev').click();assert.equal(sel.value,'60');
id(next,'next').click();assert.equal(sel.value,'61');
const dialog=id(next,'image-dialog'), full=id(next,'image-full');
assert.equal(dialog.querySelector('button'),null);
const point=(type,x,y)=>new next.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
for(let j=0;j<2;j++){
  go(next,topic.fresh);
  const node=cards(next)[j], im=node.querySelector('img'), trigger=im.closest('button');
  trigger.focus();trigger.click();
  assert(dialog.open);
  assert.equal(full.getAttribute('src'),im.getAttribute('src'));assert.equal(full.alt,im.alt);
  const c=n.records[topic.fresh-1].choices[j];
  assert.equal(id(next,'image-title').textContent,c.name+' · '+synthetic);
  assert.equal(d.activeElement,id(next,'image-title'));
  dialog.dispatchEvent(point('pointerdown',100,100));dialog.dispatchEvent(point('click',0,0));
  assert(dialog.open,'inside press / outside release dismissed');
  dialog.dispatchEvent(point('pointerdown',0,0));dialog.dispatchEvent(e(next,'pointercancel'));dialog.dispatchEvent(point('click',0,0));
  assert(dialog.open,'cancelled gesture incorrectly dismissed');
  dialog.dispatchEvent(point('pointerdown',0,0));dialog.dispatchEvent(point('click',0,0));
  assert(!dialog.open&&!full.hasAttribute('src'));assert.equal(d.activeElement,trigger);
  trigger.click();dialog.dispatchEvent(e(next,'cancel'));
  assert(!dialog.open);assert.equal(d.activeElement,trigger);
  trigger.click();full.dispatchEvent(e(next,'error'));
  assert(!dialog.open);assert.equal(d.activeElement,trigger);
  const links=[...node.querySelectorAll('a')].map(a=>a.getAttribute('href'));
  im.dispatchEvent(e(next,'error'));
  assert.equal(node.querySelector('img'),null);
  assert.equal(d.activeElement,id(next,'viewtitle'));
  assert.deepEqual([...node.querySelectorAll('a')].map(a=>a.getAttribute('href')),links,'broken thumbnail removed links');
}
const noDialog=windowFor(fresh);
apply(noDialog,n.script,false);
go(noDialog,topic.fresh);
for(const node of cards(noDialog)){
  const im=node.querySelector('img');
  assert(im && !im.closest('button'),'no-dialog fallback should be a static image');
  assert(node.querySelector('a'),'no-dialog fallback lost its first source');
}
console.log(JSON.stringify({
  htmlSha256:sha(bytes),cssSha256:sha(n.style),runtimeSha256:sha(n.script),
  topics:topic.fresh,options:images.fresh,unchangedImages:images.old,newImages:2,order:approved.map(a=>a.title),
  preservedNotices:oldNotice.querySelectorAll('pre').length,appendedNoticeBlocks:addedNotice.length,
  lastShortcut:'61 from ordinary, summary, single-card and already-last',
  dom:'125 source/image bindings; 60 prior selections; 2 zoom/focus/dismiss and static/error fallbacks; no export'
}));
