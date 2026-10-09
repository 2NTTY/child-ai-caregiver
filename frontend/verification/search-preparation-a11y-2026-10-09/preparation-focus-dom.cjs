const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createRequire } = Module;
// Supply the existing, external jsdom tooling; this check does not add a product dependency.
const root = path.resolve(__dirname, '../..');
const requireFrontend = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Set JSDOM_MODULE to an installed jsdom package directory.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[name] = dom.window[name];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = requireFrontend('react'), { createRoot } = requireFrontend('react-dom/client');
const rn = requireFrontend('react-native-web'), ts = requireFrontend('typescript');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) { return name === 'react-native' ? rn : originalLoad.call(this, name, parent, isMain); };
const Text = requireFrontend('react-native-paper/lib/commonjs/components/Typography/Text').default;
const transparent = ({children}) => React.createElement(React.Fragment, null, children);
const theme = { chineseFont: 'sans-serif', colors: {}, spacing: { sm: 8, md: 12, lg: 16 }, radius: {}, readingType: {}, mobileIcons: {}, mobileLayout: { breakpoint: 650 }, mobileType: {}, typeScale: {} };
let AppCheckbox;
function load(relative, suffix = '') {
  const filename = path.join(root, 'src', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = {exports:{}};
  new Function('require', 'module', 'exports', code + suffix)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return {Text};
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/AppIcon')) return {AppIcon: () => null};
    if (name.endsWith('/AppCheckbox')) return {AppCheckbox};
    if (name.endsWith('/preparation-view-model')) return load('preparation-view-model.ts');
    if (name.endsWith('/ui')) return {AppButton: ({label}) => React.createElement('button', {type:'button'}, label), AppSelect: () => null};
    if (!name.startsWith('.')) return requireFrontend(name);
    return new Proxy({}, {get: () => transparent});
  }, module, module.exports);
  return module.exports;
}
AppCheckbox = load('components/AppCheckbox.tsx').AppCheckbox;
const Detail = load('components/preparations/PreparationWorkspace.tsx', '\nexports.Detail = PreparationDocumentDetail;').Detail;
const reactRoot = createRoot(document.getElementById('root'));
const baseDoc = () => ({ id:'preparation-a', childId:'child-a', purpose:'outing', version:1, status:'active', archivedAt:null, readState:'ready', sources:[], revision:{id:'v1',number:1,title:'Synthetic preparation',summary:'Synthetic',eventDate:null,updatedAt:'2026-10-09T00:00:00Z',sourceAsOf:null,sourceRefs:[],sections:[{id:'checklist',title:'Checklist',kind:'checklist',items:[{id:'water',text:'Synthetic water',checked:true},{id:'book',text:'Synthetic book',checked:false}]}]} });
let doc, model, workspace, writes;
const findBook = () => document.querySelector('[role="checkbox"][aria-label="Synthetic book"]');
const pressSpace = node => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:' ',bubbles:true,cancelable:true}));
const render = () => reactRoot.render(React.createElement(React.Fragment,null,React.createElement(Detail,{key:'scope-a:'+doc.id,document:doc,workspace,onClose(){}}),React.createElement('button',{id:'after'},'After')));
async function start() {
  await React.act(async () => reactRoot.render(null));
  doc=baseDoc();writes=[];
  model={child:{id:'child-a',displayName:'Synthetic child'},scope:{authorityKey:'scope-a',childId:'child-a',role:'owner',online:true,condition:'ready'},online:true,condition:'ready',busy:false,operation:{state:'none'},capabilities:{checkItem:true,archive:true}};
  workspace={scopeKey:'scope-a',model,actions:{checkItem(...args){writes.push(args);model.busy=true;model.operation={state:'saving'};model.scope.condition='unknown';model.capabilities.checkItem=false;render();}}};
  await React.act(async () => render());
}
async function save() { const node=findBook(); await React.act(async () => node.focus()); assert.equal(document.activeElement,node); await React.act(async () => pressSpace(node)); return node; }
(async () => {
  const results=[];
  await start(); let node=await save();
  assert.equal(findBook(),node);assert.equal(document.activeElement,node);assert.equal(node.getAttribute('aria-disabled'),'true');
  await React.act(async () => pressSpace(node)); assert.equal(writes.length,1);
  await React.act(async () => {doc={...doc,version:2,revision:{...doc.revision,number:2,sections:doc.revision.sections.map(section=>({...section,items:section.items.map(item=>({...item,checked:true}))}))}};model.busy=false;model.operation={state:'saved'};model.scope.condition='ready';model.capabilities.checkItem=true;render();});
  assert.equal(findBook(),node);assert.equal(document.activeElement,node);assert.equal(node.getAttribute('aria-checked'),'true');assert.equal(node.hasAttribute('aria-disabled'),false); // RN Web omits false ARIA state.
  assert.equal(writes.length,1);results.push('Second-item Space retains the exact focused RN Web checkbox through saving and success; repeat activation is blocked.');
  await start();node=await save();
  await React.act(async () => {model.busy=false;model.operation={state:'unknown',recovery:'check'};render();});
  assert.equal(findBook(),node);assert.equal(document.activeElement,node);assert.equal(node.getAttribute('aria-disabled'),'true');
  await React.act(async () => pressSpace(node));assert.equal(writes.length,1);results.push('Unknown failed-save recovery retains focus and rejects further writes.');
  await start();node=await save();await React.act(async () => document.getElementById('after').focus());
  await React.act(async () => {model.busy=false;model.operation={state:'saved'};model.scope.condition='ready';model.capabilities.checkItem=true;render();});
  assert.equal(document.activeElement.id,'after');results.push('Moving focus elsewhere during saving is respected after success.');
  await start();node=await save();
  await React.act(async () => {model.scope.role='viewer';model.scope.condition='read_only';render();});
  assert.equal(findBook(),null);assert.equal(writes.length,1);results.push('A role change removes the retained checkbox; no stale editable control survives.');
  await React.act(async () => reactRoot.unmount());
  console.log(JSON.stringify({status:'passed',checks:results,react:React.version,rnWeb:requireFrontend('react-native-web/package.json').version,paper:requireFrontend('react-native-paper/package.json').version,jsdom:require(path.join(process.env.JSDOM_MODULE,'package.json')).version,limits:['DOM runtime only; no real-browser layout, physical keyboard, screen reader or native-device claim.']},null,2));
  dom.window.close();
})().catch(async error=>{console.error(error);try{await React.act(async()=>reactRoot.unmount());}catch{}dom.window.close();process.exitCode=1;}).finally(()=>{Module._load=originalLoad;});
