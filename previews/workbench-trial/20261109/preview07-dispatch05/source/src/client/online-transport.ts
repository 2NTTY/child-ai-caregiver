import { AVATAR_ERROR_CODES } from "../shared/avatars.ts";
import type { OnlineCommand, OnlineContext, OnlineIdentity, OnlineReceipt, OnlineSubmission } from "../shared/online.ts";

export class OnlineTransportError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, code: string | null = null, confirmed = false) {
    super("Online operation could not be confirmed");
    this.name = "OnlineTransportError";
    this.status = status;
    this.code = code;
    this.confirmed = confirmed;
  }
}

export interface OnlineTransport {
  submit(command: OnlineCommand, signal: AbortSignal, userId: string): Promise<unknown>;
  checkPending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  reset(): void;
  hasPending(): boolean;
}

interface PendingOperation { userId: string; command: OnlineCommand; canonical: string; operation: OnlineIdentity }
const safeCodes = new Set([
  ...AVATAR_ERROR_CODES, "operation_conflict", "operation_erased",
  "inputs_capacity", "input_processing",
  "operation_mismatch", "storage_epoch_changed", "session_changed", "identity_changed", "version_conflict",
  "not_found", "forbidden", "invalid_input", "validation_error", "operation_result_unavailable",
  "unauthorized", "account_precondition_required", "unsupported_media_type", "invalid_json",
  "invitation_unavailable", "already_member", "invitation_conflict", "owner_immutable",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const validContext = (value: unknown): value is OnlineContext => object(value) && validId(value.workspaceId) && validId(value.storageEpoch);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function snapshot(command: OnlineCommand): { command: OnlineCommand; canonical: string } {
  if (!object(command) || typeof command.path !== "string") throw new OnlineTransportError();
  try {
    const copied = JSON.parse(JSON.stringify(command)) as OnlineCommand;
    if (!object(copied) || typeof copied.path !== "string" || !("payload" in copied)) throw new Error();
    return { command: copied, canonical: canonicalJson(copied) };
  } catch {
    throw new OnlineTransportError();
  }
}

function validReceipt(value: unknown, expected: OnlineIdentity): value is OnlineReceipt {
  if (!object(value) || value.state !== "confirmed" || !object(value.operation)) return false;
  const identity = value.operation;
  return validId(identity.opId) && validId(identity.deviceId) && validId(identity.workspaceId) && validId(identity.storageEpoch)
    && identity.opId === expected.opId && identity.deviceId === expected.deviceId
    && identity.workspaceId === expected.workspaceId && identity.storageEpoch === expected.storageEpoch
    && typeof value.changeSeq === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value.changeSeq)
    && BigInt(value.changeSeq) <= 9223372036854775807n
    && typeof value.statusCode === "number" && Number.isSafeInteger(value.statusCode)
    && value.statusCode >= 200 && value.statusCode <= 299 && "result" in value && value.result !== undefined;
}

function validUnconfirmed(value: unknown): value is { state: "unconfirmed" } {
  return object(value) && value.state === "unconfirmed" && Object.keys(value).length === 1;
}

export function createOnlineTransport(apiUrl: string, fetcher: typeof fetch = fetch,
  options: { preserveAmbiguousLookup404?: boolean; resetOnIdentityChanged?: boolean } = {}): OnlineTransport {
  const base = apiUrl.replace(/\/$/, "");
  const deviceId = crypto.randomUUID();
  let pending: PendingOperation | null = null;
  let busy = false;
  let generation = 0;

  function reset(): void { pending = null; generation += 1; }
  function current(generationAtStart: number): void {
    if (generation !== generationAtStart) throw new OnlineTransportError();
  }
  function clearOnTerminal(error: OnlineTransportError): void {
    // A missing lookup route does not prove that the original command never committed.
    if (error.status === 401 || error.status === 404 && !options.preserveAmbiguousLookup404 || error.code === "session_changed"
      || error.code === "identity_changed" && options.resetOnIdentityChanged) reset();
  }
  async function request(path: string, signal: AbortSignal, userId: string, body?: unknown): Promise<unknown> {
    try {
      const response = await fetcher(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", signal,
        headers: { Accept: "application/json", "x-expected-user-id": userId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        let code: string | null = null;
        try {
          const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string" && safeCodes.has(value.error.code)) code = value.error.code;
        } catch { /* A response body is never an error message. */ }
        throw new OnlineTransportError(response.status, code);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof OnlineTransportError) throw error;
      throw new OnlineTransportError();
    }
  }
  async function lookup(entry: PendingOperation, signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" }> {
    const value = await request(`/online/operations/${encodeURIComponent(entry.operation.opId)}`, signal, userId);
    if (validReceipt(value, entry.operation) || validUnconfirmed(value)) return value;
    throw new OnlineTransportError();
  }
  function result(receipt: OnlineReceipt): unknown {
    reset();
    if (receipt.result === null) throw new OnlineTransportError(409, "operation_result_unavailable", true);
    return receipt.result;
  }
  async function post(entry: PendingOperation, signal: AbortSignal, userId: string, started: number): Promise<unknown> {
    let value: unknown;
    try {
      const submission: OnlineSubmission = { ...entry.command, operation: entry.operation };
      value = await request("/online/submit", signal, userId, submission);
    } catch (error) {
      current(started);
      if (error instanceof OnlineTransportError) {
        if ((error.status >= 400 && error.status <= 499
          && error.code !== "operation_mismatch" && error.code !== "storage_epoch_changed")
          || error.status === 401 || error.status === 404) reset();
      }
      throw error;
    }
    current(started);
    if (!validReceipt(value, entry.operation)) throw new OnlineTransportError();
    return result(value);
  }

  return {
    hasPending: () => pending !== null,
    reset,
    async submit(command, signal, userId) {
      if (busy) throw new OnlineTransportError(409, "operation_busy");
      busy = true;
      try {
        if (pending?.userId !== undefined && pending.userId !== userId) reset();
        const input = snapshot(command);
        if (pending) {
          if (input.canonical !== pending.canonical) throw new OnlineTransportError(409, "operation_pending");
          const started = generation;
          let receipt: OnlineReceipt | { state: "unconfirmed" };
          try { receipt = await lookup(pending, signal, userId); }
          catch (error) {
            current(started);
            if (error instanceof OnlineTransportError) clearOnTerminal(error);
            throw error;
          }
          current(started);
          if (receipt.state === "confirmed") return result(receipt);
          return await post(pending, signal, userId, started);
        }
        const started = generation;
        let context: unknown;
        try { context = await request("/online/context", signal, userId, input.command); }
        catch (error) { current(started); throw error; }
        current(started);
        if (!validContext(context)) throw new OnlineTransportError();
        const operation: OnlineIdentity = { workspaceId: context.workspaceId, storageEpoch: context.storageEpoch,
          opId: crypto.randomUUID(), deviceId };
        pending = { userId, command: input.command, canonical: input.canonical, operation };
        return await post(pending, signal, userId, started);
      } finally { busy = false; }
    },
    async checkPending(signal, userId) {
      if (busy) throw new OnlineTransportError(409, "operation_busy");
      busy = true;
      try {
        if (pending && pending.userId !== userId) reset();
        if (!pending) return null;
        const started = generation;
        let receipt: OnlineReceipt | { state: "unconfirmed" };
        try { receipt = await lookup(pending, signal, userId); }
        catch (error) {
          current(started);
          if (error instanceof OnlineTransportError) clearOnTerminal(error);
          throw error;
        }
        current(started);
        if (receipt.state === "confirmed") reset();
        return receipt;
      } finally { busy = false; }
    },
  };
}
