import { discloseAvatarReceipt } from './avatar-receipt-disclosure.ts';
import { firestorePhotoSchemas } from './firestore-photos.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { sharedDomainRoute } from './shared-domain-routing.ts';
import { sharedTaskPointerSchema, readSharedTaskResult } from './firestore-task-records.ts';
import { createFirestoreCareStore } from './firestore-care.ts';
import { createFirestoreChatStore } from './firestore-chat.ts';
import { createFirestoreMemoryStore } from './firestore-memory.ts';
import { contentPointerSchema, contentResult, contentVisible, readContentPointer } from './firestore-disclosure.ts';
import { z } from "zod";
import type { OnlineReceipt, OnlineSubmission } from "../src/shared/online.ts";
import type { FirestoreAuthorityTransaction } from "./firestore-authority.ts";
import type { WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import { onlineIdentitySchema } from "./online-routing.ts";
import { createFirestoreSharedInputStore } from './firestore-shared-inputs.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreChangeSchema,
  type FirestoreDomainOptions } from "./firestore-domain-data.ts";

const NIL = "00000000-0000-0000-0000-000000000000";
const identity = { ownerUserId: z.string().min(1).max(256), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  childId: z.uuid().nullable(), path: z.string().max(256), operation: onlineIdentitySchema, restoredFromEpoch: z.uuid().optional() };
// Restoration provenance stays internal; the existing v1 envelope/AAD and wire receipt remain unchanged.
export const firestoreOnlineConfirmedSchema = z.object({ ...identity, changeSeq: firestoreChangeSchema.shape.changeSeq,
  statusCode: z.union([z.literal(200), z.literal(201)]), result: z.unknown() }).strict();
