import type { RecordsState } from "../../../src/client/records-controller.ts";

export function confirmedUserId(state: RecordsState): string | null {
  return state.auth === "signedIn" && state.busy !== "logout" ? state.user?.id ?? null : null;
}

export function productionIdentityKey(apiBaseUrl: string, state: RecordsState, generation: number): string | null {
  const userId = confirmedUserId(state);
  return userId ? JSON.stringify([apiBaseUrl, userId, generation]) : null;
}

export function productionScopeKey(apiBaseUrl: string, state: RecordsState, generation: number): string | null {
  const identity = productionIdentityKey(apiBaseUrl, state, generation);
  const child = state.children.find(item => item.id === state.selectedChildId);
  if (!identity || !child || state.deletion?.childId === child.id) return null;
  return JSON.stringify([apiBaseUrl, state.user!.id, generation, child.id, child.accessRole ?? null]);
}
