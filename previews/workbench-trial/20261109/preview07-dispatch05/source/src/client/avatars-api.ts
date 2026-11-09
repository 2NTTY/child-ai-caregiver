import { z } from "zod";
import { createOnlineTransport, OnlineTransportError, type OnlineTransport } from "./online-transport.ts";
import { readBlobBytes, sha256Bytes } from "./blob-bytes.ts";
import { AVATAR_ERROR_CODES, avatarTargetSchema, avatarReadResultSchema, avatarReserveInputSchema,
  avatarReserveResultSchema, avatarMutationResultSchema, avatarUploadSchema, avatarCommitInputSchema, avatarRemoveInputSchema,
  avatarStateSchema, avatarContentInputSchema, sameAvatarTarget } from "../shared/avatars.ts";
import type {
  AvatarCommitInput, AvatarMutationResult, AvatarReadResult, AvatarRemoveInput,
  AvatarReserveInput, AvatarReserveResult, AvatarState, AvatarTarget, AvatarUpload,
} from "../shared/avatars.ts";

export class AvatarApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  readonly retryAfterSeconds: number | null;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false, retryAfterSeconds: number | null = null) {
    super("Avatar request could not be confirmed");
    this.name = "AvatarApiError";
    this.status = status; this.onlineCode = onlineCode; this.confirmed = confirmed; this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type AvatarReconciliation =
  | { state: "confirmed"; kind: "reserve"; target: AvatarTarget; result: AvatarReserveResult | null }
  | { state: "confirmed"; kind: "commit" | "remove"; target: AvatarTarget; result: AvatarMutationResult | null }
  | { state: "unconfirmed" }
  | null;

/**
 * One online lane per target; self never depends on a selected child.
 * Mutations use the existing online transport, preserving each original opId/body on retry.
 * A confirmed null result requires read(); it is not proof of a failed mutation.
 * The UI owns identity/workspace/epoch keys, editor attempts, and short-lived object URLs.
 */
export interface AvatarApi {
  read(target: AvatarTarget, signal: AbortSignal, userId: string): Promise<AvatarReadResult>;
  reserve(target: AvatarTarget, input: AvatarReserveInput, signal: AbortSignal, userId: string): Promise<AvatarReserveResult | null>;
  uploadStatus(target: AvatarTarget, uploadId: string, signal: AbortSignal, userId: string): Promise<AvatarUpload>;
  uploadContent(upload: AvatarUpload, base64: string, signal: AbortSignal, userId: string): Promise<AvatarUpload>;
  commit(target: AvatarTarget, input: AvatarCommitInput, signal: AbortSignal, userId: string): Promise<AvatarMutationResult | null>;
  remove(target: AvatarTarget, input: AvatarRemoveInput, signal: AbortSignal, userId: string): Promise<AvatarMutationResult | null>;
  content(avatar: AvatarState, signal: AbortSignal, userId: string): Promise<Blob>;
  reconcilePending(target: AvatarTarget, signal: AbortSignal, userId: string): Promise<AvatarReconciliation>;
  hasPendingOnline(target?: AvatarTarget): boolean;
  /** Cancels local requests/late results, not remote operations. Omit target on account/server/epoch change. */
  resetOnline(target?: AvatarTarget): void;
}


type Pending = { kind: "reserve"; target: AvatarTarget; input: AvatarReserveInput }
  | { kind: "commit"; target: AvatarTarget; input: AvatarCommitInput }
  | { kind: "remove"; target: AvatarTarget; input: AvatarRemoveInput };
type Lane = { target: AvatarTarget; online: OnlineTransport; active: Set<AbortController>; valid: boolean;
  userId: string | null; pending: Pending | null; mutationBusy: boolean };
const userSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const safeCodes = new Set<string>([...AVATAR_ERROR_CODES, "session_changed", "identity_changed", "storage_epoch_changed",
  "account_precondition_required", "unauthorized", "forbidden", "not_found", "invalid_input", "operation_conflict",
  "operation_mismatch", "operation_pending", "operation_busy", "operation_result_unavailable", "operation_erased"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sameAsset = (left: AvatarUpload["normalized"], right: AvatarUpload["normalized"]) => left === null ? right === null
  : right !== null && left.id === right.id && left.sha256 === right.sha256 && left.bytes === right.bytes
    && left.mimeType === right.mimeType && left.width === right.width && left.height === right.height;

/** No avatar bytes, upload payloads, or receipts are persisted in browser/native storage. */
export function createAvatarApi(baseUrl = "", fetcher: typeof fetch = fetch, hashBytes = sha256Bytes): AvatarApi {
  const base = baseUrl.replace(/\/$/u, ""), apiUrl = base.endsWith("/api") ? base : base + "/api";
  const lanes = new Map<string, Lane>();
  const pathFor = (target: AvatarTarget) => target.kind === "self" ? "/me/avatar" : "/children/" + encodeURIComponent(target.childId) + "/avatar";
  const keyFor = (target: AvatarTarget) => target.kind === "self" ? "self" : "child:" + target.childId;
  function checkedTarget(value: AvatarTarget): AvatarTarget {
    const parsed = avatarTargetSchema.safeParse(value);
    if (!parsed.success) throw new AvatarApiError(400, "invalid_input");
    return parsed.data;
  }
  function resetOnline(target?: AvatarTarget) {
    const keys = target === undefined ? [...lanes.keys()] : [keyFor(checkedTarget(target))];
    for (const key of keys) {
      const lane = lanes.get(key); if (!lane) continue;
      lane.valid = false; lane.online.reset(); lane.pending = null;
      for (const controller of lane.active) controller.abort(); lane.active.clear(); lanes.delete(key);
    }
  }
  function laneFor(targetInput: AvatarTarget, userId: string): Lane {
    const target = checkedTarget(targetInput);
    if (!userSchema.safeParse(userId).success) throw new AvatarApiError(400, "invalid_input");
    if ([...lanes.values()].some(lane => lane.userId !== null && lane.userId !== userId)) {
      resetOnline(); throw new AvatarApiError(409, "session_changed");
    }
    const key = keyFor(target); let lane = lanes.get(key);
    if (!lane) { lane = { target, online: createOnlineTransport(apiUrl, fetcher, { preserveAmbiguousLookup404: true, resetOnIdentityChanged: true }), active: new Set(), valid: true,
      userId, pending: null, mutationBusy: false }; lanes.set(key, lane); }
    return lane;
  }
  async function call<T>(lane: Lane, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(), abort = () => controller.abort();
    lane.active.add(controller); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(abort, 30_000);
    try {
      if (!lane.valid || controller.signal.aborted) throw new AvatarApiError();
      const value = await action(controller.signal);
      if (!lane.valid || controller.signal.aborted) throw new AvatarApiError();
      return value;
    } catch (error) {
      if (error instanceof AvatarApiError) throw error;
      if (error instanceof OnlineTransportError) throw new AvatarApiError(error.status, error.code, error.confirmed);
      throw new AvatarApiError();
    } finally { clearTimeout(deadline); lane.active.delete(controller); signal.removeEventListener("abort", abort); }
  }
  async function response(lane: Lane, path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
    const result = await fetcher(apiUrl + path, { method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", signal,
      headers: { Accept: "application/json", "x-expected-user-id": lane.userId!, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!result.ok) {
      let code: string | null = null;
      try { const value: unknown = await result.json();
        if (object(value) && object(value.error) && typeof value.error.code === "string" && safeCodes.has(value.error.code)) code = value.error.code;
      } catch { /* Do not disclose server/decoder error text. */ }
      const rawRetry = result.headers.get("retry-after"), retry = rawRetry !== null && /^[0-9]{1,6}$/u.test(rawRetry) ? Number(rawRetry) : null;
      throw new AvatarApiError(result.status, code, false, retry);
    }
    return result;
  }
  function checkedUpload(value: unknown, target: AvatarTarget, expected?: Pick<AvatarUpload, "id" | "expectedVersion" | "policyId">): AvatarUpload {
    const parsed = avatarReserveResultSchema.safeParse(value);
    if (!parsed.success || !sameAvatarTarget(parsed.data.upload.target, target)
      || expected && (parsed.data.upload.id !== expected.id || parsed.data.upload.expectedVersion !== expected.expectedVersion || parsed.data.upload.policyId !== expected.policyId))
      throw new AvatarApiError(503, "avatar_integrity_failed");
    return parsed.data.upload;
  }
  function checkedWrite(value: unknown, pending: Pending): AvatarReserveResult | AvatarMutationResult {
    if (pending.kind === "reserve") {
      const upload = checkedUpload(value, pending.target);
      if (upload.expectedVersion !== pending.input.expectedVersion || upload.policyId !== pending.input.policyId || upload.state !== "reserved")
        throw new AvatarApiError(503, "avatar_integrity_failed", true);
      return { upload };
    }
    const parsed = avatarMutationResultSchema.safeParse(value);
    if (!parsed.success || !sameAvatarTarget(parsed.data.avatar.target, pending.target)
      || parsed.data.avatar.version !== pending.input.expectedVersion + 1
      || (pending.kind === "remove" ? parsed.data.avatar.asset !== null : parsed.data.avatar.asset === null))
      throw new AvatarApiError(503, "avatar_integrity_failed", true);
    return parsed.data;
  }
  async function mutate(pending: Pending, signal: AbortSignal, userId: string): Promise<AvatarReserveResult | AvatarMutationResult | null> {
    const lane = laneFor(pending.target, userId);
    if (lane.mutationBusy) throw new AvatarApiError(409, "operation_busy");
    lane.mutationBusy = true;
    if (!lane.online.hasPending()) lane.pending = pending;
    let confirmed = false;
    try {
      const value = await call(lane, signal, async inner => {
        const result = await lane.online.submit({ path: "/api" + pathFor(pending.target) + (pending.kind === "reserve" ? "/uploads" : "/" + pending.kind), payload: pending.input }, inner, userId);
        confirmed = true; return result;
      });
      return checkedWrite(value, pending);
    } catch (error) {
      if (error instanceof AvatarApiError && error.confirmed && error.onlineCode === "operation_result_unavailable") return null;
      if (confirmed && error instanceof AvatarApiError) throw new AvatarApiError(error.status, error.onlineCode, true, error.retryAfterSeconds);
      throw error;
    } finally { lane.mutationBusy = false; if (!lane.online.hasPending()) lane.pending = null; }
  }
  const parseInput = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value); if (!parsed.success) throw new AvatarApiError(400, "invalid_input"); return parsed.data;
  };
  return {
    resetOnline,
    hasPendingOnline(target) { return target === undefined ? [...lanes.values()].some(lane => lane.online.hasPending())
      : lanes.get(keyFor(checkedTarget(target)))?.online.hasPending() ?? false; },
    async read(target, signal, userId) {
      const lane = laneFor(target, userId);
      return call(lane, signal, async inner => {
        const parsed = avatarReadResultSchema.safeParse(await (await response(lane, pathFor(lane.target), inner)).json());
        if (!parsed.success || !sameAvatarTarget(parsed.data.avatar.target, lane.target)) throw new AvatarApiError(503, "avatar_integrity_failed");
        return parsed.data;
      });
    },
    async reserve(target, input, signal, userId) {
      return await mutate({ kind: "reserve", target: checkedTarget(target), input: parseInput(avatarReserveInputSchema, input) }, signal, userId) as AvatarReserveResult | null;
    },
    async commit(target, input, signal, userId) {
      return await mutate({ kind: "commit", target: checkedTarget(target), input: parseInput(avatarCommitInputSchema, input) }, signal, userId) as AvatarMutationResult | null;
    },
    async remove(target, input, signal, userId) {
      return await mutate({ kind: "remove", target: checkedTarget(target), input: parseInput(avatarRemoveInputSchema, input) }, signal, userId) as AvatarMutationResult | null;
    },
    async uploadStatus(target, uploadId, signal, userId) {
      const lane = laneFor(target, userId); parseInput(z.uuid(), uploadId);
      return call(lane, signal, async inner => {
        const upload = checkedUpload(await (await response(lane, pathFor(lane.target) + "/uploads/" + encodeURIComponent(uploadId), inner)).json(), lane.target);
        if (upload.id !== uploadId) throw new AvatarApiError(503, "avatar_integrity_failed"); return upload;
      });
    },
    async uploadContent(uploadInput, base64, signal, userId) {
      const upload = parseInput(avatarUploadSchema, uploadInput), lane = laneFor(upload.target, userId);
      const body = parseInput(avatarContentInputSchema, { base64 });
      return call(lane, signal, async inner => {
        const next = checkedUpload(await (await response(lane, pathFor(lane.target) + "/uploads/" + encodeURIComponent(upload.id) + "/content", inner, body)).json(), lane.target, upload);
        if (next.state !== "ready" && next.state !== "committed" || upload.normalized !== null && !sameAsset(upload.normalized, next.normalized))
          throw new AvatarApiError(503, "avatar_integrity_failed");
        return next;
      });
    },
    async content(avatarInput, signal, userId) {
      const avatar = parseInput(avatarStateSchema, avatarInput), asset = avatar.asset;
      if (!asset) throw new AvatarApiError(404, "not_found");
      const lane = laneFor(avatar.target, userId);
      return call(lane, signal, async inner => {
        const result = await response(lane, pathFor(lane.target) + "/content?assetId=" + encodeURIComponent(asset.id) + "&version=" + avatar.version, inner);
        if (result.headers.get("content-type")?.split(";")[0].trim() !== asset.mimeType) throw new AvatarApiError(503, "avatar_integrity_failed");
        const length = result.headers.get("content-length");
        if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) !== asset.bytes)) throw new AvatarApiError(503, "avatar_integrity_failed");
        const blob = await result.blob();
        if (blob.size !== asset.bytes || await hashBytes(await readBlobBytes(blob)) !== asset.sha256) throw new AvatarApiError(503, "avatar_integrity_failed");
        return blob;
      });
    },
    async reconcilePending(target, signal, userId) {
      const lane = laneFor(target, userId), pending = lane.pending;
      if (lane.mutationBusy) throw new AvatarApiError(409, "operation_busy");
      lane.mutationBusy = true; let confirmed = false;
      try {
        const receipt = await call(lane, signal, async inner => { const result = await lane.online.checkPending(inner, userId); confirmed = result?.state === "confirmed"; return result; });
        if (receipt?.state !== "confirmed") return receipt;
        if (!pending) throw new AvatarApiError(503, "avatar_integrity_failed", true);
        const result = receipt.result === null ? null : checkedWrite(receipt.result, pending);
        return pending.kind === "reserve"
          ? { state: "confirmed", kind: "reserve", target: pending.target, result: result as AvatarReserveResult | null }
          : { state: "confirmed", kind: pending.kind, target: pending.target, result: result as AvatarMutationResult | null };
      } catch (error) {
        if (confirmed && error instanceof AvatarApiError) throw new AvatarApiError(error.status, error.onlineCode, true, error.retryAfterSeconds);
        throw error;
      } finally { lane.mutationBusy = false; if (!lane.online.hasPending()) lane.pending = null; }
    },
  };
}
