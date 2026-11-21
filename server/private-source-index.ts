import { randomUUID } from 'node:crypto';
import { AgentStopped } from './agent-budget.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { FirestoreDomainData, FirestoreDomainError, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { firestoreBackgroundReference, readFirestoreBackgroundClaim, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { createFirestoreSourceCardDocuments } from './firestore-source-card-documents.ts';
import type { SourceCardHead } from './source-card-document-record.ts';
import type { FirestoreModelRouting } from './firestore-model-routing.ts';
import type { createPrivateSourceModelSession, PrivateSourceModelSessionOptions } from './private-source-model-session.ts';
import { PRIVATE_INDEX_COLLECTION, PRIVATE_INDEX_FAMILY, privateIndexBasis, privateIndexId, privateIndexMetadata, privateIndexRecord,
  type PrivateIndexRecord, type PrivateProgress, type PrivateStageReceipt } from './private-source-index-record.ts';
import { privateReadingInput, privateWindow, parsePrivateDraft, parsePrivateVerdict } from './private-source-reading.ts';

type Documents = ReturnType<typeof createFirestoreSourceCardDocuments>;
export type OpenPrivateSession = (options: Omit<PrivateSourceModelSessionOptions,'routing'|'rootBudget'>) => ReturnType<typeof createPrivateSourceModelSession>;
const absent = () => domainReject('private_source_unavailable',404);
const proof = () => ({ organize:null, review:null, embed:null });
function bindingOf(b: Binding, head: SourceCardHead) {
  if (!head.rag || b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) return absent();
  return { cardId:head.cardId, documentId:head.documentId, version:head.version, incarnation:head.rag.incarnation,
    accessRevision:head.rag.accessRevision, grant:head.grant, generation:b.generation, authorizationVersion:b.authorizationVersion };
}
function initial(b: Binding, head: SourceCardHead): PrivateProgress {
  return { ...bindingOf(b,head), kind:'progress', ordinal:1, page:head.mimeType === 'application/pdf' ? 1 : null, offset:0,
    stage:'organize', next:null, facts:[], attempt:null, proof:proof(), ready:0, held:0, issue:null };
}
function source(head: SourceCardHead) {
  return { cardId:head.cardId,documentId:head.documentId,version:head.version,title:head.title,url:head.url };
}
export function createPrivateSourceIndex(options: {domain: FirestoreDomainOptions; documents: Documents; routing: FirestoreModelRouting;
  openSession: OpenPrivateSession; currentAuth: (owner:string) => Promise<{userId:string;disabled:boolean;emailVerified:boolean}> }) {
  const {documents,routing} = options, data = new FirestoreDomainData(options.domain);
  const ref = (id: string) => data.ref(PRIVATE_INDEX_COLLECTION,PRIVATE_INDEX_FAMILY,id);
  async function load(b: Binding, key: Parameters<typeof privateIndexId>[1]) {
    const id = privateIndexId(b.scope,key), snap = await b.transaction.get(ref(id));
    if (!snap.exists) return null;
    const row = data.open(PRIVATE_INDEX_FAMILY,id,b.scope,privateIndexRecord,snap);
    if (privateIndexId(b.scope,row) !== id || row.kind !== key.kind) domainReject('private_source_integrity',503);
    return row;
  }
  function save(b: Binding,row: PrivateIndexRecord) {
    const id = privateIndexId(b.scope,row);
    b.transaction.set(ref(id),{...data.tags(b.scope),...privateIndexMetadata(b.scope,row),...data.seal(PRIVATE_INDEX_FAMILY,id,b.scope,privateIndexRecord,row)});
  }
  async function progress(b: Binding,head: SourceCardHead) {
    const first = initial(b,head), row = await load(b,first);
    if (row && row.kind !== 'progress') return domainReject('private_source_integrity',503);
    return row ?? first;
  }
  async function identity(owner:string) {
    const auth = await options.currentAuth(owner);
    return auth.userId === owner && !auth.disabled && auth.emailVerified;
  }
  async function readPrivateEvidence(owner:string,cardId:string,documentId:string,version:string,page:number|null,offset:number,incarnation?:string) {
    if (!await identity(owner)) return absent();
    return documents.withIndexHead(owner,cardId,documentId,async (b,head) => {
      if (head.version !== version || incarnation !== undefined && head.rag?.incarnation !== incarnation) return absent();
      const row = await load(b,{...bindingOf(b,head),kind:'unit',page,offset});
      if (row?.kind !== 'unit') return absent();
      return {source:source(head),incarnation:row.incarnation,page:row.page,offset:row.offset,facts:row.facts};
    });
  }
  async function privateIndexStatus(owner:string,cardId:string,documentId:string) {
    if (!await identity(owner)) return absent();
    return documents.withIndexHead(owner,cardId,documentId,async (b,head) => {
      const row = await progress(b,head);
      return { source:source(head),stage:row.stage,attemptedStage:row.attempt?.stage ?? null,
        page:row.page,offset:row.offset,ready:row.ready,held:row.held,issue:row.issue };
    });
  }
  async function process(job:FirestoreBackgroundWork, signal:AbortSignal) {
    const stopped = {state:'stopped' as const}, completed = {state:'completed' as const};
    const defer = (ms = 2000) => ({state:'deferred' as const,nextAt:new Date(Date.now()+ms).toISOString()});
    if (job.kind !== 'source-card-index' || !job.lease || signal.aborted) return stopped;
    const [documentId,version,incarnation,accessRevision] = privateIndexBasis.parse(JSON.parse(job.basis));
    const owner = job.scope.ownerUserId, cardId = job.resourceId, reference = firestoreBackgroundReference(job), lease = job.lease.token;
    async function current<T>(fn:(b:Binding,head:SourceCardHead) => Promise<T>) {
      signal.throwIfAborted();
      return documents.withIndexHead(owner,cardId,documentId,async (b,head) => {
        const claim = await readFirestoreBackgroundClaim(data,b,reference,'source-card-index');
        if (claim?.id !== job.id || claim.lease?.token !== lease || head.version !== version || head.rag?.incarnation !== incarnation
          || head.rag.accessRevision !== accessRevision) return absent();
        signal.throwIfAborted();
        return fn(b,head);
      });
    }
    const authorize = async () => !signal.aborted && await identity(owner) && await current(async () => true);
    if (!await authorize()) return stopped;
    const start = await current(async (b,head) => {
      const row = await progress(b,head);
      if (!row.attempt && ['organize','review','embed'].includes(row.stage)) {
        const profile = await routing.readWorkerProfileIn(b);
        const issue = !profile.personal ? 'personal_source_key_required' : !profile.enabled ? 'background_model_disabled' : null;
        if (issue) {
          if (row.issue !== issue) save(b,{...row,issue});
          return {row,head,waiting:true};
        }
      }
      return {row,head,waiting:false};
    });
    if (start.waiting) return defer(900000);
    const row = start.row, stage = row.stage;
    if (stage === 'complete' || stage === 'unreadable') return completed;
    if (stage === 'unknown') return {state:'unknown' as const};
    if (row.attempt) {
      // A previous delivery may have reached the provider. Only its committed result can advance this cursor.
      await current(async (b,h) => {
        const prior = await progress(b,h);
        if (prior.attempt?.rootRunId === row.attempt?.rootRunId) save(b,{...prior,stage:'unknown',issue:'attempt_outcome_unknown'});
      });
      return {state:'unknown' as const};
    }
    const window = stage === 'embed' ? null : await privateWindow(documents,owner,cardId,documentId,version,row,signal);
    if (window && 'issue' in window) {
      await current(async (b,h) => {
        const prior = await progress(b,h);
        if (firestoreDomainHash(row) !== firestoreDomainHash(prior)) return;
        save(b,{...bindingOf(b,h),kind:'held',page:row.page,offset:row.offset,ordinal:row.ordinal,proof:row.proof,issue:window.issue});
        const { topic: _topic, ...unreadable } = row;
        save(b,{...unreadable,...window.next,stage:window.next ? 'organize' : 'unreadable',ordinal:row.ordinal+Number(!!window.next),
          held:row.held+1,issue:window.issue,attempt:null,next:null,facts:[],proof:proof()});
      });
      return window.next ? defer() : completed;
    }
    const attemptId = randomUUID();
    const admission = await current(async (b,h) => {
      const prior = await progress(b,h);
      if (firestoreDomainHash(prior) !== firestoreDomainHash(row)) return null;
      const profile = await routing.readWorkerProfileIn(b);
      if (!profile.personal) {
        save(b,{...row,issue:'personal_source_key_required'}); return {wait:'personal_source_key_required'} as const;
      }
      const capacity = profile.enabled && await routing.usage.personal.modelCapacity(b.transaction,owner,
        profile.selectedConfig.dailyUserAttempts,profile.selectedConfig.dailyGlobalAttempts);
      if (!capacity) {
        const issue = profile.enabled ? 'awaiting_daily_capacity' : 'background_model_disabled';
        save(b,{...row,issue}); return {wait:issue} as const;
      }
      const attempt = {rootRunId:attemptId,deadlineAtMs:Date.now()+profile.runLimits.deadlineMs,lease,stage,
        model:stage === 'embed' ? KNOWLEDGE_EMBEDDING.model : profile.selectedConfig.model,
        billingSource:profile.billingSource,settingsVersion:profile.settingsVersion};
      save(b,{...row,attempt,issue:null});
      return {attempt,profile} as const;
    });
    if (!admission) return defer();
    if ('wait' in admission) return defer(admission.wait === 'awaiting_daily_capacity' ? 3600000 : 900000);
    const {attempt,profile} = admission;
    async function commit(fn:(b:Binding,h:SourceCardHead) => void, requireProfile:boolean) {
      return current(async (b,h) => {
        const saved = await progress(b,h);
        if (saved.attempt?.rootRunId !== attempt.rootRunId || saved.stage !== stage) return false;
        if (requireProfile) {
          const p = await routing.readWorkerProfileIn(b);
          if (!p.enabled || p.settingsVersion !== profile.settingsVersion || p.billingSource !== profile.billingSource) {
            save(b,{...saved,stage:'unknown',issue:'model_authority_changed'}); return false;
          }
        }
        fn(b,h); return true;
      });
    }
    const completeUnit = (b:Binding,h:SourceCardHead,updated:PrivateProgress,result:{vector:number[]}|{issue:string}) => {
      const location = { ...bindingOf(b,h), page:row.page,offset:row.offset,ordinal:row.ordinal,proof:updated.proof };
      if ('vector' in result) {
        const { organize,review,embed } = updated.proof;
        if (!organize || !review || !embed) return domainReject('private_source_review_missing',503);
        save(b,{...location,kind:'unit',facts:updated.facts,vector:result.vector,embeddingModel:KNOWLEDGE_EMBEDDING.model,proof:{organize,review,embed}});
      } else save(b,{...location,kind:'held',issue:result.issue});
      const next = updated.next;
      const { topic: _topic, ...finished } = updated;
      save(b,{...finished,...(next ?? {}),next:null,stage:next ? 'organize' : 'complete',attempt:null,facts:[],proof:proof(),
        ordinal:row.ordinal+Number(!!next),ready:row.ready+Number('vector' in result),held:row.held+Number('issue' in result),issue:null});
    };
    let session: Awaited<ReturnType<OpenPrivateSession>> | undefined;
    let providerStarted = false;
    try {
      session = await options.openSession({owner,scope:job.scope,authorizationVersion:job.authorizationVersion,
        rootRunId:attempt.rootRunId,reference,signal,authorize,deadlineAtMs:attempt.deadlineAtMs});
      if (session.settingsVersion !== profile.settingsVersion || session.billingSource !== profile.billingSource) {
        await commit(b => save(b,{...row,attempt:null,issue:'model_settings_changed'}),false); return defer();
      }
      const receipt: PrivateStageReceipt = { rootRunId:attempt.rootRunId, model:stage === 'embed' ? KNOWLEDGE_EMBEDDING.model : session.model,
        billingSource:session.billingSource,settingsVersion:session.settingsVersion };
      const updated = {...row,issue:null,attempt:null,proof:{...row.proof,[stage]:receipt}};
      if (stage === 'embed') {
        const vector = await session.embed({task:'RETRIEVAL_DOCUMENT',title:start.head.title,text:row.facts.map(f=>f.text).join('\n')},'embedding:source-unit');
        if (!await commit((b,h)=>completeUnit(b,h,updated,{vector}),true)) return stopped;
      } else {
        if (!window || 'issue' in window) return absent();
        updated.next = window.next;
        const input = await privateReadingInput(stage,window,{page:row.page,offset:row.offset},row.facts,'model:source-'+stage,
          start.head.title, !start.head.rag?.topic, row.topic);
        const reply = await session.completeText({...input,onProviderStart:() => { providerStarted = true; }});
        let approved = false, topicSupported = false;
        try {
          if (stage === 'organize') {
            const draft = parsePrivateDraft(reply,window.text);
            updated.facts = draft.facts;
            delete updated.topic;
            if (draft.topic && !start.head.rag?.topic) updated.topic = draft.topic;
            approved = updated.facts.length > 0;
          } else {
            const verdict = parsePrivateVerdict(reply,row.facts.length);
            approved = verdict.factsSupported;
            topicSupported = verdict.topicSupported;
          }
        } catch { /* Malformed or unanchored observations are held with the original page. */ }
        if (!await commit((b,h) => {
          if (!approved) completeUnit(b,h,updated,{issue:stage === 'review' ? 'review_held' : 'no_verified_candidate'});
          else {
            if (stage === 'review' && topicSupported && row.topic && row.proof.organize)
              documents.saveReviewedTopicIn(b,h,{...row.topic,page:row.page,offset:row.offset,
                organizeRunId:row.proof.organize.rootRunId,reviewRunId:receipt.rootRunId});
            save(b,{...updated,stage:stage === 'organize' ? 'review' : 'embed'});
          }
        },true)) return stopped;
      }
      return defer();
    } catch (error) {
      // The transaction may already have advanced while the acknowledgement was lost.
      if (signal.aborted) throw error;
      const known = await current(async (b,h)=>progress(b,h));
      if (known.attempt?.rootRunId !== attempt.rootRunId) return defer();
      if (!session && error instanceof FirestoreDomainError && error.code === 'personal_source_key_required') {
        await commit(b=>save(b,{...row,attempt:null,issue:error.code}),false);
        return defer(900000);
      }
      if (error instanceof AgentStopped && !providerStarted && (error.reason === 'quota_exceeded' || error.reason === 'embedding_not_configured')) {
        const daily = error.reason === 'quota_exceeded';
        await commit(b=>save(b,{...row,attempt:null,issue:daily ? 'awaiting_daily_capacity' : 'embedding_not_configured'}),false);
        return defer(daily ? 3600000 : 900000);
      }
      await commit(b=>save(b,{...known,stage:'unknown',issue:'attempt_outcome_unknown'}),false);
      return {state:'unknown' as const};
    } finally { session?.close(); }
  }
  return {process,readPrivateEvidence,privateIndexStatus};
}
