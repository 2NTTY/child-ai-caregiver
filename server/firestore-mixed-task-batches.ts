import { z } from 'zod';
import { mixedBatchActionSchema, mixedBatchControlSchema, type MixedBatchAction, type MixedTaskBatch } from '../src/shared/mixed-task-batch.ts';
import type { MixedChatRoom } from '../src/shared/mixed-chat.ts';
import type { OnlineSubmission } from '../src/shared/online.ts';
import type { SharedAccessBasis } from '../src/shared/sharing.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { createFirestoreAgentRuns } from './firestore-agent-runs.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { domainParse, domainReject, firestoreDomainHash, firestoreDomainUuid, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreOnlineReceipts } from './firestore-online-receipts.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';

type Binding=FirestoreAuthorityTransaction;
type Batch=NonNullable<Awaited<ReturnType<FirestoreChatStore['mixed']['batchIn']>>['batch']>;
type Item=MixedTaskBatch['items'][number];
type Target={childId:string;taskId:string|null;expectedVersion:number|null};
function view(batch:Batch):MixedTaskBatch {
  const {id,runId,digest,state,action,items}=batch;
  return {id,runId,digest,state,action,items};
}

/** Only the authenticated control endpoint can confirm. A model tool can save one preview per original message. */
export function createMixedTaskBatches(options:FirestoreDomainOptions & {chat:FirestoreChatStore;online:FirestoreOnlineStore;
  runs:Pick<ReturnType<typeof createFirestoreAgentRuns>,'requireLive'|'current'|'originalReplyRun'>}) {
  const authority=createFirestoreAuthority(options),sharing=createFirestoreSharingStore(options),receipts=createFirestoreOnlineReceipts(options);
  const {chat,online,runs}=options;
  async function withTarget<T>(actor:Binding,room:MixedChatRoom,childId:string,
    use:(source:Binding,basis?:SharedAccessBasis)=>Promise<T>):Promise<T> {
    if (!room.childIds.includes(childId)) domainReject('target_outside_selection',403);
    if (room.scope.kind==='personal') return use(actor);
    return sharing.inResourceTransaction(actor,{spaceId:room.scope.spaceId,childId,module:'tasks',mode:'write'},async access=>{
      if (!access.binding.sharedAccess?.classMember) domainReject('class_required',403);
      return use(access.binding,access.basis);
    });
  }
  async function pin(source:Binding,target:Target,grant?:SharedAccessBasis) {
    const child=await source.readChild(target.childId);
    if (!child) domainReject('not_found',404);
    const task=target.taskId ? await online.readImportTask(source,target.childId,target.taskId) : null;
    if (target.taskId && (!task || task.version!==target.expectedVersion)) domainReject('version_conflict');
    return {child,task,basis:firestoreDomainHash([source.scope.workspaceId,source.scope.storageEpoch,source.authorizationVersion,
      grant??null,child.id,child.displayName])};
  }
  function checkEpoch(actor:Binding,batch:Batch) {
    if (batch.epoch!==actor.scope.storageEpoch || batch.authorizationVersion!==actor.authorizationVersion)
      domainReject('batch_authorization_changed',409);
  }
  function closeRestored(actor:Binding,batch:Batch,save:(value:Batch)=>void) {
    if (batch.epoch===actor.scope.storageEpoch || !['running','awaiting_confirmation'].includes(batch.state)) return null;
    const stopped:Batch={...batch,state:'cancelled',items:batch.items.map(item=>item.status==='pending'
      ? {...item,status:'cancelled',reason:'storage_epoch_changed'} : item)};
    save(stopped); return view(stopped);
  }
  function command(actor:Binding,source:Binding,room:MixedChatRoom,batch:Batch,item:Item,grant?:SharedAccessBasis):OnlineSubmission {
    const action=batch.action,assigneeUserId=source.sharedAccess?.classMember?.userId??source.scope.ownerUserId;
    let payload:unknown;
    if(action.kind==='create') payload={confirm:true,values:{title:action.title,details:action.details,kind:action.type,
      dueAt:action.dueAt,timeZone:action.timeZone,assigneeUserId}};
    else payload={action:action.kind,expectedVersion:item.expectedVersion,confirm:true,note:action.note,
      ...(action.kind==='reschedule'?{dueAt:action.dueAt,timeZone:action.timeZone,assigneeUserId}:{})};
    return {path:'/api/children/'+item.childId+'/tasks'+(item.taskId?'/'+item.taskId+'/change':''),payload,
      ...(room.scope.kind==='class'?{sharing:{spaceId:room.scope.spaceId,expectedBasis:grant}}:{}),
      operation:{workspaceId:actor.scope.workspaceId,storageEpoch:batch.epoch,opId:item.operationId,deviceId:batch.id}};
  }
  return {
    async propose(userId:string,roomId:string,messageId:string,runId:string,raw:unknown) {
      const action:MixedBatchAction=domainParse(mixedBatchActionSchema,raw);
      return authority.runTransaction(userId,null,async b=>{
        const source=await chat.mixed.batchIn(b,roomId,messageId);
        const run=await runs.requireLive(b,runs.current(b),runId);
        if (run.mixedChat?.roomId!==roomId || run.sourceMessageId!==messageId || run.mixedChat.basis!==source.basis)
          domainReject('agent_scope_changed');
        if (source.batch) {
          if (source.batch.runId!==runId || firestoreDomainHash(source.batch.action)!==firestoreDomainHash(action)) domainReject('operation_conflict');
          return view(source.batch);
        }
        const id=firestoreDomainUuid(['mixed-task-batch',userId,roomId,messageId]);
        const targets:Target[]=action.kind==='create'
          ? (action.childIds??source.room.childIds).map(childId=>({childId,taskId:null,expectedVersion:null})) : action.targets;
        const items:Item[]=[], targetBasis:string[]=[];
        for (const target of targets) {
          const pinned=await withTarget(b,source.room,target.childId,(binding,grant)=>pin(binding,target,grant));
          targetBasis.push(pinned.basis);
          items.push({...target,childName:pinned.child.displayName,title:action.kind==='create'?action.title:pinned.task!.title,
            operationId:firestoreDomainUuid(['mixed-task-item',id,target.childId,target.taskId]),status:'pending',reason:null,version:null});
        }
        const digest=firestoreDomainHash([id,runId,action,items,targetBasis,b.authorizationVersion,b.scope.storageEpoch]);
        const batch:Batch={id,runId,action,items,targetBasis,digest,epoch:b.scope.storageEpoch,authorizationVersion:b.authorizationVersion,
          confirmed:false,state:'awaiting_confirmation'};
        source.save(batch); return view(batch);
      });
    },
    get(userId:string,roomId:string,messageId:string) {
      return authority.runTransaction(userId,null,async b=>{
        const {batch,save}=await chat.mixed.batchIn(b,roomId,messageId);
        return batch?(closeRestored(b,batch,save)??view(batch)):null;
      });
    },
    control(userId:string,roomId:string,messageId:string,raw:unknown) {
      const request=domainParse(mixedBatchControlSchema,raw);
      return authority.runTransaction(userId,null,async b=>{
        const {room,batch,save}=await chat.mixed.batchIn(b,roomId,messageId);
        if (!batch) domainReject('not_found',404);
        if (batch.digest!==request.digest) domainReject('version_conflict');
        const restored=closeRestored(b,batch,save);
        if (restored) return restored;
        if (['cancelled','completed','partial'].includes(batch.state) || request.action==='confirm' && batch.confirmed) return view(batch);
        if (request.action==='confirm') {
          checkEpoch(b,batch);
          const run=await runs.originalReplyRun(b,messageId);
          if (run?.id!==batch.runId || run.mixedChat?.roomId!==roomId || run.state!=='completed')
            domainReject('batch_proposal_unavailable',409);
          for (const [i,item] of batch.items.entries()) {
            const current=await withTarget(b,room,item.childId,(source,grant)=>pin(source,item,grant));
            if (current.basis!==batch.targetBasis[i]) domainReject('batch_authorization_changed',409);
          }
        }
        const cancelling=request.action==='cancel';
        const next:Batch={...batch,state:cancelling?'cancelled':'running',confirmed:batch.confirmed||!cancelling,
          items:cancelling?batch.items.map(item=>item.status==='pending'?{...item,status:'cancelled',reason:'batch_cancelled'}:item):batch.items};
        save(next); return view(next);
      });
    },
    step(userId:string,roomId:string,messageId:string,index:number,expectedDigest:string) {
      domainParse(z.int().min(0).max(99),index);
      return authority.runTransaction(userId,null,async actor=>{
        const {room,batch,save}=await chat.mixed.batchIn(actor,roomId,messageId);
        if (!batch) domainReject('not_found',404);
        if (batch.digest!==expectedDigest) domainReject('version_conflict');
        const restored=closeRestored(actor,batch,save);
        if (restored) return restored;
        if (!batch.confirmed) domainReject('confirmation_required',409);
        if (batch.state!=='running') return view(batch);
        checkEpoch(actor,batch);
        const item=batch.items[index];
        if (!item) domainReject('invalid_input',400);
        if (item.status!=='pending') return view(batch);
        if (batch.items.findIndex(value=>value.status==='pending')!==index) domainReject('batch_position_changed');
        let outcome:Item, stagingWrites=false;
        try {
          outcome=await withTarget(actor,room,item.childId,async(source,grant)=>{
            const current=await pin(source,item,grant);
            if (current.basis!==batch.targetBasis[index]) domainReject('batch_authorization_changed');
            if (current.task && (batch.action.kind==='complete' && current.task.occurrence.state==='completed'
              || batch.action.kind==='cancel' && current.task.occurrence.state==='cancelled'))
              return {...item,status:'skipped',reason:'already_terminal',version:current.task.version};
            const input=command(actor,source,room,batch,item,grant);
            const change=await online.prepareTask(source,item.childId,item.taskId??undefined,input.payload,item.operationId);
            const receipt=receipts.prepareConfirmed(actor,input,{childId:grant?null:item.childId,changeSeq:change.changeSeq,
              statusCode:item.taskId?200:201,result:{task:change.task}});
            stagingWrites=true;
            change.commit(); receipt.commit();
            return {...item,status:'completed',reason:null,taskId:change.task.id,version:change.task.version};
          });
        } catch(error) {
          // Only a known domain rejection may settle an item. Infrastructure errors leave the original transaction retryable.
          if (stagingWrites || !error || typeof error!=='object' || !('status' in error) || !('code' in error)
            || typeof error.code!=='string' || ![400,403,404,409,428].includes(Number(error.status))) throw error;
          outcome={...item,status:Number(error.status)===409?'conflict':'failed',reason:error.code,version:null};
        }
        const items=batch.items.map((old,i)=>i===index?outcome:old);
        const state=items.some(i=>i.status==='pending')?'running':items.some(i=>i.status==='conflict'||i.status==='failed')?'partial':'completed';
        const next:Batch={...batch,items,state};
        save(next); return view(next);
      });
    },
  };
}
