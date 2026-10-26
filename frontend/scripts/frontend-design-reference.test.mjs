import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

// Fixed ordinary-fix baseline 3b8cc50. This checks presentation bindings, not live authorization.
// New local topic selection and preparation navigation are tested separately.
const expected = {
  "frontend/src/components/child-overview/ChildOverviewContent.tsx": {
    "count": 14,
    "sha256": "bca561ca1e30cabe601b3de545dccc8010cc317c3ca21f5d52aeedaf03c358b8"
  },
  "frontend/src/components/contact/ContactConsentCard.tsx": {
    "count": 29,
    "sha256": "a8631592e31eb1859e8d8a20785d2a9f37b9a2ba56e675ea4b292db8db0bcecd"
  },
  "frontend/src/components/contact/ContactTaskCard.tsx": {
    "count": 31,
    "sha256": "4811f5ca1f207918d77ec8ce2304b4f7e5d162f3d9f5f07184d9a98738dbc864"
  },
  "frontend/src/components/contact/ContactView.tsx": {
    "count": 16,
    "sha256": "b80f0142cabcf68cca46b1455c67ea0392e976dd802902aadc5b870746c23c67"
  },
  "frontend/src/components/family/FamilyView.tsx": {
    "count": 65,
    "sha256": "a6a2a8d0ef9d7248b1279048dbc791e25f778f418293877b6c20cdfee594eb2c"
  },
  "frontend/src/components/memory/MemoryReferenceView.tsx": {
    "count": 31,
    "sha256": "b99c2373a778feb840d4673062719b14e03144f9398556c64144220a98fad35d"
  },
  "frontend/src/components/model-settings/ModelSettingsView.tsx": {
    "count": 78,
    "sha256": "b70ee2996ee29d4c773c167e0bc63a8189ad8b46adc5d9c1c2cbe69e3f524af9"
  },
  "frontend/src/components/photos/AttachmentLibrary.tsx": {
    "count": 17,
    "sha256": "fd7033d12f97c07360e54adf80572df34244f6a612fcaa3df85318e41f756faf"
  },
  "frontend/src/components/photos/PhotoRecordForm.tsx": {
    "count": 9,
    "sha256": "506727060bdb20b02b63b30f42f05190962c54c2abf3fefa21e367415159e4a3"
  },
  "frontend/src/components/photos/PhotosView.tsx": {
    "count": 67,
    "sha256": "67e018043abc85c2af3426efa12f2202d9bb5bfd67dca2748e45b9082bf2a917"
  },
  "frontend/src/components/profile/ProfileForm.tsx": {
    "count": 18,
    "sha256": "c27ea7fdf01c7ae7aa7b58dd0328c0b167656d33d2a71c61646e2637838e0eb1"
  },
  "frontend/src/components/profile/ProfileHistoryView.tsx": {
    "count": 12,
    "sha256": "327f3f9121e32d5977a703c9b29cd87750e53ebc39f7b4b8a2d8a38151e91d4a"
  },
  "frontend/src/components/profile/ProfileSummary.tsx": {
    "count": 0,
    "sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  "frontend/src/components/profile/ProfileView.tsx": {
    "count": 24,
    "sha256": "deccd487b0ff2256c64f9b245477173d18273c4cf20ff7a6b1d30e090b938984"
  },
  "frontend/src/components/shared-inputs/SourceComposer.tsx": {
    "count": 18,
    "sha256": "5d55adff644488002362c69e983f5c819fd7b5633e25176610f90bd1c41d1db3"
  },
  "frontend/src/components/shared-inputs/SourceDetails.tsx": {
    "count": 44,
    "sha256": "167ed4620b9b794470a90ff32c05307cb9ab718765f2910070dc724a9d146c0a"
  },
  "frontend/src/components/shared-inputs/SourceIntakeEditor.tsx": {
    "count": 51,
    "sha256": "dc4407b08b0eed4c279b0c78c8838999f98f6393074ed238f64e500f401b0de3"
  },
  "frontend/src/components/shared-inputs/SourceRecordForm.tsx": {
    "count": 14,
    "sha256": "0b33c9f9e7dca6730911e48e1fe305b2ceb35ca8bdea87235b0f5d26f277a28d"
  },
  "frontend/src/components/shared-inputs/SourcesView.tsx": {
    "count": 40,
    "sha256": "67a552318992b994e0f48d0146fc1538bd0258c9f759581be09ce3a43b36c38f"
  },
  "frontend/src/components/summary/SummaryRecords.tsx": {
    "count": 13,
    "sha256": "95baf2783595be60fe3536243efe009694b835b5acdaae69393fa9eda962d939"
  },
  "frontend/src/screens/SummaryScreen.tsx": {
    "count": 19,
    "sha256": "04d6e0aacafe3306dc963a559ce016a0010b51783fadb446feea4b806e438ec4"
  },
  "frontend/src/screens/familyScreen.tsx": {
    "count": 1,
    "sha256": "5c3faebff3ce608ed82c9d1a613a35a8e3a67ad857b4513e15107dc602b180fc"
  },
  "frontend/src/screens/memoryScreen.tsx": {
    "count": 4,
    "sha256": "8c0f6428533ed871b5b384bea93ee2363001e6a77fcdc9fe787ec71d390ef29d"
  },
  "frontend/src/screens/profileScreen.tsx": {
    "count": 24,
    "sha256": "f6c5c68d847b74dcce74c31a766030ff4cbb5db516669865934b2f27facb96ea"
  },
  "frontend/src/screens/settingsScreen.tsx": {
    "count": 6,
    "sha256": "efab8683497be70e82538828df2a9cca4d76e9377db07d4cfa1926a0edf5839f"
  }
};
const root=path.resolve(import.meta.dirname,'../..');
function bindings(file,source){const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),out=[];function visit(n){if(ts.isJsxAttribute(n)){const name=n.name.getText(tree);if(name!=='onLayout'&&/^(on[A-Z]\w*|disabled|editable|checked|scopeKey|formKey|returnFocusRef|fallbackFocusRef|aria-invalid|aria-describedby)$/.test(name)){const value=name+'='+n.initializer?.getText(tree).replace(/\s+/g,' ');if(!['onChange={setSelectedId}','onPress={() => setSelectedId(fact.id)}','onPress={() => guarded(() => router.push("/growth?tab=preparation"))}'].includes(value))out.push(value);}}ts.forEachChild(n,visit);}visit(tree);return out.sort();}

