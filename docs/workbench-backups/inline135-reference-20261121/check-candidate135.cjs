'use strict';
// Independent read-only differential check. No network resources or export.
// node workbench-coverage-20261121/check-candidate135.cjs [candidate-135/out] [sealed HTML SHA-256]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {JSDOM} = require('../caregiver_mermaid/node_modules/jsdom');
const base = __dirname;
const original = path.join(base, 'candidate-133/out');
const candidate = path.resolve(process.argv[2] || path.join(base, 'candidate-135/out'));
const originalSha = '0e8cad0f7ef22fba35fba331e8e0a775f6d62ba44609daa80314b9b1f9bbfb27';
const topic = {old:65, fresh:66};
const images = {old:133, fresh:135};
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
const searchDraft = approvedJson('draft-search-coverage/assets.json','d914fa7236d6d1bdc28b5c40539a31ba6971b5d938590e65174ba25164ed183a');
const fixture=approvedJson('draft-search-coverage/fixture.json','d663d2c8a3edc82f148bc8d9a5e82ba443145375103b301957c15397745ed67b');
assert.deepEqual([fixture.a.matches,fixture.a.rerunCount],[30,1000]);
assert.match(fixture.a.query,/ count:30$/u);
assert.deepEqual(fixture.b.queryWindow,['14:00','14:25']);
assert.equal(fixture.b.activePage,1);
assert(fixture.b.pages[1][1]<fixture.b.pages[0][0],'earlier page and recent page are distinct time windows');
assert.deepEqual([fixture.b.logs.at(-1)[0],fixture.b.logs[0][0]],fixture.b.pages[fixture.b.activePage]);
const approvedCopy=[
  '這次搜尋達到結果上限，有部分結果未列出。勾選較高的上限後要另跑一次，不是接續本次結果，也不代表已搜完。',
  '右側時段只表示實際回傳日誌的範圍。查看更早日誌時，保留查詢式、改到較早的時間窗，不是在同一時間窗增加筆數。'
];
const approved = [{title:'搜尋範圍：改上限或改時段',dir:'draft-search-coverage',rows:searchDraft.map((r,i)=>{
  const pin='https://github.com/'+r.sourceRepository+'/blob/'+r.sourceCommit+'/';
  assert(r.link.startsWith(pin)&&exactPin.test(r.link));
  const licenceSuffix=i===0?'LICENSE.apache':'LICENSE';
  assert.equal(r.sourceRepository,['sourcegraph/sourcegraph-public-snapshot','grafana/grafana'][i]);
  assert.equal(r.sourceCommit,['1cd36d2dbbd2a9ab638cc437d208d2717eaefb0b','4c0e7045f97f356716755b47183b22e7f12bb4bf'][i]);
  assert.equal(r.sourceVersion,['final public Apache snapshot','v12.0.0'][i]);
  assert.equal(r.sourceLicense,['Apache-2.0','AGPL-3.0-only'][i]);
  assert.equal(r.sourceLinks.at(-2),pin+(i===0?'LICENSE#L1-L3':'LICENSING.md#L1-L5'));
  for(const ref of r.sourceLinks)assert(ref.startsWith(pin)&&(exactPin.test(ref)||ref===pin+licenceSuffix));
  assert.equal(r.sourceLinks.at(-1),pin+licenceSuffix);
  assert.equal(new Set([r.link,...r.sourceLinks]).size,1+r.sourceLinks.length);
  return {variant:r.variant,file:r.file,name:r.choice,link:r.link,links:[r.link,...r.sourceLinks],
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
assert.equal(sha(baseBytes),originalSha,'sealed candidate-133 HTML');
const bytes = read(path.join(candidate,'index.html'));
const requiredSeal=process.argv[3];
assert.match(requiredSeal || '',/^[a-f0-9]{64}$/,'pass the independently reported candidate-135 HTML seal, not a locally computed digest');
assert.equal(sha(bytes),requiredSeal,'candidate-135 HTML does not match the exact seal under test');
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
assert.deepEqual(totals(n),[topic.fresh,images.fresh,images.fresh],'not exactly 66 topics and 135 cards/artworks');
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
assert.equal(oldNotice.querySelectorAll('pre').length,151);
const rawNotices=x=>[...x.children].map(el=>el.outerHTML);
assert.deepEqual(rawNotices(newNotice).slice(0,oldNotice.childElementCount),rawNotices(oldNotice),'existing attribution/notice changed');
const addedNotice=[...newNotice.children].slice(oldNotice.childElementCount);
assert.deepEqual(addedNotice.map(x=>x.tagName),['H3','PRE'],'one attribution/disclaimer pair for #66 only');
assert.match(addedNotice[0].textContent,/^第 66 題/u);
const addedCopy=addedNotice.map(x=>x.textContent).join('\n');
for(const term of ['非官方','Sourcegraph','Grafana OSS','v12.0.0','Apache-2.0','AGPL-3.0-only']) assert(addedCopy.includes(term),'missing new attribution/disclaimer '+term);
assert(/獨立虛構工作場景，不是同一流程/u.test(addedCopy),'A/B must remain separate, not successive steps');
assert(/修改結果上限後重新搜尋，不是接續/u.test(addedCopy));
assert(/保留查詢式並改到較早的時間窗，不是同一時間窗增加筆數/u.test(addedCopy));
assert(/兩者都不表示結果已完整/u.test(addedCopy));
const declaration=read(path.join(base,'draft-search-coverage','DECLARATION.txt'));
assert.equal(sha(declaration),'0911050b7a8412944d3c0161d7b00d2b0a6ddd8e1e6a3842ccb5a26d474210fe','draft #66 disclosure seal changed');
assert.equal(addedNotice[1].textContent,declaration.toString('utf8'),'served disclosure differs from sealed draft');
// Require the complete static shell to be unchanged apart from the new data,
// the added notice, updated counters, CSP and the last-topic label.
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
      assert.deepEqual(Object.keys(a).sort(),['src','alt','credit','original','replacement','previewLabel'].sort());
      assert.deepEqual(Object.keys(c).sort(),['name','note','links'].sort());
      assert.equal(c.note,approvedCopy[j],'copy must distinguish rerun with changed cap from looking at an earlier time window');
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
assert.equal(last.textContent.trim(),'直達第 66 題');
for(let i=0;i<n.records.length;i++){
  const record=n.records[i];
  go(next,i+1);
  assert.equal(sel.value,String(i+1));
  if(i<topic.old) {
    go(baseline,i+1);
    assert.equal(id(next,'gallery').outerHTML,id(baseline,'gallery').outerHTML,'prior card DOM/IDs changed');
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
      const anchors=[...node.querySelectorAll('a')];
      assert.deepEqual(anchors.map(a=>a.getAttribute('href')),c.links.map(l=>l.url));
      const evidence=node.querySelector('details');
      assert(evidence && !evidence.open && evidence.querySelector('summary'),'secondary sources should remain in a native disclosure');
      assert.equal(evidence.querySelector('summary').textContent,`更多原方參考（${anchors.length-1}）`);
      assert.deepEqual([...evidence.querySelectorAll('a')],anchors.slice(1));
      for(const a of anchors){
        assert.equal(a.rel,'noopener noreferrer');
        assert.equal(a.referrerPolicy,'no-referrer');assert.equal(a.target,'_blank');
      }
      assert([...node.querySelectorAll('p')].some(x=>x.textContent===c.note),'served card wording missing');
      assert.equal(node.querySelectorAll('button').length,2,'static mock cannot expose a usable search action');
      assert.deepEqual([...node.querySelectorAll('.image-caption')].map(x=>x.textContent),[synthetic,a.credit]);
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
assert.equal(sel.value,String(topic.old));
assert.equal(cards(next).length,1,'old selected choice lookup regressed');
for(const [from,state] of [[1,'ordinary'],[topic.old,'summary'],[topic.old,'single'],[topic.fresh,'ordinary']]){
  go(next,from);
  if(state==='summary')id(next,'summary').click();
  if(state==='single')id(next,'modes').children[1].click();
  assert(!last.hidden&&!last.disabled&&!last.closest('[hidden]'),'last command unavailable from '+state);
  for(let el=last;el;el=el.parentElement){
    const styles=next.getComputedStyle(el);
    assert(styles.display!=='none'&&styles.visibility!=='hidden',"last shortcut's rendered position hidden");
  }
  last.click();
  assert.equal(sel.value,String(topic.fresh));
  assert.equal(id(next,'viewtitle').textContent,approved[0].title);
  assert.equal(d.activeElement,id(next,'viewtitle'));
  assert.equal(cards(next).length,2);
  assert(id(next,'next').disabled&&!id(next,'prev').disabled);
}
id(next,'prev').click();assert.equal(sel.value,String(topic.old));
id(next,'next').click();assert.equal(sel.value,String(topic.fresh));
// Confirm both new choices remain independently usable in the local selection UI,
// and that swapping the #66 decision cannot alter any of the first 65 decisions.
for(let j=0;j<2;j++){
  go(next,topic.fresh);
  cards(next)[j].querySelector('[data-choose]').click();
  assert.equal(cards(next)[j].querySelector('[data-choose]').getAttribute('aria-pressed'),'true');
  id(next,'summary').click();
  const entries=selectionEntries(next);
  assert.equal(entries.length,topic.fresh);
  assert.deepEqual(entries.slice(0,topic.old),selectionEntries(baseline));
  assert(id(next,'entries').querySelectorAll('.entry')[topic.old].textContent.includes(approved[0].rows[j].name));
}
// JSDOM does not synthesize native keyboard activations. Check native
// focusability and dispatch Enter/Space then simulate their default click.
// For verified outbound links, cancel the default to prevent navigation.
function press(w, el, key, activate) {
  const d=w.document;
  el.focus();
  assert.equal(d.activeElement,el,'keyboard action is not focusable');
  assert(el.tabIndex>=0&&!el.disabled&&!el.closest('[hidden]'),'keyboard action unavailable');
  const init={key,code:key===' '?'Space':key,bubbles:true,cancelable:true};
  const down=el.dispatchEvent(new w.KeyboardEvent('keydown',init));
  const up=el.dispatchEvent(new w.KeyboardEvent('keyup',init));
  if(down&&(key!==' '||up)) activate();
}
press(next,last,'Enter',()=>last.click());
assert.equal(d.activeElement,id(next,'viewtitle'));
assert.equal(sel.value,String(topic.fresh));
for(const node of cards(next)){
  const summary=node.querySelector('details > summary');
  const details=summary.parentElement;
  press(next,summary,'Enter',()=>summary.click());
  assert(details.open,'native evidence disclosure failed to open');
  for(const link of [node.querySelector('a'),[...details.querySelectorAll('a')].at(-1)]){
    assert(link);
    let fired=0;
    link.addEventListener('click',event=>{event.preventDefault();++fired},{once:true});
    const before=selectionEntries(next);
    press(next,link,'Enter',()=>link.click());
    assert.equal(fired,1,'source did not expose a cancellable primary keyboard activation');
    assert.equal(sel.value,String(topic.fresh));
    assert.deepEqual(selectionEntries(next),before,'following a source should not select a card');
  }
}
const dialog=id(next,'image-dialog'), full=id(next,'image-full');
assert.equal(dialog.querySelector('button'),null);
const point=(type,x,y)=>new next.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
for(let j=0;j<2;j++){
  go(next,topic.fresh);
  const node=cards(next)[j], im=node.querySelector('img'), trigger=im.closest('button');
  press(next,trigger,j===0?'Enter':' ',()=>trigger.click());
  assert(dialog.open);
  full.dispatchEvent(point('pointerdown',80,80));full.dispatchEvent(point('click',80,80));
  assert(dialog.open,'inside image click dismissed');
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
  trigger.click();
  // Native Escape translates to a dialog cancel event in a browser;
  // dispatch both in sequence to test the site's cancel/restore behavior.
  const escape=dialog.dispatchEvent(new next.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
  if(escape&&dialog.open) assert(!dialog.dispatchEvent(e(next,'cancel')),'cancel is intercepted for cleanup');
  assert(!dialog.open&&!full.hasAttribute('src'));assert.equal(d.activeElement,trigger);
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
  lastShortcut:'66 from ordinary, summary, single-card and already-last',
  dom:'135 source/image bindings; 65 preserved choices/summary; both new choices; keyboard focus and modeled activation, 2 zoom/focus/dismiss and static/error fallbacks; no export'
}));
