import { z } from "zod";
import type { PhotoAttachment, PhotoConfirmation, PhotoMetadata } from "../shared/photos.ts";
import { PHOTO_LIMITS, photoDraftSchema, photoMetadataSchema } from "../shared/photos.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class PhotoApiError extends Error {
  constructor(readonly status = 0, readonly onlineCode: string | null = null, readonly confirmed = false) {
    super("Photo request could not be confirmed");
    this.name = "PhotoApiError";
  }
}

export type PhotoWriteResult = { photo: PhotoAttachment; recordId?: string } | { deleted: true; cleanupPending: true } | null;
export type PhotoReconciliation = { state: "confirmed"; result: PhotoWriteResult } | { state: "unconfirmed" } | null;
export interface PhotoApi {
  photos(childId: string, signal: AbortSignal, userId: string): Promise<{ photos: PhotoAttachment[]; canCreate: boolean }>;
  photo(childId: string, photoId: string, signal: AbortSignal, userId: string): Promise<PhotoAttachment>;
  content(photo: PhotoAttachment, signal: AbortSignal, userId: string): Promise<Blob>;
  reserve(childId: string, metadata: PhotoMetadata, signal: AbortSignal, userId: string): Promise<PhotoWriteResult>;
  upload(photo: PhotoAttachment, base64: string, signal: AbortSignal, userId: string): Promise<PhotoAttachment>;
  extract(photo: PhotoAttachment, signal: AbortSignal, userId: string): Promise<PhotoAttachment>;
  confirm(photo: PhotoAttachment, input: PhotoConfirmation, signal: AbortSignal, userId: string): Promise<PhotoWriteResult>;
  delete(photo: PhotoAttachment, signal: AbortSignal, userId: string): Promise<PhotoWriteResult>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<PhotoReconciliation>;
  hasPendingOnline(): boolean;
  resetOnline(): void;
}

