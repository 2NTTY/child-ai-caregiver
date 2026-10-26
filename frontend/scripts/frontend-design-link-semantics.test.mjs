import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/preview/PreviewNavigationGuard.tsx',import.meta.url),'utf8');
const nodes=value=>!value||typeof value!=='object'?[]:[value,...[value.props?.children].flat(Infinity).flatMap(nodes)];
function harness() {
 let cursor=0,slots=[],guard=null,path='/care',pushes=[];
 const react={createContext:()=>({Provider:'Provider'}),useContext:()=>guard,useCallback:fn=>fn,useEffect(){},useLayoutEffect(){},
  useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
  useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];}};
 const Dialog=()=>null;Object.assign(Dialog,{Title:'Dialog.Title',Content:'Dialog.Content',Actions:'Dialog.Actions'});
 const ports={react,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{Platform:{OS:'web'},StyleSheet:{create:value=>value},View:'View'},'react-native-paper':{Text:'Text'},
  'expo-router':{Link:'Link',usePathname:()=>path,useRouter:()=>({push:href=>pushes.push(href)})},'expo-router/react-navigation':{},
  '../components/AppDialog':{AppDialog:Dialog},'../components/ui':{AppButton:'AppButton'},'../theme':{colors:{},typeScale:{}},'../production/routes':{isProductionRouteConnected:route=>route!=='/login'},'./browser-history-guard':{}};
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};new Function('require','module','exports',output)(name=>ports[name],module,module.exports);
 return {pushes,provider(){cursor=0;const tree=module.exports.PreviewNavigationGuard({children:'page'});guard=tree.props.value;return tree;},link(href='/tasks'){return module.exports.PreviewLink({href,children:'destination'});},get guard(){return guard;},setPath:value=>{path=value;}};
}
function event(fields={},native=false) {let prevented=0;return {event:{...(native?{nativeEvent:fields}:fields),preventDefault(){prevented++;}},get prevented(){return prevented;}};}

test('real PreviewLink preserves browser modifier, middle and already-prevented clicks at both event layers',()=>{
 for(const native of [false,true])for(const fields of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2},{defaultPrevented:true}]) {
  const h=harness();h.provider();let requests=0;h.guard.request=()=>{requests++;};const click=event(fields,native);h.link().props.onPress(click.event);
  assert.equal(click.prevented,0);assert.equal(requests,0);assert.deepEqual(h.pushes,[]);
 }
});
test('ordinary left and keyboard navigation retain the same guarded workspace route',()=>{
 for(const fields of [{button:0},{}]) {
  const h=harness();h.provider();const click=event(fields);h.link().props.onPress(click.event);assert.equal(click.prevented,1);assert.deepEqual(h.pushes,['/tasks']);
 }
 const h=harness();h.provider();const click=event();h.link('/care').props.onPress(click.event);assert.equal(click.prevented,1);assert.deepEqual(h.pushes,[]);
});
test('ordinary link navigation still blocks a page-local dirty form until explicit discard',()=>{
 const h=harness();h.provider();h.guard.register('local',{dirty:true,pending:false,scope:'child'});
 h.link().props.onPress(event().event);assert.deepEqual(h.pushes,[]);
 const tree=h.provider(),confirm=nodes(tree).find(n=>n.props?.label==='捨棄並離開');assert.ok(confirm);confirm.props.onPress();assert.deepEqual(h.pushes,['/tasks']);
});
test('ordinary link navigation cannot discard a pending or unknown page-local operation',()=>{
 for(const pendingKind of ['saving','unknown']) {
  const h=harness();h.provider();h.guard.register('local',{dirty:true,pending:true,pendingKind,scope:'child'});
  h.link().props.onPress(event().event);assert.deepEqual(h.pushes,[]);const tree=h.provider(),all=nodes(tree);
  assert.ok(all.some(n=>n.props?.label==='留在此頁'));assert.equal(all.some(n=>n.props?.label==='捨棄並離開'),false);
 }
});
