import { sharedWriteAttributionSchema, sharedWriteAttribution, validSharedAttribution } from './shared-write-attribution.ts';
import { sharedAttachmentReads, attachmentReadFence, withSharedAttachmentWrite } from './firestore-attachment-access.ts';
import type { SharedSelection } from '../src/shared/sharing.ts';
import type { FirestoreAuthority } from './firestore-authority.ts';
import { createPrivateAttachmentList } from './firestore-attachment-list.ts';
import type { AttachmentListPolicy } from '../src/shared/attachment-list.ts';
import { createFirestoreOnlineReceipts } from './firestore-online-receipts.ts';
import { firebaseErasureIntentSchema, firebaseErasureDescriptorSchema, erasureCoversChatFile, firebaseErasureIntentHash, type FirebaseErasureJournal, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from './firebase-erasure-journal.ts';
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { DocumentSnapshot } from "@google-cloud/firestore";
import { chatFileReservationSchema, type ChatFileAttachment, type ChatFileReservation, chatFileMessageReferenceSchema, type ChatFileMessageReference } from "../src/shared/chat-files.ts";
import { createFirestoreAuthority, sharedSourceOperationId, type FirestoreAuthorityTransaction } from "./firestore-authority.ts";
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from "./firestore-domain-data.ts";
import { workRecoveryScopeSchema, type WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import { chatFileObjectDescriptorSchema, type ChatFileObjects, type ChatFileObjectDescriptor } from "./firebase-chat-file-objects.ts";
import { decodeChatFileBase64, ChatFileError } from "./chat-file-bytes.ts";
import { importProvenanceSchema, type ImportProvenance } from '../src/shared/import-provenance.ts';
import { attachmentImportStageSchema, checkedAttachmentImportStage, type AttachmentImportStage, type AttachmentImportAccess } from './handover-attachment-stage.ts';

const uuid = z.uuid(), at = z.iso.datetime({ offset: true });
const uploadSchema = z.object({ token: uuid, startedAt: at, unknown: z.boolean() }).strict();
export const firestoreChatFileRowSchema = z.object({
  id: uuid, scope: workRecoveryScopeSchema, objectScope: workRecoveryScopeSchema,
  version: z.number().int().min(1), createdAt: at, updatedAt: at,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  metadata: chatFileReservationSchema.omit({ opId: true }).nullable(),
  state: z.enum(["reserved", "ready", "deleting", "deleted"]), upload: uploadSchema.nullable(),
  descriptor: chatFileObjectDescriptorSchema.nullable(), messageId: uuid.nullable(),
  importStage: attachmentImportStageSchema.optional(), importedFrom: importProvenanceSchema.optional(),
  deletion: z.object({ intent: firebaseErasureIntentSchema, proof: firebaseErasureDescriptorSchema.nullable(), expectedVersion: z.number().int().positive(),
    actorUserId: z.string().min(1).max(256).optional(), actorOperationId: uuid.optional(), attribution: sharedWriteAttributionSchema.optional(),
    integrity: chatFileReservationSchema.pick({ bytes: true, sha256: true, mimeType: true }),
    cleanup: z.enum(['pending', 'blocked', 'complete']), attempts: z.number().int().min(0).max(6), nextCheckAt: at.nullable(),
  }).strict().nullable(),
}).strict().refine(v => (['deleting', 'deleted'].includes(v.state)) === (v.metadata === null)
  && (v.metadata === null) === (v.deletion !== null)
  && (v.state !== "ready" || v.descriptor !== null)
  && (!v.importStage || v.state !== 'ready' || !!v.importedFrom)
  && (!v.importedFrom || !!v.importStage && v.importedFrom.current.source.section === 'files'
    && v.importedFrom.current.sourceHash === v.importStage.sourceHash && v.importedFrom.current.importedBy === v.importStage.actorUserId)
  && (!v.deletion || erasureCoversChatFile(v.deletion.intent, v.objectScope, v.id))
  && (!v.deletion || validSharedAttribution(v.deletion.attribution, v.scope, v.id, v.deletion.expectedVersion + 1, v.deletion.actorUserId ?? v.scope.ownerUserId))
  && (!v.deletion?.attribution || !!v.deletion.actorOperationId)
  && (!v.deletion?.actorOperationId || v.deletion.intent.operationId === sharedSourceOperationId(v.deletion.actorUserId ?? v.scope.ownerUserId, v.deletion.actorOperationId)));
export type FirestoreChatFileRow = z.infer<typeof firestoreChatFileRowSchema>;
export interface FirestoreChatFileOptions extends FirestoreDomainOptions { attachmentListPolicy?: AttachmentListPolicy; objects: ChatFileObjects; journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'>; serverClock?: () => number }
/** Private file authority. Upload and object reads occur outside retried Firestore callbacks. */
export function createFirestoreChatFilesStore(options: FirestoreChatFileOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), clock = options.serverClock ?? Date.now;
  const receipts = createFirestoreOnlineReceipts(options);
  const ref = (id: string) => data.ref("chat_file_assets", "chat-file-asset", id);
  const now = () => new Date(clock()).toISOString();
  const scopeTag = (scope: WorkRecoveryScope) => firestoreDomainHash(["chat-file-scope", scope]);
  function open(snapshot: DocumentSnapshot, scope: WorkRecoveryScope, id: string) {
    if (!snapshot.exists || snapshot.get("scopeTag") !== scopeTag(scope)) domainReject("not_found", 404);
    const row = data.open("chat-file-asset", id, scope, firestoreChatFileRowSchema, snapshot);
    if (row.id !== id || snapshot.ref.path !== ref(id).path || firestoreDomainHash(row.scope) !== firestoreDomainHash(scope)
      || row.objectScope.ownerUserId !== scope.ownerUserId || row.objectScope.workspaceId !== scope.workspaceId
      || row.objectScope.childId !== scope.childId) domainReject("chat_file_binding", 503);
    return row;
  }
  async function read(binding: FirestoreAuthorityTransaction, id: string) {
    domainParse(uuid, id);
    if (!await binding.readChild(binding.scope.childId)) domainReject("not_found", 404);
    return open(await binding.transaction.get(ref(id)), binding.scope, id);
  }
  function envelope(row: FirestoreChatFileRow) {
    return { ...data.tags(row.scope), scopeTag: scopeTag(row.scope), assetId: row.id, state: row.state,
      createdAt: row.createdAt, updatedAt: row.updatedAt, messageId: row.messageId, cleanupState: row.deletion?.cleanup ?? (row.messageId === null && !(row.importedFrom && row.state === 'ready') ? 'unlinked' : null), cleanupAt: row.deletion?.nextCheckAt ?? null,
      ...data.seal("chat-file-asset", row.id, row.scope, firestoreChatFileRowSchema, row, row.version) };
  }
  function current(row: FirestoreChatFileRow) { if (["deleting", "deleted"].includes(row.state)) domainReject("chat_file_deleted", 410); }
  function checkedDescriptor(row: FirestoreChatFileRow, descriptor: ChatFileObjectDescriptor) {
    descriptor = domainParse(chatFileObjectDescriptorSchema, descriptor, "chat_file_integrity", 503);
    const meta = row.metadata ?? row.deletion?.integrity;
    if (descriptor.objectName !== options.objects.address(row.objectScope, row.id) || !meta || meta.sha256 !== descriptor.sha256 || meta.bytes !== descriptor.bytes || meta.mimeType !== descriptor.mimeType) domainReject("chat_file_integrity", 503);
    return descriptor;
  }
  function view(row: FirestoreChatFileRow, b?: FirestoreAuthorityTransaction): ChatFileAttachment {
    if (b?.sharedAccess && (row.state !== 'ready' || !row.messageId)) domainReject('not_found', 404);
    return { id: row.id, childId: row.scope.childId, version: row.version, createdAt: row.createdAt,
      state: row.state === "reserved" && row.upload ? row.upload.unknown ? "unknown" : "uploading" : row.state,
      fileName: row.metadata?.fileName ?? null, mimeType: row.metadata?.mimeType ?? null, bytes: row.metadata?.bytes ?? null, sha256: row.metadata?.sha256 ?? null,
      messageId: b?.sharedAccess ? null : row.messageId, ...(b?.sharedAccess ? { sharedSpaceId: b.sharedAccess.spaceId } : {}) };
  }
  async function operation(b: FirestoreAuthorityTransaction, opId: string, path: string, payload: unknown) {
    const prior = await receipts.read(b, opId);
    const submission = { path, payload, operation: prior?.operation ?? { opId, deviceId: '00000000-0000-0000-0000-000000000000',
      workspaceId: b.scope.workspaceId, storageEpoch: b.scope.storageEpoch } };
    if (prior) receipts.assertSame(b, prior, submission);
    return { prior, submission };
  }
  async function prepareReservation(b: FirestoreAuthorityTransaction, raw: ChatFileReservation, importStage?: AttachmentImportStage) {
    const input = domainParse(chatFileReservationSchema, raw), { opId: id, ...metadata } = input;
    const fingerprint = firestoreDomainHash(importStage ? ['chat-file-import-reserve', input, importStage] : ["chat-file-reserve", input]), createdAt = now();
    const childId = b.scope.childId;
      if (!await b.readChild(childId)) domainReject("not_found", 404);
      const op = importStage ? null : await operation(b, id, '/api/children/' + childId + '/files', input);
      const existing = await b.transaction.get(ref(id));
      if (existing.exists) {
        const prior = open(existing, b.scope, id); if (prior.fingerprint !== fingerprint) domainReject("operation_conflict");
        if (importStage) current(prior);
        return { value: view(prior), commit() {} };
      }
      if (op?.prior) domainReject('operation_erased');
      // Only a few unfinished uploads may occupy a user's child scope at once.
      const pending = await b.transaction.get(data.collection("chat_file_assets").where("scopeTag", "==", scopeTag(b.scope))
        .where("state", "==", "reserved").limit(3));
      if (pending.size >= 3) domainReject("chat_file_pending_capacity");
      const change = await b.prepareChange(id, "chat", false);
      const row: FirestoreChatFileRow = { id, scope: { ...b.scope }, objectScope: { ...b.scope }, version: 1, createdAt,
        updatedAt: createdAt, fingerprint, metadata, state: "reserved", upload: null, descriptor: null, messageId: null, deletion: null,
        ...(importStage ? { importStage } : {}) };
      const saved = op ? receipts.prepareConfirmed(b, op.submission, { childId, changeSeq: change.changeSeq, statusCode: 201,
        result: { fileId: id, action: 'chat_file_reserve', accepted: true } }) : null;
      return { value: view(row), commit() { change.commit(); b.transaction.create(ref(id), envelope(row)); saved?.commit(); } };
  }
  async function reserve(userId: string, childId: string, raw: ChatFileReservation) {
    return authority.runTransaction(userId, childId, async b => { const prepared = await prepareReservation(b, raw); prepared.commit(); return prepared.value; });
  }
  function prepareImportReservation(b: FirestoreAuthorityTransaction, raw: ChatFileReservation, stage: AttachmentImportStage) {
    return prepareReservation(b, raw, checkedAttachmentImportStage(b, stage));
  }
  function uploadTransaction<T>(userId: string, childId: string, access: AttachmentImportAccess | undefined,
    use: (b: FirestoreAuthorityTransaction) => Promise<T>) {
    const checked = (b: FirestoreAuthorityTransaction) => {
      if (access) checkedAttachmentImportStage(b, access.stage);
      return use(b);
    };
    return access?.selection ? withSharedAttachmentWrite(options, userId, childId, access.selection, checked)
      : authority.runTransaction(userId, childId, checked);
  }
  function checkImportAccess(b: FirestoreAuthorityTransaction, row: FirestoreChatFileRow, access?: AttachmentImportAccess) {
    if (access) {
      if (!row.importStage) domainReject('operation_conflict');
      checkedAttachmentImportStage(b, access.stage, row.importStage);
    } else if (row.importStage && row.state !== 'ready') domainReject('chat_file_import_pending');
  }
  async function finish(userId: string, childId: string, original: FirestoreChatFileRow, descriptor: ChatFileObjectDescriptor, access?: AttachmentImportAccess) {
    const checked = checkedDescriptor(original, descriptor);
    return uploadTransaction(userId, childId, access, async b => {
      const row = await read(b, original.id); current(row);
      checkImportAccess(b, row, access);
      if (row.fingerprint !== original.fingerprint || row.upload?.token !== original.upload?.token) domainReject("chat_file_upload_changed");
      if (row.state === "ready" || row.importStage && row.descriptor) {
        if (firestoreDomainHash(row.descriptor) !== firestoreDomainHash(checked)) domainReject("chat_file_integrity", 503);
        return view(row);
      }
      const change = await b.prepareChange(randomUUID(), "chat", false);
      const updated: FirestoreChatFileRow = { ...row, version: row.version + 1, state: row.importStage ? 'reserved' : "ready", descriptor: checked, updatedAt: now() };
      change.commit(); b.transaction.set(ref(row.id), envelope(updated)); return view(updated);
    });
  }
  async function settleUploadFailure(original: FirestoreChatFileRow, definitelyNotWritten = false) {
    // No new authority: this only fences a previously admitted upload, even after access was revoked.
    await options.database.runTransaction(async tx => {
      const snapshot = await tx.get(ref(original.id)); if (!snapshot.exists) return;
      const row = open(snapshot, original.scope, original.id);
      if (row.state !== "reserved" || row.upload?.token !== original.upload?.token || !row.upload) return;
      if (!definitelyNotWritten && row.upload.unknown) return;
      tx.set(ref(row.id), envelope({ ...row, version: row.version + 1, upload: definitelyNotWritten ? null : { ...row.upload, unknown: true }, updatedAt: now() }));
    });
  }
  async function upload(userId: string, childId: string, id: string, expectedVersion: number, base64: string, signal?: AbortSignal, access?: AttachmentImportAccess) {
    domainParse(uuid, id); domainParse(z.number().int().min(1), expectedVersion);
    let bytes: Buffer;
    try { bytes = decodeChatFileBase64(base64); } catch { domainReject('invalid_chat_file', 400); }
    const sha256 = createHash("sha256").update(bytes).digest("hex"), token = randomUUID();
    const admission = await uploadTransaction(userId, childId, access, async b => {
      const row = await read(b, id); current(row);
      checkImportAccess(b, row, access);
      if (row.metadata?.sha256 !== sha256 || row.metadata.bytes !== bytes.length) domainReject("chat_file_hash_mismatch", 400);
      if (row.state === "ready" || row.upload) return { row, admitted: false };
      if (row.version !== expectedVersion) domainReject("version_conflict");
      const next: FirestoreChatFileRow = { ...row, version: row.version + 1, updatedAt: now(), upload: { token, startedAt: now(), unknown: false } };
      b.transaction.set(ref(id), envelope(next)); return { row: next, admitted: true };
    });
    if (admission.row.state === "ready") return view(admission.row);
    if (!admission.admitted) return reconcile(userId, childId, id, access);
    try {
      const descriptor = await options.objects.write(admission.row.objectScope, id, base64, admission.row.metadata!.mimeType, signal);
      await captureLateObject(admission.row, descriptor);
      return await finish(userId, childId, admission.row, descriptor, access);
    } catch (e) {
      // ChatFileError is raised by validation before Storage is called.
      await settleUploadFailure(admission.row, e instanceof ChatFileError);
      if (e instanceof ChatFileError) domainReject(e.code, e.code === "chat_file_validation_unavailable" ? 503 : 400);
      domainReject("chat_file_upload_unknown", 503);
    }
  }
  async function captureLateObject(original: FirestoreChatFileRow, descriptor: ChatFileObjectDescriptor) {
    checkedDescriptor(original, descriptor);
    // A previously admitted writer may report its one object after deletion or revocation.
    // This wakes cleanup, never publishes the file or grants current read access.
    await options.database.runTransaction(async tx => {
      const snapshot = await tx.get(ref(original.id)); if (!snapshot.exists) return;
      const row = open(snapshot, original.scope, original.id);
      if (!row.deletion || row.fingerprint !== original.fingerprint || row.upload?.token !== original.upload?.token) return;
      if (row.descriptor && firestoreDomainHash(row.descriptor) !== firestoreDomainHash(descriptor)) domainReject('chat_file_integrity', 503);
      if (row.deletion.cleanup === 'complete') return;
      tx.set(ref(row.id), envelope({ ...row, version: row.version + 1, descriptor, updatedAt: now(),
        deletion: { ...row.deletion, cleanup: 'pending', attempts: 0, nextCheckAt: now() } }));
    });
  }
  async function finishDeletion(original: FirestoreChatFileRow) {
    if (!original.deletion) domainReject('chat_file_delete_binding', 503);
    const proof = original.deletion.proof ?? await options.journal.writeOnce(original.deletion.intent);
    if (firestoreDomainHash(await options.journal.read(original.deletion.intent, proof)) !== firestoreDomainHash(original.deletion.intent))
      domainReject('chat_file_delete_binding', 503);
    return options.database.runTransaction(async tx => {
      const row = open(await tx.get(ref(original.id)), original.scope, original.id);
      if (!row.deletion || firestoreDomainHash(row.deletion.intent) !== firestoreDomainHash(original.deletion!.intent)) domainReject('chat_file_delete_binding', 503);
      if (row.deletion.proof && firestoreDomainHash(row.deletion.proof) !== firestoreDomainHash(proof)) domainReject('chat_file_delete_binding', 503);
      if (row.state === 'deleted') return row;
      const updated: FirestoreChatFileRow = { ...row, version: row.version + 1, state: 'deleted', updatedAt: now(),
        deletion: { ...row.deletion, proof, nextCheckAt: now() } };
      tx.set(ref(row.id), envelope(updated)); return updated;
    });
  }
  async function deleteChatFile(userId: string, childId: string, id: string, expectedVersion: number, operationId: string, selection?: SharedSelection) {
    domainParse(uuid, operationId); domainParse(z.number().int().positive(), expectedVersion);
    const prepare = async (b: FirestoreAuthorityTransaction, actor: FirestoreAuthorityTransaction) => {
      const op = await operation(actor, operationId, '/api/children/' + childId + '/files/' + id + '/delete', { expectedVersion, ...(selection ? { spaceId: selection.spaceId } : {}) });
      const row = await read(b, id);
      if (row.deletion) {
        if ((row.deletion.actorOperationId ?? row.deletion.intent.operationId) !== operationId || row.deletion.expectedVersion !== expectedVersion
          || (row.deletion.actorUserId ?? row.scope.ownerUserId) !== actor.actorUserId || !op.prior) domainReject('operation_conflict');
        return row;
      }
      if (op.prior) domainReject('operation_erased');
      if (b.sharedAccess && (row.state !== 'ready' || !row.messageId)) domainReject('not_found', 404);
      if (row.version !== expectedVersion) domainReject('version_conflict');
      const intent: FirebaseErasureIntent = { type: 'file-delete', scope: row.objectScope, assetId: id,
        operationId: b.sharedAccess ? sharedSourceOperationId(actor.actorUserId, operationId) : operationId, at: now() };
      const change = await b.prepareChange(operationId, 'chat', true);
      const { bytes, sha256, mimeType } = row.metadata!;
      const updated: FirestoreChatFileRow = { ...row, version: row.version + 1, state: 'deleting', metadata: null, updatedAt: now(),
        deletion: { intent, proof: null, expectedVersion, actorUserId: actor.actorUserId,
          ...(b.sharedAccess ? {actorOperationId: operationId} : {}),
          ...(sharedWriteAttribution(b, id, row.version + 1) ? { attribution: sharedWriteAttribution(b, id, row.version + 1) } : {}), integrity: { bytes, sha256, mimeType }, cleanup: 'pending', attempts: 0, nextCheckAt: now() } };
      const saved = receipts.prepareConfirmed(actor, op.submission, { childId: selection ? null : childId, changeSeq: change.changeSeq, statusCode: 200,
        result: { fileId: id, action: 'chat_file_delete', accepted: true } });
      change.commit(); b.transaction.set(ref(id), envelope(updated)); saved.commit(); return updated;
    };
    const prepared = selection
      ? await withSharedAttachmentWrite(options, userId, childId, selection, prepare)
      : await authority.runTransaction(userId, childId, b => prepare(b, b));
    const deleted = await finishDeletion(prepared);
    return { operationId, deleted: true as const, cleanupPending: deleted.deletion!.cleanup !== 'complete' };
  }
  async function expireUnlinked(scope: WorkRecoveryScope, id: string) {
    domainParse(workRecoveryScopeSchema, scope); domainParse(uuid, id);
    const pending = await options.database.runTransaction(async tx => {
      if (!(await authority.readControl(tx)).enabled) return null;
      const row = open(await tx.get(ref(id)), scope, id);
      if (row.deletion) return row;
      if (row.messageId || row.importedFrom && row.state === 'ready' || clock() < Date.parse(row.createdAt) + 86400_000) return null;
      const { bytes, sha256, mimeType } = row.metadata!;
      const intent: FirebaseErasureIntent = { type:'file-delete',scope:row.objectScope,assetId:id,operationId:randomUUID(),at:now() };
      const updated: FirestoreChatFileRow = { ...row,version:row.version+1,state:'deleting',metadata:null,updatedAt:now(),
        deletion:{intent,proof:null,expectedVersion:row.version,integrity:{bytes,sha256,mimeType},cleanup:'pending',attempts:0,nextCheckAt:now()} };
      tx.set(ref(id),envelope(updated));return updated;
    });
    if (pending) await finishDeletion(pending);
    return pending !== null;
  }
  async function cleanupDeleted(scope: WorkRecoveryScope, id: string) {
    domainParse(workRecoveryScopeSchema, scope); domainParse(uuid, id);
    let row = await options.database.runTransaction(async tx => open(await tx.get(ref(id)), scope, id));
    if (!row.deletion || !erasureCoversChatFile(row.deletion.intent, row.objectScope, id)) domainReject('chat_file_delete_binding', 503);
    if (row.state === 'deleting') row = await finishDeletion(row);
    const original = row, deletion = row.deletion!;
    if (deletion.cleanup === 'complete') return { state: 'complete' as const };
    if (deletion.cleanup === 'blocked' || deletion.nextCheckAt && Date.parse(deletion.nextCheckAt) > clock()) return { state: 'pending' as const };
    if (!deletion.proof || deletion.proof.intentSha256 !== firebaseErasureIntentHash(deletion.intent)
      || firestoreDomainHash(await options.journal.read(deletion.intent, deletion.proof)) !== firestoreDomainHash(deletion.intent)) domainReject('chat_file_delete_binding', 503);
    let descriptor = row.descriptor, complete = false;
    try {
      if (!descriptor && row.upload) {
        const found = await options.objects.inspect(row.objectScope, id);
        if (found) descriptor = checkedDescriptor(row, found);
      }
      if (descriptor) { checkedDescriptor(row, descriptor); await options.objects.remove(row.objectScope, id, descriptor); complete = true; }
      else complete = row.upload === null; // An unknown admitted write is not proof of absence.
    } catch { complete = false; }
    return options.database.runTransaction(async tx => {
      const fresh = open(await tx.get(ref(id)), scope, id);
      if (firestoreDomainHash(fresh) !== firestoreDomainHash(original)) return { state: 'pending' as const };
      const attempts = Math.min(6, deletion.attempts + 1), blocked = !complete && attempts === 6;
      const updated: FirestoreChatFileRow = { ...fresh, version: fresh.version + 1, descriptor, updatedAt: now(),
        deletion: { ...deletion, attempts, cleanup: complete ? 'complete' : blocked ? 'blocked' : 'pending',
          nextCheckAt: complete || blocked ? null : new Date(clock() + Math.min(900_000, 30_000 * 2 ** attempts)).toISOString() } };
      tx.set(ref(id), envelope(updated)); return { state: complete ? 'complete' as const : 'pending' as const };
    });
  }
  async function eraseForScope(scope: WorkRecoveryScope, id: string, intent: FirebaseErasureIntent, proof: FirebaseErasureDescriptor) {
    if (!['child-delete', 'account-delete', 'class-delete'].includes(intent.type) || !erasureCoversChatFile(intent, scope, id)
      || firestoreDomainHash(await options.journal.read(intent, proof)) !== firestoreDomainHash(intent)) domainReject('chat_file_delete_binding', 503);
    const exists = await options.database.runTransaction(async tx => {
      const snapshot = await tx.get(ref(id)); if (!snapshot.exists) return false;
      const row = open(snapshot, scope, id); if (row.deletion) return true;
      const { bytes, sha256, mimeType } = row.metadata!;
      tx.set(ref(id), envelope({ ...row, version: row.version + 1, state: 'deleted', metadata: null, updatedAt: now(),
        deletion: { intent, proof, expectedVersion: row.version, integrity: { bytes, sha256, mimeType }, cleanup: 'pending', attempts: 0, nextCheckAt: now() } }));
      return true;
    });
    if (!exists) return true;
    return (await cleanupDeleted(scope, id)).state === 'complete';
  }
  async function reconcile(userId: string, childId: string, id: string, access?: AttachmentImportAccess) {
    const row = await uploadTransaction(userId, childId, access, async b => { const found = await read(b, id); current(found); checkImportAccess(b, found, access); return found; });
    if (row.state === "ready" || !row.upload) return view(row);
    const descriptor = await options.objects.inspect(row.objectScope, id);
    if (descriptor) return finish(userId, childId, row, descriptor, access);
    await settleUploadFailure(row);
    return uploadTransaction(userId, childId, access, async b => view(await read(b, id)));
  }
  async function prepareImportPublication(b: FirestoreAuthorityTransaction, id: string, rawStage: AttachmentImportStage, rawProvenance: ImportProvenance) {
    const row = await read(b, id); current(row);
    if (!row.importStage) domainReject('operation_conflict');
    const stage = checkedAttachmentImportStage(b, rawStage, row.importStage), importedFrom = domainParse(importProvenanceSchema, rawProvenance);
    if (importedFrom.current.source.section !== 'files' || importedFrom.current.sourceHash !== stage.sourceHash
      || importedFrom.current.importedBy !== stage.actorUserId) domainReject('operation_conflict');
    if (row.state === 'ready') {
      if (firestoreDomainHash(row.importedFrom) !== firestoreDomainHash(importedFrom)) domainReject('operation_conflict');
      return { value: view(row), changeSeq: null, commit() {} };
    }
    if (!row.descriptor) domainReject('chat_file_not_available');
    checkedDescriptor(row, row.descriptor);
    const change = await b.prepareChange(stage.operationId, 'chat', false);
    const next: FirestoreChatFileRow = { ...row, state: 'ready', version: row.version + 1, importedFrom, updatedAt: now() };
    return { value: view(next), changeSeq: change.changeSeq, commit() { change.commit(); b.transaction.set(ref(id), envelope(next)); } };
  }
  async function prepareLink(b: FirestoreAuthorityTransaction, id: string, expectedVersion: number, messageId: string) {
    const row = await read(b, id); current(row);
    if (row.state !== "ready" || !row.descriptor || row.messageId) domainReject("chat_file_not_available");
    if (row.version !== expectedVersion) domainReject("version_conflict");
    domainParse(uuid, messageId);
    const updated: FirestoreChatFileRow = { ...row, messageId, version: row.version + 1, updatedAt: now() };
    const chatFile = { id, version: updated.version, sha256: row.descriptor.sha256, mimeType: row.descriptor.mimeType, bytes: row.descriptor.bytes };
    return { file: chatFile, commit() { b.transaction.set(ref(id), envelope(updated)); } };
  }
  async function readEvidence(b: FirestoreAuthorityTransaction, messageId: string, reference: ChatFileMessageReference) {
    reference = domainParse(chatFileMessageReferenceSchema, reference);
    const row = await read(b, reference.id); current(row);
    if (row.state !== 'ready' || !row.descriptor || row.messageId !== messageId || row.version !== reference.version
      || ['sha256', 'mimeType', 'bytes'].some(key => row.descriptor![key as keyof ChatFileObjectDescriptor] !== reference[key as keyof ChatFileMessageReference]))
      domainReject('chat_file_changed');
    return row;
  }
  async function contentForMessage(userId: string, childId: string, messageId: string, reference: ChatFileMessageReference) {
    await authority.runTransaction(userId, childId, b => readEvidence(b, messageId, reference));
    const original = await content(userId, childId, reference.id);
    await authority.runTransaction(userId, childId, b => readEvidence(b, messageId, reference));
    return original;
  }
  function readers(readAuthority: Pick<FirestoreAuthority, 'runTransaction'>) {
    async function content(userId: string, childId: string, id: string) {
      const first = await readAuthority.runTransaction(userId, childId, async b => {
        const row = await read(b, id); current(row);
        if (row.state !== 'ready' || !row.descriptor) domainReject('chat_file_not_available');
        return { row, attachment: view(row, b), fence: attachmentReadFence(b) };
      });
      const value = await options.objects.read(first.row.objectScope, id, first.row.descriptor!);
      await readAuthority.runTransaction(userId, childId, async b => {
        const fresh = await read(b, id); current(fresh);
        if (attachmentReadFence(b) !== first.fence || fresh.version !== first.row.version
          || firestoreDomainHash(fresh.descriptor) !== firestoreDomainHash(first.row.descriptor)
          || fresh.messageId !== first.row.messageId) domainReject('chat_file_changed');
        view(fresh, b);
      });
      return { ...value, attachment: first.attachment };
    }
    return { content, list: createPrivateAttachmentList({ data, authority: readAuthority, source: 'files', policy: options.attachmentListPolicy, scopeTag, open, view }),
      get(userId: string, childId: string, id: string) { return readAuthority.runTransaction(userId, childId, async b => view(await read(b, id), b)); } };
  }
  const { content, list, get } = readers(authority);

  return { list, get, prepareImportReservation, prepareImportPublication,
    uploadImported: (userId: string, childId: string, id: string, expectedVersion: number, base64: string, stage: AttachmentImportStage,
      signal?: AbortSignal, selection?: SharedSelection) => upload(userId, childId, id, expectedVersion, base64, signal, { stage, selection }),
    forSharedSpace: (selection: SharedSelection) => ({ ...readers(sharedAttachmentReads(options, selection)),
    delete: (userId: string, childId: string, id: string, version: number, opId: string) => deleteChatFile(userId, childId, id, version, opId, selection) }), reserve, upload, reconcile, content, prepareLink, contentForMessage, readEvidence, delete: deleteChatFile, cleanupDeleted, expireUnlinked, eraseForScope,
    readMetadata: async (b: FirestoreAuthorityTransaction, id: string) => view(await read(b,id), b) };
}
export type FirestoreChatFilesStore = ReturnType<typeof createFirestoreChatFilesStore>;