test('reference reconstruction retains original handlers, guards, scope and form/focus bindings',()=>{
 for(const [file,basis] of Object.entries(expected)){
  const current=bindings(file,fs.readFileSync(path.join(root,file),'utf8'));
  // New presentation forwarding only; every pre-existing binding must still match.
  const additions = file.endsWith('/memory/MemoryReferenceView.tsx') ? ['onQuestion={onQuestion}', 'onQuestion={onQuestion}']
    : [];
  for (const binding of additions) { const index = current.indexOf(binding); assert.ok(index >= 0, binding); current.splice(index, 1); }
  assert.equal(current.length,basis.count,file+' binding count');
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(current)).digest('hex'),basis.sha256,file+' binding identities');
 }
});

const jsx=(type,props,key)=>({type,props:props??{},key});
function nodes(tree) { return !tree || typeof tree!=='object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree,...nodes(tree.props?.children),...nodes(tree.props?.action)]; }
function moduleWithHooks(file,extra='') {
 const slots=[];let cursor=0;
 const hooks={useRef:value=>slots[cursor++]??={current:value},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useId:()=> 'reference-test',useEffect(){},useLayoutEffect(){}};
 const symbols=new Proxy({},{get:(_t,key)=>String(key)});
 const imports={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':{StyleSheet:{create:value=>value},Platform:{OS:'web'},View:'View',Pressable:'Pressable'},'react-native-paper':{Text:'Text'}};
 const module={exports:{}};
 const source=fs.readFileSync(path.join(root,file),'utf8')+extra;
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(name=>imports[name]??(name.endsWith('/theme')?{colors:{},spacing:{},readingType:{},radius:{},workspaceType:{}}:symbols),module,module.exports);
 return {exports:module.exports,render(component,props){cursor=0;return component(props);}};
}

test('settings directory keeps all eight chapters and native tab focus in both layouts',()=>{
 const items=['account','children','family','preferences','notifications','assistant','model','privacy'].map(key=>({key,label:key,description:`About ${key}`}));
 for(const compact of [false,true]){
  const h=moduleWithHooks('frontend/src/components/settings/SettingsNavigation.tsx');let selected='account',focused=null;
  const render=()=>h.render(h.exports.SettingsNavigation,{id:'settings',items,value:selected,onChange:value=>{selected=value;},compact});
  let tree=render(),tabs=nodes(tree).filter(node=>node.type==='Pressable');assert.equal(tabs.length,8);
  tabs.forEach((tab,i)=>tab.props.ref({focus(){focused=items[i].key;}}));
  tabs[0].props.onKeyDown({key:'ArrowRight',preventDefault(){}});assert.equal(selected,'children');assert.equal(focused,'children');
  tree=render();tabs=nodes(tree).filter(node=>node.type==='Pressable');assert.equal(tabs.filter(tab=>tab.props.tabIndex===0).length,1);assert.equal(tabs[1].props['aria-selected'],true);
  tabs[1].props.onKeyDown({key:'End',preventDefault(){}});assert.equal(selected,'privacy');assert.equal(focused,'privacy');
  tabs[7].props.onKeyDown({key:'Home',preventDefault(){}});assert.equal(selected,'account');assert.equal(focused,'account');
  tabs[3].props.onPress();assert.equal(selected,'preferences');
 }
});

test('memory topic selection keeps exact facts, a single visible reader and safe fallback after removal',()=>{
 const h=moduleWithHooks('frontend/src/components/memory/MemoryReferenceView.tsx','\nexport { MemoryFactReader };');
 const facts=Object.freeze([Object.freeze({id:'first',version:1,key:'生活習慣',content:'保持原文一'}),Object.freeze({id:'second',version:2,key:'照顧偏好',content:'保持原文二'})]);
 const workspace=Object.freeze({scopeKey:'child-a'}),model=Object.freeze({});
 const props={facts,workspace,model,width:1024,onQuestion(){}};
 const render=patch=>h.render(h.exports.MemoryFactReader,{...props,...patch});
 let tree=render(),buttons=nodes(tree).filter(node=>node.type==='Pressable');
 assert.equal(buttons.length,2);buttons[1].props.onPress();tree=render();
 let readers=nodes(tree).filter(node=>node.type==='View'&&node.props['aria-hidden']!==undefined);
 assert.equal(readers.filter(node=>node.props['aria-hidden']===false).length,1);assert.equal(readers[1].props.children.props.fact,facts[1]);
 assert.equal(readers[0].props.importantForAccessibility,'no-hide-descendants');
 tree=render({width:320});const select=nodes(tree).find(node=>node.type==='AppSelect');assert.equal(select.props.value,'second');assert.equal(select.props.options.length,2);
 select.props.onChange('first');tree=render({width:320});assert.equal(nodes(tree).find(node=>node.type==='AppSelect').props.value,'first');
 tree=render({facts:[facts[1]],width:320});assert.equal(nodes(tree).find(node=>node.type==='AppSelect').props.value,'second');
 assert.deepEqual(facts.map(fact=>fact.content),['保持原文一','保持原文二']);
});

test('reconstruction removes misleading photo steps and repeated source status chips, not original consent',()=>{
 const photos=fs.readFileSync(path.join(root,'frontend/src/components/photos/PhotosView.tsx'),'utf8');
 const sources=fs.readFileSync(path.join(root,'frontend/src/components/shared-inputs/SourcesView.tsx'),'utf8');
 assert.doesNotMatch(photos,/s\.stepNumber|\["選擇原照片", "私人保存"/);
 assert.match(photos,/我同意把原照片交由目前選用的模型服務提取；候選仍需核對/);
 assert.doesNotMatch(sources,/label=\{fetchStateLabels\[input.fetchState\]\}|label=\{readiness.indexLabel\}/);
 assert.match(sources,/sourceReadiness\(input, model\)/);
 const family=fs.readFileSync(path.join(root,'frontend/src/screens/familyScreen.tsx'),'utf8');
 assert.match(family,/家庭協作尚未開放/);assert.doesNotMatch(family,/<FamilyView/);
});
