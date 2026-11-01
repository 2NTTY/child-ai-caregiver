/** Data-only same-case projection; never a transport, state owner or availability grant. */
import {normalTasksFor} from './normal-tasks.mjs';
import contracts from '../sources/normal-tasks-read-bindings.json' with {type:'json'};
const identifiers=Object.freeze([{"canonical":"preview-child-01","native":"c0b00000-0000-4000-8000-000000000001"},{"canonical":"preview-child-01-task-ordinary","native":"c0b00000-0000-4000-8000-000000000002"},{"canonical":"preview-child-01-task-appointment","native":"c0b00000-0000-4000-8000-000000000003"},{"canonical":"preview-child-01-task-review","native":"c0b00000-0000-4000-8000-000000000004"},{"canonical":"preview-child-01-task-future","native":"c0b00000-0000-4000-8000-000000000005"},{"canonical":"preview-child-01-task-completed","native":"c0b00000-0000-4000-8000-000000000006"},{"canonical":"preview-child-01-task-cancelled","native":"c0b00000-0000-4000-8000-000000000007"},{"canonical":"preview-child-01-task-ordinary-occurrence","native":"c0b00000-0000-4000-8000-000000000008"},{"canonical":"preview-child-01-task-appointment-occurrence","native":"c0b00000-0000-4000-8000-000000000009"},{"canonical":"preview-child-01-task-review-occurrence","native":"c0b00000-0000-4000-8000-00000000000a"},{"canonical":"preview-child-01-task-future-occurrence","native":"c0b00000-0000-4000-8000-00000000000b"},{"canonical":"preview-child-01-task-completed-occurrence","native":"c0b00000-0000-4000-8000-00000000000c"},{"canonical":"preview-child-01-task-cancelled-occurrence","native":"c0b00000-0000-4000-8000-00000000000d"},{"canonical":"preview-child-01-task-ordinary-initial","native":"c0b00000-0000-4000-8000-00000000000e"},{"canonical":"preview-child-01-task-ordinary-follow-up","native":"c0b00000-0000-4000-8000-00000000000f"},{"canonical":"preview-batch-initial","native":"c0b00000-0000-4000-8000-000000000010"},{"canonical":"preview-batch-follow-up","native":"c0b00000-0000-4000-8000-000000000011"}].map(row=>Object.freeze(row)));
const forward=new Map(identifiers.map(row=>[row.canonical,row.native])),inverse=new Map(identifiers.map(row=>[row.native,row.canonical]));
export function nativeTaskIdentifier(id){if(typeof id!=='string'||!forward.has(id))throw Error('NORMAL_CANONICAL_ID_UNMAPPED');return forward.get(id);}
export function canonicalTaskIdentifier(id){if(typeof id!=='string'||!inverse.has(id))throw Error('NORMAL_NATIVE_ID_UNMAPPED');return inverse.get(id);}
function nativeTask(item){const {terminalAt,completedAt,...task}=item;return {...task,id:nativeTaskIdentifier(task.id),childId:nativeTaskIdentifier(task.childId),occurrence:{...task.occurrence,id:nativeTaskIdentifier(task.occurrence.id)}};}
const unavailable=reason=>({status:'unavailable',reason,runtimeReady:false,selectable:false,dataMapped:false});
export function normalTasksReadBinding(registry,variant,scenario='normal'){
 if(!['original','harbour'].includes(variant))return unavailable('SOURCE_PAIR_NOT_BOUND');
 const data=normalTasksFor(registry,variant,scenario);if(data.status!=='schema-projected')return unavailable(data.reason);
 if(data.fixtureDocumentSha256!==contracts.fixtureDocumentSha256)throw Error('NORMAL_FIXTURE_CONTRACT_STALE');
 const f=data.fixture,native={child:{...data.child,id:nativeTaskIdentifier(data.child.id)},scheduleContext:{...data.model.scheduleContext},
  page:{items:f.items.map(nativeTask),eligibleAssignees:f.eligibleAssignees,nextAfterId:null,
   reminders:f.reminders.map(r=>({...r,id:nativeTaskIdentifier(r.id),batchId:nativeTaskIdentifier(r.batchId),taskId:nativeTaskIdentifier(r.taskId),occurrenceId:nativeTaskIdentifier(r.occurrenceId)})),
   work:f.work.map(w=>({...w,taskId:nativeTaskIdentifier(w.taskId)})),workerEnabled:f.workerEnabled},
  histories:Object.fromEntries(Object.entries(f.histories).map(([id,revisions])=>[nativeTaskIdentifier(id),{revisions:revisions.map(r=>({...r,task:nativeTask(r.task)})),nextBeforeVersion:null}]))};
 return {status:'native-read-data-projected',scenario:'normal',source:data.source,fixtureDocumentSha256:data.fixtureDocumentSha256,
  nativeContract:structuredClone(contracts.variants[variant]),identityMap:identifiers.map(row=>({...row})),native,
  unavailable:['native-clock-wiring','records-session-account-bootstrap','task-mutations-and-reconciliation','non-tasks-pages','sourceframe-artifact-and-runtime'],runtimeReady:false,selectable:false,dataMapped:false};
}
