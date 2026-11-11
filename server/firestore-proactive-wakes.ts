import { z } from 'zod';
import { taskTimeZoneSchema } from '../src/shared/tasks.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { readContextBasis, selectHouseholdChanges, householdChangeSchema, type HouseholdChange } from './firestore-context-basis.ts';
import { domainParse, domainReject, firestoreDomainHash, FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firestoreBackgroundReference, firestoreBackgroundWorkSchema, prepareFirestoreBackgroundWork, type FirestoreBackgroundWork as Job } from './firestore-background-work.ts';
import { reminderLocalTime } from './task-policy.ts';
import type { ProactivePublicResult } from './firestore-proactive-public.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreNativePush } from './firestore-native-push.ts';
import type { WorkCoverageReader } from './firestore-work-followup.ts';
import type { WorkResource } from '../src/shared/agent-work.ts';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const policyView = z.object({enabled:z.boolean(),timeZone:taskTimeZoneSchema,version:revision}).strict();
const commandSchema = policyView.omit({version:true}).extend({expectedVersion:revision,opId:z.uuid()}).strict();
const scan = z.object({jobId:digest,revision,sinceRevision:revision.optional(),events:z.array(digest).max(8),
  householdIds:z.array(digest).max(8).optional(),householdChanged:z.boolean()}).strict();
const cueAuthority = {policyVersion:revision,generation:z.uuid(),authorizationVersion:z.string().min(1).max(128)};
export const proactiveCueSchema = scan.extend({...cueAuthority,basis:digest,userTurn:z.uuid().nullable(),state:z.enum(['pending','settled'])}).strict();
export const proactiveReservationSchema = z.object({id:digest,jobId:digest,...cueAuthority}).strict();
export const proactiveRevisitSchema = z.object({jobId:digest,opId:z.uuid(),policyVersion:revision,reason:z.string().max(240),kind:z.enum(['observation','important']),
  at:z.iso.datetime({offset:true}),revision,userTurn:z.uuid().nullable(),events:z.array(digest).max(8),
  householdChanges:z.array(householdChangeSchema).max(8).optional(),householdChangesComplete:z.boolean().optional()}).strict();
export const proactivePolicySchema = policyView.extend({lastRevision:revision,scan:scan.nullable()}).strict();
export const proactiveSettingReceiptSchema = z.object({opId:z.uuid(),fingerprint:digest,result:policyView}).strict();
export const proactiveAssessmentSchema = z.object({id:digest,opId:z.uuid(),outcome:z.enum(['no_action','contact','unknown']),
  contactedAt:z.iso.datetime().nullable(),repeated:z.boolean()}).strict();
const initial = {enabled:false,timeZone:'Asia/Hong_Kong',version:0,lastRevision:0,scan:null};
export async function readProactivePolicy(data: FirestoreDomainData,b: Binding) {
  if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || !await b.readChild(b.scope.childId)) domainReject('not_found',404);
  const id = JSON.stringify([b.actorUserId,b.scope.childId]), row = await b.transaction.get(data.ref('proactive_state','proactive-policy',id));
  return row.exists ? data.open('proactive-policy',id,b.scope,proactivePolicySchema,row) : {...initial};
}

