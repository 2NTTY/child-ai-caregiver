import { randomUUID } from "node:crypto";
import type { Firestore, DocumentSnapshot } from "@google-cloud/firestore";
import { z } from "zod";
import { PHOTO_LIMITS, photoMetadataSchema, photoDraftSchema, type PhotoDraft, type PhotoAttachment, type PhotoMetadata } from "../src/shared/photos.ts";
import type { AgentScope } from './agent-runtime.ts';
import { createFirestoreCareStore } from './firestore-care.ts';
import { careValuesSchema } from './care-validation.ts';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthorityTransaction, type FirestoreAuthorityOptions } from "./firestore-authority.ts";
import { FirestoreDomainData, FirestoreDomainError, firestoreDomainHash } from "./firestore-domain-data.ts";
import { workRecoveryScopeSchema, type WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import { canonical } from "./firestore-session-codec.ts";
import { decodePhoto, photoHash } from "./photo-files.ts";
import { firebasePhotoObjectDescriptorSchema, FirebasePhotoObjectError, type FirebasePhotoObjects, type FirebasePhotoObjectDescriptor } from "./firebase-photo-objects.ts";
import { firebaseErasureIntentSchema, firebaseErasureDescriptorSchema, firebaseErasureIntentHash, FirebaseErasureError,
  type FirebaseErasureJournal, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from "./firebase-erasure-journal.ts";

import type { OnlineSubmission, OnlineReceipt } from "../src/shared/online.ts";
import { onlineSubmissionSchema } from "./online-routing.ts";
import { createFirestoreOnlineReceipts, isFirestoreOnlinePending } from "./firestore-online-receipts.ts";
const NIL = "00000000-0000-0000-0000-000000000000";
const SYSTEM: WorkRecoveryScope = { ownerUserId: "system:photos", workspaceId: NIL, childId: NIL, storageEpoch: NIL };
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), version = integer.min(1).max(2147483647);
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), at = z.iso.datetime({ offset: true });
const uploadSchema = z.object({ id: uuid, reservationOperationId: uuid, sha256: hash, bytes: integer.min(1).max(PHOTO_LIMITS.bytes),
  mimeType: z.enum(["image/png", "image/jpeg"]), authorizationVersion: z.string(), generation: uuid, startedAt: at }).strict();
const deletionSchema = z.object({ intent: firebaseErasureIntentSchema, fingerprint: hash, expectedVersion: version,
  journal: firebaseErasureDescriptorSchema.nullable() }).strict();
const extractionSchema = z.object({ state: z.enum(['not_requested', 'running', 'available', 'failed', 'unknown']),
  runId: uuid.nullable(), draft: photoDraftSchema.nullable(), stopReason: z.string().max(128).nullable(),
  processedAt: at.nullable(), model: z.string().max(256).nullable(), expiresAt: at.nullable(),
  authorizationVersion: z.string().max(100).nullable(), generation: uuid.nullable() }).strict();
const rowSchema = z.object({ id: uuid, scope: workRecoveryScopeSchema, reservationOperationId: uuid, createdAt: at, version,
  state: z.enum(["reserved", "ready", "deleting", "deleted"]), metadata: photoMetadataSchema.nullable(),
  objectScope: workRecoveryScopeSchema.optional(),
  descriptor: firebasePhotoObjectDescriptorSchema.nullable(), upload: uploadSchema.nullable(), deletion: deletionSchema.nullable(),
  visibility: z.enum(['private', 'shared']).optional(), recordId: uuid.nullable().optional(), extraction: extractionSchema.optional() }).strict()
  .refine(row => (row.state === "deleted") === (row.metadata === null)
    && (row.state !== "ready" || row.descriptor !== null)
    && ((row.state === "deleting" || row.state === "deleted") === (row.deletion !== null)));
type Row = z.infer<typeof rowSchema>;
const operationSchema = z.object({ scope: workRecoveryScopeSchema, operationId: uuid, action: z.enum(["reserve", "delete"]), fingerprint: hash,
  photoId: uuid, state: z.enum(["pending", "confirmed"]), result: z.object({ deleted: z.literal(true), cleanupPending: z.literal(true) }).strict().nullable() }).strict();
const childQuotaSchema = z.object({ bytes: integer.max(PHOTO_LIMITS.childBytes), count: integer.max(PHOTO_LIMITS.count) }).strict();
const globalQuotaSchema = z.object({ activeBytes: integer, activeCount: integer, cleanupBytes: integer, cleanupCount: integer }).strict()
  .refine(value => value.activeBytes + value.cleanupBytes <= PHOTO_LIMITS.totalBytes
    && value.activeCount + value.cleanupCount <= PHOTO_LIMITS.totalCount);
export const firestorePhotoCleanupSchema = z.object({ scope: workRecoveryScopeSchema, photoId: uuid, operationId: uuid,
  objectScope: workRecoveryScopeSchema.optional(),
  state: z.enum(["known", "unresolved"]), uploadStarted: z.boolean(), upload: uploadSchema.nullable(),
  sha256: hash, bytes: integer.min(1).max(PHOTO_LIMITS.bytes), mimeType: z.enum(["image/png", "image/jpeg"]),
  descriptor: firebasePhotoObjectDescriptorSchema.nullable(), journal: firebaseErasureDescriptorSchema }).strict()
  .refine(value => (value.state === "known") === (value.descriptor !== null) && value.uploadStarted === (value.upload !== null));
