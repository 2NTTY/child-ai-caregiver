const assert=require('node:assert/strict'), fs=require('node:fs'),crypto=require('node:crypto');
const {JSDOM}=require('../caregiver_mermaid/node_modules/jsdom');
const html=fs.readFileSync(process.argv[2],'utf8');
const manifest=JSON.parse(fs.readFileSync(process.argv[3]));
const y=new JSDOM(html,{runScripts:'outside-only',url:'https://example.invalid/'}),w=y.window,d=w.document;
const s=d.scripts[1].textContent; const h=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifestByLink=new Map(manifest.map(e=>[e.link,e])); assert.equal(manifestByLink.size,manifest.length);
const base=new JSDOM(fs.readFileSync('baseline-site111.html','utf8')).window.document;
assert.equal(d.scripts[0].textContent,base.scripts[0].textContent);
assert.equal(d.scripts.length,2);
w.eval(s);
const choose=d.querySelector('#topic'); let total=0; const byTopic={};
const all=JSON.parse(d.scripts[0].textContent);
for(const [i,g] of all.entries()){
 choose.value=String(i+1);choose.dispatchEvent(new w.Event('change'));
 assert.equal(d.querySelectorAll('#gallery article').length,g.choices.length);
 const cards=d.querySelectorAll('#gallery article');
 for(const [j,c] of g.choices.entries()){
  const expected=manifestByLink.get(c.links[0].url);const actual=cards[j].querySelector('img');
  assert(cards[j].querySelector('a[href="'+c.links[0].url+'"]'));
  if(!expected){assert(!actual);continue};
  assert(actual);assert.equal(actual.alt,expected.alt);
  assert(actual.src.startsWith('data:'+(expected.mime??'image/png')+';base64,'));
  const raw=Buffer.from(actual.src.split(',')[1],'base64');
  assert.equal(h(raw),expected.sha256);
  if(expected.original) assert(cards[j].querySelector('a[href="'+expected.original+'"]'));
  const notices=[...d.querySelectorAll('footer pre')].map(p=>p.textContent);
  const norm=x=>x.replace(/\r\n/g,'\n'); 
  assert(notices.includes(norm(fs.readFileSync(expected.license,'utf8'))));
  for(const n of expected.additionalNotices??[]) assert(notices.includes(norm(fs.readFileSync(n.file,'utf8'))));
  total++;byTopic[i+1]=(byTopic[i+1]||0)+1;
 }}
choose.value='11';choose.dispatchEvent(new w.Event('change'));
const card=d.querySelector('#gallery article'), original=manifest.find(e=>e.link.includes('shadcn-ui')).original;
card.querySelector('img').dispatchEvent(new w.Event('error'));
assert(!card.querySelector('img'));
assert(card.querySelector('a[href="'+original+'"]'),'failing image must retain original image link');
assert.equal(total,manifest.length);
assert.equal(byTopic[11],2);if(manifest.length>=7)assert.equal(byTopic[2],3);if(manifest.length===12){assert.equal(byTopic[3],2);assert.equal(byTopic[5],3);}
console.log(JSON.stringify({topics:all.length,cards:all.flatMap(g=>g.choices).length,inline:total,byTopic}));
