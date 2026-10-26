import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/production/TaskKnowledgeSummaryContent.tsx',import.meta.url),'utf8');
const nodes=value=>!value||typeof value!=='object'?[]:[value,...[value.props?.children].flat(Infinity).flatMap(nodes)];
function harness(initial) {
 let owner=initial,cursor=0,states=[],effects=[];
 const react={useState(value){const i=cursor++;if(!(i in states))states[i]=value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
 const ports={react,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':{View:'View'},'react-native-paper':{Text:'Text'},
  './TaskKnowledgeDomains':{useProductionTaskKnowledgeSummary:()=>owner},'../preview/PreviewNavigationGuard':{usePreviewNavigation:()=>fn=>fn()},
  '../components/summary/summary-form':{summaryPeriodSchema:{safeParse:()=>({success:true})}},'../summary-view-model':{summaryPeriodLabel:()=> '這星期',summaryTime:()=> '今天'},
  '../components/summary/summary-styles':{summaryStyles:{}}};
 // A function marker mirrors a real component; this test inspects composition, not DOM/layout.
 const AppDialog=()=>null;Object.assign(AppDialog,{Title:'Dialog.Title',ScrollArea:'Dialog.ScrollArea',Actions:'Dialog.Actions'});ports['../components/AppDialog']={AppDialog};
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert.deepEqual(output.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
 const module={exports:{}};new Function('require','module','exports',output.outputText)(name=>ports[name]??new Proxy({},{get:(_,key)=>String(key)}),module,module.exports);
 return {render(props={}){cursor=0;effects=[];return module.exports.TaskKnowledgeSummaryContent({presentation:'overview',scopeKey:'parent:child-a',childId:'child-a',onRecord(){},onTask(){},...props});},setOwner:value=>{owner=value;},get effects(){return effects;},AppDialog};
}
function owner(patch={}) {return {model:{scopeKey:'parent:child-a',access:'editable',online:true,busy:false,dirty:false,readFailed:false,pending:null,operation:'none',query:{startDay:'2026-10-20',period:'week',timeZone:'Asia/Hong_Kong'},page:{childId:'child-a',canManage:true,period:{},generatedAt:'2026-10-26'},...patch},actions:{refresh(){},updateQuery(){},discard(){},retryOriginal(){},setOriginalConsent(){}}};}

test('actual overview adapter mounts the reconstructed record reader inline without an intermediate review dialog',()=>{
 const value=owner(),h=harness(value),onRecord=()=>{},onTask=()=>{},tree=h.render({onRecord,onTask}),all=nodes(tree);
 const reader=all.find(n=>n.type==='SummaryRecords');assert.ok(reader);assert.equal(reader.props.page,value.model.page);assert.equal(reader.props.onRecord,onRecord);assert.equal(reader.props.onTask,onTask);
 for(const dialog of all.filter(n=>n.type===h.AppDialog))assert.equal(nodes(dialog).includes(reader),false);
 assert.doesNotMatch(source,/reviewScope|完整回顧|ChildOverviewRecentRecords/);
 assert.ok(all.some(n=>n.props?.label==='套用期間'&&n.props.onPress===value.actions.refresh));
});
test('inline overview keeps exact child/scope and revoked-access gates before any record reader',()=>{
 for(const value of [owner({scopeKey:'parent:other'}),owner({page:{childId:'other'}}),owner({access:'lost'})]) {
  const tree=harness(value).render();assert.equal(nodes(tree).some(n=>n.type==='SummaryRecords'),false);
 }
 const lost=harness(owner({access:'lost'})).render();assert.match(lost.props.children,/已無權/);
});
test('unknown original operation remains visible and retry uses original consent and checked state',()=>{
 const pending={confirmed:false,checked:false,reference:'original-op',appointmentLabel:'見面',input:{expectedVersion:2,basisVersion:'basis',period:{},reviewed:false,questions:['要帶甚麼？'],checklist:[]}};
 const value=owner({pending}),h=harness(value);let all=nodes(h.render());
 assert.ok(all.some(n=>n.props?.title==='原保存結果待核對'));
 let retry=all.find(n=>n.props?.label==='明確重試原到診準備保存');assert.equal(retry.props.disabled,true);assert.equal(retry.props.onPress,value.actions.retryOriginal);
 value.model.pending.checked=true;value.model.originalConsent=true;all=nodes(h.render());retry=all.find(n=>n.props?.label==='明確重試原到診準備保存');assert.equal(retry.props.disabled,false);
 value.model.pending.confirmed=true;all=nodes(h.render());assert.equal(all.some(n=>n.props?.label==='明確重試原到診準備保存'),false);
});
test('the actual preparation edit dialog and dirty/unmount guards remain, only the redundant read dialog is removed',()=>{
 const value=owner(),h=harness(value);let tree=h.render({preparation:true}),all=nodes(tree);
 const open=all.find(n=>n.props?.label==='查看／人工修改共享到診準備');assert.ok(open);open.props.onPress();
 all=nodes(h.render({preparation:true}));assert.ok(all.some(n=>n.type===h.AppDialog&&n.props.visible===true));assert.ok(all.some(n=>n.type==='PreparationCard'&&n.props.actions===value.actions));
 let discards=0;value.actions.discard=()=>discards++;
 for(const [pending,busy,expected] of [[null,false,1],[{},false,1],[null,true,1]]) {
  value.model.dirty=true;value.model.pending=pending?{confirmed:false,checked:false,input:{period:{},questions:[],checklist:[]}}:null;value.model.busy=busy;h.render();for(const effect of h.effects){const cleanup=effect();if(typeof cleanup==='function')cleanup();}assert.equal(discards,expected);
 }
});
