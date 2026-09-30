import { z } from "zod";
import type { OnlineChange, OnlineCommand } from "../src/shared/online.ts";
import type { FamilyRole } from "../src/shared/family.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES } from "./family-access.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const onlineIdentitySchema = z.object({ opId: z.uuid(), deviceId: z.uuid(), workspaceId: z.uuid(), storageEpoch: z.uuid() }).strict();
export const onlineCommandSchema = z.object({ path: z.string().max(256), payload: z.record(z.string(), z.unknown()) }).strict();
export const onlineSubmissionSchema = onlineCommandSchema.extend({ operation: onlineIdentitySchema }).strict();
export interface OnlineRoute {
  kind: OnlineChange["kind"];
  scope: "child" | "workspace" | "personal" | "invitation";
  targetId?: string;
  roles: readonly FamilyRole[];
  privateResult: boolean;
  deleted: boolean;
}

/** Only local database mutations enter the receipt transaction. Never a model call. */
export function onlineRoute(command: OnlineCommand): OnlineRoute {
  const { path } = command;
  if (path === "/api/children" || path === "/api/notification-preferences") return {
    kind: path === "/api/children" ? "children" : "preferences", scope: "personal", roles: ["owner"], privateResult: path !== "/api/children", deleted: false,
  };
  if (path === "/api/web-push/subscriptions" || new RegExp(`^/api/web-push/subscriptions/${uuid}/(?:revoke|test)$`, "i").test(path)) return {
    kind: "preferences", scope: "personal", roles: ["owner"], privateResult: true, deleted: false,
  };
  if(new RegExp(`^/api/telegram/(?:challenges(?:/${uuid}/confirm)?|bindings/${uuid}/(?:revoke|test))$`,"i").test(path))return {
    kind:"preferences",scope:"personal",roles:["owner"],privateResult:true,deleted:false,
  };
  if (path === "/api/families/invitations/accept") {
    const target = z.object({ confirmWorkspaceId: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict().parse(command.payload);
    return { kind: "family", scope: "invitation", targetId: target.confirmWorkspaceId, roles: READ_ROLES, privateResult: true, deleted: false };
  }
  const child = new RegExp(`^/api/children/(${uuid})/(records|messages|delete|profile(?:/delete)?|care(?:/${uuid}/(?:revise|delete))?)$`, "i").exec(path);
  if (child) {
    const section = child[2];
    return { kind: section === "messages" ? "chat" : section.startsWith("profile") ? "profile" : section === "delete" ? "children" : "care",
      scope: "child", targetId: child[1].toLowerCase(), roles: section === "delete" ? ["owner"] : section === "messages" ? READ_ROLES : WRITE_ROLES,
      privateResult: section === "messages", deleted: section === "delete" || section.endsWith("/delete") };
  }
  const memory = new RegExp(`^/api/children/(${uuid})/memory/(?:facts(?:/${uuid}/(?:confirm|revise|deactivate|delete))?|topics(?:/${uuid}/(?:change|reopen|delete))?)$`, "i").exec(path);
  if (memory) return { kind: "memory", scope: "child", targetId: memory[1].toLowerCase(), roles: READ_ROLES,
    privateResult: true, deleted: path.endsWith("/delete") };
  const preparation = new RegExp("^/api/children/("+uuid+")/visit-preparation$","i").exec(path);
  if(preparation)return {kind:"care",scope:"child",targetId:preparation[1].toLowerCase(),roles:WRITE_ROLES,privateResult:false,deleted:false};
  const task = new RegExp(`^/api/children/(${uuid})/tasks(?:/${uuid}/change)?$`, "i").exec(path);
  if (task) return { kind: "tasks", scope: "child", targetId: task[1].toLowerCase(), roles: WRITE_ROLES, privateResult: false, deleted: false };
  const family = new RegExp(`^/api/families/(${uuid})/(children|invitations(?:/${uuid}/revoke)?|members/[A-Za-z0-9_-]{1,128})$`, "i").exec(path);
  if (family) return { kind: family[2] === "children" ? "children" : "family", scope: "workspace", targetId: family[1].toLowerCase(),
    roles: family[2] === "children" ? WRITE_ROLES : ["owner"], privateResult: false, deleted: false };
  throw new FamilyError(404, "not_found");
}

/** Stable object-key order; array order and exact user strings remain significant. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
