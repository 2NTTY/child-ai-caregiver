const assert=require('node:assert/strict'),test=require('node:test');
const {readFileSync,existsSync}=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const source=process.env.PDF_REVIEW_SOURCE||path.resolve(__dirname,'../..');
const req=createRequire(path.join(source,'frontend/package.json'));
const React=req('react'),{act}=React,{createRoot}=req('react-dom/client'),{QueryClient}=req('@tanstack/react-query'),ts=req('typescript');
if(!process.env.TEST_JSDOM_PATH)throw new Error('Supply TEST_JSDOM_PATH for an existing jsdom installation; jsdom is not a repository dependency.');
const {JSDOM}=require(process.env.TEST_JSDOM_PATH);
const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
global.fetch=()=>{throw new Error('Real fetch forbidden in offline owner review')};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),docId=id(9),snapshotId=id(10),olderId=id(11);
const snapshot=(sid=snapshotId,version=2)=>({id:sid,version,generatedAt:'2026-10-10T00:00:00Z',sourceBasis:'synthetic-basis',title:'Synthetic report',summary:'Synthetic',ageLabel:'unknown',period:{from:'2026-10-01',to:'2026-10-10'},eventDate:null,coverageNote:'Synthetic',sections:[],sources:[],changes:[]});
const report=child=>({id:docId,childId:child,kind:'growth_report',purpose:'family',version:2,status:'active',archivedAt:null,current:snapshot(),history:[],readState:'ready',autoRefresh:false});
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const pdf=()=>new Response(new Blob(['synthetic-not-a-real-PDF']),{headers:{'Content-Type':'application/pdf'}});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(){
 let user='synthetic-a',epoch=1,child=id(1),env,value,pdfReply=()=>pdf(),contentReply,versionsReply;
 const calls=[],accessErrors=[],urls=[],revoked=[],downloads=[],client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const scope=()=>user+':'+epoch+':'+child;
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=dom.window.HTMLAnchorElement.prototype.click;
 URL.createObjectURL=blob=>{assert.ok(blob instanceof Blob);const url='blob:synthetic-'+urls.length;urls.push(url);return url};
 URL.revokeObjectURL=url=>revoked.push(url);
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,download:this.download})};
 const fetcher=async(url,init)=>{assert.equal(init.credentials,'include');assert.equal(init.cache,'no-store');assert.equal(init.headers['x-expected-user-id'],user);calls.push({url,init});
  if(init.method==='POST'){assert.ok(url.endsWith('/pdf'),'Only a synthetic PDF read POST is permitted');return pdfReply(init)}
  assert.equal(init.method,'GET');
  if(url.includes('/content?'))return contentReply(init);
  if(url.endsWith('/versions'))return versionsReply ? versionsReply(init) : json({page:{documentId:docId,authorityVersion:'auth:1',items:[{snapshotId:olderId,snapshotVersion:1,generatedAt:'2026-10-09T00:00:00Z',invalidated:false}],nextCursor:null}});
  assert.match(url,/\/documents\?/);const forChild=url.split('/children/')[1].split('/')[0];
  return json({page:{authorityVersion:'auth:1',canManage:true,items:[report(forChild)],hasMore:false}});
 };
 const modules=new Map();function compile(relative){const file=path.resolve(source,relative);if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);
  const js=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',js)(name=>{
   if(!name.startsWith('.'))return req(name);
   if(name==='./useDomainEnvironment')return {useDomainWriteGuard(){}};
   const target=path.resolve(path.dirname(file),name),full=existsSync(target)?target:existsSync(target+'.ts')?target+'.ts':target+'.tsx';
   const e=compile(full);return /\/family-documents-api(?:\.ts)?$/.test(name)?{...e,createFamilyDocumentsApi:base=>e.createFamilyDocumentsApi(base,fetcher)}:e;
  },m,m.exports);return m.exports;
 }
 const {useFamilyDocuments}=compile('frontend/src/production/useFamilyDocuments.ts');
 function Host(){value=useFamilyDocuments(env);return null;}
 const root=createRoot(document.getElementById('root'));
 const render=async(next={})=>{user=next.user??user;epoch=next.epoch??epoch;child=next.child??child;const key=scope();env={scopeKey:key,userId:user,childId:child,childName:'Synthetic child',role:'owner',online:true,apiBaseUrl:'/api',queryClient:client,current:()=>scope()===key,canStartWrite:()=>true,accessError:e=>accessErrors.push(e),invalidate(){}};await act(async()=>root.render(React.createElement(Host,{key})))};
 const intent=()=>({scopeKey:scope(),childId:child,authorityVersion:'auth:1',snapshotId,snapshotVersion:2,periodId:snapshotId+':2',purpose:'family',includeSources:true,includeRevision:false});
 const start=async(current=()=>true,input=intent())=>{let job;await act(async()=>{job=value.exportReport(input,current)});return {job}};
 const finish=async(held,response,job)=>{let result;await act(async()=>{held.resolve(response);result=await job});return result};
 return {render,get:()=>value,intent,start,finish,calls,accessErrors,urls,revoked,downloads,setPdf:fn=>{pdfReply=fn},setContent:fn=>{contentReply=fn},setVersions:fn=>{versionsReply=fn},act:fn=>act(async()=>{fn();await Promise.resolve()}),postCount:()=>calls.filter(c=>c.init.method==='POST').length,
  close:async()=>{await act(async()=>{root.unmount();client.clear()});URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;dom.window.HTMLAnchorElement.prototype.click=oldClick;}};
}
test('actual React owner stays single-flight across cancel/reopen and discards old success or failure before explicit retry',async()=>{
 for(const status of [200,503]){const h=fixture(),held=defer();try{await h.render();assert.equal(h.get().readState,'ready');h.setPdf(()=>held.promise);const notice=h.get().notice;let generation=1;const old=await h.start(()=>generation===1);await h.start(()=>generation===1);assert.equal(h.postCount(),1);assert.equal(h.get().exportBusy,true);assert.equal(h.get().notice,notice);
 generation++;await h.start(()=>generation===2);assert.equal(h.postCount(),1,'Closing the dialog is not cancellation confirmation and cannot unlock an unsettled request');
 assert.equal(await h.finish(held,status===200?pdf():json({},status),old.job),undefined);assert.equal(h.get().notice,notice);assert.equal(h.get().exportBusy,false);assert.equal(h.urls.length,0);assert.equal(h.downloads.length,0);
 h.setPdf(()=>pdf());const fresh=await h.start(()=>generation===2);let result;await act(async()=>{result=await fresh.job});assert.equal(result.state,'ready');assert.equal(h.postCount(),2);assert.equal(h.downloads.length,1);assert.deepEqual(h.revoked,h.urls);assert.equal(document.querySelectorAll('a').length,0);
 }finally{held.resolve(pdf());await h.close()}}
});
test('old child, identity, or session-epoch PDF completion cannot release the new scoped owner export lock',async()=>{
 for(const change of [{child:id(2)},{user:'synthetic-b'},{epoch:2}]){const h=fixture(),oldHeld=defer(),newHeld=defer();try{await h.render();h.setPdf(()=>oldHeld.promise);const old=await h.start();const oldSignal=h.calls.at(-1).init.signal;
 h.setPdf(()=>newHeld.promise);await h.render(change);assert.equal(oldSignal.aborted,true);const fresh=await h.start();assert.equal(h.get().exportBusy,true);const notice=h.get().notice;
 assert.equal(await h.finish(oldHeld,pdf(),old.job),undefined);assert.equal(h.get().exportBusy,true,'Old finally cannot release the new owner lock');assert.equal(h.get().notice,notice);assert.equal(h.downloads.length,0);await h.start();assert.equal(h.postCount(),2);
 const result=await h.finish(newHeld,pdf(),fresh.job);assert.equal(result.state,'ready');assert.equal(h.downloads.length,1);assert.deepEqual(h.revoked,h.urls);assert.equal(h.get().exportBusy,false);assert.equal(h.accessErrors.length,0);
 }finally{oldHeld.resolve(pdf());newHeld.resolve(pdf());await h.close()}}
});
test('a concurrent read reporting a newer version of the same document invalidates its pending PDF before browser handoff',async()=>{
 const h=fixture(),content=defer(),held=defer();try{await h.render();await h.act(()=>h.get().archive.reading.loadVersions(docId));h.setContent(()=>content.promise);await h.act(()=>h.get().archive.reading.readVersion(docId,olderId,1));assert.equal(h.get().archive.reading.content.busy,true);
 h.setPdf(()=>held.promise);const old=await h.start();const text=JSON.stringify(snapshot(olderId,1));await h.act(()=>content.resolve(json({page:{documentId:docId,documentVersion:3,authorityVersion:'auth:1',snapshotId:olderId,snapshotVersion:1,offset:0,text,totalCharacters:text.length,nextOffset:null,complete:true,invalidated:false,contentKind:'snapshot_json'}})));
 assert.equal(h.get().authorityVersion,'');assert.equal(h.get().archive.state,'error');const notice=h.get().notice;assert.match(notice,/文件或來源基準已有變更/);
 assert.equal(await h.finish(held,pdf(),old.job),undefined);assert.equal(h.get().notice,notice);assert.equal(h.get().exportBusy,false);assert.equal(h.urls.length,0);assert.equal(h.downloads.length,0);
 }finally{content.resolve(json({}));held.resolve(pdf());await h.close()}
});
test('a canceled current-scope export still honors a late 403 revocation and cannot report cancellation as success',async()=>{
 const h=fixture(),held=defer();try{await h.render();await h.act(()=>h.get().markDraft());assert.equal(h.get().dirty,true);h.setPdf(()=>held.promise);let current=true;const old=await h.start(()=>current);const notice=h.get().notice;current=false;
 assert.equal(await h.finish(held,json({error:{code:'forbidden'}},403),old.job),undefined);assert.equal(h.get().archive.state,'invalidated');assert.equal(h.get().dirty,false);assert.equal(h.get().exportBusy,false);assert.equal(h.get().notice,notice);assert.equal(h.accessErrors.length,1);assert.equal(h.accessErrors[0].status,403);assert.equal(h.urls.length,0);await h.start();assert.equal(h.postCount(),1);
 }finally{held.resolve(pdf());await h.close()}
});
test('same-batch document-version invalidation blocks a PDF resolving before the next React commit',async()=>{
 const h=fixture(),content=defer(),held=defer();try{await h.render();await h.act(()=>h.get().archive.reading.loadVersions(docId));h.setContent(()=>content.promise);await h.act(()=>h.get().archive.reading.readVersion(docId,olderId,1));
 h.setPdf(()=>held.promise);const old=await h.start();const text=JSON.stringify(snapshot(olderId,1));let result;
 await act(async()=>{
  content.resolve(json({page:{documentId:docId,documentVersion:3,authorityVersion:'auth:1',snapshotId:olderId,snapshotVersion:1,offset:0,text,totalCharacters:text.length,nextOffset:null,complete:true,invalidated:false,contentKind:'snapshot_json'}}));
  for(let i=0;i<100;i++)await Promise.resolve();
  held.resolve(pdf());result=await old.job;
 });
 assert.equal(h.get().archive.state,'error','The older document projection was invalidated by its concurrent content read');
 assert.equal(h.urls.length,0,'A known-invalid document must not create an object URL before the React commit');
 assert.equal(h.downloads.length,0);assert.equal(result,undefined);assert.doesNotMatch(h.get().notice,/交給瀏覽器下載/);
 }finally{content.resolve(json({}));held.resolve(pdf());await h.close()}
});
test('same-batch authority invalidation from a concurrent version-index read rejects the pending PDF',async()=>{
 const h=fixture(),versions=defer(),held=defer();try{await h.render();h.setVersions(()=>versions.promise);await h.act(()=>h.get().archive.reading.loadVersions(docId));h.setPdf(()=>held.promise);const old=await h.start();let result;
 await act(async()=>{versions.resolve(json({page:{documentId:docId,authorityVersion:'auth:2',items:[],nextCursor:null}}));for(let i=0;i<100;i++)await Promise.resolve();held.resolve(pdf());result=await old.job});
 assert.equal(h.get().archive.state,'error');assert.equal(h.urls.length,0);assert.equal(h.downloads.length,0);assert.equal(result,undefined);assert.match(h.get().notice,/來源或權限基準已有變更/);
 }finally{versions.resolve(json({}));held.resolve(pdf());await h.close()}
});
test('invalidating a different unread historical snapshot does not cancel an authorized current-snapshot export',async()=>{
 const h=fixture(),content=defer(),held=defer();try{await h.render();await h.act(()=>h.get().archive.reading.loadVersions(docId));h.setContent(()=>content.promise);await h.act(()=>h.get().archive.reading.readVersion(docId,olderId,1));h.setPdf(()=>held.promise);const old=await h.start();let result;
 await act(async()=>{content.resolve(json({page:{documentId:docId,documentVersion:2,authorityVersion:'auth:1',snapshotId:olderId,snapshotVersion:1,offset:0,text:'{}',totalCharacters:2,nextOffset:null,complete:true,invalidated:true,contentKind:'redacted_manifest_json'}}));for(let i=0;i<100;i++)await Promise.resolve();held.resolve(pdf());result=await old.job});
 assert.equal(h.get().archive.reading.content.invalidated,true);assert.equal(h.get().archive.snapshot.id,snapshotId);assert.equal(result.state,'ready');assert.equal(h.downloads.length,1);assert.deepEqual(h.revoked,h.urls);
 }finally{content.resolve(json({}));held.resolve(pdf());await h.close()}
});
