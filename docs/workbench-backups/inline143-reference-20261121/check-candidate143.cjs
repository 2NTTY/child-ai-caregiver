'use strict';
// Independent read-only differential check. No network resources or export.
// node workbench-coverage-20261121/check-candidate143.cjs [candidate-143/out] [sealed HTML SHA-256]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {JSDOM} = require('../caregiver_mermaid/node_modules/jsdom');
const base = __dirname;
const original = path.join(base, 'candidate-141/out');
const candidate = path.resolve(process.argv[2] || path.join(base, 'candidate-143/out'));
const originalSha = '8f7c6829275cafd4e2fb68983038b5daaa8ef14908114d33248bf5700aae0e61';
const topic = {old:69, fresh:70};
const images = {old:141, fresh:143};
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
const contextDraft = approvedJson('draft-contextual-item-question/assets.json','81bcfd2471413ba649fdc4cf76eeb761d83c8f5239137a63ff3681d1aa84cc92');
const fixture=approvedJson('draft-contextual-item-question/fixture.json','119ae4814f8f42ab7d2a83a33b467bea64896dd73d64d4e4476b48ec13d340ba');
assert.deepEqual(fixture.a.range,[2,3]);
assert(fixture.a.files.includes(fixture.a.document));
assert.equal(fixture.b.attachedCell,1);
assert.equal(fixture.b.attachmentAddedExplicitly,true);
assert.match(fixture.b.notebook,/\.ipynb$/u);
assert.notEqual(fixture.a.workspace,fixture.b.workspace);
const approvedCopy=[
  '提問欄留在編輯區，位於選取文字正上方。這張圖只展示尚未送出的草稿；選區不保證是唯一會用的資料。',
  '工作頁與左側提問同時保留。手動附上所選單元格後，附件顯示筆記本檔名。這是未送出的草稿；介面參考 Jupyter Chat，附加方式另參照 Jupyter AI 文件。'
];
const approved = [{title:'留在工作頁，問這一項',dir:'draft-contextual-item-question',rows:contextDraft.map((r,i)=>{
  const pin='https://github.com/'+r.sourceRepository+'/blob/'+r.sourceCommit+'/';
  assert(r.link.startsWith(pin)&&exactPin.test(r.link));
  const licenceSuffix=i===0?'LICENSE.txt#L1-L21':'LICENSE';
  assert.equal(r.sourceRepository,['microsoft/vscode','jupyterlab/jupyter-chat'][i]);
  assert.equal(r.sourceCommit,['994fd12f8d3a5aa16f17d42c041e5809167e845a','5d74c49baf56c1e1ee59a0912dd4a6a096f84a9b'][i]);
  assert.equal(r.sourceVersion,['1.107.1','v0.23.0'][i]);
  assert.equal(r.sourceLicense,['MIT','BSD-3-Clause'][i]);
  const secondary = 'https://github.com/jupyterlab/jupyter-ai/blob/00c1fa5809f08c9c0a6d41553119a8aaae6bc528/';
  const secondarySuffixes=['docs/source/users/index.md#L7-L24','docs/source/users/index.md#L133-L144','pyproject.toml#L25-L38','LICENSE'];
  assert.deepEqual(r.relatedSources,i===0?undefined:[{sourceRepository:'jupyterlab/jupyter-ai',
    sourceCommit:'00c1fa5809f08c9c0a6d41553119a8aaae6bc528',sourceVersion:'v3.1.0',sourceLicense:'BSD-3-Clause',
    role:'official documentation and compatibility'}]);
  assert.deepEqual(r.sourceLinks.filter(ref=>ref.startsWith(secondary)),i===0?[]:secondarySuffixes.map(s=>secondary+s),
    'Jupyter AI is B-only documentation/compatibility with its own immutable license, never the primary implementation');
  for(const ref of r.sourceLinks)assert(
    ref.startsWith(pin)&&(exactPin.test(ref)||ref===pin+licenceSuffix) ||
    i===1&&secondarySuffixes.some(s=>ref===secondary+s),'wrong scoped code license, docs license or reference '+ref);
  assert.equal(r.sourceLinks.at(-1),pin+licenceSuffix);
  if(i===1)assert(r.sourceLinks.includes(pin+'packages/jupyterlab-chat-extension/package.json#L11-L16'));
  assert.equal(new Set([r.link,...r.sourceLinks]).size,1+r.sourceLinks.length);
  return {variant:r.variant,file:r.file,name:r.choice,link:r.link,links:[r.link,...r.sourceLinks],
    alt:r.alt,label:r.previewLabel,credit:r.credit,digest:r.sha256,dimensions:r.dimensions};
})}];
for(const group of approved) {
  assert.deepEqual(group.rows.map(c=>c.variant),['A','B']);
  for(const row of group.rows) {
    assert(exactPin.test(row.link),'not an exact line pin: '+row.link);
    assert.equal(row.label,synthetic);
    assert.equal(row.credit,'本工作台依開源實作重繪，非官方截圖；僅供版式比較。');
    assert.match(row.file,/^[a-z0-9-]+\.png$/);
    row.bytes = read(path.join(base,group.dir,row.file));
    assert.deepEqual([row.bytes.readUInt32BE(16),row.bytes.readUInt32BE(20)],row.dimensions);
    assert.equal(sha(row.bytes),row.digest,'draft raster hash');
  }
}
const baseBytes = read(path.join(original,'index.html'));
assert.equal(sha(baseBytes),originalSha,'sealed candidate-141 HTML');
const bytes = read(path.join(candidate,'index.html'));
const requiredSeal=process.argv[3];
assert.match(requiredSeal || '',/^[a-f0-9]{64}$/,'pass the independently reported candidate-143 HTML seal, not a locally computed digest');
assert.equal(sha(bytes),requiredSeal,'candidate-143 HTML does not match the exact seal under test');
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
assert.deepEqual(totals(n),[topic.fresh,images.fresh,images.fresh],'not exactly 70 topics and 143 cards/artworks');
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
assert.equal(oldNotice.querySelectorAll('pre').length,155);
const rawNotices=x=>[...x.children].map(el=>el.outerHTML);
assert.deepEqual(rawNotices(newNotice).slice(0,oldNotice.childElementCount),rawNotices(oldNotice),'existing attribution/notice changed');
const addedNotice=[...newNotice.children].slice(oldNotice.childElementCount);
assert.deepEqual(addedNotice.map(x=>x.tagName),['H3','PRE'],'one attribution/disclaimer pair for #70 only');
assert.match(addedNotice[0].textContent,/^第 70 題/u);
const addedCopy=addedNotice.map(x=>x.textContent).join('\n');
for(const term of ['非官方','Code – OSS','1.107.1','MIT','Jupyter AI v3.1.0 文件','Jupyter Chat v0.23.0 介面實作','BSD-3-Clause']) assert(addedCopy.includes(term),'missing new attribution/disclaimer '+term);
assert(/不同工具的獨立例子，不是同一流程/u.test(addedCopy),'A/B must remain separate, not successive steps');
assert(/不代表提交時只會帶該段/u.test(addedCopy),'A does not promise selection-only context');
assert(/手動附上單元格，附件標籤顯示筆記本檔名/u.test(addedCopy),'B requires manual attachment, and the badge is the notebook filename');
assert(/沒有送出問題、執行程式、呼叫模型、生成答案或更改任何文件/u.test(addedCopy));
const declaration=read(path.join(base,'draft-contextual-item-question','DECLARATION.txt'));
assert.equal(sha(declaration),'8b099796498a448668c1635782eefef33908b875ba1c0a0774d0386b111f68e3','draft #70 disclosure seal changed');
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
      assert.equal(c.note,approvedCopy[j],'copy must distinguish positioned draft and explicitly attached cell, both unsent');
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
assert.equal(last.textContent.trim(),'直達第 70 題');
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
      assert.deepEqual(anchors.map(a=>a.textContent),c.links.map(l=>l.label+' ↗'));
      if (j===0) {
        assert.match(anchors[0].textContent,/Code – OSS 1\.107\.1/u);
        assert.match(anchors.at(-1).textContent,/MIT（非圖像授權）/u);
        assert(anchors.every(a=>!a.textContent.includes('Jupyter')));
      } else {
        assert.match(anchors[0].textContent,/^Jupyter Chat v0\.23\.0/u);
        assert.match(anchors[2].textContent,/^另參考 Jupyter AI v3\.1\.0 官方文件/u);
        assert.match(anchors[5].textContent,/^Jupyter AI .*BSD-3-Clause（非圖像授權）/u);
        assert.match(anchors.at(-1).textContent,/^Jupyter Chat .*BSD-3-Clause（非圖像授權）/u);
      }
      const evidence=node.querySelector('details');
      assert(evidence && !evidence.open && evidence.querySelector('summary'),'secondary sources should remain in a native disclosure');
      assert.equal(evidence.querySelector('summary').textContent,`更多原方參考（${anchors.length-1}）`);
      assert.deepEqual([...evidence.querySelectorAll('a')],anchors.slice(1));
      for(const a of anchors){
        assert.equal(a.rel,'noopener noreferrer');
        assert.equal(a.referrerPolicy,'no-referrer');assert.equal(a.target,'_blank');
      }
      assert([...node.querySelectorAll('p')].some(x=>x.textContent===c.note),'served card wording missing');
      assert.equal(node.querySelectorAll('button').length,2,'static mock cannot expose a usable prompt, attachment, execution or send control');
      assert.deepEqual([...node.querySelectorAll('.image-caption')].map(x=>x.textContent),[synthetic,a.credit]);
      assert.equal(node.querySelector('form,input,select,textarea,[contenteditable],[role="switch"],dialog,[role="dialog"]'),null,'no interactive model, document, or attachment action');
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
// and that swapping the #70 decision cannot alter any of the first 69 decisions.
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
  lastShortcut:'70 from ordinary, summary, single-card and already-last',
  dom:'143 source/image bindings; 69 preserved choices/summary; both new choices; keyboard focus and modeled activation, 2 zoom/focus/dismiss and static/error fallbacks; no export'
}));
