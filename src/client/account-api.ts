import { z } from "zod";
import { resolveApiBaseUrl } from "../config/api-base-url.ts";
import { accountAcknowledgementSchema, accountEraseExecuteSchema, SERVICE_POLICY_VERSION, type AccountExportPage, type AccountEraseReceipt, type AccountServiceStatus } from "../shared/account-service.ts";
const receiptSchema = z.object({ operationId: z.uuid(), state: z.enum(["prepared", "completed"]), attachmentsPending: z.boolean() }).strict();
const preparedSchema = receiptSchema.extend({ receiptToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), summary: z.object({ childCount: z.number().int().nonnegative() }).strict(), expiresAt: z.iso.datetime() }).strict();
const exportPageSchema = z.object({ section: z.string().min(1).max(80), items: z.array(z.unknown()).max(200), nextCursor: z.string().max(16000).nullable(), complete: z.boolean(), scopeVersion: z.string().regex(/^[a-f0-9]{64}$/), notices: z.array(z.string()).max(20) }).strict();
const statusSchema = z.object({ enabled: z.boolean(), registration: z.enum(["invite", "trial"]), mailConfigured: z.boolean(), policyVersion: z.string(), notice: z.string(),
  user: z.object({ id: z.string(), emailVerified: z.boolean(), acknowledged: z.boolean(), acknowledgementVersion: z.string().nullable() }).strict().nullable() }).strict();