export type FirestorePhotoCleanup = z.infer<typeof firestorePhotoCleanupSchema>;
const cursorSchema = z.object({ scopeTag: hash, sortKey: z.string().min(1).max(80) }).strict();
export type FirestorePhotoCursor = z.infer<typeof cursorSchema>;
export class FirestorePhotoError extends FirestoreDomainError {
  constructor(status: number, code: string) { super(status, code); this.name = "FirestorePhotoError"; }
}
function fail(code: string, status = 409): never { throw new FirestorePhotoError(status, code); }
function parse<T>(schema: z.ZodType<T>, input: unknown, invalid = false): T {
  const parsed = schema.safeParse(input); if (!parsed.success) fail(invalid ? "invalid_input" : "photo_integrity", invalid ? 400 : 503);
  return parsed.data;
}
/** A quarantined hot-backup upload keeps its immutable original object address. */
export function photoObjectScope(row: { scope: WorkRecoveryScope; objectScope?: WorkRecoveryScope }): WorkRecoveryScope {
  const target = row.objectScope ?? row.scope;
  if (target.ownerUserId !== row.scope.ownerUserId || target.workspaceId !== row.scope.workspaceId || target.childId !== row.scope.childId)
    fail('photo_integrity', 503);
  return target;
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
export interface FirestorePhotosOptions extends FirestoreAuthorityOptions {
  objects: Pick<FirebasePhotoObjects, "write" | "recover" | "read"> & Partial<Pick<FirebasePhotoObjects, "remove" | "inspect">>;
  journal: Pick<FirebaseErasureJournal, "writeOnce"> & Partial<Pick<FirebaseErasureJournal, "read">>;
}
/** Domain transactions own permission, quotas and receipts. Storage calls never run inside SDK callbacks. */
export function createFirestorePhotoStore(options: FirestorePhotosOptions) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), receipts = createFirestoreOnlineReceipts(options), { objects, journal } = options;
  const care = createFirestoreCareStore(options);
  const tag = (scope: WorkRecoveryScope) => firestoreDomainHash([options.projectId, options.namespace, "photo-scope", scope]);
  const rowRef = (id: string) => data.ref("photos", "photo", id);
  const opRef = (id: string) => data.ref("photo_ops", "photo-operation", id);
  const quotaRef = (scope: WorkRecoveryScope) => data.ref("photo_quota", "photo-child-quota", tag(scope));
  const globalRef = data.ref("photo_quota", "photo-global-quota", "global");
  const cleanupRef = (id: string) => data.ref("photo_cleanup", "photo-cleanup", id);
  const now = () => { const value = (options.serverClock ?? Date.now)(); if (!Number.isSafeInteger(value) || value < 0) fail("photo_unavailable", 503);
    return new Date(value).toISOString(); };
  const seal = <T>(kind: string, id: string, scope: WorkRecoveryScope, schema: z.ZodType<T>, value: T, recordVersion = 1) =>
    data.seal(kind, id, scope, schema, value, recordVersion);
  function writeRow(binding: FirestoreAuthorityTransaction, row: Row) {
    binding.transaction.set(rowRef(row.id), { assetId: row.id, scopeTag: tag(row.scope),
      sortKey: row.createdAt + "/" + row.id, live: row.state === "reserved" || row.state === "ready",
      ...seal("photo", row.id, row.scope, rowSchema, row, row.version) });
  }
  function checkedRow(snapshot: DocumentSnapshot, scope: WorkRecoveryScope, id: string): Row {
    if (!snapshot.exists || snapshot.data()?.scopeTag !== tag(scope)) fail("not_found", 404);
    const row = data.open("photo", id, scope, rowSchema, snapshot);
    photoObjectScope(row);
    if (row.id !== id || !same(row.scope, scope) || snapshot.ref.path !== rowRef(id).path) fail("photo_integrity", 503);
    return row;
  }
  async function readRow(binding: FirestoreAuthorityTransaction, id: string) {
    return checkedRow(await binding.transaction.get(rowRef(id)), binding.scope, id);
  }
  function active(row: Row): asserts row is Row & { metadata: PhotoMetadata } {
    if (row.state === "deleted") fail("photo_deleted", 410);
    if (row.state === "deleting") fail("photo_deleting", 409);
    if (!row.metadata) fail("photo_integrity", 503);
  }
  function view(row: Row): PhotoAttachment {
    active(row);
    return { ...row.metadata, id: row.id, childId: row.scope.childId, ownerUserId: row.scope.ownerUserId, createdAt: row.createdAt,
      version: row.version, state: row.state as "reserved" | "ready", recoveryPending: row.state === "reserved" && !!row.objectScope, visibility: row.visibility ?? 'private', canManage: true, recordId: row.recordId ?? null,
      extraction: row.extraction ? { state: row.extraction.state === 'running' && Date.parse(row.extraction.expiresAt!) <= Date.parse(now()) ? 'unknown' : row.extraction.state,
        runId: row.extraction.runId, draft: row.extraction.draft, stopReason: row.extraction.stopReason,
        processedAt: row.extraction.processedAt, model: row.extraction.model }
        : { state: "not_requested", runId: null, draft: null, stopReason: null, processedAt: null, model: null } };
  }
  async function operation(binding: FirestoreAuthorityTransaction, operationId: string, action: "reserve" | "delete", fingerprint: string) {
    const snapshot = await binding.transaction.get(opRef(operationId)); if (!snapshot.exists) return null;
    if (snapshot.data()?.scopeTag !== tag(binding.scope)) fail("operation_conflict");
    const op = data.open("photo-operation", operationId, binding.scope, operationSchema, snapshot);
    if (op.operationId !== operationId || op.action !== action || op.fingerprint !== fingerprint || !same(op.scope, binding.scope)) fail("operation_conflict");
    return op;
  }
  function writeOperation(binding: FirestoreAuthorityTransaction, value: z.infer<typeof operationSchema>) {
    binding.transaction.set(opRef(value.operationId), { scopeTag: tag(binding.scope),
      ...seal("photo-operation", value.operationId, binding.scope, operationSchema, value) });
  }
  async function quotas(binding: FirestoreAuthorityTransaction) {
    const tx = binding.transaction, [globalSnapshot, childSnapshot] = await tx.getAll(globalRef, quotaRef(binding.scope));
    let global: z.infer<typeof globalQuotaSchema>;
    if (!globalSnapshot.exists) {
      const [photos, cleanup, counters] = await Promise.all([
        tx.get(data.collection("photos").limit(1)), tx.get(data.collection("photo_cleanup").limit(1)), tx.get(data.collection("photo_quota").limit(1)),
      ]);
      if (photos.size || cleanup.size || counters.size) fail("photo_quota_unavailable", 503);
      global = { activeBytes: 0, activeCount: 0, cleanupBytes: 0, cleanupCount: 0 };
    } else global = data.open("photo-global-quota", "global", SYSTEM, globalQuotaSchema, globalSnapshot);
    let child: z.infer<typeof childQuotaSchema>;
    if (!childSnapshot.exists) {
      if ((await tx.get(data.collection("photos").where("scopeTag", "==", tag(binding.scope)).limit(1))).size) fail("photo_quota_unavailable", 503);
      child = { bytes: 0, count: 0 };
    } else child = data.open("photo-child-quota", tag(binding.scope), binding.scope, childQuotaSchema, childSnapshot);
    return { global, child };
  }
  function writeQuotas(binding: FirestoreAuthorityTransaction, value: Awaited<ReturnType<typeof quotas>>) {
    binding.transaction.set(globalRef, seal("photo-global-quota", "global", SYSTEM, globalQuotaSchema, value.global));
    binding.transaction.set(quotaRef(binding.scope), { scopeTag: tag(binding.scope),
      ...seal("photo-child-quota", tag(binding.scope), binding.scope, childQuotaSchema, value.child) });
  }
  function occupied(row: Row, quota: Awaited<ReturnType<typeof quotas>>) {
    if (!row.metadata || quota.child.count < 1 || quota.child.bytes < row.metadata.bytes
      || quota.global.activeCount < 1 || quota.global.activeBytes < row.metadata.bytes) fail("photo_quota_unavailable", 503);
  }
  function descriptor(scope: WorkRecoveryScope, id: string, value: FirebasePhotoObjectDescriptor, metadata: Pick<PhotoMetadata, "sha256" | "bytes" | "mimeType">) {
    const result = parse(firebasePhotoObjectDescriptorSchema, value);
    // This matches the immutable port's versioned server key, never a caller-supplied filename/path.
    const fullScope = { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId, storageEpoch: scope.storageEpoch };
    const expectedName = "photos/v1/" + photoHash(Buffer.from(JSON.stringify(["yuban-photo-object", 1, options.projectId, options.namespace, fullScope]))) + "/" + id;
    if (result.objectName !== expectedName || result.sha256 !== metadata.sha256 || result.bytes !== metadata.bytes || result.mimeType !== metadata.mimeType)
      fail("photo_integrity", 503);
    return result;
  }
  async function guard<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof FirestorePhotoError || error instanceof FirestoreAuthorityError && error.status < 500) throw error;
      if (error instanceof FirebasePhotoObjectError || error instanceof FirebaseErasureError) fail(error.code, error.status);
      if (error instanceof FirestoreDomainError && error.status < 500) throw error;
      fail("photo_unavailable", 503);
    }
  }
  const ids = (userId: string, childId: string, id?: string) => {
    parse(z.string().min(1).max(256), userId, true); parse(uuid, childId, true); if (id !== undefined) parse(uuid, id, true);
  };
  async function onlinePrior(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission | undefined, operationId: string) {
    const prior = await receipts.read(binding, operationId);
    if (submission) {
      if (prior) receipts.assertSame(binding, prior, submission); else receipts.assertCurrent(binding, submission);
    } else if (prior) fail("operation_conflict");
    return prior;
  }
  async function reserveOperation(userId: string, childId: string, operationId: string, value: PhotoMetadata,
    submission?: OnlineSubmission): Promise<PhotoAttachment | OnlineReceipt> {
    ids(userId, childId); parse(uuid, operationId, true); const metadata = parse(photoMetadataSchema, value, true);
    const id = randomUUID(), createdAt = now(), fingerprint = firestoreDomainHash(["reserve", metadata]);
    return guard(() => authority.runTransaction(userId, childId, async binding => {
      const shared = await onlinePrior(binding, submission, operationId);
      if (shared) {
        if (isFirestoreOnlinePending(shared)) fail("operation_conflict");
        return receipts.disclose(binding, shared) as Promise<OnlineReceipt>;
      }
      const prior = await operation(binding, operationId, "reserve", fingerprint);
      if (prior) {
        // A historical direct mutation cannot acquire an invented online receipt.
        if (submission || prior.state !== "confirmed") fail("operation_conflict");
        return view(await readRow(binding, prior.photoId));
      }
      const quota = await quotas(binding);
      if (quota.child.count + 1 > PHOTO_LIMITS.count || quota.child.bytes + metadata.bytes > PHOTO_LIMITS.childBytes
        || quota.global.activeBytes + quota.global.cleanupBytes + metadata.bytes > PHOTO_LIMITS.totalBytes
        || quota.global.activeCount + quota.global.cleanupCount + 1 > PHOTO_LIMITS.totalCount) fail("photo_capacity");
      const change = await binding.prepareChange(operationId, "care", false);
      const row: Row = { scope: { ...binding.scope }, id, reservationOperationId: operationId, createdAt, version: 1,
        state: "reserved", metadata, descriptor: null, upload: null, deletion: null };
      const photo = view(row), sharedWrite = submission ? receipts.prepareConfirmed(binding, submission,
        { childId, changeSeq: change.changeSeq, statusCode: 201, result: { photo } }) : null;
      writeRow(binding, row); writeOperation(binding, { scope: row.scope, operationId, action: "reserve", fingerprint, photoId: id, state: "confirmed", result: null });
      quota.child.bytes += metadata.bytes; quota.child.count++; quota.global.activeBytes += metadata.bytes; quota.global.activeCount++;
      writeQuotas(binding, quota); sharedWrite?.commit(); change.commit(); return sharedWrite ? sharedWrite.receipt : photo;
    }));
  }
  async function deleteOperation(userId: string, childId: string, id: string, expectedVersion: number, operationId: string,
    submission?: OnlineSubmission): Promise<{ deleted: true; cleanupPending: true } | OnlineReceipt> {
    ids(userId, childId, id); parse(version, expectedVersion, true); parse(uuid, operationId, true);
    const timestamp = now(), fingerprint = firestoreDomainHash(["delete", id, expectedVersion]);
    return guard(async () => {
      const first = await authority.runTransaction(userId, childId, async binding => {
        const shared = await onlinePrior(binding, submission, operationId);
        if (shared && !isFirestoreOnlinePending(shared))
          return { confirmed: await receipts.disclose(binding, shared) as OnlineReceipt, intent: null };
        const prior = await operation(binding, operationId, "delete", fingerprint);
        if (submission && !shared && prior) fail("operation_conflict");
        if (prior?.state === "confirmed") {
          if (submission || !prior.result || prior.photoId !== id) fail("photo_integrity", 503);
          return { confirmed: prior.result, intent: null };
        }
        const row = await readRow(binding, id);
        if (prior) {
          if (prior.photoId !== id || row.state !== "deleting" || !row.deletion || row.deletion.intent.operationId !== operationId
            || row.deletion.fingerprint !== fingerprint || (submission && !shared)) fail("operation_conflict");
          return { confirmed: null, intent: row.deletion.intent };
        }
        if (shared) fail("photo_integrity", 503);
        active(row); if (row.version !== expectedVersion) fail("version_conflict");
        const quota = await quotas(binding); occupied(row, quota);
        const intent: FirebaseErasureIntent = { scope: { ...binding.scope }, assetId: id, operationId, at: timestamp, type: "photo-delete" };
        const reservationReceipt = await receipts.read(binding, row.reservationOperationId);
        if (reservationReceipt && (isFirestoreOnlinePending(reservationReceipt) || reservationReceipt.childId !== childId
          || reservationReceipt.path.toLowerCase() !== "/api/children/" + childId + "/photos")) fail("photo_integrity", 503);
        const redact = reservationReceipt && !isFirestoreOnlinePending(reservationReceipt)
          ? receipts.prepareRedaction(binding, reservationReceipt) : null;
        const pending = submission ? receipts.preparePending(binding, submission, childId) : null;
        row.state = "deleting"; row.version++; row.deletion = { intent, expectedVersion, fingerprint, journal: null };
        writeRow(binding, row); writeOperation(binding, { scope: row.scope, operationId, action: "delete", fingerprint, photoId: id, state: "pending", result: null });
        redact?.(); pending?.commit(); return { confirmed: null, intent };
      });
      if (first.confirmed) return first.confirmed;
      const journalDescriptor = parse(firebaseErasureDescriptorSchema, await journal.writeOnce(first.intent!));
      if (journalDescriptor.intentSha256 !== firebaseErasureIntentHash(first.intent!)) fail("photo_integrity", 503);
      return authority.runTransaction(userId, childId, async binding => {
        const shared = await onlinePrior(binding, submission, operationId);
        if (shared && !isFirestoreOnlinePending(shared)) return receipts.disclose(binding, shared) as Promise<OnlineReceipt>;
        if (submission && !shared) fail("photo_integrity", 503);
        const prior = await operation(binding, operationId, "delete", fingerprint);
        if (!prior || prior.photoId !== id) fail("operation_conflict");
        if (prior.state === "confirmed") { if (submission || !prior.result) fail("photo_integrity", 503); return prior.result; }
        const row = await readRow(binding, id), quota = await quotas(binding); occupied(row, quota);
        if (row.state !== "deleting" || !row.deletion || !same(row.deletion.intent, first.intent)
          || row.deletion.fingerprint !== fingerprint || row.deletion.expectedVersion !== expectedVersion) fail("operation_conflict");
        if ((await binding.transaction.get(cleanupRef(id))).exists) fail("photo_integrity", 503);
        const reservationReceipt = await receipts.read(binding, row.reservationOperationId);
        if (reservationReceipt && (isFirestoreOnlinePending(reservationReceipt) || reservationReceipt.childId !== childId
          || reservationReceipt.path.toLowerCase() !== "/api/children/" + childId + "/photos")) fail("photo_integrity", 503);
        const redact = reservationReceipt && !isFirestoreOnlinePending(reservationReceipt)
          ? receipts.prepareRedaction(binding, reservationReceipt) : null;
        const record = row.recordId ? await care.readRecord(binding, row.recordId) : null;
        const change = record ? await care.prepareDeletion(binding, record.id, record.version, operationId)
          : await binding.prepareChange(operationId, "care", true), metadata = row.metadata!;
        const result = { deleted: true as const, cleanupPending: true as const };
        const sharedWrite = submission ? receipts.prepareConfirmed(binding, submission,
          { childId, changeSeq: change.changeSeq, statusCode: 200, result }, true) : null;
        const cleanup: FirestorePhotoCleanup = { scope: row.scope, ...(row.objectScope ? { objectScope: row.objectScope } : {}), photoId: id, operationId, state: row.descriptor ? "known" : "unresolved",
          uploadStarted: row.upload !== null, upload: row.upload, sha256: metadata.sha256, bytes: metadata.bytes, mimeType: metadata.mimeType,
          descriptor: row.descriptor, journal: journalDescriptor };
        binding.transaction.create(cleanupRef(id), { scopeTag: tag(binding.scope), state: cleanup.state,
          ...seal("photo-cleanup", id, binding.scope, firestorePhotoCleanupSchema, cleanup) });
        row.state = "deleted"; row.version++; row.metadata = null; row.descriptor = null; row.deletion.journal = journalDescriptor;
        delete row.extraction;
        writeRow(binding, row); writeOperation(binding, { ...prior, state: "confirmed", result });
        quota.child.bytes -= metadata.bytes; quota.child.count--; quota.global.activeBytes -= metadata.bytes; quota.global.activeCount--;
        quota.global.cleanupBytes += metadata.bytes; quota.global.cleanupCount++;
        writeQuotas(binding, quota); redact?.(); sharedWrite?.commit(); change.commit(); return sharedWrite ? sharedWrite.receipt : result;
      });
    });
  }
  async function confirmOperation(userId: string, childId: string, id: string, submission: OnlineSubmission): Promise<OnlineReceipt> {
    const input = parse(z.object({ expectedVersion: version, confirmShared: z.literal(true), values: careValuesSchema }).strict(), submission.payload, true);
    const first = await authority.runTransaction(userId, childId, async b => {
      const old = await onlinePrior(b, submission, submission.operation.opId);
      if (old) {
        if (isFirestoreOnlinePending(old)) fail('operation_conflict');
        const receipt = await receipts.disclose(b, old); if (receipt.state !== 'confirmed') fail('operation_conflict');
        return { receipt, row: null, scope: null, auth: null, generation: null };
      }
      const row = await readRow(b, id); active(row);
      if (row.state !== 'ready' || row.recordId || row.version !== input.expectedVersion) fail('version_conflict');
      if (row.extraction?.state === 'running' && Date.parse(row.extraction.expiresAt!) > Date.parse(now())) fail('photo_processing');
      return { receipt: null, row, scope: b.scope, auth: b.authorizationVersion, generation: b.generation };
    });
    if (first.receipt) return first.receipt;
    // The existing download path authenticates, checks generation/hash and reauthorizes after Storage I/O.
    await service.content(userId, childId, id);
    return authority.runTransaction(userId, childId, async b => {
      const old = await onlinePrior(b, submission, submission.operation.opId);
      if (old) {
        if (isFirestoreOnlinePending(old)) fail('operation_conflict');
        const receipt = await receipts.disclose(b, old); if (receipt.state !== 'confirmed') fail('operation_conflict'); return receipt;
      }
      const row = await readRow(b, id); active(row);
      if (!same(row, first.row) || !same(b.scope, first.scope) || b.authorizationVersion !== first.auth || b.generation !== first.generation) fail('version_conflict');
      const prepared = await care.prepareRecord(b, submission.operation.opId, { ...input.values,
        source: '照片 ' + id + ' · SHA-256 ' + row.metadata.sha256 + ' · 上傳 ' + row.createdAt + ' · ' + row.metadata.source });
      row.visibility = 'shared'; row.recordId = prepared.value.id; row.version++;
      const result = { photo: view(row), recordId: prepared.value.id };
      const receipt = receipts.prepareConfirmed(b, submission, { childId, changeSeq: prepared.changeSeq, statusCode: 200, result });
      prepared.commit(); writeRow(b, row); receipt.commit(); return receipt.receipt;
    });
  }
  const service = {
    async submitOnline(userId: string, value: OnlineSubmission): Promise<OnlineReceipt> {
      const submission = parse(onlineSubmissionSchema, value, true);
      const match = /^\/api\/children\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/photos(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(delete|confirm))?$/iu.exec(submission.path);
      if (!match) fail("firebase_domain_not_ready", 503);
      const childId = match[1].toLowerCase(), photoId = match[2]?.toLowerCase();
      if (!photoId) return reserveOperation(userId, childId, submission.operation.opId,
        parse(photoMetadataSchema, submission.payload, true), submission) as Promise<OnlineReceipt>;
      if (match[3] === 'confirm') return confirmOperation(userId, childId, photoId, submission);
      const payload = parse(z.object({ expectedVersion: version, confirmDelete: z.literal(true) }).strict(), submission.payload, true);
      return deleteOperation(userId, childId, photoId, payload.expectedVersion, submission.operation.opId, submission) as Promise<OnlineReceipt>;
    },
    async reserve(userId: string, childId: string, operationId: string, value: PhotoMetadata): Promise<PhotoAttachment> {
      return reserveOperation(userId, childId, operationId, value) as Promise<PhotoAttachment>;
    },
    async get(userId: string, childId: string, id: string): Promise<PhotoAttachment> {
      ids(userId, childId, id); return guard(() => authority.runTransaction(userId, childId, async binding => view(await readRow(binding, id))));
    },
    async list(userId: string, childId: string, input: { limit?: number; cursor?: FirestorePhotoCursor | null } = {}) {
      ids(userId, childId); const checked = parse(z.object({ limit: integer.min(1).max(100).optional(), cursor: cursorSchema.nullable().optional() }).strict(), input, true);
      return guard(() => authority.runTransaction(userId, childId, async binding => {
        const scopeTag = tag(binding.scope), limit = checked.limit ?? 50, cursor = checked.cursor;
        if (cursor && cursor.scopeTag !== scopeTag) fail("cursor_scope", 409);
        let query = data.collection("photos").where("scopeTag", "==", scopeTag).where("live", "==", true);
        if (cursor) query = query.where("sortKey", ">=", cursor.sortKey);
        const snapshot = await binding.transaction.get(query.orderBy("sortKey").limit(limit + 2));
        const rows = snapshot.docs.filter(doc => !cursor || doc.data()?.sortKey !== cursor.sortKey).map(doc => {
          const id = parse(uuid, doc.data()?.assetId), row = checkedRow(doc, binding.scope, id);
          if (doc.data()?.sortKey !== row.createdAt + "/" + row.id || (row.state !== "ready" && row.state !== "reserved")) fail("photo_integrity", 503);
          return row;
        });
        const page = rows.slice(0, limit), complete = rows.length <= limit;
        return { photos: page.map(view), canCreate: true, complete,
          nextCursor: complete ? null : { scopeTag, sortKey: page.at(-1)!.createdAt + "/" + page.at(-1)!.id } };
      }));
    },
    async upload(userId: string, childId: string, id: string, base64: string): Promise<PhotoAttachment> {
      ids(userId, childId, id); const candidate = randomUUID(), startedAt = now();
      return guard(async () => {
        const first = await authority.runTransaction(userId, childId, async binding => {
          const row = await readRow(binding, id); active(row); const quota = await quotas(binding); occupied(row, quota);
          let bytes: Buffer; try { bytes = decodePhoto(base64, row.metadata.mimeType); } catch { fail("invalid_photo", 400); }
          if (bytes.length !== row.metadata.bytes || photoHash(bytes) !== row.metadata.sha256) fail("photo_hash_mismatch", 400);
          if (row.upload && (row.upload.authorizationVersion !== binding.authorizationVersion || row.upload.generation !== binding.generation)) {
            if (!row.objectScope || row.state !== 'reserved') fail("upload_scope_changed", 403);
            // Restore quarantine authorizes only recovery of the original hash/address, never a new upload.
            row.upload = { ...row.upload, authorizationVersion: binding.authorizationVersion, generation: binding.generation };
            writeRow(binding, row);
          }
          const mode = row.state === "ready" ? "read" : row.upload ? "recover" : "write";
          if (!row.upload) { row.upload = { id: candidate, reservationOperationId: row.reservationOperationId, sha256: row.metadata.sha256,
            bytes: row.metadata.bytes, mimeType: row.metadata.mimeType, authorizationVersion: binding.authorizationVersion,
            generation: binding.generation, startedAt }; writeRow(binding, row); }
          return { row, mode, scope: { ...binding.scope }, authorizationVersion: binding.authorizationVersion, generation: binding.generation };
        });
        const metadata = first.row.metadata!;
        let uploaded: FirebasePhotoObjectDescriptor;
        if (first.mode === "read") { await objects.read(photoObjectScope(first.row), id, first.row.descriptor!); uploaded = first.row.descriptor!; }
        else uploaded = await objects[first.mode as "write" | "recover"](photoObjectScope(first.row), id, { base64, mimeType: metadata.mimeType });
        const actual = descriptor(photoObjectScope(first.row), id, uploaded, metadata);
        const final = await authority.runTransaction(userId, childId, async binding => {
          const row = await readRow(binding, id);
          if (!same(binding.scope, first.scope) || binding.authorizationVersion !== first.authorizationVersion || binding.generation !== first.generation
            || row.upload?.id !== first.row.upload!.id) fail("upload_scope_changed", 403);
          if (row.state === "deleted") {
            const snapshot = await binding.transaction.get(cleanupRef(id));
            if (!snapshot.exists) fail("photo_integrity", 503);
            const cleanup = data.open("photo-cleanup", id, binding.scope, firestorePhotoCleanupSchema, snapshot);
            if (cleanup.photoId !== id || !same(cleanup.scope, binding.scope) || cleanup.upload?.id !== row.upload.id
              || cleanup.operationId !== row.deletion?.intent.operationId) fail("photo_integrity", 503);
            descriptor(photoObjectScope(cleanup), id, actual, cleanup);
            if (cleanup.descriptor && !same(cleanup.descriptor, actual)) fail("photo_integrity", 503);
            if (!cleanup.descriptor) binding.transaction.set(cleanupRef(id), { scopeTag: tag(binding.scope), state: "known",
              ...seal("photo-cleanup", id, binding.scope, firestorePhotoCleanupSchema, { ...cleanup, state: "known", descriptor: actual }) });
            return { blocked: true as const, photo: null };
          }
          if (row.state === "deleting") { if (row.descriptor && !same(row.descriptor, actual)) fail("photo_integrity", 503);
            row.descriptor = actual; writeRow(binding, row); return { blocked: true as const, photo: null }; }
          active(row); const quota = await quotas(binding); occupied(row, quota);
          if (!same(row.metadata, metadata) || row.reservationOperationId !== first.row.reservationOperationId) fail("photo_integrity", 503);
          if (row.state === "ready") { if (!same(row.descriptor, actual)) fail("photo_integrity", 503); return { blocked: false as const, photo: view(row) }; }
          if (row.version !== first.row.version) fail("version_conflict");
          const change = await binding.prepareChange(row.upload!.id, "care", false);
          row.state = "ready"; row.version++; row.descriptor = actual; writeRow(binding, row); change.commit();
          return { blocked: false as const, photo: view(row) };
        });
        if (final.blocked) fail("photo_deleting", 409); return final.photo!;
      });
    },
    async content(userId: string, childId: string, id: string) {
      ids(userId, childId, id);
      return guard(async () => {
        const first = await authority.runTransaction(userId, childId, async binding => {
          const row = await readRow(binding, id); active(row); if (row.state !== "ready" || !row.descriptor) fail("not_found", 404);
          return { row, scope: { ...binding.scope }, authorizationVersion: binding.authorizationVersion, generation: binding.generation };
        });
        const content = await objects.read(photoObjectScope(first.row), id, first.row.descriptor!);
        await authority.runTransaction(userId, childId, async binding => {
          const row = await readRow(binding, id); active(row);
          if (!same(binding.scope, first.scope) || binding.authorizationVersion !== first.authorizationVersion || binding.generation !== first.generation
            || row.state !== "ready" || row.version !== first.row.version || !same(row.descriptor, first.row.descriptor)
            || !same(row.metadata, first.row.metadata)) fail("version_conflict");
        });
        const bytes = decodePhoto(content.base64, first.row.metadata!.mimeType);
        if (bytes.length !== first.row.metadata!.bytes || photoHash(bytes) !== first.row.metadata!.sha256 || !bytes.equals(content.buffer)) fail("photo_integrity", 503);
        return { base64: content.base64, bytes, mimeType: first.row.metadata!.mimeType };
      });
    },
    async delete(userId: string, childId: string, id: string, expectedVersion: number, operationId: string): Promise<{ deleted: true; cleanupPending: true }> {
      return deleteOperation(userId, childId, id, expectedVersion, operationId) as Promise<{ deleted: true; cleanupPending: true }>;
    },
    /** Operator/worker only. The immutable erasure intent is authority even after account revocation. */
    async cleanupDeleted(scopeInput: WorkRecoveryScope, idInput: string, operationInput: string): Promise<{ state: "complete" | "pending" }> {
      const scope = parse(workRecoveryScopeSchema, scopeInput, true), id = parse(uuid, idInput, true), operationId = parse(uuid, operationInput, true);
      if (!objects.remove || !journal.read) fail("photo_cleanup_unavailable", 503);
      const inspect = async (tx: import("@google-cloud/firestore").Transaction) => {
        const [photoSnapshot, cleanupSnapshot, quotaSnapshot] = await tx.getAll(rowRef(id), cleanupRef(id), globalRef);
        const row = checkedRow(photoSnapshot, scope, id);
        if (row.state !== "deleted" || !row.deletion?.journal || row.deletion.intent.operationId !== operationId
          || row.deletion.intent.assetId !== id || row.deletion.intent.type !== "photo-delete"
          || !same(row.deletion.intent.scope, scope)) fail("photo_cleanup_binding", 409);
        if (!cleanupSnapshot.exists) return null;
        const cleanup = data.open("photo-cleanup", id, scope, firestorePhotoCleanupSchema, cleanupSnapshot);
        if (cleanup.photoId !== id || cleanup.operationId !== operationId || !same(cleanup.scope, scope)
          || !same(cleanup.journal, row.deletion.journal)
          || cleanup.journal.intentSha256 !== firebaseErasureIntentHash(row.deletion.intent)) fail("photo_integrity", 503);
        const global = data.open("photo-global-quota", "global", SYSTEM, globalQuotaSchema, quotaSnapshot);
        if (global.cleanupCount < 1 || global.cleanupBytes < cleanup.bytes) fail("photo_quota_unavailable", 503);
        if (cleanup.descriptor) descriptor(photoObjectScope(cleanup), id, cleanup.descriptor, cleanup);
        return { cleanup, global, intent: row.deletion.intent };
      };
      return guard(async () => {
        const first = await options.database.runTransaction(inspect);
        if (!first) return { state: "complete" };
        if (first.cleanup.state !== "known" || !first.cleanup.descriptor) {
          // Resolve a lost upload receipt with a pinned, authenticated read; a 404 cannot prove an in-flight upload absent.
          if (first.cleanup.uploadStarted && options.objects.inspect) {
            const found = await options.objects.inspect(photoObjectScope(first.cleanup), id);
            if (found) {
              descriptor(photoObjectScope(first.cleanup), id, found, first.cleanup);
              await options.database.runTransaction(async tx => {
                const current = await inspect(tx); if (!current || !same(current.cleanup, first.cleanup)) return;
                tx.set(cleanupRef(id), { scopeTag: tag(scope), state: 'known',
                  ...seal('photo-cleanup', id, scope, firestorePhotoCleanupSchema, { ...current.cleanup, state: 'known', descriptor: found }) });
              });
            }
          }
          if (first.cleanup.uploadStarted) return { state: 'pending' };
        }
        const intent = await journal.read!(first.intent, first.cleanup.journal);
        if (!same(intent, first.intent)) fail("photo_integrity", 503);
        if (first.cleanup.descriptor) await objects.remove!(photoObjectScope(first.cleanup), id, first.cleanup.descriptor);
        return options.database.runTransaction(async tx => {
          const current = await inspect(tx);
          if (!current) return { state: "complete" as const };
          if (!same(current.cleanup, first.cleanup) || !same(current.intent, first.intent)) fail("version_conflict");
          current.global.cleanupBytes -= current.cleanup.bytes; current.global.cleanupCount--;
          tx.set(globalRef, seal("photo-global-quota", "global", SYSTEM, globalQuotaSchema, current.global));
          tx.delete(cleanupRef(id));
          return { state: "complete" as const };
        });
      });
    },
    /** Trusted erasure consumer only, after canonical admission is blocked. Never a public photo endpoint. */
    async eraseForScope(scope: WorkRecoveryScope, id: string, intent: FirebaseErasureIntent, proof: FirebaseErasureDescriptor) {
      if (!objects.remove || !journal.read) fail('photo_cleanup_unavailable', 503);
      if (!['child-delete', 'account-delete'].includes(intent.type) || scope.ownerUserId !== intent.scope.ownerUserId || scope.workspaceId !== intent.scope.workspaceId
        || scope.storageEpoch !== intent.scope.storageEpoch || intent.type === 'child-delete' && scope.childId !== intent.scope.childId) fail('photo_cleanup_binding');
      if (!same(await journal.read(intent, proof), intent)) fail('photo_integrity', 503);
      const first = await options.database.runTransaction(async tx => {
        const snap = await tx.get(rowRef(id)); return snap.exists ? checkedRow(snap, scope, id) : null;
      });
      if (!first) return true;
      if (first.state === 'deleted') {
        const result = await service.cleanupDeleted(scope, id, first.deletion!.intent.operationId);
        return result.state === 'complete';
      }
      // Unknown uploads retain a cleanup obligation instead of assuming that no object exists.
      if (first.upload && !first.descriptor) {
        const found = await options.objects.inspect?.(photoObjectScope(first), id);
        if (!found) return false;
        descriptor(photoObjectScope(first), id, found, first.upload);
        await options.database.runTransaction(async tx => {
          const row = checkedRow(await tx.get(rowRef(id)), scope, id); if (!same(row, first)) fail('version_conflict');
          row.descriptor = found; writeRow({ scope, transaction: tx } as FirestoreAuthorityTransaction, row);
        });
        return false;
      }
      if (first.descriptor) await objects.remove(photoObjectScope(first), id, first.descriptor);
      return options.database.runTransaction(async tx => {
        const [snap, globalSnap, childSnap] = await tx.getAll(rowRef(id), globalRef, quotaRef(scope));
        if (!snap.exists) return true;
        const row = checkedRow(snap, scope, id);
        if (!same(row, first)) fail('version_conflict');
        const global = data.open('photo-global-quota', 'global', SYSTEM, globalQuotaSchema, globalSnap);
        const child = data.open('photo-child-quota', tag(scope), scope, childQuotaSchema, childSnap);
        const bytes = row.metadata!.bytes;
        if (global.activeCount < 1 || global.activeBytes < bytes || child.count < 1 || child.bytes < bytes) fail('photo_quota_unavailable', 503);
        global.activeCount--; global.activeBytes -= bytes; child.count--; child.bytes -= bytes;
        tx.set(globalRef, seal('photo-global-quota', 'global', SYSTEM, globalQuotaSchema, global));
        tx.set(quotaRef(scope), seal('photo-child-quota', tag(scope), scope, childQuotaSchema, child));
        tx.delete(rowRef(id)); return true;
      });
    },
    async claimExtraction(userId: string, childId: string, id: string, expectedVersion: number) {
      ids(userId, childId, id); parse(version, expectedVersion, true); const runId = randomUUID(), started = now();
      return authority.runTransaction(userId, childId, async b => {
        const row = await readRow(b, id); active(row);
        if (row.state !== 'ready' || row.visibility === 'shared' || row.recordId) fail('not_found', 404);
        if (row.extraction && row.extraction.state !== 'not_requested' && (row.extraction.state !== 'failed' || row.version !== expectedVersion))
          return { created: false, photo: view(row), scope: null };
        if (row.version !== expectedVersion) fail('version_conflict');
        const change = await b.prepareChange(runId, 'care', false);
        row.version++; row.extraction = { state: 'running', runId, draft: null, stopReason: null, processedAt: null, model: null,
          expiresAt: new Date(Date.parse(started) + 95000).toISOString(), authorizationVersion: b.authorizationVersion, generation: b.generation };
        const scope: AgentScope = { userId, childId, workspaceId: b.scope.workspaceId, authorizationVersion: b.authorizationVersion,
          dataVersion: b.scope.storageEpoch + ':' + change.changeSeq };
        writeRow(b, row); change.commit(); return { created: true, photo: view(row), scope };
      });
    },
    async extractionAuthorized(userId: string, childId: string, id: string, runId: string) {
      ids(userId, childId, id); parse(uuid, runId, true);
      return authority.runTransaction(userId, childId, async b => {
        const row = await readRow(b, id), e = row.extraction;
        return row.state === 'ready' && row.visibility !== 'shared' && !row.recordId && e?.state === 'running' && e.runId === runId
          && e.authorizationVersion === b.authorizationVersion && e.generation === b.generation && Date.parse(e.expiresAt!) > Date.parse(now());
      });
    },
    async finishExtraction(userId: string, childId: string, id: string, runId: string, draft: PhotoDraft | null, stopReason: string | null, model: string | null) {
      ids(userId, childId, id); parse(uuid, runId, true);
      return authority.runTransaction(userId, childId, async b => {
        const row = await readRow(b, id); active(row); const e = row.extraction;
        if (row.state !== 'ready' || row.visibility === 'shared' || !e || e.runId !== runId) fail('not_found', 404);
        if (e.state !== 'running') return view(row);
        const allowed = e.authorizationVersion === b.authorizationVersion && e.generation === b.generation && Date.parse(e.expiresAt!) > Date.parse(now());
        const accepted = allowed && draft ? parse(photoDraftSchema, draft) : null;
        row.extraction = { ...e, state: accepted ? 'available' : !allowed || stopReason === 'cancelled' || stopReason === 'deadline' ? 'unknown' : 'failed',
          draft: accepted, stopReason: allowed ? stopReason : 'unauthorized_or_expired', processedAt: now(), model };
        row.version++; const change = await b.prepareChange(randomUUID(), 'care', false);
        writeRow(b, row); change.commit(); return view(row);
      });
    },
  };
  return service;
}
export type FirestorePhotoStore = ReturnType<typeof createFirestorePhotoStore>;

export const firestorePhotoSchemas = { photo: rowSchema, operation: operationSchema, childQuota: childQuotaSchema, globalQuota: globalQuotaSchema, cleanup: firestorePhotoCleanupSchema } as const;
