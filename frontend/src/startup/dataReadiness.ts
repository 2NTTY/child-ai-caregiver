import { parseCareRoute, type RouteParams } from "../navigation/route-state";
import type { RecordsState } from "../../../src/client/records-controller";

export type StartupReadiness = "loading" | "ready" | "error";

/** A failed required read reveals its existing recovery UI, even if another read is pending. */
export function combineStartupReadiness(states: readonly StartupReadiness[]): StartupReadiness {
  return states.includes("error") ? "error" : states.includes("loading") ? "loading" : "ready";
}

export function productionStartupReadiness(state: Pick<RecordsState, "auth" | "online" | "children" | "childrenLoading" | "childrenError" | "childrenLoadedAt" | "selectedChildId">,
  scopeKey: string | null, route: StartupReadiness): StartupReadiness {
  if (state.auth === "checking") return state.online ? "loading" : "error";
  if (state.auth === "unavailable" || !state.online) return "error";
  if (state.auth === "signedOut") return "ready";
  if (state.childrenError) return "error";
  if (state.childrenLoading || state.childrenLoadedAt === null) return "loading";
  if (state.children.length === 0) return route;
  // The list and its initial selection are published separately by the existing owner.
  if (!state.selectedChildId) return "loading";
  if (!scopeKey || !state.children.some(child => child.id === state.selectedChildId)) return "error";
  return route;
}

type StartupRouteParams = RouteParams;

export function routeStartupRequirements(pathname: string, params: StartupRouteParams, hasChild = true, includeShell = false): readonly string[] {
  const care = parseCareRoute(params);
  const requirements: Record<string, readonly string[]> = {
    "/": ["profile", "care", "tasks", "growth"], "/chat": ["chat", "agentPending"], "/care": care.tab === "photos" ? ["photos"] : ["care", "agentPending", ...(care.recordId ? ["careDetail"] : [])], "/profile": ["profile"],
    "/tasks": ["tasks", ...(params.taskId ? ["taskDetail"] : [])], "/growth": params.tab === "preparation" ? ["documents"] : params.tab === "archive" ? ["growth", "documents"] : ["growth"], "/memory": ["memory"], "/history": params.category === "profile" ? ["profile"] : params.category === "preparations" ? ["documents"] : params.category === "growth" ? ["growth"] : params.category === "care" || params.category === "review" ? ["care"] : params.category === "conversations" ? ["conversations"] : params.category === "notifications" ? ["notifications"] : ["tasks"],
    "/photos": ["photos"], "/sources": ["sources"], "/family": ["family"], "/contact": ["contact"],
    "/summary": params.tab === "preparation" ? ["documents"] : params.tab === "archive" ? ["growth", "documents"] : ["profile", "summary"],
    "/settings": params.section === "model" ? ["model"] : params.section === "notifications" ? ["preferences", "push", "telegram"] : [],
  };
  // Empty child pages can show onboarding, but identity-scoped pages must still finish their own reads.
  const identityReads = new Set(["family", "model", "push", "telegram", "preferences"]);
  return [...new Set([...(includeShell && hasChild ? ["profile"] : []), ...(requirements[pathname] ?? [])])]
    .filter(key => hasChild || identityReads.has(key));
}

export function routeStartupReadiness(pathname: string, params: StartupRouteParams, reads: Readonly<Record<string, StartupReadiness>>, hasChild = true, includeShell = false): StartupReadiness {
  return combineStartupReadiness(routeStartupRequirements(pathname, params, hasChild, includeShell).map(key => reads[key] ?? "loading"));
}

export const startupReadState = (value: string | undefined): StartupReadiness => value === undefined || ["loading", "loading_more", "idle", "unread"].includes(value) ? "loading"
  : ["ready", "available"].includes(value) ? "ready" : "error";

/** A list snapshot cannot complete an explicit URL target's independent first read. */
export function targetStartupReadiness(target: string | undefined, loadedId: string | undefined, read: { id: string; state: StartupReadiness } | null | undefined): StartupReadiness {
  if (!target || loadedId === target) return "ready";
  if (read?.id !== target) return "loading";
  return read.state === "ready" ? "error" : read.state;
}

/** The remaining rail only displays tasks; hidden rail content adds no reads. */
export function visibleRailStartupRequirements(visible: boolean): readonly string[] {
  return visible ? ["tasks"] : [];
}
export function visibleRailStartupReadiness(visible: boolean, reads: Readonly<Record<string, StartupReadiness>>): StartupReadiness {
  return combineStartupReadiness(visibleRailStartupRequirements(visible).map(key => reads[key] ?? "loading"));
}