export const firestoreOnlinePendingSchema = z.object({ ...identity, state: z.literal("pending") }).strict();
export const firestoreOnlineRecordSchema = z.union([firestoreOnlineConfirmedSchema, firestoreOnlinePendingSchema]);
export const firestoreOnlineErasureBarrierSchema = z.object({ state: z.literal("erasure_barrier"), ownerUserId: z.string().min(1).max(256),
  operationId: z.uuid(), childId: z.uuid(), assetId: z.uuid(), intentSha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const storedRecordSchema = z.union([firestoreOnlineRecordSchema, firestoreOnlineErasureBarrierSchema]);
const privateInputPointerSchema = z.object({ format: z.literal('private-input-receipt:1'), id: z.uuid(), version: z.number().int().positive(),
  recordId: z.uuid().optional() }).strict();
export const firestoreSharedResultSchema = z.object({ format: z.literal('shared-domain-receipt:1'), spaceId: z.uuid(), childId: z.uuid(),
  module: z.enum(['care', 'profile', 'tasks', 'memory', 'attachments']), result: z.union([contentPointerSchema, sharedTaskPointerSchema,
    z.object({format:z.literal('shared-photo-deletion:1'),id:z.uuid(),version:z.number().int().positive()}).strict(),
    z.object({ deleted: z.literal(true) }).strict()]) }).strict();
export type FirestoreOnlineConfirmed = z.infer<typeof firestoreOnlineConfirmedSchema>;
export type FirestoreOnlinePending = z.infer<typeof firestoreOnlinePendingSchema>;
export type FirestoreOnlineRecord = z.infer<typeof firestoreOnlineRecordSchema>;
export const isFirestoreOnlinePending = (record: FirestoreOnlineRecord): record is FirestoreOnlinePending => "state" in record;
export const firestoreOnlineFingerprint = (submission: OnlineSubmission) =>
  firestoreDomainHash({ path: submission.path, payload: submission.payload, operation: submission.operation,
    ...(submission.sharing ? { sharing: submission.sharing } : {}) });

/** Shared owner-wide original-operation ledger; callers supply only canonical transaction bindings. */
export function createFirestoreOnlineReceipts(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options);
  const scopeFor = (binding: FirestoreAuthorityTransaction): WorkRecoveryScope => ({ ...binding.scope, childId: NIL });
  const idFor = (owner: string, opId: string) => JSON.stringify([owner, opId]);
  function assertCurrent(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission) {
    if (submission.operation.workspaceId !== binding.scope.workspaceId || submission.operation.storageEpoch !== binding.scope.storageEpoch)
      domainReject("storage_epoch_changed");
  }
  function assertSame(binding: FirestoreAuthorityTransaction, record: FirestoreOnlineRecord, submission: OnlineSubmission) {
    if (record.fingerprint !== firestoreOnlineFingerprint(submission)) domainReject("operation_conflict");
    if (record.operation.workspaceId !== binding.scope.workspaceId || submission.operation.workspaceId !== binding.scope.workspaceId) domainReject("storage_epoch_changed");
    if (record.restoredFromEpoch === undefined) assertCurrent(binding, submission);
    else if (record.restoredFromEpoch !== record.operation.storageEpoch || record.restoredFromEpoch === binding.scope.storageEpoch
      || submission.operation.storageEpoch !== record.restoredFromEpoch) domainReject("storage_epoch_changed");
  }
  function assertStoredScope(binding: FirestoreAuthorityTransaction, record: FirestoreOnlineRecord) {
    const epoch = binding.scope.storageEpoch, restored = record.restoredFromEpoch;
    if (record.ownerUserId !== binding.scope.ownerUserId || record.operation.workspaceId !== binding.scope.workspaceId
      || (restored === undefined ? record.operation.storageEpoch !== epoch : restored !== record.operation.storageEpoch || restored === epoch)) {
      domainReject("receipt_binding", 500);
    }
  }
  async function read(binding: FirestoreAuthorityTransaction, opId: string): Promise<FirestoreOnlineRecord | null> {
    domainParse(z.uuid(), opId);
    const scope = scopeFor(binding), id = idFor(scope.ownerUserId, opId);
    const snapshot = await binding.transaction.get(data.ref("online_operations", "online-receipt", id));
    if (!snapshot.exists) return null;
    const raw = snapshot.data(), tags = data.tags(scope);
    if (raw?.workspaceTag !== tags.workspaceTag || raw?.epochTag !== tags.epochTag) domainReject("storage_epoch_changed");
    if (raw?.userTag !== tags.userTag || raw?.childTag !== tags.childTag) domainReject("projection_binding", 500);
    const record = data.open("online-receipt", id, scope, storedRecordSchema, snapshot);
    if ("state" in record && record.state === "erasure_barrier") {
      if (record.ownerUserId !== scope.ownerUserId || record.operationId !== opId) domainReject("receipt_binding", 500);
      domainReject("operation_erased");
    }
    assertStoredScope(binding, record);
    if (record.operation.opId !== opId || (!isFirestoreOnlinePending(record) && BigInt(record.changeSeq) > BigInt(binding.changeSeq))) domainReject("receipt_binding", 500);
    return record;
  }
  async function disclose(binding: FirestoreAuthorityTransaction, record: FirestoreOnlineRecord): Promise<OnlineReceipt | { state: "unconfirmed" }> {
    const shared = !isFirestoreOnlinePending(record) ? firestoreSharedResultSchema.safeParse(record.result) : null;
    if (shared?.success) {
      const pointer = shared.data, route = sharedDomainRoute(record.path);
      if (record.childId !== null || route.childId !== pointer.childId || route.module !== pointer.module) domainReject('receipt_binding', 500);
      let result: unknown = null;
      try {
        result = await createFirestoreSharingStore(options).inResourceTransaction(binding,
          { spaceId: pointer.spaceId, childId: pointer.childId, module: pointer.module, mode: 'read' },
          async access => {
            if ('deleted' in pointer.result) return pointer.result;
            if (pointer.result.format === 'shared-photo-deletion:1') {
              if (pointer.module !== 'attachments' || !record.path.toLowerCase().endsWith('/photos/'+pointer.result.id+'/delete')) domainReject('receipt_binding',500);
              const row = data.open('photo',pointer.result.id,access.scope,firestorePhotoSchemas.photo,
                await access.binding.transaction.get(data.ref('photos','photo',pointer.result.id)));
              if (row.id !== pointer.result.id || firestoreDomainHash(row.scope)!==firestoreDomainHash(access.scope)
                || row.version < pointer.result.version || row.deletion?.actorUserId !== binding.actorUserId
                || row.deletion.actorOperationId !== record.operation.opId) domainReject('receipt_binding',500);
              if (row.state !== 'deleted' || !row.deletion.journal) return {state:'unconfirmed' as const};
              if (row.deletion.journal.intentSha256!==firebaseErasureIntentHash(row.deletion.intent)) domainReject('receipt_binding',500);
              return {deleted:true as const,cleanupPending:true as const};
            }
            if (pointer.result.format === 'shared-task-result:1') return readSharedTaskResult(data, access.binding, pointer.result);
            const body = await readContentPointer(data, access.binding, pointer.result);
            if (pointer.module !== 'memory' || body === null) return body;
            const memory = createFirestoreMemoryStore({ ...options, care: createFirestoreCareStore(options), chat: createFirestoreChatStore(options) });
            const value = pointer.result.kind === 'fact' ? await memory.readFact(access.binding, pointer.result.id)
              : pointer.result.kind === 'topic' ? await memory.readTopic(access.binding, pointer.result.id) : null;
            return value ? { [pointer.result.key]: value } : null;
          });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error &&
          (['space_access_denied', 'space_inactive', 'module_not_shared', 'account_inactive', 'account_not_ready', 'not_found', 'scope_changed'].includes(String(error.code))
            || error.code === 'binding' && 'status' in error && error.status === 403))) throw error;
      }
      const confirmed = record as FirestoreOnlineConfirmed;
      if (result && typeof result === 'object' && 'state' in result && result.state === 'unconfirmed') return {state:'unconfirmed'};
      return { state: 'confirmed', path: record.path, operation: record.operation, changeSeq: confirmed.changeSeq,
        statusCode: confirmed.statusCode, result };
    }
    let visible = record.childId === null || await binding.readChild(record.childId) !== null;
    if (isFirestoreOnlinePending(record)) return { state: "unconfirmed" };
    let result = record.result;
    if (visible && record.childId) {
      const scoped = { ...binding, scope: { ...binding.scope, childId: record.childId } };
      const pointer = contentPointerSchema.safeParse(result), legacy = pointer.success ? null : contentResult(record.path, result);
      if (pointer.success) {
        result = await readContentPointer(data, scoped, pointer.data);
        if (result !== null && pointer.data.kind === 'fact') {
          const memory = createFirestoreMemoryStore({ ...options, care: createFirestoreCareStore(options), chat: createFirestoreChatStore(options) });
          result = { fact: await memory.readFact(scoped, pointer.data.id) };
        }
      }
      else if (legacy && !await contentVisible(data, scoped, legacy.kind, legacy.id, legacy.version)) result = null;
    }
    // A deleted private source cannot reappear through a saved create/manage receipt.
    if (visible && /^\/api\/children\/[^/]+\/inputs(?:\/|$)/u.test(record.path) && record.result !== null) {
      const pointer = privateInputPointerSchema.safeParse(result), legacy = result as { input?: { id?: unknown } };
      if (pointer.success || legacy.input) {
        const id = pointer.success ? pointer.data.id : domainParse(z.uuid(), legacy.input!.id, 'receipt_binding', 500);
        const current = await binding.transaction.get(data.ref('shared_inputs', 'shared-input', id));
        const tags = data.tags({ ...binding.scope, childId: record.childId! });
        visible = current.exists && current.get('live') === true && Object.entries(tags).every(([key, value]) => current.get(key) === value);
        if (pointer.success && visible) {
          // Later edits require a current-resource read; never return a newer body as the old operation result.
          visible = current.get('recordVersion') === pointer.data.version;
          if (visible) {
            const input = await createFirestoreSharedInputStore(options).read({ ...binding, scope: { ...binding.scope, childId: record.childId! } }, id);
            result = { input, ...(pointer.data.recordId ? { recordId: pointer.data.recordId } : {}) };
          }
        }
      }
    }
    if (visible && /^\/api\/(?:me|children\/[^/]+)\/avatar\/(?:uploads|commit|remove)$/u.test(record.path))
      result = await discloseAvatarReceipt(data, binding, record.path, result);
    return { state: "confirmed", path: record.path, operation: record.operation, changeSeq: record.changeSeq,
      statusCode: record.statusCode, result: visible ? result : null };
  }
  function prepare(binding: FirestoreAuthorityTransaction, value: FirestoreOnlineRecord, replace: boolean, restoredRedaction = false) {
    const record = domainParse(firestoreOnlineRecordSchema, value, "receipt_binding", 500);
    const scope = scopeFor(binding), id = idFor(scope.ownerUserId, record.operation.opId);
    if (record.restoredFromEpoch !== undefined) {
      if (!restoredRedaction) domainReject("receipt_binding", 500);
      assertStoredScope(binding, record);
    } else {
      assertCurrent(binding, { path: record.path, operation: record.operation, payload: {} });
      if (record.ownerUserId !== scope.ownerUserId) domainReject("receipt_binding", 500);
    }
    const envelope = { ...data.tags(scope), ...data.seal("online-receipt", id, scope, firestoreOnlineRecordSchema, record) };
    return () => {
      const ref = data.ref("online_operations", "online-receipt", id);
      if (replace) binding.transaction.set(ref, envelope); else binding.transaction.create(ref, envelope);
    };
  }
  function identityFor(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission, childId: string | null) {
    assertCurrent(binding, submission);
    return { ownerUserId: binding.scope.ownerUserId, fingerprint: firestoreOnlineFingerprint(submission),
      childId, path: submission.path, operation: submission.operation };
  }
  function preparePending(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission, childId: string | null) {
    const record: FirestoreOnlinePending = { ...identityFor(binding, submission, childId), state: "pending" };
    return { record, commit: prepare(binding, record, false) };
  }
  function prepareConfirmed(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission,
    value: { childId: string | null; changeSeq: string; statusCode: 200 | 201; result: unknown }, replace = false) {
    const record: FirestoreOnlineConfirmed = { ...identityFor(binding, submission, value.childId),
      changeSeq: value.changeSeq, statusCode: value.statusCode, result: value.result };
    const receipt: OnlineReceipt = { state: "confirmed", path: record.path, operation: record.operation,
      changeSeq: record.changeSeq, statusCode: record.statusCode, result: record.result };
    const pointer = contentResult(record.path, value.result);
    let saved = pointer ? { ...record, result: pointer } : record;
    if (submission.sharing) {
      const route = sharedDomainRoute(record.path);
      if (value.childId !== null) domainReject('receipt_binding', 500);
      const task = route.module === 'tasks' ? domainParse(z.object({ task: z.object({ id: z.uuid(), version: z.number().int().positive() }) }), value.result).task : null;
      saved = { ...record, result: firestoreSharedResultSchema.parse({ format: 'shared-domain-receipt:1', ...route,
        spaceId: submission.sharing.spaceId, result: task ? { format: 'shared-task-result:1', id: task.id, version: task.version } : pointer ?? value.result }) };
    }
    if (/^\/api\/children\/[^/]+\/inputs(?:\/|$)/u.test(record.path) && value.result && typeof value.result === 'object' && 'input' in value.result) {
      const result = value.result as { input: { id: string; version: number }; recordId?: string };
      saved = { ...record, result: privateInputPointerSchema.parse({ format: 'private-input-receipt:1', id: result.input.id,
        version: result.input.version, ...(result.recordId ? { recordId: result.recordId } : {}) }) };
    }
    return { record: saved, receipt, commit: prepare(binding, saved, replace) };
  }
  function prepareRedaction(binding: FirestoreAuthorityTransaction, record: FirestoreOnlineConfirmed) {
    return prepare(binding, { ...record, result: null }, true, true);
  }
  return { read, disclose, assertSame, assertCurrent, preparePending, prepareConfirmed, prepareRedaction };
}
