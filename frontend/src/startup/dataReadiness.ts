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

export function routeStartupReadiness(pathname: string, params: { tab?: string; category?: string; section?: string; view?: string }, reads: Readonly<Record<string, StartupReadiness>>, hasChild = true): StartupReadiness {
  const requirements: Record<string, readonly string[]> = {
    "/": ["profile", "care", "tasks", "growth"], "/chat": ["chat"], "/care": params.view === "photos" ? ["photos"] : ["care"], "/profile": ["profile"],
    "/tasks": ["tasks"], "/growth": params.tab === "archive" ? ["growth", "documents"] : ["growth"], "/memory": ["memory"], "/history": params.category === "preparations" ? ["documents"] : params.category === "growth" ? ["growth"] : params.category === "care" || params.category === "review" ? ["care"] : params.category === "conversations" || params.category === "notifications" ? [] : ["tasks"],
    "/photos": ["photos"], "/sources": ["sources"], "/family": ["family"], "/contact": ["contact"],
    "/summary": params.tab === "preparation" ? ["documents"] : ["profile", "summary"],
    "/settings": params.section === "model" ? ["model"] : params.section === "notifications" ? ["push", "telegram"] : params.section === "preferences" ? ["preferences"] : [],
  };
  // Empty child pages can show onboarding, but identity-scoped pages must still finish their own reads.
  const identityReads = new Set(["family", "model", "push", "telegram", "preferences"]);
  return combineStartupReadiness((requirements[pathname] ?? []).filter(key => hasChild || identityReads.has(key)).map(key => reads[key] ?? "loading"));
}