/** First local 09:00 after today, including non-24-hour days. */
export function nextProactiveDay(at: string, zone: string) {
  const today = reminderLocalTime(at,zone).day;
  const tomorrow = new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  let low = Math.floor(Date.parse(at)/60000), high = low+49*60;
  while (high-low>1) {
    const mid = Math.floor((high+low)/2), local = reminderLocalTime(new Date(mid*60000).toISOString(),zone);
    if (local.day>tomorrow || local.day===tomorrow && local.minutes>=540) high=mid; else low=mid;
  }
  return new Date(high*60000).toISOString();
}
type SourceReader = (b: Binding) => Promise<Pick<ProactivePublicResult,'candidates'>>;
export interface ProactiveHouseholdAdapters {
  coverage?: WorkCoverageReader;
  readHouseholdChange?(binding: Binding, locator: HouseholdChange): Promise<boolean>;
}
export function createProactiveWakes(options: FirestoreDomainOptions, chat: FirestoreChatStore, publicEvents?:SourceReader,
  deliveries?:Pick<FirestoreNativePush,'readChatDeliveryStatuses'>, adapters: ProactiveHouseholdAdapters = {}) {
  const data = new FirestoreDomainData(options);
  const key = (b:Binding,...parts:string[]) => JSON.stringify([b.actorUserId,b.scope.childId,...parts]);
  const ref = (kind:string,id:string) => data.ref('proactive_state',kind,id);
  const read = (b:Binding) => readProactivePolicy(data,b);
  function save<T>(b:Binding,kind:string,id:string,schema:z.ZodType<T>,value:T) {
    b.transaction.set(ref(kind,id),{...data.tags(b.scope),...data.seal(kind,id,b.scope,schema,value)});
  }
  const view = (policy:z.infer<typeof proactivePolicySchema>) => ({enabled:policy.enabled,timeZone:policy.timeZone,version:policy.version});
  const workResource = (change: HouseholdChange): Pick<WorkResource, 'kind' | 'id'> | null =>
    change.domain === 'profile' || change.domain === 'memory_topic' ? null : { kind: change.domain, id: change.id };
  const householdAssessmentId = (change: HouseholdChange) => firestoreDomainHash(['household-change',change.revision,change.domain,change.id]);
  async function excludeWorkCoverage(b: Binding, readable: HouseholdChange[], candidates: ProactivePublicResult['candidates']) {
    const resources = readable.map(workResource).filter((value): value is NonNullable<typeof value> => value !== null);
    const sources = [...new Set(candidates.map(row => row.evidence.sourceId))];
    const coverage = resources.length || sources.length ? await adapters.coverage?.(b, { resources, knowledgeSourceIds: sources }) : undefined;
    const covered = new Set(coverage?.resources.map(value => value.kind + ':' + value.id) ?? []);
    const coveredSources = new Set(coverage?.knowledgeSourceIds ?? []);
    const complete = !resources.length && !sources.length || coverage?.complete === true;
    return { changes: readable.filter(change => !covered.has(change.domain + ':' + change.id) && (complete || !workResource(change))),
      deferred: readable.filter(change=>!complete && workResource(change) && !covered.has(change.domain+':'+change.id)),
      candidates: candidates.filter(row => complete && !coveredSources.has(row.evidence.sourceId)), complete };
  }
  async function householdBatch(b: Binding, context: Awaited<ReturnType<typeof readContextBasis>>, since: number, through: number,
    candidates: ProactivePublicResult['candidates']) {
    const selected = selectHouseholdChanges(context, since, through), readable: HouseholdChange[] = [];
    for (const change of selected.changes) if (await adapters.readHouseholdChange?.(b, change)) readable.push(change);
    const filtered = await excludeWorkCoverage(b,readable,candidates);
    const unassessed: HouseholdChange[]=[];
    for(const change of filtered.changes)if(!await assessment(b,householdAssessmentId(change)))unassessed.push(change);
    return { ...filtered,changes:unassessed,coverageComplete:filtered.complete,
      deferred:adapters.readHouseholdChange?filtered.deferred:selected.changes,logComplete: selected.complete,
      complete: filtered.complete && selected.complete && (!selected.changes.length || !!adapters.readHouseholdChange) };
  }
  async function schedule(b:Binding,version:number,zone:string,now:string) {
    const at = nextProactiveDay(now,zone);
    return prepareFirestoreBackgroundWork(data,b.transaction,{kind:'proactive-day',scope:b.scope,resourceId:b.scope.childId,
      generation:b.generation,authorizationVersion:b.authorizationVersion,basis:version + '/' + reminderLocalTime(at,zone).day},at);
  }
  async function configure(b:Binding,input:unknown) {
    const request = domainParse(commandSchema,input), id = key(b,request.opId), current = await read(b), fingerprint = firestoreDomainHash(request);
    const prior = await b.transaction.get(ref('proactive-setting-receipt',id));
    if (prior.exists) {
      const saved = data.open('proactive-setting-receipt',id,b.scope,proactiveSettingReceiptSchema,prior);
      if (saved.fingerprint !== fingerprint) domainReject('operation_conflict',409);
      return saved.result;
    }
    if (current.version !== request.expectedVersion) domainReject('version_conflict',409);
    const next = {enabled:request.enabled,timeZone:request.timeZone,version:current.version+1};
    const baseline = await readContextBasis(data,b);
    const job = next.enabled ? await schedule(b,next.version,next.timeZone,new Date().toISOString()) : null;
    const change = await b.prepareChange(request.opId,'preferences',false,b.scope.childId);
    save(b,'proactive-policy',key(b),proactivePolicySchema,{...next,lastRevision:baseline.proactiveRevision,scan:null});
    save(b,'proactive-setting-receipt',id,proactiveSettingReceiptSchema,{opId:request.opId,fingerprint,result:next});
    change.commit(); job?.commit(); return next;
  }
  async function assessment(b:Binding,id:string) {
    const address = key(b,id), row = await b.transaction.get(ref('proactive-assessment',address));
    return row.exists ? data.open('proactive-assessment',address,b.scope,proactiveAssessmentSchema,row) : null;
  }
  const valid = (b:Binding,job:Job) => job.generation===b.generation && job.authorizationVersion===b.authorizationVersion
    && firestoreDomainHash(b.scope)===firestoreDomainHash(job.scope) && job.resourceId===b.scope.childId;
  const currentAuthority = (b:Binding,policy:z.infer<typeof proactivePolicySchema>,value:z.infer<typeof proactiveReservationSchema> | z.infer<typeof proactiveCueSchema>) =>
    value.policyVersion===policy.version && value.generation===b.generation && value.authorizationVersion===b.authorizationVersion;
  async function reservation(b:Binding,id:string) {
    const address=key(b,id),row=await b.transaction.get(ref('proactive-reservation',address));
    const value=row.exists?data.open('proactive-reservation',address,b.scope,proactiveReservationSchema,row):null;
    if(value && value.id!==id)domainReject('proactive_binding',500);
    return value;
  }
  async function cue(b:Binding,id:string,policy:z.infer<typeof proactivePolicySchema>,context:Awaited<ReturnType<typeof readContextBasis>>,job?:Job) {
    const address=key(b,id),row=await b.transaction.get(ref('proactive-cue',address));
    if(row.exists) {
      const value=data.open('proactive-cue',address,b.scope,proactiveCueSchema,row);
      if(value.jobId!==id)domainReject('proactive_binding',500);
      if(value.state==='pending' && !job){
        const pending=await b.transaction.get(data.ref('background_work','background-work',id));
        if(!pending.exists)return null;
        const original=data.open('background-work',id,b.scope,firestoreBackgroundWorkSchema,pending);
        if(['completed','stopped','failed'].includes(original.state))return null;
      }
      return {value,legacy:false};
    }
    // A pre-upgrade scan keeps its original job and authority while acquiring a durable cue.
    if(policy.scan?.jobId!==id)return null;
    if(!job) {
      const original=await b.transaction.get(data.ref('background_work','background-work',id));
      if(!original.exists || Object.entries(data.tags(b.scope)).some(([name,value])=>original.get(name)!==value))return null;
      job=data.open('background-work',id,b.scope,firestoreBackgroundWorkSchema,original);
    }
    if(job.id!==id || job.kind!=='proactive-assessment' || job.basis.startsWith('revisit:') || !valid(b,job))return null;
    return {legacy:true,value:proactiveCueSchema.parse({...policy.scan,basis:job.basis,policyVersion:policy.version,generation:job.generation,
      authorizationVersion:job.authorizationVersion,userTurn:context.value.lastUserMessageId??null,state:'pending'})};
  }
  async function daily(b:Binding,job:Job,now:string) {
    const current = await read(b);
    if (!valid(b,job) || !current.enabled || job.kind!=='proactive-day'
      || job.basis!==current.version+'/'+reminderLocalTime(job.dueAt,current.timeZone).day || Date.parse(job.dueAt)>Date.parse(now)) return {state:'stopped' as const};
    const tomorrow = await schedule(b,current.version,current.timeZone,now);
    const context = await readContextBasis(data,b), publicPage = await publicEvents?.(b);
    const household = await householdBatch(b,context,current.lastRevision,context.proactiveRevision,publicPage?.candidates??[]);
    const availableEvents=new Set(household.candidates.map(row=>row.assessmentId));
    const cues=new Map<string,Awaited<ReturnType<typeof cue>>>(),reservations=new Map<string,Awaited<ReturnType<typeof reservation>>>();
    const getCue=async(id:string)=>{
      if(!cues.has(id))cues.set(id,await cue(b,id,current,context));
      return cues.get(id)!;
    };
    const getReservation=async(id:string)=>{
      if(!reservations.has(id))reservations.set(id,await reservation(b,id));
      return reservations.get(id)!;
    };
    const legacy=current.scan?await getCue(current.scan.jobId):null;
    const legacyReservations:z.infer<typeof proactiveReservationSchema>[]=[];
    if(legacy?.legacy)for(const id of legacy.value.events) {
      const prior=await getReservation(id);
      if(!prior || !currentAuthority(b,current,prior)) {
        const value={id,jobId:legacy.value.jobId,policyVersion:current.version,generation:b.generation,authorizationVersion:b.authorizationVersion};
        reservations.set(id,value);legacyReservations.push(value);
      }
    }
    const events:string[] = [];
    for (const row of household.candidates) {
      if(await assessment(b,row.assessmentId))continue;
      const held=await getReservation(row.assessmentId),owner=held?await getCue(held.jobId):null;
      if(held && owner && currentAuthority(b,current,held) && currentAuthority(b,current,owner.value)
        && owner.value.state==='pending' && owner.value.events.includes(row.assessmentId)
        && owner.value.events.every(id=>availableEvents.has(id))
        && owner.value.revision===context.proactiveRevision && owner.value.userTurn===(context.value.lastUserMessageId??null))continue;
      events.push(row.assessmentId);
    }
    const householdIds:string[]=[];
    for(const change of household.changes){
      const id=householdAssessmentId(change),held=await getReservation(id),owner=held?await getCue(held.jobId):null;
      if(held && owner && currentAuthority(b,current,held) && currentAuthority(b,current,owner.value)
        && owner.value.state==='pending' && owner.value.householdIds?.includes(id)
        && owner.value.revision===context.proactiveRevision && owner.value.userTurn===(context.value.lastUserMessageId??null))continue;
      householdIds.push(id);
    }
    const householdChanged = householdIds.length > 0 || !household.logComplete && household.coverageComplete && context.proactiveRevision!==current.lastRevision;
    const acknowledged = !household.logComplete && !household.coverageComplete ? current.lastRevision
      : household.deferred.length ? Math.min(context.proactiveRevision,...household.deferred.map(change=>change.revision-1)) : context.proactiveRevision;
    const basis=firestoreDomainHash([job.id,context.proactiveRevision,events]);
    const candidate = householdChanged || events.length ? await prepareFirestoreBackgroundWork(data,b.transaction,{kind:'proactive-assessment',scope:b.scope,
      generation:b.generation,authorizationVersion:b.authorizationVersion,resourceId:b.scope.childId,
      basis},now) : null;
    // Commit tomorrow independently of today's model availability. Replayed assessments keep their original identity.
    if(legacy?.legacy)save(b,'proactive-cue',key(b,legacy.value.jobId),proactiveCueSchema,legacy.value);
    for(const held of legacyReservations)if(!candidate || !events.includes(held.id))
      save(b,'proactive-reservation',key(b,held.id),proactiveReservationSchema,held);
    if (candidate) {
      const selected={jobId:candidate.id,revision:context.proactiveRevision,sinceRevision:current.lastRevision,householdIds,householdChanged,events};
      save(b,'proactive-cue',key(b,candidate.id),proactiveCueSchema,{...selected,basis,policyVersion:current.version,
        generation:b.generation,authorizationVersion:b.authorizationVersion,userTurn:context.value.lastUserMessageId??null,state:'pending'});
      for(const id of [...events,...householdIds])save(b,'proactive-reservation',key(b,id),proactiveReservationSchema,{id,jobId:candidate.id,
        policyVersion:current.version,generation:b.generation,authorizationVersion:b.authorizationVersion});
      save(b,'proactive-policy',key(b),proactivePolicySchema,{...current,lastRevision:acknowledged,scan:selected});
    } else if (current.lastRevision !== acknowledged)
      save(b,'proactive-policy',key(b),proactivePolicySchema,{...current,lastRevision:acknowledged});
    tomorrow.commit(); candidate?.commit(); return {state:'completed' as const};
  }
  async function input(b:Binding,job:Job) {
    const policy = await read(b);
    if(!valid(b,job) || job.kind!=='proactive-assessment' || !policy.enabled || Date.parse(job.dueAt)>Date.now())return null;
    const context = await readContextBasis(data,b);
    const revisitKey = key(b,job.id), revisitRef = ref('proactive-revisit',revisitKey);
    const revisitRow = job.basis.startsWith('revisit:') ? await b.transaction.get(revisitRef) : null;
    const revisit = revisitRow?.exists ? data.open('proactive-revisit',revisitKey,b.scope,proactiveRevisitSchema,revisitRow):null;
    if(job.basis.startsWith('revisit:') && !revisit)return null;
    if(revisit && (revisit.policyVersion!==policy.version || job.basis!=='revisit:'+revisit.opId)) return null;
    const stored=revisit?null:await cue(b,job.id,policy,context,job);
    const selected = revisit ? {...revisit,householdChanged:false} : stored?.value;
    if (!selected || selected.jobId!==job.id || context.proactiveRevision!==selected.revision) return null;
    if(stored && (!currentAuthority(b,policy,stored.value) || stored.value.state!=='pending' || stored.value.basis!==job.basis
      || stored.value.userTurn!==(context.value.lastUserMessageId??null)))return null;
    if(stored && !stored.legacy)for(const id of [...stored.value.events,...stored.value.householdIds??[]]) {
      const held=await reservation(b,id);
      if(!held || held.jobId!==job.id || !currentAuthority(b,policy,held))return null;
    }
    if (revisit) {
      if (Date.parse(revisit.at)>Date.now() || (context.value.lastUserMessageId??null)!==revisit.userTurn) return null;
      const original = await chat.getContact(b,'daily',revisit.opId);
      if (revisit.kind==='important' && (!original || original.seenAt)) return null;
      if (original && deliveries) {
        const statuses = await deliveries.readChatDeliveryStatuses(b,original.deliveryIds);
        if (statuses.length!==original.deliveryIds.length || statuses.some(item=>['queued','sending','unknown'].includes(item.status))) return null;
      }
    }
    const page = selected.events.length ? await publicEvents?.(b) : null;
    const events = (page?.candidates ?? []).filter(row=>selected.events.includes(row.assessmentId));
    if (events.length!==selected.events.length) return null;
    const revisitedChanges: HouseholdChange[] = [];
    for (const change of revisit?.householdChanges ?? []) if (await adapters.readHouseholdChange?.(b,change)) revisitedChanges.push(change);
    const revisited = revisit ? await excludeWorkCoverage(b,revisitedChanges,events) : null;
    const household = revisit ? { ...revisited!, complete: revisited!.complete && (revisit.householdChangesComplete ?? true), logComplete: true }
      : await householdBatch(b,context,stored!.value.sinceRevision ?? stored!.value.revision,selected.revision,events);
    if(!revisit && stored!.value.householdIds)household.changes=household.changes.filter(change=>stored!.value.householdIds!.includes(householdAssessmentId(change)));
    if (household.candidates.length !== events.length) return null;
    if(revisit?.householdChanges?.length && !household.changes.length && !events.length)return null;
    if (!revisit && selected.householdChanged && stored!.value.sinceRevision !== undefined && household.logComplete
      && !household.changes.length && !events.length) return null;
    return {eventType:revisit?'proactive_revisit':'proactive_daily',reason:revisit?.reason,householdChanged:selected.householdChanged,
      householdChanges:household.changes,householdChangesComplete:household.complete,
      publicEvents:events.map(({eventId,kind,evidence})=>({eventId,kind,sourceId:evidence.sourceId,chunkId:evidence.chunkId,
        versionId:evidence.versionId,title:evidence.title,section:evidence.section})),events,cue:selected,policy,revisit,storedCue:stored?.value??null,userTurn:context.value.lastUserMessageId??null};
  }
  async function settle(b:Binding,job:Job,result:ProductAgentResult|null) {
    const selected = await input(b,job);
    if (!selected) return {state:'stopped' as const};
    const opId = firestoreBackgroundReference(job), complete = result?.status==='completed';
    const contact = complete && result.outcome!=='no_action' && result.text.trim()
      ? await chat.prepareParentContact(b,{opId,origin:selected.revisit?'followup':'daily',text:result.text,runId:result.runId}) : null;
    const at = new Date().toISOString();
    const important = selected.events.filter(row=>['deadline','recall'].includes(row.kind) && result?.citations.some(c=>c.chunkId===row.evidence.chunkId));
    const proposed = complete && result.nextCheck && Date.parse(result.nextCheck.at)>Date.now() ? result.nextCheck : null;
    const publicContact = !!contact && selected.events.length > 0;
    const householdObservation = selected.householdChanges.length > 0;
    const next = selected.revisit ? null
      : proposed && (!publicContact || householdObservation) ? {...proposed,kind:'observation' as const}
      : contact && important.length ? {at:proposed?.at ?? nextProactiveDay(at,selected.policy.timeZone),reason:'仍有效且家長未查看的重要公告。核對後才考慮再提一次。',kind:'important' as const}:null;
    const jobNext = next ? await prepareFirestoreBackgroundWork(data,b.transaction,{kind:'proactive-assessment',scope:b.scope,
      generation:b.generation,authorizationVersion:b.authorizationVersion,resourceId:b.scope.childId,basis:'revisit:'+opId},next.at):null;
    const revisit = next && jobNext ? {...next,opId,jobId:jobNext.id,policyVersion:selected.policy.version,userTurn:selected.userTurn,revision:selected.cue.revision,
      events:(next.kind==='important'?important:publicContact?[]:selected.events).map(row=>row.assessmentId),
      ...(next.kind==='observation'?{householdChanges:selected.householdChanges,householdChangesComplete:selected.householdChangesComplete}:{})}:null;
    const previousAssessments = selected.revisit ? await Promise.all(selected.events.map(row=>assessment(b,row.assessmentId))) : [];
    if(!selected.revisit)for(const change of selected.householdChanges){
      const id=householdAssessmentId(change);
      save(b,'proactive-assessment',key(b,id),proactiveAssessmentSchema,{id,opId,
        outcome:contact?'contact':complete?'no_action':'unknown',contactedAt:contact?at:null,repeated:false});
    }
    for (const [index,row] of selected.events.entries()) {
      if (!selected.revisit) save(b,'proactive-assessment',key(b,row.assessmentId),proactiveAssessmentSchema,
        {id:row.assessmentId,opId,outcome:contact?'contact':complete?'no_action':'unknown',contactedAt:contact?at:null,repeated:false});
      else {
        // The follow-up slot is consumed by this original run, including no-action.
        const previous = previousAssessments[index];
        if (previous?.opId===selected.revisit.opId) save(b,'proactive-assessment',key(b,row.assessmentId),proactiveAssessmentSchema,{...previous,repeated:true});
      }
    }
    if (revisit) save(b,'proactive-revisit',key(b,revisit.jobId),proactiveRevisitSchema,revisit);
    if (selected.revisit) b.transaction.delete(ref('proactive-revisit',key(b,selected.revisit.jobId)));
    else {
      if(selected.storedCue)save(b,'proactive-cue',key(b,job.id),proactiveCueSchema,{...selected.storedCue,state:'settled'});
      if(selected.policy.scan?.jobId===job.id)save(b,'proactive-policy',key(b),proactivePolicySchema,{...selected.policy,scan:null});
    }
    jobNext?.commit();
    contact?.commit();
    return {state:complete?'completed' as const:result?.status==='stopped'?'stopped' as const:'unknown' as const};
  }
  return {read,view,configure,daily,input,settle};
}
