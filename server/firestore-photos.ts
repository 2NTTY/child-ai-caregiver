import { randomUUID } from "node:crypto";
import type { Firestore, DocumentSnapshot } from "@google-cloud/firestore";
import { z } from "zod";
import { PHOTO_LIMITS, photoMetadataSchema, type PhotoAttachment, type PhotoMetadata } from "../src/shared/photos.ts";
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
const rowSchema = z.object({ id: uuid, scope: workRecoveryScopeSchema, reservationOperationId: uuid, createdAt: at, version,
  state: z.enum(["reserved", "ready", "deleting", "deleted"]), metadata: photoMetadataSchema.nullable(),
  descriptor: firebasePhotoObjectDescriptorSchema.nullable(), upload: uploadSchema.nullable(), deletion: deletionSchema.nullable() }).strict()
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
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
export interface FirestorePhotosOptions extends FirestoreAuthorityOptions {
  objects: Pick<FirebasePhotoObjects, "write" | "recover" | "read"> & Partial<Pick<FirebasePhotoObjects, "remove">>;
  journal: Pick<FirebaseErasureJournal, "writeOnce"> & Partial<Pick<FirebaseErasureJournal, "read">>;
}
/** Domain transactions own permission, quotas and receipts. Storage calls never run inside SDK callbacks. */
export function createFirestorePhotoStore(options: FirestorePhotosOptions) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), receipts = createFirestoreOnlineReceipts(options), { objects, journal } = options;
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
      version: row.version, state: row.state as "reserved" | "ready", visibility: "private", canManage: true, recordId: null,
      extraction: { state: "not_requested", runId: null, draft: null, stopReason: null, processedAt: null, model: null } };
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
        const change = await binding.prepareChange(operationId, "care", true), metadata = row.metadata!;
        const result = { deleted: true as const, cleanupPending: true as const };
        const sharedWrite = submission ? receipts.prepareConfirmed(binding, submission,
          { childId, changeSeq: change.changeSeq, statusCode: 200, result }, true) : null;
        const cleanup: FirestorePhotoCleanup = { scope: row.scope, photoId: id, operationId, state: row.descriptor ? "known" : "unresolved",
          uploadStarted: row.upload !== null, upload: row.upload, sha256: metadata.sha256, bytes: metadata.bytes, mimeType: metadata.mimeType,
          descriptor: row.descriptor, journal: journalDescriptor };
        binding.transaction.create(cleanupRef(id), { scopeTag: tag(binding.scope), state: cleanup.state,
          ...seal("photo-cleanup", id, binding.scope, firestorePhotoCleanupSchema, cleanup) });
        row.state = "deleted"; row.version++; row.metadata = null; row.descriptor = null; row.deletion.journal = journalDescriptor;
        writeRow(binding, row); writeOperation(binding, { ...prior, state: "confirmed", result });
        quota.child.bytes -= metadata.bytes; quota.child.count--; quota.global.activeBytes -= metadata.bytes; quota.global.activeCount--;
        quota.global.cleanupBytes += metadata.bytes; quota.global.cleanupCount++;
        writeQuotas(binding, quota); redact?.(); sharedWrite?.commit(); change.commit(); return sharedWrite ? sharedWrite.receipt : result;
      });
    });
  }
  return {
    async submitOnline(userId: string, value: OnlineSubmission): Promise<OnlineReceipt> {
      const submission = parse(onlineSubmissionSchema, value, true);
      const match = /^\/api\/children\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/photos(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/delete)?$/iu.exec(submission.path);
      if (!match) fail("firebase_domain_not_ready", 503);
      const childId = match[1].toLowerCase(), photoId = match[2]?.toLowerCase();
      if (!photoId) return reserveOperation(userId, childId, submission.operation.opId,
        parse(photoMetadataSchema, submission.payload, true), submission) as Promise<OnlineReceipt>;
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
          if (row.upload && (row.upload.authorizationVersion !== binding.authorizationVersion || row.upload.generation !== binding.generation)) fail("upload_scope_changed", 403);
          const mode = row.state === "ready" ? "read" : row.upload ? "recover" : "write";
          if (!row.upload) { row.upload = { id: candidate, reservationOperationId: row.reservationOperationId, sha256: row.metadata.sha256,
            bytes: row.metadata.bytes, mimeType: row.metadata.mimeType, authorizationVersion: binding.authorizationVersion,
            generation: binding.generation, startedAt }; writeRow(binding, row); }
          return { row, mode, scope: { ...binding.scope }, authorizationVersion: binding.authorizationVersion, generation: binding.generation };
        });
        const metadata = first.row.metadata!;
        let uploaded: FirebasePhotoObjectDescriptor;
        if (first.mode === "read") { await objects.read(first.scope, id, first.row.descriptor!); uploaded = first.row.descriptor!; }
        else uploaded = await objects[first.mode as "write" | "recover"](first.scope, id, { base64, mimeType: metadata.mimeType });
        const actual = descriptor(first.scope, id, uploaded, metadata);
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
            descriptor(binding.scope, id, actual, cleanup);
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
        const content = await objects.read(first.scope, id, first.row.descriptor!);
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
        if (cleanup.descriptor) descriptor(scope, id, cleanup.descriptor, cleanup);
        return { cleanup, global, intent: row.deletion.intent };
      };
      return guard(async () => {
        const first = await options.database.runTransaction(inspect);
        if (!first) return { state: "complete" };
        // An upload with no confirmed object identity cannot be guessed or treated as absent.
        if (first.cleanup.state !== "known" || !first.cleanup.descriptor) return { state: "pending" };
        const intent = await journal.read!(first.intent, first.cleanup.journal);
        if (!same(intent, first.intent)) fail("photo_integrity", 503);
        await objects.remove!(scope, id, first.cleanup.descriptor);
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
    async extract(): Promise<never> { fail("firebase_domain_not_ready", 503); },
    async confirm(): Promise<never> { fail("firebase_domain_not_ready", 503); },
  };
}
export type FirestorePhotoStore = ReturnType<typeof createFirestorePhotoStore>;

export const firestorePhotoSchemas = { photo: rowSchema, operation: operationSchema, childQuota: childQuotaSchema, globalQuota: globalQuotaSchema, cleanup: firestorePhotoCleanupSchema } as const;