export type PreparedAccountDeletion = z.infer<typeof preparedSchema>;
export interface AccountDownload { format: "yuban-personal-data:1"; scopeVersion: string; sections: { section: string; childId: string | null; items: unknown[]; notices: string[]; complete: true }[]; complete: true }
export class AccountApiError extends Error {
  readonly status: number; readonly code: string | null;
  constructor(status = 0, code: string | null = null) { super("Account request could not be confirmed"); this.name = "AccountApiError"; this.status = status; this.code = code; }
}
export function createAccountApi(baseUrl = "", fetcher: typeof fetch = fetch) {
  const base = resolveApiBaseUrl(baseUrl), apiUrl = base.endsWith("/api") ? base : base + "/api";
  let identity: string | null = null, generation = 0, pending: { userId: string; operationId: string; receipt: PreparedAccountDeletion | null; executionUnknown: boolean } | null = null;
  const active = new Set<AbortController>();
  const recoveries = new Map<string, { operationId: string; receiptToken: string | null; executionUnknown: boolean }>();
  function setIdentity(userId: string | null) {
    if (identity === userId) return;
    if (pending?.receipt?.state === "completed") recoveries.delete(pending.userId);
    else if (pending) recoveries.set(pending.userId, { operationId: pending.operationId, receiptToken: pending.receipt?.receiptToken ?? recoveries.get(pending.userId)?.receiptToken ?? null, executionUnknown: pending.executionUnknown });
    for (const controller of active) controller.abort(); active.clear(); identity = userId; generation++; pending = null;
  }
  function requireIdentity(userId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new AccountApiError(400, "invalid_input");
    if (identity === null) setIdentity(userId);
    if (identity !== userId) throw new AccountApiError(409, "session_changed");
  }
  async function request(path: string, signal: AbortSignal, userId: string | null, body?: unknown, receiptToken?: string): Promise<unknown> {
    if (userId) requireIdentity(userId);
    const ticket = generation, controller = new AbortController(), abort = () => controller.abort(); active.add(controller);
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await fetcher(apiUrl + path, { method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", ...(userId ? { "x-expected-user-id": userId } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(receiptToken ? { "x-erasure-receipt": receiptToken } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      if (!response.ok) {
        let code: string | null = null;
        try { const value = await response.json(); if (typeof value?.error?.code === "string" && /^[a-z_]{1,80}$/.test(value.error.code)) code = value.error.code; } catch { /* Keep status only. */ }
        throw new AccountApiError(response.status, code);
      }
      const value: unknown = await response.json();
      if (controller.signal.aborted || ticket !== generation || userId !== null && identity !== userId) throw new AccountApiError(409, "session_changed");
      return value;
    } catch (error) { if (error instanceof AccountApiError) throw error; throw new AccountApiError(); }
    finally { clearTimeout(timeout); active.delete(controller); signal.removeEventListener("abort", abort); }
  }
  async function exportPage(userId: string, query: { section: string; childId?: string; scopeVersion?: string; cursor?: string }, signal: AbortSignal): Promise<AccountExportPage> {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const page = exportPageSchema.parse(await request("/account/export?" + params, signal, userId));
    if (page.section !== query.section || page.complete !== (page.nextCursor === null) || query.scopeVersion && page.scopeVersion !== query.scopeVersion) throw new AccountApiError(409, "export_scope_changed");
    return page;
  }
  return {
    setIdentity,
    async status(userId: string | null, signal: AbortSignal): Promise<AccountServiceStatus> {
      const status = statusSchema.parse(await request("/account", signal, userId));
      if (userId && status.user?.id !== userId) throw new AccountApiError(409, "session_changed"); return status;
    },
    async acknowledge(userId: string, operationId: string, signal: AbortSignal) {
      const body = accountAcknowledgementSchema.parse({ operationId, accepted: true, policyVersion: SERVICE_POLICY_VERSION });
      return statusSchema.parse(await request("/account/acknowledgement", signal, userId, body));
    },
    exportPage,
    async download(userId: string, signal: AbortSignal): Promise<AccountDownload> {
      requireIdentity(userId);
      const ticket = generation, manifest = await exportPage(userId, { section: "manifest" }, signal), scopeVersion = manifest.scopeVersion;
      const definition = z.object({ format: z.literal("yuban-personal-data:1"), sections: z.array(z.object({ section: z.string().min(1).max(80), childScoped: z.boolean(), required: z.literal(true) }).strict()).min(1).max(80) }).passthrough().parse(manifest.items[0]);
      const sections: AccountDownload["sections"] = [{ section: "manifest", childId: null, items: manifest.items, notices: manifest.notices, complete: true }];
      const childIds: string[] = [];
      async function collect(section: string, childId?: string) {
        let cursor: string | undefined, items: unknown[] = [], notices: string[] = []; const seen = new Set<string>();
        do {
          if (signal.aborted || ticket !== generation || identity !== userId) throw new AccountApiError(409, "session_changed");
          const page = await exportPage(userId, { section, ...(childId ? { childId } : {}), scopeVersion, ...(cursor ? { cursor } : {}) }, signal);
          items.push(...page.items); notices.push(...page.notices);
          if (page.nextCursor && seen.has(page.nextCursor)) throw new AccountApiError(0, "invalid_export_cursor");
          if (page.nextCursor) seen.add(page.nextCursor); cursor = page.nextCursor ?? undefined;
        } while (cursor);
        sections.push({ section, childId: childId ?? null, items, notices: [...new Set(notices)], complete: true });
        if (section === "children") for (const item of items) childIds.push(z.object({ id: z.uuid() }).passthrough().parse(item).id);
      }
      if (!definition.sections.some(value => value.section === "children" && !value.childScoped)) throw new AccountApiError();
      await collect("children");
      for (const section of definition.sections.filter(value => !value.childScoped && value.section !== "children")) await collect(section.section);
      for (const childId of childIds) for (const section of definition.sections.filter(value => value.childScoped)) await collect(section.section, childId);
      // One final authorization/version check prevents delivering copies completed under a stale scope.
      await exportPage(userId, { section: "manifest", scopeVersion }, signal);
      if (signal.aborted || ticket !== generation || identity !== userId) throw new AccountApiError(409, "session_changed");
      return { format: "yuban-personal-data:1", scopeVersion, sections, complete: true };
    },
    async prepareDeletion(userId: string, signal: AbortSignal, operationId?: string): Promise<PreparedAccountDeletion> {
      requireIdentity(userId);
      if (pending && (pending.userId !== userId || operationId && pending.operationId !== operationId)) throw new AccountApiError(409, "check_original_erasure");
      const recovery = recoveries.get(userId);
      if (recovery && operationId && operationId !== recovery.operationId) throw new AccountApiError(409, "check_original_erasure");
      const attempt = pending ?? { userId, operationId: recovery?.operationId ?? operationId ?? crypto.randomUUID(), receipt: null, executionUnknown: recovery?.executionUnknown ?? false }; pending = attempt;
      const receipt = preparedSchema.parse(await request("/account/deletion/prepare", signal, userId, { operationId: attempt.operationId }));
      if (receipt.operationId !== attempt.operationId || pending !== attempt) throw new AccountApiError(); attempt.receipt = receipt; return receipt;
    },
    async executeDeletion(userId: string, input: { password: string; confirmation: string }, signal: AbortSignal): Promise<AccountEraseReceipt> {
      requireIdentity(userId);
      const attempt = pending; if (!attempt?.receipt || attempt.userId !== userId) throw new AccountApiError(409, "erasure_prepare_required");
      const body = accountEraseExecuteSchema.parse({ ...input, operationId: attempt.operationId, receiptToken: attempt.receipt.receiptToken });
      attempt.executionUnknown = true;
      try {
        const result = receiptSchema.parse(await request("/account/delete", signal, userId, body));
        if (result.operationId !== attempt.operationId) throw new AccountApiError();
        if (result.state === "completed") attempt.executionUnknown = false;
        attempt.receipt = { ...attempt.receipt, state: result.state, attachmentsPending: result.attachmentsPending };
        return result;
      } catch (error) {
        if (error instanceof AccountApiError && ["password_verification_failed", "erasure_receipt_expired", "account_scope_changed", "invalid_input"].includes(error.code ?? "") && error.status >= 400 && error.status < 500) attempt.executionUnknown = false;
        throw error;
      }
    },
    async deletionStatus(receipt: Pick<PreparedAccountDeletion, "operationId" | "receiptToken">, signal: AbortSignal): Promise<AccountEraseReceipt> {
      z.uuid().parse(receipt.operationId); z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(receipt.receiptToken);
      const result = receiptSchema.parse(await request("/account/deletion/" + receipt.operationId, signal, null, undefined, receipt.receiptToken));
      if (result.operationId !== receipt.operationId) throw new AccountApiError();
      if (pending?.operationId === result.operationId && result.state === "completed") {
        pending.executionUnknown = false;
        if (pending.receipt) pending.receipt = { ...pending.receipt, state: result.state, attachmentsPending: result.attachmentsPending };
      }
      if (result.state === "completed") for (const [userId, recovery] of recoveries) if (recovery.operationId === result.operationId) recoveries.delete(userId);
      return result;
    },
    async discardPreparedDeletion(userId: string, signal: AbortSignal) {
      requireIdentity(userId);
      const attempt = pending;
      if (!attempt || attempt.userId !== userId || attempt.executionUnknown) throw new AccountApiError(409, "check_original_erasure");
      if (attempt.receipt) {
        const result = receiptSchema.parse(await request("/account/deletion/" + attempt.operationId, signal, null, undefined, attempt.receipt.receiptToken));
        if (result.state !== "prepared") throw new AccountApiError(409, "erasure_already_completed");
      }
      // Only a prepare with no unconfirmed execution may be replaced. Never discard an unknown delete.
      if (pending !== attempt || identity !== userId) throw new AccountApiError(409, "session_changed");
      recoveries.delete(userId); pending = null;
    },
    pendingDeletion: () => pending?.userId === identity ? pending.receipt : null,
    deletionRecovery: () => identity ? recoveries.get(identity) ?? (pending ? { operationId: pending.operationId, receiptToken: pending.receipt?.receiptToken ?? null } : null) : null,
  };
}
