const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const source = process.env.PDF_REVIEW_SOURCE || path.resolve(__dirname, '../..');
const root = path.join(source, 'frontend');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
// Use an explicitly provided existing DOM runtime; no product dependency or browser claim.
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation; jsdom is not a repository dependency.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[name] = dom.window[name];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {} });
const React = requireFrontend('react'), { createRoot } = requireFrontend('react-dom/client');
const rn = requireFrontend('react-native-web'), ts = requireFrontend('typescript');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'react-native') return rn;
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), SafeAreaInsetsContext: React.createContext({ top: 0, right: 0, bottom: 0, left: 0 }) };
  return originalLoad.call(this, name, parent, isMain);
};
const paper = {
  MD3LightTheme: requireFrontend('react-native-paper/lib/commonjs/styles/themes/v3/LightTheme').MD3LightTheme,
  configureFonts: requireFrontend('react-native-paper/lib/commonjs/styles/fonts').default,
  Text: requireFrontend('react-native-paper/lib/commonjs/components/Typography/Text').default,
  Button: requireFrontend('react-native-paper/lib/commonjs/components/Button/Button').default,
  Dialog: requireFrontend('react-native-paper/lib/commonjs/components/Dialog/Dialog').default,
};
const transparent = ({ children }) => React.createElement(React.Fragment, null, children);
const empty = () => null;
const cache = new Map();
function load(relative) {
  const filename = path.join(root, 'src', relative);
  if (cache.has(filename)) return cache.get(filename);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return paper;
    if (name.endsWith('/AppIcon')) return { AppIcon: empty };
    if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: empty };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (name.endsWith('/motion')) return { MotionBackdrop: empty, MotionEntrance: transparent, motionTokens: { dialog: { distance: 12, duration: 0 } }, useMotionPreferences: () => ({ enabled: false, epoch: 0 }) };
    if (name.endsWith('/MotionPaperScope')) return { MotionPaperScope: transparent };
    if (name.endsWith('/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.endsWith('/ui')) return { AppButton: load('components/ui.tsx').AppButton,
      AppSelect: ({ label, value, options, onChange }) => React.createElement('select', { 'aria-label': label, value, onChange: event => onChange(event.target.value) }, options.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))) };
    if (['./AppRadioItem', './HorizontalOverflowRail', '../motion/MotionSelectionMarker'].includes(name)) return new Proxy({}, { get: () => empty });
    if (!name.startsWith('.')) return requireFrontend(name);
    const target = path.resolve(path.dirname(filename), name);
    const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
    return load(path.relative(path.join(root, 'src'), resolved));
  }, module, module.exports);
  cache.set(filename, module.exports); return module.exports;
}
const GrowthArchive = load('components/growth/GrowthArchive.tsx').GrowthArchive;
const {QueryClient}=requireFrontend('@tanstack/react-query');
global.fetch=()=>{throw new Error('Real network forbidden in synthetic UI admission review')};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),child=id(1),docId=id(9),sid=id(10);
const snapshot={id:sid,version:2,generatedAt:'2026-10-10T00:00:00Z',sourceBasis:'synthetic-basis',title:'Synthetic report',summary:'Synthetic',ageLabel:'unknown',period:{from:'2026-10-01',to:'2026-10-10'},eventDate:null,coverageNote:'Synthetic',sections:[],sources:[],changes:[]};
const report={id:docId,childId:child,kind:'growth_report',purpose:'family',version:2,status:'active',archivedAt:null,current:snapshot,history:[],readState:'ready',autoRefresh:false};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const pdf=()=>new Response(new Blob(['synthetic-not-a-real-PDF']),{headers:{'Content-Type':'application/pdf'}});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const byLabel=label=>document.querySelector(`[aria-label="${label}"]`);
async function click(label){const button=byLabel(label);assert.ok(button,'Visible control exists: '+label);assert.notEqual(button.getAttribute('aria-disabled'),'true',label+' is enabled');await React.act(async()=>{button.focus();button.click()})}
function fixture(){
 const versions=defer(),calls=[],accessErrors=[],downloads=[],urls=[],revoked=[],client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});let value,readStatus=200,readAuthority="auth:1";
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,anchorClick=dom.window.HTMLAnchorElement.prototype.click;
 URL.createObjectURL=blob=>{assert.ok(blob instanceof Blob);const u='blob:synthetic-'+urls.length;urls.push(u);return u};URL.revokeObjectURL=u=>revoked.push(u);dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.href)};
 const fetcher=async(url,init)=>{assert.equal(init.credentials,'include');assert.equal(init.cache,'no-store');calls.push({url,method:init.method,signal:init.signal});
  if(init.method==='POST'){assert.ok(url.endsWith('/pdf'));return pdf()}
  assert.equal(init.method,'GET');if(url.endsWith('/versions'))return versions.promise;
  assert.match(url,/\/documents\?/);if(readStatus!==200)return json({},readStatus);return json({page:{authorityVersion:readAuthority,canManage:true,items:[report],hasMore:false}})
 };
 const modules=new Map();function compile(relative){const filename=path.resolve(source,relative);if(modules.has(filename))return modules.get(filename).exports;const module={exports:{}};modules.set(filename,module);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',code)(name=>{if(!name.startsWith('.'))return requireFrontend(name);if(name==='./useDomainEnvironment')return {useDomainEnvironment:()=>env,useDomainWriteGuard(){}};
   if(name==='./task-knowledge-tasks')return {useTaskKnowledgeTasks:()=>null};
   if(name==='./task-knowledge-summary')return {useTaskKnowledgeSummary:()=>null};
   if(name==='./task-knowledge-memory')return {useTaskKnowledgeMemory:()=>({value:null})};
   if(name==='./task-knowledge-growth')return {useTaskKnowledgeGrowth:()=>growth};
   if(name==='./usePersonalHistory')return {usePersonalHistory:()=>null,PersonalHistoryProvider:transparent};
   const target=path.resolve(path.dirname(filename),name),resolved=fs.existsSync(target)?target:fs.existsSync(target+'.ts')?target+'.ts':target+'.tsx';const e=compile(resolved);return /\/family-documents-api(?:\.ts)?$/.test(name)?{...e,createFamilyDocumentsApi:base=>e.createFamilyDocumentsApi(base,fetcher)}:e;
  },module,module.exports);return module.exports;
 }
 const domains=compile('frontend/src/production/TaskKnowledgeDomains.tsx');
 const {useGrowthWorkspace}=compile('frontend/src/workspaces/GrowthWorkspace.tsx');
 const env={scopeKey:'synthetic:1:'+child,userId:'synthetic',childId:child,childName:'Synthetic',role:'owner',online:true,apiBaseUrl:'/api',queryClient:client,current:()=>true,canStartWrite:()=>true,accessError:e=>accessErrors.push(e),invalidate(){}};
 const growth={scopeKey:env.scopeKey,model:{scopeKey:env.scopeKey,childId:child,childName:'Synthetic',access:'editable',online:true,load:'ready',page:{authorityVersion:'auth:1',items:[]}},actions:{refresh(){}}};
 function Host(){value=domains.useProductionFamilyDocuments();const workspace=useGrowthWorkspace();if(!value||!workspace)return null;
  return React.createElement(GrowthArchive,{model:workspace.model,wide:true,active:true,scrollRef:{current:null},exportBusy:value.exportBusy,onExportReport:value.exportReport})}
 const root=createRoot(document.getElementById('root'));
 return {calls,versions,urls,downloads,revoked,accessErrors,get:()=>value,setReadStatus:s=>{readStatus=s},setAuthority:a=>{readAuthority=a;growth.model.page.authorityVersion=a},refresh:()=>React.act(async()=>value.refresh()),postCount:()=>calls.filter(x=>x.method==='POST').length,
  async start(){await React.act(async()=>root.render(React.createElement(domains.ProductionTaskKnowledgeDomains,null,React.createElement(Host))));assert.equal(value.archive.state,'ready');await click('翻閱其他期間／版本');await click('查看「Synthetic report」較早修訂');assert.equal(calls.filter(x=>x.url.endsWith('/versions')).length,1);await click('導出報告');assert.ok(byLabel('下載這個版本的 PDF'));assert.equal(this.postCount(),0);assert.equal(value.exportBusy,false)},
  async close(){versions.resolve(json({}));await React.act(async()=>{root.unmount();client.clear()});URL.createObjectURL=create;URL.revokeObjectURL=revoke;dom.window.HTMLAnchorElement.prototype.click=anchorClick}
 };
}
test.after(()=>{Module._load=originalLoad;dom.window.close()});
test('a visible real export button cannot admit a new PDF after same-batch version-index authority invalidation',async()=>{
 const h=fixture();try{await h.start();await React.act(async()=>{h.versions.resolve(json({page:{documentId:docId,authorityVersion:'auth:2',items:[],nextCursor:null}}));for(let i=0;i<100;i++)await Promise.resolve();
 const button=byLabel('下載這個版本的 PDF');assert.ok(button);assert.notEqual(button.getAttribute('aria-disabled'),'true');button.click();for(let i=0;i<100;i++)await Promise.resolve();});
 assert.equal(h.get().archive.state,'error');assert.deepEqual({post:h.postCount(),objectUrls:h.urls.length,downloads:h.downloads.length},{post:0,objectUrls:0,downloads:0},'Known-invalid current document must not admit a new PDF through the real rendered button');
 }finally{await h.close()}
});
test('late version-index 403 synchronously blocks a fresh real-button export before the UI rerenders',async()=>{
 const h=fixture();try{await h.start();await React.act(async()=>{h.versions.resolve(json({error:{code:'forbidden'}},403));for(let i=0;i<100;i++)await Promise.resolve();const button=byLabel('下載這個版本的 PDF');assert.ok(button);button.click();for(let i=0;i<100;i++)await Promise.resolve()});
 assert.equal(h.get().archive.state,'invalidated');assert.equal(h.postCount(),0);assert.equal(h.urls.length,0);assert.equal(h.accessErrors.length,1);assert.equal(h.accessErrors[0].status,403);
 }finally{await h.close()}
});
test('after the ordinary React commit an invalid version index removes the export entry entirely',async()=>{
 const h=fixture();try{await h.start();await React.act(async()=>h.versions.resolve(json({page:{documentId:docId,authorityVersion:'auth:2',items:[],nextCursor:null}})));
 assert.equal(h.get().archive.state,'error');assert.equal(byLabel('下載這個版本的 PDF'),null);assert.equal(byLabel('導出報告'),null);assert.equal(h.postCount(),0);
 }finally{await h.close()}
});
test('failed authoritative reread cannot reopen export admission; a successful fresh projection permits an explicit current-button export',async()=>{
 const h=fixture();try{await h.start();const staleExport=h.get().exportReport,request={scopeKey:'synthetic:1:'+child,childId:child,authorityVersion:'auth:1',snapshotId:sid,snapshotVersion:2,periodId:sid+':2',purpose:'family',includeSources:true,includeRevision:false};
 await React.act(async()=>h.versions.resolve(json({page:{documentId:docId,authorityVersion:'auth:2',items:[],nextCursor:null}})));h.setReadStatus(503);await h.refresh();assert.equal(h.get().archive.state,'error');assert.equal(h.get().exportBusy,false);
 let staleResult;await React.act(async()=>{staleResult=await staleExport(request)});assert.equal(staleResult,undefined);assert.equal(h.postCount(),0);assert.equal(byLabel('導出報告'),null);
 h.setReadStatus(200);h.setAuthority('auth:2');await h.refresh();assert.equal(h.get().archive.state,'ready');assert.equal(h.get().authorityVersion,'auth:2');assert.equal(h.postCount(),0,'Successful reread never exports automatically');
 await React.act(async()=>{staleResult=await staleExport(request)});assert.equal(staleResult,undefined);assert.equal(h.postCount(),0,'Previous authority and callback cannot use the fresh projection');
 await click('導出報告');await click('下載這個版本的 PDF');assert.equal(h.postCount(),1);assert.equal(h.downloads.length,1);assert.deepEqual(h.revoked,h.urls);assert.equal(h.get().exportBusy,false);
 }finally{await h.close()}
});
