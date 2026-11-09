import type { ChildSelection, ChildSelectionPreferences } from "../../../src/client/child-selection.ts";

type NavigationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
/** Per-tab navigation preference; the controller validates it against a fresh authorized list. */
export function createWebChildSelectionPreferences(apiBaseUrl: string,
  storage: () => NavigationStorage | null = () => typeof window === "undefined" ? null : window.sessionStorage,
): ChildSelectionPreferences {
  const key = (userId: string) => "yuban-child-selection-v1:" + JSON.stringify([apiBaseUrl, userId]);
  return {
    read(userId) {
      try {
        const value = storage()?.getItem(key(userId));
        if (!value || value.length > 1024) return null;
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const selected = parsed as Record<string, unknown>;
        return Object.keys(selected).length === 2 && identifier(selected.childId) && identifier(selected.workspaceId)
          ? { childId: selected.childId, workspaceId: selected.workspaceId } : null;
      } catch { return null; }
    },
    write(userId, selection: ChildSelection) {
      try { storage()?.setItem(key(userId), JSON.stringify({ childId: selection.childId, workspaceId: selection.workspaceId })); }
      catch { /* Storage availability must not prevent authentication or navigation. */ }
    },
    clear(userId) { try { storage()?.removeItem(key(userId)); } catch { /* Best effort after confirmed logout. */ } },
  };
}
