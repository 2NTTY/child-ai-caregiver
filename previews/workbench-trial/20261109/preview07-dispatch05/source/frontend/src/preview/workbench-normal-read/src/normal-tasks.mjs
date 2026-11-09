/** Static normal data projection only. No owner, action implementation or runtime permission. */
import fixtureDocument from '../fixtures/normal-tasks.json' with {type:'json'};
import bindings from '../sources/task-bindings.json' with {type:'json'};
import {validateRegistry,VARIANTS} from './registry.mjs';
const FIXTURE_SHA='d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4';
const unavailable=reason=>({status:'unavailable',reason,runtimeReady:false});
export function normalTasksFor(registry,variant,scenario='normal'){
 validateRegistry(registry);
 if(!VARIANTS.includes(variant))return unavailable('UNKNOWN_VARIANT');
 if(scenario!=='normal')return unavailable('SCENARIO_NOT_MAPPED');
 const row=registry.sources[variant],binding=bindings.variants[variant],expected=binding.source;
 if(row.status!=='source-verified')return unavailable('SOURCE_NOT_VERIFIED');
 if(Object.keys(expected).some(k=>row.source[k]!==expected[k])||row.receiptSha256!==bindings.receipts[variant==='original'?'original':'four'].sha256)return unavailable('STALE_SOURCE_BINDING');
 const data=structuredClone(fixtureDocument),f=data.fixture;
 const model={child:{id:data.child.id,name:data.child.displayName},access:'editable',online:true,reading:false,
  dataLabel:'合成示例 · 未接駁 Server · 待辦與事項歷史共用本次資料',scheduleContext:data.scheduleContext,
  items:f.items,eligibleAssignees:f.eligibleAssignees,selected:null,hasMoreTasks:false,loadingMoreTasks:false,
  workerEnabled:f.workerEnabled,work:f.work,reminders:f.reminders,history:[],historyOpen:false,hasMoreHistory:false,
  draft:null,latest:null,operation:{state:'none',message:'',reference:null}};
 return {status:'schema-projected',runtimeReady:false,source:structuredClone(expected),fixtureDocumentSha256:FIXTURE_SHA,
  schemaBindings:binding.schema.files.map(path=>({path,sha256:binding.files.find(f=>f.path===path).sha256})),
  child:data.child,fixture:f,model,
  unavailable:['runtime-owner-actions','slot-adapters','non-normal-scenarios','no-results-ui-query','other-routes']};
}