const user = z.string().min(1).max(128);
const version = z.number().int().positive().max(2147483647);
const photoSchema = photoMetadataSchema.extend({
  id: z.uuid(), childId: z.uuid(), ownerUserId: user, createdAt: z.iso.datetime({ offset: true }), version,
  state: z.enum(["reserved", "ready"]), visibility: z.enum(["private", "shared"]), canManage: z.boolean(),
  recordId: z.uuid().nullable(),
  extraction: z.object({
    state: z.enum(["not_requested", "running", "available", "failed", "unknown"]), runId: z.uuid().nullable(),
    draft: photoDraftSchema.nullable(), stopReason: z.string().max(200).nullable(),
    processedAt: z.iso.datetime({ offset: true }).nullable(), model: z.string().max(200).nullable(),
  }).strict(),
}).strict();
const resultSchema = z.object({ photo: photoSchema }).strict();
const confirmationSchema = z.object({ photo: photoSchema, recordId: z.uuid() }).strict();
const deletionSchema = z.object({ deleted: z.literal(true), cleanupPending: z.literal(true) }).strict();
type Target = {
  kind: "reserve" | "confirm" | "delete"; childId: string; userId: string;
  photoId?: string; metadata?: PhotoMetadata; expectedVersion?: number;
};
const codes = new Set(["session_changed", "version_conflict", "invalid_input", "forbidden", "not_found",
  "photo_capacity", "photo_processing", "photo_hash_mismatch", "invalid_photo",
  "photo_extraction_unknown", "operation_pending", "operation_busy", "operation_result_unavailable"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sameMetadata = (left: PhotoMetadata, right: PhotoMetadata) =>
  left.fileName === right.fileName && left.mimeType === right.mimeType && left.bytes === right.bytes
  && left.sha256 === right.sha256 && left.source === right.source;

function checkedPhoto(value: unknown, childId: string, userId: string, photoId?: string, confirmed = false): PhotoAttachment {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success || parsed.data.photo.childId !== childId || (photoId !== undefined && parsed.data.photo.id !== photoId)
    || (parsed.data.photo.visibility === "private" && parsed.data.photo.ownerUserId !== userId)) {
    throw new PhotoApiError(0, null, confirmed);
  }
  return parsed.data.photo;
}

function checkedWrite(value: unknown, target: Target): PhotoWriteResult {
  if (target.kind === "delete") {
    const parsed = deletionSchema.safeParse(value);
    if (!parsed.success) throw new PhotoApiError(0, null, true);
    return parsed.data;
  }
  if (target.kind === "confirm") {
    const parsed = confirmationSchema.safeParse(value);
    if (!parsed.success) throw new PhotoApiError(0, null, true);
    const photo = checkedPhoto({ photo: parsed.data.photo }, target.childId, target.userId, target.photoId, true);
    if (photo.visibility !== "shared" || photo.recordId !== parsed.data.recordId || photo.state !== "ready"
      || photo.version <= target.expectedVersion!) throw new PhotoApiError(0, null, true);
    return { photo, recordId: parsed.data.recordId };
  }
  const photo = checkedPhoto(value, target.childId, target.userId, undefined, true);
  if (photo.ownerUserId !== target.userId || photo.visibility !== "private" || !target.metadata
    || !sameMetadata(photo, target.metadata)) throw new PhotoApiError(0, null, true);
  return { photo };
}

export function createPhotoApi(baseUrl = "", fetcher: typeof fetch = fetch): PhotoApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : base + "/api";
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0;
  let pendingTarget: Target | null = null;
  const collection = (childId: string) => "/children/" + encodeURIComponent(childId) + "/photos";
  const entity = (childId: string, photoId: string) => collection(childId) + "/" + encodeURIComponent(photoId);
  const identity = (childId: string, userId: string, photoId?: string) => {
    if (!z.uuid().safeParse(childId).success || !user.safeParse(userId).success
      || (photoId !== undefined && !z.uuid().safeParse(photoId).success)) throw new PhotoApiError(400, "invalid_input");
  };

  async function call<T>(signal: AbortSignal, action: (innerSignal: AbortSignal) => Promise<T>, timeoutMs = 20_000): Promise<T> {
    const started = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, timeoutMs);
    try {
      if (controller.signal.aborted) throw new PhotoApiError();
      const value = await action(controller.signal);
      if (started !== generation) throw new PhotoApiError();
      return value;
    } catch (error) {
      if (error instanceof PhotoApiError) throw error;
      if (error instanceof OnlineTransportError) throw new PhotoApiError(error.status, error.code, error.confirmed);
      throw new PhotoApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  async function response(path: string, signal: AbortSignal, userId: string, body?: unknown): Promise<Response> {
    const result = await fetcher(apiUrl + path, {
      method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", signal,
      headers: { Accept: "application/json", "x-expected-user-id": userId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok) {
      let code: string | null = null;
      try {
        const value: unknown = await result.json();
        if (object(value) && object(value.error) && typeof value.error.code === "string" && codes.has(value.error.code)) code = value.error.code;
      } catch { /* Remote error bodies are never displayed. */ }
      throw new PhotoApiError(result.status, code);
    }
    return result;
  }
  const request = (path: string, signal: AbortSignal, userId: string, body?: unknown, timeoutMs = 20_000) =>
    call(signal, async innerSignal => (await response(path, innerSignal, userId, body)).json() as Promise<unknown>, timeoutMs);
  async function mutate(path: string, payload: unknown, target: Target, signal: AbortSignal): Promise<PhotoWriteResult> {
    if (!online.hasPending()) pendingTarget = target;
    let confirmed = false;
    try {
      const value = await call(signal, async innerSignal => {
        const result = await online.submit({ path: "/api" + path, payload }, innerSignal, target.userId);
        confirmed = true;
        return result;
      });
      return checkedWrite(value, target);
    } catch (error) {
      if (error instanceof PhotoApiError && error.confirmed && error.onlineCode === "operation_result_unavailable") return null;
      if (confirmed && error instanceof PhotoApiError) throw new PhotoApiError(error.status, error.onlineCode, true);
      throw error;
    } finally {
      if (!online.hasPending()) pendingTarget = null;
    }
  }

  return {
    hasPendingOnline: () => online.hasPending(),
    resetOnline() { generation++; pendingTarget = null; online.reset(); },
    async reconcilePending(signal, userId) {
      const target = pendingTarget;
      let confirmed = false;
      try {
        const receipt = await call(signal, async innerSignal => {
          const value = await online.checkPending(innerSignal, userId);
          confirmed = value?.state === "confirmed";
          return value;
        });
        if (receipt?.state !== "confirmed") return receipt;
        if (receipt.result === null) return { state: "confirmed", result: null };
        if (!target || target.userId !== userId) throw new PhotoApiError(0, null, true);
        return { state: "confirmed", result: checkedWrite(receipt.result, target) };
      } catch (error) {
        if (confirmed && error instanceof PhotoApiError) throw new PhotoApiError(error.status, error.onlineCode, true);
        throw error;
      } finally {
        if (!online.hasPending()) pendingTarget = null;
      }
    },
    async photos(childId, signal, userId) {
      identity(childId, userId);
      const parsed = z.object({ photos: z.array(photoSchema).max(PHOTO_LIMITS.count), canCreate: z.boolean() }).strict()
        .safeParse(await request(collection(childId), signal, userId));
      if (!parsed.success || new Set(parsed.data.photos.map(photo => photo.id)).size !== parsed.data.photos.length
        || parsed.data.photos.some(photo => photo.childId !== childId || (photo.visibility === "private" && photo.ownerUserId !== userId))) {
        throw new PhotoApiError();
      }
      return parsed.data;
    },
    async photo(childId, photoId, signal, userId) {
      identity(childId, userId, photoId);
      return checkedPhoto(await request(entity(childId, photoId), signal, userId), childId, userId, photoId);
    },
    async content(photo, signal, userId) {
      identity(photo.childId, userId, photo.id);
      return call(signal, async innerSignal => {
        const result = await response(entity(photo.childId, photo.id) + "/content", innerSignal, userId);
        if (result.headers.get("content-type")?.split(";")[0].trim() !== photo.mimeType) throw new PhotoApiError();
        const blob = await result.blob();
        if (blob.size !== photo.bytes || blob.size > PHOTO_LIMITS.bytes) throw new PhotoApiError();
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== photo.sha256) throw new PhotoApiError();
        return blob;
      });
    },
    async reserve(childId, metadata, signal, userId) {
      identity(childId, userId);
      const parsed = photoMetadataSchema.safeParse(metadata);
      if (!parsed.success || !parsed.data.source.trim()) throw new PhotoApiError(400, "invalid_input");
      return mutate(collection(childId), parsed.data, { kind: "reserve", childId, userId, metadata: parsed.data }, signal);
    },
    async upload(photo, base64, signal, userId) {
      identity(photo.childId, userId, photo.id);
      const value = await request(entity(photo.childId, photo.id) + "/content", signal, userId, { base64 });
      const next = checkedPhoto(value, photo.childId, userId, photo.id);
      if (next.state !== "ready" || !sameMetadata(photo, next)) throw new PhotoApiError();
      return next;
    },
    async extract(photo, signal, userId) {
      identity(photo.childId, userId, photo.id);
      const value = await request(entity(photo.childId, photo.id) + "/extract", signal, userId,
        { expectedVersion: photo.version, confirmModel: true }, 90_000);
      const next = checkedPhoto(value, photo.childId, userId, photo.id);
      if (!sameMetadata(photo, next) || next.version < photo.version) throw new PhotoApiError();
      return next;
    },
    async confirm(photo, input, signal, userId) {
      identity(photo.childId, userId, photo.id);
      if (input.expectedVersion !== photo.version || input.confirmShared !== true) throw new PhotoApiError(400, "invalid_input");
      return mutate(entity(photo.childId, photo.id) + "/confirm", input,
        { kind: "confirm", childId: photo.childId, userId, photoId: photo.id, expectedVersion: photo.version }, signal);
    },
    async delete(photo, signal, userId) {
      identity(photo.childId, userId, photo.id);
      return mutate(entity(photo.childId, photo.id) + "/delete", { expectedVersion: photo.version, confirmDelete: true },
        { kind: "delete", childId: photo.childId, userId, photoId: photo.id }, signal);
    },
  };
}
