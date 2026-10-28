import { AVATAR_CLEANUP_RETRY_MS } from './avatar-config.ts';
import { avatarCleanupRecordSchema } from './avatar-data.ts';
import type { FirestoreAvatarCleanup } from './firestore-avatar-cleanup.ts';
import { firestoreChatFileRowSchema, type FirestoreChatFilesStore } from './firestore-chat-files.ts';
import { firestoreVoiceRowSchema, type FirestoreVoiceStore } from './firestore-voice.ts';
import { firestoreAgentClaimSchema, firestoreAgentRunSchema } from './firestore-agent-runs.ts';
import { settleSummaryRequest, firestoreContextRecoverySchema } from './firestore-context-basis.ts';
import { createFirestoreContentErasure } from './firestore-content-erasure.ts';
import type { FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import { randomUUID } from 'node:crypto';
import { FieldPath, type DocumentSnapshot, type Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, FIRESTORE_TASK_DISPATCH_SCOPE as SYSTEM, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { prepareFirestoreBackgroundWork, preparePhotoCleanupWake, prepareObjectCleanupWake, firestoreBackgroundReference, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { firestoreFamilyDocumentSchemas } from './firestore-family-documents.ts';
import { firestoreWorkWatchSchema } from './firestore-work-followup.ts';
import { firestorePhotoSchemas, type createFirestorePhotoStore } from './firestore-photos.ts';
import { firestoreScopeErasureSchema, type FirestoreErasureStore } from './firestore-erasure.ts';
import type { createFirestoreErasureCleanup } from './firestore-erasure-cleanup.ts';
import type { FirestoreKnowledgeRefresh } from './firestore-knowledge-refresh.ts';
import { createKnowledgeSourceFetcher } from './knowledge-source-fetch.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firestoreHandoverJobSchema, assertHandoverJobIdentity } from './firestore-handover-jobs.ts';
import type { createHandoverService } from './handover-service.ts';

const stages = ['documents', 'work_watches', 'photo_cleanup', 'erasures', 'content_erasures', 'context_versions', 'voice_assets', 'chat_file_assets', 'avatar_cleanup', 'handover_exports'] as const;
const cursorSchema = z.object({ after: z.record(z.string(), z.string().nullable()), complete: z.array(z.string()),
  minute: z.number().int(), token: z.uuid().nullable(), until: z.number().int().nonnegative() }).strict();
const empty = () => ({ after: {} as Record<string, string | null>, complete: [] as string[], minute: -1, token: null as string | null, until: 0 });
export const firestoreMaintenanceRecoverySchema = cursorSchema;
const knowledgePeriod = (weekly: boolean, now = Date.now()) => {
  const local = new Date(now + 8 * 3600_000), at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 1);
  let start = at <= now ? at : at - 86400_000;
  if (weekly) { const day = new Date(start + 8 * 3600_000).getUTCDay(); start -= ((day + 6) % 7) * 86400_000; }
  return new Date(start).toISOString();
};

/** One Scheduler wake reconciles bounded pages. No interval, source model, private context, or provider send lives here. */
export function createFirestoreBackgroundMaintenance(options: FirestoreDomainOptions & {
  journal?: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'>;
  avatars?: Pick<FirestoreAvatarCleanup, 'process'>;
  voices?: Pick<FirestoreVoiceStore, 'cleanupDeleted' | 'expireUnlinked'>;
  files?: Pick<FirestoreChatFilesStore, 'cleanupDeleted' | 'expireUnlinked'>;
  handover?: Pick<ReturnType<typeof createHandoverService>, 'cleanup'>;
  enabled: boolean; knowledge: FirestoreKnowledgeRefresh;
  photos: Pick<ReturnType<typeof createFirestorePhotoStore>, 'cleanupDeleted'>;
  erasures: FirestoreErasureStore; cleanup: ReturnType<typeof createFirestoreErasureCleanup>;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), fetcher = createKnowledgeSourceFetcher();
  function open<T>(row: DocumentSnapshot, kind: string, schema: z.ZodType<T>) {
    const raw = row.data(); if (!raw) domainReject('maintenance_binding', 500);
    const context = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } }).context;
    if (context.kind !== kind || row.id !== firestoreDomainHash([kind, context.id])) domainReject('maintenance_binding', 500);
    return { scope: context.scope, id: context.id, value: data.open(kind, context.id, context.scope, schema, row) };
  }
  const stateRef = (id: string) => data.ref('maintenance_state', 'maintenance-state', id);
  const stateEnvelope = (id: string, scope: WorkRecoveryScope, value: z.infer<typeof cursorSchema>) =>
    ({ ...data.tags(scope), ...data.seal('maintenance-state', id, scope, cursorSchema, value) });
  async function queueRow(stage: typeof stages[number], row: DocumentSnapshot, basis: string, known?: Binding) {
    if (stage === 'handover_exports') {
      const info = open(row, 'handover-export', firestoreHandoverJobSchema), job = info.value;
      assertHandoverJobIdentity(job, info.scope, info.id, row.data()!.recordVersion);
      if (job.cleaned || !['cancelled', 'expired'].includes(job.state) && Date.parse(job.expiresAt) > Date.now()) return;
      await options.database.runTransaction(async tx => {
        const control = await authority.readControl(tx); if (!options.enabled || !control.enabled) return;
        const fresh = await tx.get(row.ref); if (!fresh.exists || firestoreDomainHash(fresh.data()) !== firestoreDomainHash(row.data())) return;
        const identity = { kind: 'handover-cleanup' as const, scope: SYSTEM, resourceId: row.id, basis: firestoreDomainHash(info.id),
          generation: control.generation, authorizationVersion: '0' };
        const wake = job.artifact ? await prepareObjectCleanupWake(data, tx, identity, firestoreDomainHash(job.artifact)) : () => {};
        const work = await prepareFirestoreBackgroundWork(data, tx, identity, new Date().toISOString()); work.commit(); wake();
      });
      return;
    }
    if (stage === 'context_versions') {
      const info = open(row, 'context-version', firestoreContextRecoverySchema), value = info.value;
      if (!value.summaryPending || !value.summaryRequest || Date.parse(value.summaryAfter ?? '') > Date.now()) return;
      try { await authority.runTransaction(info.scope.ownerUserId, info.scope.childId, async b => {
        if (!options.enabled || !(await authority.readControl(b.transaction)).enabled || firestoreDomainHash(info.scope) !== firestoreDomainHash(b.scope)) return;
        const fresh = await b.transaction.get(row.ref); if (!fresh.exists || firestoreDomainHash(fresh.data()) !== firestoreDomainHash(row.data())) return;
        if (value.summaryBlocked) {
          if (!value.summaryBlockedReference) return;
          const key = JSON.stringify([b.scope.ownerUserId, b.scope.childId, 'worker', value.summaryBlockedReference]);
          const pointer = await b.transaction.get(data.ref('agent_claims', 'agent-claim', key)); if (!pointer.exists) return;
          const claim = data.open('agent-claim', key, b.scope, firestoreAgentClaimSchema, pointer);
          const runRow = await b.transaction.get(data.ref('agent_runs', 'agent-run', claim.runId)); if (!runRow.exists) return;
          const run = data.open('agent-run', claim.runId, b.scope, firestoreAgentRunSchema, runRow);
          if (run.recipeId === 'memory-refresh' && run.trigger.reference === value.summaryBlockedReference && run.state === 'completed' && run.result?.outcome === 'no_action')
            await settleSummaryRequest(data, b, value.summaryRequest!, 'more');
          return; // Missing/stopped/unknown is never permission to repeat a model attempt.
        }
        const queued = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'memory-refresh', scope: b.scope, resourceId: b.scope.childId,
          basis: String(value.summaryRequest), generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date().toISOString());
        queued.commit();
      }); } catch (error) { if (!error || typeof error !== 'object' || !('status' in error) || ![403, 404, 409].includes(Number(error.status))) throw error; }
      return;
    }
    if (stage === 'avatar_cleanup') {
      const info = open(row, 'avatar-cleanup', avatarCleanupRecordSchema), cleanup = info.value;
      if (cleanup.state === 'complete' || cleanup.reason === 'staging' && cleanup.committedVersion !== null
        || Date.parse(cleanup.nextAttemptAt) > Date.now()) return;
      await options.database.runTransaction(async tx => {
        const control = await authority.readControl(tx); if (!options.enabled || !control.enabled) return;
        const fresh = await tx.get(row.ref); if (!fresh.exists || firestoreDomainHash(fresh.data()) !== firestoreDomainHash(row.data())) return;
        const identity = { kind: 'avatar-cleanup' as const, scope: SYSTEM, resourceId: row.id, basis: firestoreDomainHash(info.id),
          generation: control.generation, authorizationVersion: '0' };
        const wake = cleanup.descriptor ? await prepareObjectCleanupWake(data, tx, identity,
          firestoreDomainHash([cleanup.descriptor, cleanup.reason, cleanup.committedVersion]), { avatarLifecycle: true }) : () => {};
        const work = await prepareFirestoreBackgroundWork(data, tx, identity, new Date().toISOString()); work.commit(); wake();
      });
      return;
    }
    if (stage === 'voice_assets') {
      const info=open(row,'voice-asset',firestoreVoiceRowSchema), voice=info.value;
      if(voice.deletion ? voice.deletion.cleanup!=='pending'||Date.parse(voice.deletion.nextCheckAt??'')>Date.now()
        : voice.messageId!==null||Date.parse(voice.createdAt)+86400_000>Date.now())return;
      await options.database.runTransaction(async tx=>{
        const control=await authority.readControl(tx);if(!options.enabled||!control.enabled)return;
        const fresh=await tx.get(row.ref);if(!fresh.exists||firestoreDomainHash(fresh.data())!==firestoreDomainHash(row.data()))return;
        const identity={kind:'voice-cleanup' as const,scope:SYSTEM,resourceId:row.id,basis:firestoreDomainHash([info.id,voice.deletion?'delete':'expiry']),generation:control.generation,authorizationVersion:'0'};
        const wake=voice.descriptor?await prepareObjectCleanupWake(data,tx,identity,firestoreDomainHash(voice.descriptor)):()=>{};
        const work=await prepareFirestoreBackgroundWork(data,tx,identity,new Date().toISOString());work.commit();wake();
      });return;
    }
    if (stage === 'chat_file_assets') {
      const info=open(row,'chat-file-asset',firestoreChatFileRowSchema), file=info.value;
      if(file.deletion ? file.deletion.cleanup!=='pending'||Date.parse(file.deletion.nextCheckAt??'')>Date.now()
        : file.messageId!==null||Date.parse(file.createdAt)+86400_000>Date.now())return;
      await options.database.runTransaction(async tx=>{
        const control=await authority.readControl(tx);if(!options.enabled||!control.enabled)return;
        const fresh=await tx.get(row.ref);if(!fresh.exists||firestoreDomainHash(fresh.data())!==firestoreDomainHash(row.data()))return;
        const identity={kind:'file-cleanup' as const,scope:SYSTEM,resourceId:row.id,basis:firestoreDomainHash([info.id,file.deletion?'delete':'expiry']),generation:control.generation,authorizationVersion:'0'};
        const wake=file.descriptor?await prepareObjectCleanupWake(data,tx,identity,firestoreDomainHash(file.descriptor)):()=>{};
        const work=await prepareFirestoreBackgroundWork(data,tx,identity,new Date().toISOString());work.commit();wake();
      });return;
    }
    if (stage === 'erasures' || stage === 'photo_cleanup') {
      const info = stage === 'erasures' ? open(row, 'scope-erasure', firestoreScopeErasureSchema) : open(row, 'photo-cleanup', firestorePhotoSchemas.cleanup);
      const target = stage === 'erasures' ? firestoreScopeErasureSchema.parse(info.value).state : 'cleanup';
      if (!['requested', 'blocked', 'cleaning', 'cleanup'].includes(target)) return;
      await options.database.runTransaction(async tx => {
        const control = await authority.readControl(tx); if (!options.enabled || !control.enabled) return;
        const fresh = await tx.get(row.ref); if (!fresh.exists || firestoreDomainHash(fresh.data()) !== firestoreDomainHash(row.data())) return;
        const identity = { kind: stage === 'erasures' ? 'scope-erasure' as const : 'photo-cleanup' as const, scope: SYSTEM,
          resourceId: row.id, basis: firestoreDomainHash(info.id), generation: control.generation, authorizationVersion: '0' };
        const wake = stage === 'photo_cleanup' && firestorePhotoSchemas.cleanup.parse(info.value).state === 'known'
          ? await preparePhotoCleanupWake(data, tx, identity, firestoreDomainHash(firestorePhotoSchemas.cleanup.parse(info.value).descriptor)) : () => {};
        const work = await prepareFirestoreBackgroundWork(data, tx, identity, new Date().toISOString()); work.commit(); wake();
      });
      return;
    }
    const info = stage === 'documents' ? open(row, 'family-document', firestoreFamilyDocumentSchemas.metadata) : open(row, 'work-watch', firestoreWorkWatchSchema);
    const eligible = stage === 'documents' ? (() => { const v = firestoreFamilyDocumentSchemas.metadata.parse(info.value); return v.autoRefresh && v.status === 'active' && !v.progress?.blocked; })()
      : firestoreWorkWatchSchema.parse(info.value).enabled;
    if (!eligible) return;
    const prepare = async (b: Binding) => {
      if (!options.enabled || !(await authority.readControl(b.transaction)).enabled || firestoreDomainHash(info.scope) !== firestoreDomainHash(b.scope)) return;
      const fresh = await b.transaction.get(row.ref); if (!fresh.exists || firestoreDomainHash(fresh.data()) !== firestoreDomainHash(row.data())) return;
      const work = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: stage === 'documents' ? 'document-refresh' : 'work-check', scope: b.scope,
        resourceId: info.id, basis, generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date().toISOString()); work.commit();
    };
    if (known) await prepare(known);
    else try { await authority.runTransaction(info.scope.ownerUserId, info.scope.childId, prepare); }
    catch (error) { if (!error || typeof error !== 'object' || !('status' in error) || ![403, 404, 409].includes(Number(error.status))) throw error; }
  }
  async function tick() {
    if (!options.enabled) return 0;
    const id = 'global', ref = stateRef(id), token = randomUUID(), minute = Math.floor(Date.now() / 60000);
    const state = await options.database.runTransaction(async tx => {
      if (!(await authority.readControl(tx)).enabled) return null;
      const row = await tx.get(ref), value = row.exists ? data.open('maintenance-state', id, SYSTEM, cursorSchema, row) : empty();
      if (value.minute >= minute || value.until > Date.now()) return null;
      value.token = token; value.until = Date.now() + 120000; tx.set(ref, stateEnvelope(id, SYSTEM, value)); return value;
    });
    if (!state) return 0;
    let scanned = 0;
    // One bounded pass upgrades pre-R01 tombstones; normal writers enqueue their own barriers.
    if (options.journal) for (const suffix of ['care_records', 'child_profiles', 'memory_facts', 'memory_topics']) {
      const key = 'content-backfill:' + suffix; if (state.complete.includes(key)) continue;
      let q: Query = data.collection(suffix).orderBy(FieldPath.documentId()).limit(5);
      if (state.after[key]) q = q.startAfter(state.after[key]);
      const rows = await q.get();
      for (const row of rows.docs) await createFirestoreContentErasure({ ...options, journal: options.journal }).backfill(row);
      state.after[key] = rows.docs.at(-1)?.id ?? null; if (rows.size < 5) state.complete.push(key); scanned += rows.size;
    }
    for (const stage of stages) {
      let q: Query = data.collection(stage).orderBy(FieldPath.documentId()).limit(5);
      if (stage === 'voice_assets' || stage === 'chat_file_assets') q = q.where('cleanupState','in',['pending','unlinked']);
      if (stage === 'avatar_cleanup') q = q.where('complete', '==', false);
      if (stage === 'handover_exports') q = q.where('cleaned', '==', false);
      if (stage === 'content_erasures') q = q.where('stage', 'in', ['revisions', 'receipts']);
      if (stage === 'context_versions') q = q.where('summaryPending', '==', true);
      if (stage === 'work_watches') q = q.where('enabled', '==', true);
      if (stage === 'erasures') q = q.where('state', 'in', ['requested', 'blocked', 'cleaning']);
      if (state.after[stage]) q = q.startAfter(state.after[stage]);
      const rows = await q.get();
      for (const row of rows.docs) {
        if (stage === 'content_erasures') {
          if (!options.journal) domainReject('content_journal_unavailable', 503);
          await createFirestoreContentErasure({ ...options, journal: options.journal }).advance(row); scanned++; continue;
        }
        const basis = stage === 'documents' ? 'hour:' + Math.floor(Date.now() / 3600000)
          : stage === 'work_watches' ? (() => { const watch = open(row, 'work-watch', firestoreWorkWatchSchema).value;
            return Date.parse(watch.nextCheckAt) <= Date.now() ? 'check:' + watch.workVersion + ':' + watch.nextCheckAt : null; })() : '';
        if (basis !== null) await queueRow(stage, row, basis); scanned++;
      }
      state.after[stage] = rows.size === 5 ? rows.docs.at(-1)!.id : null;
    }
    // Reuse the reviewed weekly/daily source schedule, including one missed occurrence, without downloading in the dispatcher.
    for (const entry of await options.knowledge.jobs()) {
      const slot = knowledgePeriod(entry.definition.classification === 'official_guidance');
      if (slot < entry.registeredAt) continue;
      await options.database.runTransaction(async tx => {
        const control = await authority.readControl(tx); if (!control.enabled || control.generation !== entry.data.workerGeneration) return;
        const queued = await prepareFirestoreBackgroundWork(data, tx, { kind: 'knowledge-check', scope: SYSTEM, resourceId: entry.definition.id,
          basis: entry.data.revision + ':' + slot, generation: control.generation, authorizationVersion: '0' }, new Date().toISOString()); queued.commit();
      });
    }
    await options.database.runTransaction(async tx => {
      const row = await tx.get(ref), current = data.open('maintenance-state', id, SYSTEM, cursorSchema, row);
      if (current.token !== token) domainReject('maintenance_lease_changed');
      tx.set(ref, stateEnvelope(id, SYSTEM, { ...state, minute, token: null, until: 0 }));
    });
    return scanned;
  }
  async function childChange(job: FirestoreBackgroundWork) {
    if (job.kind !== 'child-change') domainReject('invalid_scope', 400);
    const id = job.id, ref = stateRef(id), prior = await ref.get();
    const state = prior.exists ? data.open('maintenance-state', id, job.scope, cursorSchema, prior) : empty();
    for (const stage of ['documents', 'work_watches'] as const) {
      if (state.complete.includes(stage)) continue;
      let q: Query = data.collection(stage).orderBy(FieldPath.documentId()).limit(5);
      for (const [key, value] of Object.entries(data.tags(job.scope))) q = q.where(key, '==', value);
      if (state.after[stage]) q = q.startAfter(state.after[stage]);
      const rows = await q.get();
      for (const row of rows.docs) await queueRow(stage, row, 'change:' + job.id);
      state.after[stage] = rows.docs.at(-1)?.id ?? null; if (rows.size < 5) state.complete.push(stage);
    }
    await authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
      if (b.generation !== job.generation || b.authorizationVersion !== job.authorizationVersion || firestoreDomainHash(b.scope) !== firestoreDomainHash(job.scope)) domainReject('maintenance_scope_changed');
      b.transaction.set(ref, stateEnvelope(id, job.scope, state));
    });
    return state.complete.length === 2 ? { state: 'completed' as const } : { state: 'deferred' as const, nextAt: new Date(Date.now() + 1000).toISOString() };
  }
  async function process(job: FirestoreBackgroundWork, signal: AbortSignal) {
    if (firestoreDomainHash(job.scope) !== firestoreDomainHash(SYSTEM)) domainReject('maintenance_scope_changed');
    const control = await authority.readControl();
    if (!options.enabled || !control.enabled || job.generation !== control.generation || signal.aborted) return { state: 'stopped' as const };
    if (job.kind === 'handover-cleanup') {
      if (!options.handover) domainReject('package_service_unavailable', 503);
      const row = await data.collection('handover_exports').doc(job.resourceId).get();
      if (!row.exists) return { state: 'completed' as const };
      const info = open(row, 'handover-export', firestoreHandoverJobSchema);
      assertHandoverJobIdentity(info.value, info.scope, info.id, row.data()!.recordVersion);
      if (job.basis !== firestoreDomainHash(info.id)) domainReject('maintenance_binding', 500);
      const result = await options.handover.cleanup(info.scope, info.value.id, signal).catch(() => ({ state: 'unknown' as const }));
      return result.state === 'unknown' && job.attempts < 3
        ? { state: 'deferred' as const, nextAt: new Date(Date.now() + 60000).toISOString() } : result;
    }
    if (job.kind === 'knowledge-check') {
      const revision = job.basis.slice(0, 36), result = await options.knowledge.process({ watchId: job.resourceId, revision, workerGeneration: job.generation },
        firestoreBackgroundReference(job), fetcher, signal);
      return { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
    }
    if (job.kind === 'avatar-cleanup') {
      if (!options.avatars) domainReject('avatar_unavailable', 503);
      const row = await data.collection('avatar_cleanup').doc(job.resourceId).get();
      if (!row.exists) return { state: 'completed' as const };
      const value = open(row, 'avatar-cleanup', avatarCleanupRecordSchema).value;
      const result = await options.avatars.process(value.binding, value.assetId);
      if (result.state === 'complete') return { state: 'completed' as const };
      if (result.nextAt) return { state: 'deferred' as const,
        nextAt: new Date(Math.max(Date.parse(result.nextAt), Date.now() + AVATAR_CLEANUP_RETRY_MS)).toISOString() };
      // Retained current content is not a deleted object. A later due non-current responsibility
      // must carry fresh descriptor+reason/version evidence through the avatar-only wake above.
      return { state: result.state === 'retained' ? 'completed' as const : 'unknown' as const };
    }
    if (job.kind === 'voice-cleanup') {
      if(!options.voices)domainReject('voice_cleanup_unavailable',503);
      const row=await data.collection('voice_assets').doc(job.resourceId).get();if(!row.exists)return{state:'completed' as const};
      const voice=open(row,'voice-asset',firestoreVoiceRowSchema).value;
      if(!voice.deletion && !await options.voices.expireUnlinked(voice.scope,voice.id))return {state:'completed' as const};
      const result=await options.voices.cleanupDeleted(voice.scope,voice.id);
      if(result.state==='complete')return{state:'completed' as const};
      const fresh=await row.ref.get();if(!fresh.exists)return{state:'completed' as const};
      const pending=open(fresh,'voice-asset',firestoreVoiceRowSchema).value.deletion!;
      return pending.cleanup==='blocked'?{state:'unknown' as const}
        :{state:'deferred' as const,nextAt:pending.nextCheckAt&&Date.parse(pending.nextCheckAt)>Date.now()?pending.nextCheckAt:new Date(Date.now()+60000).toISOString()};
    }
    if (job.kind === 'file-cleanup') {
      if(!options.files)domainReject('chat_file_cleanup_unavailable',503);
      const row=await data.collection('chat_file_assets').doc(job.resourceId).get();if(!row.exists)return{state:'completed' as const};
      const file=open(row,'chat-file-asset',firestoreChatFileRowSchema).value;
      if(!file.deletion && !await options.files.expireUnlinked(file.scope,file.id))return {state:'completed' as const};
      const result=await options.files.cleanupDeleted(file.scope,file.id);
      if(result.state==='complete')return{state:'completed' as const};
      const fresh=await row.ref.get();if(!fresh.exists)return{state:'completed' as const};
      const pending=open(fresh,'chat-file-asset',firestoreChatFileRowSchema).value.deletion!;
      return pending.cleanup==='blocked'?{state:'unknown' as const}
        :{state:'deferred' as const,nextAt:pending.nextCheckAt&&Date.parse(pending.nextCheckAt)>Date.now()?pending.nextCheckAt:new Date(Date.now()+60000).toISOString()};
    }
    if (job.kind === 'photo-cleanup') {
      const row = await data.collection('photo_cleanup').doc(job.resourceId).get(); if (!row.exists) return { state: 'completed' as const };
      const { value } = open(row, 'photo-cleanup', firestorePhotoSchemas.cleanup);
      const result = await options.photos.cleanupDeleted(value.scope, value.photoId, value.operationId);
      // Unresolved object absence stays visible for reconciliation, never a successful deletion.
      if (result.state === 'complete') return { state: 'completed' as const };
      const latest = await row.ref.get();
      if (!latest.exists) return { state: 'completed' as const };
      const pending = open(latest, 'photo-cleanup', firestorePhotoSchemas.cleanup).value;
      return pending.state === 'known' || job.attempts < 3
        ? { state: 'deferred' as const, nextAt: new Date(Date.now() + 60_000 * Math.max(1, job.attempts)).toISOString() }
        : { state: 'unknown' as const };
    }
    if (job.kind !== 'scope-erasure') domainReject('invalid_scope', 400);
    const row = await data.collection('erasures').doc(job.resourceId).get(); if (!row.exists) domainReject('erasure_binding', 500);
    let value = open(row, 'scope-erasure', firestoreScopeErasureSchema).value;
    if (value.state === 'requested') { await options.erasures.resumeRequested(value); value = (await options.database.runTransaction(tx => options.erasures.read(tx, value.intent.scope.ownerUserId, value.intent.operationId)))!; }
    const start = Date.now();
    for (let pages = 0; pages < 8 && Date.now() - start < 45000 && !signal.aborted; pages++) {
      const previous = value.cleanup, result = await options.cleanup.advance(value.intent.scope.ownerUserId, value.intent.operationId);
      if (result.state === 'completed') return { state: 'completed' as const };
      value = (await options.database.runTransaction(tx => options.erasures.read(tx, value.intent.scope.ownerUserId, value.intent.operationId)))!;
      if (firestoreDomainHash(previous) === firestoreDomainHash(value.cleanup)) break;
    }
    return { state: 'deferred' as const, nextAt: new Date(Date.now() + 60000).toISOString() };
  }
  return { tick, childChange, process };
}
