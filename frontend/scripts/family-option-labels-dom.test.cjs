const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const source = process.env.FAMILY_LABEL_SOURCE || path.resolve(__dirname, '../..');
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
  Portal: requireFrontend('react-native-paper/lib/commonjs/components/Portal/Portal').default,
  TouchableRipple: requireFrontend('react-native-paper/lib/commonjs/components/TouchableRipple/TouchableRipple').default,
  useTheme: requireFrontend('react-native-paper/lib/commonjs/core/theming').useTheme,
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
    if(name.endsWith('/useContainerWidth'))return {useContainerWidth:()=>({width:1024,ref:null,onLayout(){}})};
    if(name.endsWith('/PreviewNavigationGuard'))return {usePreviewLeaveGuard(){}};
    if (name.endsWith('/motion')) return { MotionDisclosure:({expanded,children})=>expanded?children:null,MotionFeedback:transparent,MotionList:({items,renderItem})=>React.createElement(React.Fragment,null,items.map((item,i)=>React.createElement(React.Fragment,{key:i},renderItem(item,{exiting:false})))), MotionBackdrop: empty, MotionEntrance: transparent, motionTokens: { dialog: { distance: 12, duration: 0 } }, useMotionPreferences: () => ({ enabled: false, epoch: 0 }) };
    if (name.endsWith('/MotionPaperScope')) return { MotionPaperScope: transparent };
    if (name.endsWith('/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.endsWith('/ui')) return load('components/ui.tsx');
    if (['./HorizontalOverflowRail', '../motion/MotionSelectionMarker'].includes(name)) return new Proxy({}, { get: () => empty });
    if (!name.startsWith('.')) return requireFrontend(name);
    const target = path.resolve(path.dirname(filename), name);
    const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
    return load(path.relative(path.join(root, 'src'), resolved));
  }, module, module.exports);
  cache.set(filename, module.exports); return module.exports;
}
const FamilyView=load('components/family/FamilyView.tsx').FamilyView;
const {QueryClient}=requireFrontend('@tanstack/react-query');
global.fetch=()=>{throw new Error('Real network forbidden in family label review')};
const family=(id,ownerName='合成驗收家長')=>({id,ownerName,role:'owner',version:1,members:[],invitations:[]});
const children=[{id:'sunny',workspaceId:'family-sunny',displayName:'小晴'},{id:'ming',workspaceId:'family-ming',displayName:'小明'},{id:'not-a-member',workspaceId:'other-family',displayName:'不屬所列家庭'}];
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function fixture({families=[family('family-sunny'),family('family-ming')],recordChildren=children,production=true}={}){
 const requests=[],selections=[],client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});let value,records=recordChildren;
 const snapshot=()=>({identityKey:'parent:1',scopeKey:'parent:1:sunny',sessionGeneration:1,records:{children:records,childrenLoadedAt:'2026-10-10T00:00:00Z',childrenLoading:false,childrenError:null}});
 const env={identityKey:'parent:1',scopeKey:'parent:1:sunny',userId:'parent',childId:'sunny',childName:'小晴',role:'owner',online:true,apiBaseUrl:'/api',queryClient:client,current:()=>true,currentIdentity:()=>true,canStartWrite:()=>true,accessError(){},invalidate(){},owner:{getSnapshot:snapshot,setDomainPending(){},controller:{reloadChildren(){assert.fail('Label display must not reload children')}}}};
 const fetcher=async(url,init)=>{assert.equal(init.method,'GET','Labels must never write');requests.push(url);if(url==='/api/auth/get-session')return json({user:{id:'parent'}});assert.equal(url,'/api/families');return json({families})};
 const modules=new Map();function compile(relative){const file=path.resolve(source,relative);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(name=>{if(!name.startsWith('.'))return requireFrontend(name);if(name==='./useDomainEnvironment')return {useDomainWriteGuard(){}};
 const target=path.resolve(path.dirname(file),name),resolved=fs.existsSync(target)?target:fs.existsSync(target+'.ts')?target+'.ts':target+'.tsx';const e=compile(resolved);return /\/family-api(?:\.ts)?$/.test(name)?{...e,createFamilyApi:base=>e.createFamilyApi(base,fetcher)}:e;},module,module.exports);return module.exports;}
 const useProductionFamily=compile('frontend/src/production/useProductionFamily.ts').useProductionFamily;
 function Host(){value=useProductionFamily(env);return React.createElement(FamilyView,{production,model:value.model,actions:{...value.actions,selectFamily:id=>{selections.push(id);value.actions.selectFamily(id)}},writeNotice:null,previewControls:null})}
 const root=createRoot(document.getElementById('root'));const render=()=>React.act(async()=>root.render(React.createElement(paper.Portal.Host,null,React.createElement(Host))));
 return {requests,selections,get:()=>value,render,setChildren:async next=>{records=next;await render()},async open(){const trigger=[...document.querySelectorAll('[aria-label]')].find(n=>n.getAttribute('aria-label').startsWith('家庭：'));assert.ok(trigger);await React.act(async()=>trigger.click());return [...document.querySelectorAll('[role="radio"]')].filter(n=>n.getAttribute('aria-label')?.startsWith('家庭選項：'))},close:()=>React.act(async()=>{root.unmount();client.clear()})};
}
test.after(()=>{Module._load=originalLoad;dom.window.close()});
test('same-owner family options expose distinct loaded-child labels visually and to accessibility APIs',async()=>{
 const h=fixture();try{await h.render();const radios=await h.open();assert.equal(radios.length,2);assert.deepEqual(radios.map(n=>n.getAttribute('aria-label')),['家庭選項：合成驗收家長的家庭 · 孩子：小晴','家庭選項：合成驗收家長的家庭 · 孩子：小明']);
 assert.ok(radios[0].textContent.includes('孩子：小晴'));assert.ok(radios[1].textContent.includes('孩子：小明'));assert.ok(!radios.map(n=>n.textContent).join('').includes('不屬所列家庭'));assert.deepEqual(h.requests,['/api/auth/get-session','/api/families','/api/auth/get-session']);
 }finally{await h.close()}
});
async function key(node,key){await React.act(async()=>{node.focus();node.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))});await React.act(async()=>node.dispatchEvent(new window.KeyboardEvent('keyup',{key,bubbles:true,cancelable:true})))}
test('Space and Enter retain radio semantics and select the stable family id without another API read',async()=>{
 const h=fixture();try{await h.render();let radios=await h.open();assert.equal(radios[0].getAttribute('aria-checked'),'true');assert.equal(radios[1].getAttribute('aria-checked'),'false');await key(radios[1],' ');assert.equal(h.get().model.family.id,'family-ming');assert.deepEqual(h.selections,['family-ming']);radios=await h.open();assert.equal(radios[1].getAttribute('aria-checked'),'true');await key(radios[0],'Enter');assert.equal(h.get().model.family.id,'family-sunny');assert.deepEqual(h.selections,['family-ming','family-sunny']);assert.equal(h.requests.length,3);
 }finally{await h.close()}
});
test('unique owner labels remain short and optional child hints do not change unrelated family titles',async()=>{
 const h=fixture({families:[family('family-sunny','晴家長'),family('family-ming','明家長')]});try{await h.render();const radios=await h.open();assert.deepEqual(radios.map(n=>n.getAttribute('aria-label')),['家庭選項：晴家長的家庭','家庭選項：明家長的家庭']);assert.equal(h.requests.length,3);
 }finally{await h.close()}
});
test('absent or identical loaded-child names do not fabricate a family identity or expose identifiers',async()=>{
 for(const recordChildren of [[],children.slice(0,2).map(c=>({...c,displayName:'同名孩子'}))]){const h=fixture({recordChildren});try{await h.render();const radios=await h.open();const expected=recordChildren.length?'家庭選項：合成驗收家長的家庭 · 孩子：同名孩子':'家庭選項：合成驗收家長的家庭';assert.deepEqual(radios.map(n=>n.getAttribute('aria-label')),[expected,expected]);for(const node of radios){assert.doesNotMatch(node.textContent,/family-|選項\s*[12]|沒有孩子|無孩子/)}assert.equal(h.requests.length,3);
 }finally{await h.close()}}
});
test('already-visible child updates relabel only their matching family and preserve the selected stable id',async()=>{
 const h=fixture();try{await h.render();let radios=await h.open();await key(radios[1],' ');assert.equal(h.get().model.family.id,'family-ming');await h.setChildren([{...children[1],displayName:'小明新稱呼'},children[2],children[0],{...children[0],id:'sunny-other-id'}]);radios=await h.open();assert.deepEqual(radios.map(n=>n.getAttribute('aria-label')),['家庭選項：合成驗收家長的家庭 · 孩子：小晴','家庭選項：合成驗收家長的家庭 · 孩子：小明新稱呼']);assert.equal(radios[1].getAttribute('aria-checked'),'true');assert.equal(h.get().model.family.id,'family-ming');assert.equal(h.requests.length,3);assert.deepEqual(h.selections,['family-ming']);
 }finally{await h.close()}
});
