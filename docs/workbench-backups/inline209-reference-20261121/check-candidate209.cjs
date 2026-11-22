'use strict';
// Read-only. NODE_PATH must expose an installed jsdom; never fetch resources.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), {JSDOM} = require('jsdom');
const seal = '655fbc32e644380c300ecd7c69b011f631d1153f582f98429338c21c76550a45';
const sha = (b,fmt='hex')=>crypto.createHash('sha256').update(b).digest(fmt);
const [oldDir, newDir, aSha, bSha] = process.argv.slice(2);
const read = x=>{ assert(fs.lstatSync(x).isFile(), 'not a regular file: '+x); return fs.readFileSync(x); };
const ls = x=>{ assert(fs.lstatSync(x).isDirectory(), 'not a directory: '+x);return fs.readdirSync(x).sort(); };
const key = c=>c.name+'\n'+c.links[0].url;
const artRx=/^const artwork=(\{[^\r\n]+\});$/gm;
const canon = obj=>JSON.stringify(obj).replace(/</g,'\\u003c');
const once = (s,rx)=>{const a=[...s.matchAll(rx)];assert.equal(a.length,1,'not unique: '+rx);return a[0][1];};
const replace = (s,old,add)=>{assert(old && s.indexOf(old)>=0 && s.indexOf(old)===s.lastIndexOf(old),'ambiguous/missing replace landmark');return s.replace(old,()=>add);};
const tagHash = s=>"'sha256-"+sha(s,'base64')+"'";
const recordsRx=/<script id="records" type="application\/json">([\s\S]*?)<\/script>/g, runtimeRx=/<script>([\s\S]*?)<\/script>/g;
const cspRx=/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g, styleRx=/<style>([\s\S]*?)<\/style>/g;
const counts = (n,m)=>'aria-label="共 '+n+' 個主題，'+m+' 個方案"><div><b>'+n+'</b>主題</div><div><b>'+m+'</b>方案</div>';
const shortcut=n=>'<button id="latest" type="button">直達第 '+n+' 題</button>';
const scriptValue=s=>'<script>'+s+'</script>';
const recordValue=s=>'<script id="records" type="application/json">'+s+'</script>';
const noticeTail='</pre></details></footer>';
function load(dir,n,m) {
  assert.deepEqual(ls(dir),['index.html','visuals']);
  const bytes=read(path.join(dir,'index.html')), code=bytes.toString('utf8');
  assert(Buffer.from(code).equals(bytes),'invalid UTF8/newline');
  if(n===102){assert.equal(bytes.length,711825);assert.equal(sha(bytes),seal);}
  const script=once(code,runtimeRx), raw=once(code,recordsRx), csp=once(code,cspRx), style=once(code,styleRx);
  const artRaw=once(script,artRx), art=JSON.parse(artRaw), records=JSON.parse(raw), files=new Map();
  const dom=new JSDOM(code,{runScripts:'outside-only',url:'https://offline.invalid/wb/'}), w=dom.window,d=w.document;
  assert.equal(d.scripts.length,2);assert.equal(d.scripts[0].textContent,raw);assert.equal(d.scripts[1].textContent,script);
  const policy=["default-src 'none'",'script-src '+tagHash(script),'style-src '+tagHash(style),"img-src 'self'","connect-src 'none'","media-src 'none'","object-src 'none'","frame-src 'none'","base-uri 'none'","form-action 'none'"].join('; ');
  assert.equal(d.querySelector('meta[http-equiv="Content-Security-Policy"]').content,policy,'inline CSP hash/policy changed');
  const choices=records.flatMap(r=>r.choices), keys=choices.map(key);
  assert.deepEqual([records.length,choices.length,Object.keys(art).length],[n,m,m]);
  assert.equal(new Set(keys).size,m);assert.deepEqual(new Set(keys),new Set(Object.keys(art)));
  for(const k of keys) {
    const row=art[k], match=/^\.\/visuals\/([a-f0-9]{64})\.(png|webp)$/.exec(row.src);
    assert(match&&match[0]===row.src,'bad content-addressed raster path: '+k);
    const name=row.src.slice('./visuals/'.length);
    assert(!files.has(name),'duplicate physical raster');
    const data=read(path.join(dir,'visuals',name));
    assert.equal(sha(data),match[1],'raster does not match its filename');
    assert(match[2]==='png'?data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP','wrong raster signature');
    files.set(name,data);
  }
  assert.deepEqual(ls(path.join(dir,'visuals')),[...files.keys()].sort());
  return {code,script,raw,records,style,artRaw,art,files,csp,w,d};
}
function check(){
  assert(oldDir,'Usage: verify-209.cjs OLD_OUT [NEW_OUT APPROVED_A_SHA APPROVED_B_SHA]');
  const p=load(oldDir,102,207);
  if(!newDir){console.log(JSON.stringify({baselineOnly:true,topics:102,images:207,htmlSha256:seal}));p.w.close();return;}
  for(const h of [aSha,bSha])assert.match(h||'',/^[a-f0-9]{64}$/,'A and B digests from independently approved artwork are required');
  assert.notEqual(aSha,bSha);
  const n=load(newDir,103,209);
  assert.deepEqual(n.records.slice(0,102),p.records);
  assert.deepEqual(Object.entries(n.art).slice(0,207),Object.entries(p.art));
  assert.equal(n.style,p.style);
  for(const [f,b] of p.files)assert(n.files.has(f)&&n.files.get(f).equals(b),'old raster bytes changed: '+f);
  const added=n.records[102], rows=added.choices, addition={};
  assert.deepEqual(Object.keys(added).sort(),['choices','title']);
  assert.equal(typeof added.title,'string');assert(added.title.trim());assert.equal(rows.length,2);
  assert.equal(new Set(rows.map(c=>c.name)).size,2,'indistinguishable A/B labels');
  rows.forEach((c,i)=>{
    const k=key(c),r=n.art[k], hash=[aSha,bSha][i];
    assert(!Object.hasOwn(p.art,k));assert.deepEqual(Object.keys(c).sort(),['links','name','note']);
    assert(c.note.trim()&&c.name.trim()&&c.links.length);for(const l of c.links){assert.deepEqual(Object.keys(l).sort(),['label','url']);const u=new URL(l.url);assert(l.label.trim()&&u.protocol==='https:'&&!u.username&&!u.password);}
    assert.deepEqual(Object.keys(r).sort(),['alt','credit','original','previewLabel','replacement','src']);
    assert(r.alt.trim()&&/非官方/u.test(r.credit)&&/非官方/u.test(r.previewLabel));assert.equal(r.original,null);assert.equal(r.replacement,null);
    assert.equal(r.src,'./visuals/'+hash+'.png','A/B image does not match the independently approved order/digest');
    assert(!p.files.has(hash+'.png'));addition[k]=r;
  });
  // Canonicalize only appended data. Duplicate keys, unescaped '<' and mutations of the frozen prefix fail.
  assert.equal(n.raw,p.raw.slice(0,-1)+','+canon(added)+']');
  assert.equal(n.artRaw,p.artRaw.slice(0,-1)+','+canon(addition).slice(1));
  assert.equal(replace(n.script,n.artRaw,p.artRaw),p.script,'executable viewer changed outside artwork data');
  const notice=once(n.code,/(<h3>第 103 題[^<]*<\/h3><pre>[^<]+<\/pre>)(?=<\/details><\/footer>)/g);
  assert(/非官方/u.test(notice));
  let stripped=replace(n.code,'</pre>'+notice+'</details></footer>',noticeTail);
  for(const [nn,pp] of [[counts(103,209),counts(102,207)],[shortcut(103),shortcut(102)],[scriptValue(n.script),scriptValue(p.script)],[recordValue(n.raw),recordValue(p.raw)],[n.csp,p.csp]])stripped=replace(stripped,nn,pp);
  assert.equal(sha(stripped),seal,'shell differs outside append-only allowlist');
  function exercise(x) {
    const w=x.w,d=x.d,el=id=>d.getElementById(id),dlg=el('image-dialog'),gal=()=>[...d.querySelectorAll('#gallery article')];
    // Only the known runtime, with strict JSON artwork and original executable bytes, is evaluated. No resource loading.
    dlg.showModal=function(){this.setAttribute('open','')};dlg.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'))};
    w.eval(x.script);
    const route=num=>{el('topic').value=String(num);el('topic').dispatchEvent(new w.Event('change',{bubbles:true}));};
    return {el,gal,route,dlg,w,d};
  }
  const old=exercise(p),now=exercise(n);assert.equal(now.el('topic').options.length,103);
  for(let i=1;i<=102;i++){
    old.route(i);now.route(i);
    assert.equal(now.el('gallery').outerHTML,old.el('gallery').outerHTML,'old DOM differed at '+i);
    assert.equal(now.el('topic').options[i-1].outerHTML,old.el('topic').options[i-1].outerHTML);
  }
  now.el('latest').click(); assert.equal(now.el('topic').value,'103');assert.equal(now.d.activeElement,now.el('viewtitle'));
  assert(now.el('next').disabled&&!now.el('prev').disabled);now.el('prev').click();assert.equal(now.el('topic').value,'102');now.el('next').click();assert.equal(now.gal().length,2);
  for(let j=0;j<2;j++){
    now.route(103);const c=rows[j], r=n.art[key(c)], card=now.gal()[j],img=card.querySelector('img'),trigger=img.closest('button');
    assert.equal(card.getAttribute('aria-label'),['A','B'][j]+' · '+c.name);assert.equal(img.alt,r.alt);assert.equal(img.getAttribute('src'),r.src);
    assert.deepEqual([...card.querySelectorAll('a')].map(l=>l.getAttribute('href')),c.links.map(l=>l.url));assert.equal(trigger.getAttribute('aria-label'),'放大 '+c.name+' '+r.previewLabel);
    trigger.focus();assert.equal(now.d.activeElement,trigger);trigger.click();
    assert(now.dlg.open);assert.equal(now.el('image-full').getAttribute('src'),r.src);assert.equal(now.el('image-full').alt,r.alt);assert.equal(now.d.activeElement,now.el('image-title'));
    now.dlg.dispatchEvent(new now.w.Event('cancel',{cancelable:true}));assert(!now.dlg.open);assert.equal(now.d.activeElement,trigger);assert(!now.el('image-full').hasAttribute('src'));
    now.el('modes').children[j+1].click();assert.equal(now.gal().length,1);
    const pick=now.gal()[0].querySelector('[data-choose]');assert.equal(pick.dataset.choose,String(j));pick.click();assert.equal(now.gal()[0].querySelector('[data-choose]').getAttribute('aria-pressed'),'true');
    now.el('summary').click();assert(now.el('entries').textContent.includes(c.name));assert.equal(now.el('entries').querySelectorAll('.entry').length,1);
    now.el('latest').click();assert.equal(now.gal().length,2);
  }
  console.log(JSON.stringify({baseHtmlSha256:seal,htmlSha256:sha(n.code),topics:103,choices:209,images:209,unchangedRecordPrefix:102,unchangedImageBytePairs:207,newImageDigests:[aSha,bSha],newTitle:added.title,shell:'reverses to sealed baseline',viewer:'offline JSDOM: old DOM, latest, previous/next, zoom/cancel/focus restoration, A/B modes and selection summary; not a native-browser or visual test'}));
  p.w.close();n.w.close();
}
try{check()}catch(err){console.error('VERIFY FAILED:',err.message?.split('\n')[0].slice(0,380));process.exitCode=1;}
