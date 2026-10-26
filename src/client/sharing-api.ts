import { z } from "zod";
import { sharedSpaceViewSchema, sharedSpacePageSchema, sharedMemberPageSchema, sharedGrantPageSchema, sharedInvitePageSchema, sharedChildViewSchema,
  sharingCommandSchema, sharingOperationSchema, type SharingCommand, type SharingOperation } from "../shared/sharing-control.ts";
import { resolveApiBaseUrl } from "../config/api-base-url.ts";

export class SharingApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status = 0, code = "sharing_unavailable") { super("Sharing request could not be confirmed"); this.name = "SharingApiError"; this.status = status; this.code = code; }
}
const operationLookupSchema = z.object({ operation: sharingOperationSchema.nullable() }).strict();
const identifier = (value: string) => { if (!z.uuid().safeParse(value).success) throw new SharingApiError(400, "invalid_input"); return value; };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalidRedaction = (operation: SharingOperation) => "redacted" in operation && operation.redacted === true
  && (operation.space !== null || operation.invitationToken !== undefined || operation.exit !== undefined);
export function createSharingApi(baseUrl = "", fetcher: typeof fetch = fetch) {
  const base = resolveApiBaseUrl(baseUrl).replace(/\/$/u, ""), api = base.endsWith("/api") ? base : base + "/api";
  async function request(path: string, userId: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    if (!userId || signal.aborted) throw new SharingApiError(409, "identity_changed");
    const controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 20_000);
    try {
      const response = await fetcher(api + "/shared-spaces" + path, { method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "x-expected-user-id": userId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value: unknown = await response.json();
      if (controller.signal.aborted) throw new SharingApiError();
      if (!response.ok) {
        const code = object(value) && object(value.error) ? value.error.code : object(value) ? value.code : null;
        throw new SharingApiError(response.status, typeof code === "string" && /^[a-z_]{1,80}$/u.test(code) ? code : "sharing_unavailable");
      }
      return value;
    } catch (error) { if (error instanceof SharingApiError) throw error; throw new SharingApiError(); }
    finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  }
  function checked<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value); if (!parsed.success) throw new SharingApiError(0, "sharing_response_invalid"); return parsed.data;
  }
  async function page<T>(schema: z.ZodType<{ items: T[]; nextCursor: string | null }>, path: string, userId: string, signal: AbortSignal, cursor?: string) {
    if (cursor !== undefined && (!cursor || cursor.length > 8192)) throw new SharingApiError(400, "invalid_input");
    const result = checked(schema, await request(path + (cursor === undefined ? "" : "?" + new URLSearchParams({ cursor })), userId, signal));
    if (result.nextCursor === "" || cursor !== undefined && result.nextCursor === cursor) throw new SharingApiError(0, "sharing_response_invalid");
    return result;
  }
  return {
    spaces: (userId: string, signal: AbortSignal, cursor?: string) => page(sharedSpacePageSchema, "", userId, signal, cursor),
    async space(spaceId: string, userId: string, signal: AbortSignal) {
      const space = checked(sharedSpaceViewSchema, await request("/" + identifier(spaceId), userId, signal));
      if (space.id !== spaceId) throw new SharingApiError(0, "sharing_response_invalid"); return space;
    },
    async child(spaceId: string, childId: string, userId: string, signal: AbortSignal) {
      const child = checked(sharedChildViewSchema, await request('/' + identifier(spaceId) + '/children/' + identifier(childId), userId, signal));
      if (child.spaceId !== spaceId || child.childId !== childId) throw new SharingApiError(0, 'sharing_response_invalid');
      return child;
    },
    members: (spaceId: string, userId: string, signal: AbortSignal, cursor?: string) => page(sharedMemberPageSchema, "/" + identifier(spaceId) + "/members", userId, signal, cursor),
    shares: (spaceId: string, userId: string, signal: AbortSignal, cursor?: string) => page(sharedGrantPageSchema, "/" + identifier(spaceId) + "/shares", userId, signal, cursor),
    invitations: (spaceId: string, userId: string, signal: AbortSignal, cursor?: string) => page(sharedInvitePageSchema, "/" + identifier(spaceId) + "/invitations", userId, signal, cursor),
    async submit(input: SharingCommand, userId: string, signal: AbortSignal): Promise<SharingOperation> {
      const parsed = sharingCommandSchema.safeParse(input); if (!parsed.success) throw new SharingApiError(400, "invalid_input");
      const command = parsed.data, operation = checked(sharingOperationSchema, await request("/commands", userId, signal, command));
      if (operation.operationId !== command.operationId || operation.action !== command.action
        || "spaceId" in command && (operation.space !== null && operation.space.id !== command.spaceId || operation.exit && operation.exit.spaceId !== command.spaceId)
        || operation.invitationToken !== undefined && command.action !== "invite" || invalidRedaction(operation)) throw new SharingApiError(0, "sharing_response_invalid");
      return operation;
    },
    async operation(operationId: string, userId: string, signal: AbortSignal) {
      const result = checked(operationLookupSchema, await request("/operations/" + identifier(operationId), userId, signal));
      if (result.operation && (result.operation.operationId !== operationId || invalidRedaction(result.operation))) throw new SharingApiError(0, "sharing_response_invalid");
      return result.operation;
    },
  };
}
export type SharingApi = ReturnType<typeof createSharingApi>;
