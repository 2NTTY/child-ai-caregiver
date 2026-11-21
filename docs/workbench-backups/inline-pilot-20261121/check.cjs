const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {JSDOM}=require('../caregiver_mermaid/node_modules/jsdom');
const html=fs.readFileSync(process.argv[2],'utf8');
const source=fs.readFileSync('baseline-response.html','utf8');
const match=s=>s.match(/<script id="records" type="application\/json">([^]*?)<\/script>/)[1];
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.invalid/'}),w=dom.window,d=w.document;
w.HTMLDialogElement.prototype.showModal=function(){assert(!this.open);this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
const s=[...d.scripts].find(x=>x.textContent.includes('const by=id'));
w.eval(s.textContent);
const q=sel=>d.querySelector(sel), qs=sel=>[...d.querySelectorAll(sel)];
const choose=()=>qs('[data-choose]')[0];
assert.equal(q('#topic').options.length,53);
assert.equal(qs('#gallery article').length,3);
assert.equal(qs('#gallery img').length,2,'two locally approved images should be visible on the first comparison');
const images=qs('#gallery img');
assert(images.every(x=>x.getAttribute('src').startsWith('data:image/png;base64,')&&x.alt));
assert.equal(qs('#gallery article a').length,3);
assert.equal(qs('#gallery .image-preview').length,2);
const preview=q('#gallery .image-preview');
preview.focus(); preview.click();
assert(q('#image-dialog').open);
assert.equal(d.activeElement,q('#image-close'));
assert.equal(q('#image-full').src,images[0].src);
assert.equal(q('#summary').textContent,'我的選擇（0）');
q('#image-close').click();assert(!q('#image-dialog').open);assert.equal(d.activeElement,preview);
qs('#gallery .image-preview')[1].click();assert.equal(q('#image-full').src,images[1].src);
q('#image-dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert(!q('#image-dialog').open);
preview.click();images[0].dispatchEvent(new w.Event('error'));assert(!q('#image-dialog').open);assert.equal(qs('#gallery img').length,1);assert.equal(qs('#gallery article a').length,3);
choose().click();assert.equal(q('#summary').textContent,'我的選擇（1）');choose().click();assert.equal(q('#summary').textContent,'我的選擇（0）');
q('#next').click();assert.equal(qs('#gallery img').length,0);
q('#latest').click();assert.equal(q('#topic').value,'53');assert(q('#next').disabled);
assert.equal(match(html),match(source),'all published records remain unchanged');
assert.equal(qs('script').length,2,'do not copy the CDN injection');
const csp=q('meta[http-equiv="Content-Security-Policy"]').content;
for(const [tag,dir] of [[s,'script'],[q('style'),'style']]){
const hash=crypto.createHash('sha256').update(tag.textContent).digest('base64');assert(csp.includes(dir+"-src 'sha256-"+hash+"'"));}
assert(csp.includes("img-src data:;")&&csp.includes("connect-src 'none';")&&csp.includes("frame-src 'none';"));
if(process.argv[3]==='--invalid'){
 for(const illegal of ['https://evil.invalid/a.png','//evil.invalid/a.png','javascript:alert(1)','data:image/svg+xml;base64,XXXX','data:image/png;base64,NOT-A-PNG']){
 const altered=html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/,illegal);
 const x=new JSDOM(altered,{runScripts:'outside-only',url:'https://example.invalid/'});x.window.eval([...x.window.document.scripts].find(e=>e.textContent.includes('const by=id')).textContent);
 assert.equal(x.window.document.querySelectorAll('#gallery img').length,1,illegal);
 assert(![...x.window.document.images].some(e=>e.getAttribute('src')===illegal));
 }}
console.log('PASS inline + navigation, DOM, fallback, CSP');
