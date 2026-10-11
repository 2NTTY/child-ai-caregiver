const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const sourceRoot = path.resolve(process.env.SETTINGS_WIDTH_SOURCE || path.join(__dirname, '../..'));
const deps = path.resolve(process.env.SETTINGS_WIDTH_DEPS || sourceRoot);
const req = Module.createRequire(path.join(deps, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'https://synthetic.invalid/settings?section=preferences' });
Object.defineProperty(dom.window.document.documentElement, 'clientWidth', { value: 1188 });
Object.defineProperty(dom.window.document.documentElement, 'clientHeight', { value: 761 });
for (const k of ['window','document','HTMLElement','Element','Node','ShadowRoot','MutationObserver','getComputedStyle']) global[k] = dom.window[k];
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
// jsdom has no geometry/ResizeObserver. Supply explicit geometry ports only.
// 818.4/584 models the observed 1.4 CSS zoom straddling the product's 720 threshold.
let measured = false;
let visualWidth = 818.4;
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable:true, get(){return this.dataset.testid==='settings-workspace' ? 584 : 176;} });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable:true, get(){return this.dataset.testid==='settings-workspace' ? (document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('aria-label')==='家庭成員'?450:900) : 48;} });
window.HTMLElement.prototype.getBoundingClientRect = function(){const width=this.dataset.testid==='settings-workspace'?visualWidth:246.4;return {x:0,y:0,top:0,left:0,right:width,bottom:this.offsetHeight*1.4,width,height:this.offsetHeight*1.4,toJSON(){return this;}};};
const observers=[];
window.ResizeObserver=class { constructor(callback){this.callback=callback;this.nodes=new Set();observers.push(this);} observe(node){this.nodes.add(node);} unobserve(node){this.nodes.delete(node);} disconnect(){this.nodes.clear();} };
function deliverWorkspaceResize(){const workspace=document.querySelector('[data-testid=settings-workspace]');let deliveries=0;for(const o of observers)if(o.nodes.has(workspace)){o.callback([{target:workspace}]);deliveries++;}assert.equal(deliveries,1,'Exactly one real RN Web layout observer registered the workspace');}
let network=0;
global.fetch=()=>{network++;throw new Error('Network forbidden');};
const React=req('react'),{createRoot}=req('react-dom/client'),rn=req('react-native-web'),ts=req('typescript');
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){return name==='react-native'?rn:originalLoad.call(this,name,parent,isMain);};
const paper={
 MD3LightTheme:req('react-native-paper/lib/commonjs/styles/themes/v3/LightTheme').MD3LightTheme,
 configureFonts:req('react-native-paper/lib/commonjs/styles/fonts').default,
 Text:req('react-native-paper/lib/commonjs/components/Typography/Text').default,
 Switch:req('react-native-paper/lib/commonjs/components/Switch/Switch').default,
};
const empty=()=>null;
const view=React.forwardRef(({children,preset,triggerKey,scopeKey,enabled,...props},ref)=>React.createElement(rn.View,{...props,ref},children));
const source=path.join(sourceRoot,'frontend/src'),cache=new Map(),loaded=[];
function load(file){const filename=path.resolve(source,file);if(cache.has(filename))return cache.get(filename).exports;
 const overlay=process.env.SETTINGS_WIDTH_OVERLAY && path.join(process.env.SETTINGS_WIDTH_OVERLAY,path.relative(sourceRoot,filename));
 const raw=fs.readFileSync(overlay && fs.existsSync(overlay) ? overlay : filename);loaded.push({path:path.relative(source,filename),sha256:crypto.createHash('sha256').update(raw).digest('hex')});
 const module={exports:{}};cache.set(filename,module);const code=ts.transpileModule(raw.toString('utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(name=>{
  if(name==='react-native')return rn;if(name==='react-native-paper')return paper;
  if(name.endsWith('/AppIcon'))return {AppIcon:empty};
  if(name.endsWith('/AppScrollView'))return {AppScrollView:rn.ScrollView};
  if(name.endsWith('/AppRadioItem'))return {AppRadioItem:empty};
  if(name.endsWith('/AppDialog'))return {AppDialog:empty};
  if(name.endsWith('/AppStatusBadge'))return {AppStatusBadge:empty};
  if(name.endsWith('/HorizontalOverflowRail'))return {HorizontalOverflowRail:({children})=>React.createElement(rn.View,null,children)};
  if(name.endsWith('/MotionSelectionMarker'))return {MotionSelectionMarker:empty};
  if(name.endsWith('/motion'))return {MotionEntrance:view};
  if(!name.startsWith('.'))return req(name);
  const p=path.resolve(path.dirname(filename),name),target=fs.existsSync(p+'.tsx')?p+'.tsx':fs.existsSync(p+'.ts')?p+'.ts':p;
  return load(path.relative(source,target));
 },module,module.exports);return module.exports;
}
const {SettingsNavigation}=load('components/settings/SettingsNavigation.tsx');
const {useContainerWidth}=load('components/useContainerWidth.ts');
const {AppTabPanel}=load('components/ui.tsx');
const items=[['account','個人與帳戶'],['children','孩子設定'],['family','家庭成員'],['preferences','應用偏好'],['notifications','通知渠道'],['assistant','助手設定'],['model','模型設定'],['privacy','資料與私隱']].map(([key,label])=>({key,label}));
const events=[],renders=[],nodeIds=new WeakMap();let nextNodeId=1;
const id=n=>n?(nodeIds.has(n)?nodeIds.get(n):(nodeIds.set(n,nextNodeId),nextNodeId++)):null;
const describe=n=>({tag:n?.tagName,id:id(n),label:n?.getAttribute('aria-label'),role:n?.getAttribute('role'),connected:n?.isConnected});
document.addEventListener('focusin',e=>events.push({kind:'focusin',...describe(e.target)}));
document.addEventListener('focusout',e=>events.push({kind:'focusout',...describe(e.target)}));
function Host(){const [tab,setTab]=React.useState('preferences');const geometry=useContainerWidth();const compact=measured?geometry.width<720:false;
 React.useLayoutEffect(()=>{renders.push({tab,width:geometry.width,compact,active:describe(document.activeElement),family:describe(document.querySelector('[role=tab][aria-label="家庭成員"]'))});});
 return React.createElement(rn.View,{ref:geometry.ref,onLayout:geometry.onLayout,testID:'settings-workspace'},
 React.createElement(SettingsNavigation,{id:'settings',items,value:tab,onChange:setTab,compact}),
 items.map(item=>React.createElement(AppTabPanel,{key:item.key,tabsId:'settings',tabKey:item.key,active:tab===item.key},React.createElement(paper.Text,null,item.label),item.key==='preferences'?React.createElement(paper.Switch,{accessibilityLabel:'減少動畫',value:true,onValueChange:empty}):null)));
}
const root=createRoot(document.getElementById('root'));
const byLabel=label=>document.querySelector(`[role=tab][aria-label="${label}"]`);
const observations=[];
async function prepare(ctx,useMeasured){measured=useMeasured;visualWidth=818.4;await React.act(async()=>root.render(null));events.length=0;renders.length=0;
 ctx.mock.timers.enable({apis:['setTimeout']});await React.act(async()=>root.render(React.createElement(Host)));
 if(useMeasured)await React.act(async()=>{deliverWorkspaceResize();ctx.mock.timers.tick(0);});
 // Native Tab default actions do not exist in jsdom. Establish the same browser-proven
 // focus path explicitly (switch -> active tabpanel -> selected preferences tab).
 for(const n of [document.querySelector('[role=switch]'),document.querySelector('[role=tabpanel][tabindex="0"]'),byLabel('應用偏好')]){await React.act(async()=>n.focus());assert.equal(document.activeElement,n);}
 assert.equal(byLabel('應用偏好').getAttribute('aria-selected'),'true');
 assert.equal(document.querySelector('[role=tablist]').getAttribute('aria-orientation'),'vertical');
}
async function arrowUp(){await React.act(async()=>{byLabel('應用偏好').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',code:'ArrowUp',bubbles:true,cancelable:true}));});}
function record(stage,previous){const current=byLabel('家庭成員');const value={stage,active:describe(document.activeElement),family:describe(current),previousFamily:describe(previous),sameNode:current===previous,selected:current?.getAttribute('aria-selected'),tabIndex:current?.tabIndex,orientation:document.querySelector('[role=tablist]')?.getAttribute('aria-orientation'),url:locationHref(),network,renders:[...renders],events:[...events]};observations.push(value);console.log(JSON.stringify(value));return current;}
function locationHref(){return window.location.href;}
test('fixed vertical SettingsNavigation preserves exact ArrowUp target focus',async ctx=>{await prepare(ctx,false);const previous=byLabel('家庭成員');await arrowUp();const current=record('fixed-vertical-after-up',previous);assert.equal(document.activeElement,current,'ArrowUp must retain focus on the connected selected family tab');assert.equal(current,previous);ctx.mock.timers.reset();});
test('scaled container read followed by actual RN Web layout callback retains exact ArrowUp target focus',async ctx=>{await prepare(ctx,true);const previous=byLabel('家庭成員');await arrowUp();assert.equal(document.activeElement,previous,'The direct keyboard handler initially focuses its real target');record('measured-before-resize-delivery',previous);
 // Deliver the height-change ResizeObserver observation through the unmodified RN Web
 // UIManager timer. This is controlled observer input, not an arbitrary wait.
 await React.act(async()=>{deliverWorkspaceResize();ctx.mock.timers.tick(0);});const current=record('measured-after-resize-delivery',previous);
 try { assert.ok(document.activeElement===current,'ArrowUp must retain focus on the connected selected family tab'); } finally {ctx.mock.timers.reset();}});
test('real visual resize crosses the Settings threshold while zero width preserves the last valid layout',async ctx=>{
 await prepare(ctx,true);
 const initial=byLabel('應用偏好');
 await React.act(async()=>{deliverWorkspaceResize();ctx.mock.timers.tick(0);});
 assert.equal(document.querySelector('[role=tablist]').getAttribute('aria-orientation'),'vertical');
 assert.equal(byLabel('應用偏好'),initial,'A height-only callback preserves the mounted navigation');
 visualWidth=650;
 await React.act(async()=>{deliverWorkspaceResize();ctx.mock.timers.tick(0);});
 assert.equal(document.querySelector('[role=tablist]').getAttribute('aria-orientation'),'horizontal','A real smaller visual width activates compact navigation');
 visualWidth=0;
 await React.act(async()=>{deliverWorkspaceResize();ctx.mock.timers.tick(0);});
 assert.equal(document.querySelector('[role=tablist]').getAttribute('aria-orientation'),'horizontal','Hidden zero width does not erase the last valid measurement');
 visualWidth=818.4;
 await React.act(async()=>{deliverWorkspaceResize();ctx.mock.timers.tick(0);});
 assert.equal(document.querySelector('[role=tablist]').getAttribute('aria-orientation'),'vertical','A real larger visual width returns to wide navigation');
 observations.push({stage:'visual-resize-zero-height-only',widths:[818.4,650,0,818.4],orientations:['vertical','horizontal','horizontal','vertical'],network});
 ctx.mock.timers.reset();
});
test.after(async()=>{await React.act(async()=>root.unmount());if (process.env.SETTINGS_WIDTH_EVIDENCE) fs.writeFileSync(process.env.SETTINGS_WIDTH_EVIDENCE,JSON.stringify({versions:{react:req('react/package.json').version,reactNativeWeb:req('react-native-web/package.json').version,paper:req('react-native-paper/package.json').version},loaded,observations,network,limits:['jsdom geometry and ResizeObserver are explicit environment ports','Native Space/Tab defaults are not simulated; same focus path is established explicitly','No full Settings owner or browser geometry captured; source root may be provided by SETTINGS_WIDTH_SOURCE and a candidate by SETTINGS_WIDTH_OVERLAY','MotionEntrance and horizontal overflow presentation are structural substitutes']},null,2));});
