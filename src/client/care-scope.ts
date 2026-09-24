import type { Child } from "../shared/records.ts";
import type { RecordsState } from "./records-controller.ts";
export interface CareScope { userId: string; child: Child }

// Keep page-only drafts mounted but hidden during session checks. Confirmed logout,
// another identity or a fresh child list without access discards the old component.
export function retainCareScope(previous: CareScope | null, state: RecordsState): CareScope | null {
  if (state.auth === "signedOut") return null;
  if (state.auth === "checking" || state.auth === "unavailable") return previous;
  const child = state.children.find(item => item.id === state.selectedChildId);
  if (state.user && child) return { userId: state.user.id, child };
  if (state.user?.id !== previous?.userId) return null;
  return state.childrenLoading || !state.childrenLoadedAt ? previous : null;
}
