import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { PreparationWorkspaceValue } from "../workspaces/PreparationWorkspace";
import type { PreparationNavigation } from "./useGrowthRouteNavigation";
import { useNavigationAuthority } from "./NavigationAuthority";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";

type HistoryRoute = ReturnType<typeof parseHistoryRoute>;
const key = (route: HistoryRoute) => JSON.stringify(serializeHistoryRoute(route));
export type HistoryPreparationNavigation = PreparationNavigation & { closeForNavigation(): void };

/** Archived selection stays in the original document owner; only accepted reads publish a URL. */
export function useHistoryPreparationRoute(scope: string | null, owner: PreparationWorkspaceValue | null): HistoryPreparationNavigation {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/history" && focused && route.category === "preparations";
  const authority = useNavigationAuthority(), mounted = useRef(true), boundScope = useRef<string | null | undefined>(undefined);
  const current = useRef({ scope, owner, route, active }); current.current = { scope, owner, route, active };
  const scopeChanged = boundScope.current !== undefined && boundScope.current !== scope;
  type Intent = { basis: string; scope: string; model: object; origin: string | null; id: string | null; mode: "push" | "replace" | "navigation" };
  const [intent, setIntent] = useState<Intent | null>(null), pending = useRef(intent); pending.current = intent;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function admitted(basis?: string) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key
      && current.current.scope === scope && (!authority || authority.isCurrent())
      && (basis === undefined || key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis);
  }
  function clear() { pending.current = null; setIntent(null); }
  function write(id: string | null, mode: "push" | "replace") {
    if (current.current.route.documentId === id) return;
    const params = serializeHistoryRoute({ ...current.current.route, documentId: id });
    if (mode === "push") router.push({ pathname: "/history", params }); else router.setParams(params);
  }
  function select(id: string | null, mode: Intent["mode"]) {
    const value = current.current.owner, starting = current.current.route;
    if (!admitted(key(starting)) || !scope || !value || value.scopeKey !== scope || value.model.condition === "lost") return;
    if (id !== null && !value.model.documents.some(item => item.id === id && item.status === "archived")) return;
    const selected = value.model.selected?.id ?? null;
    if (selected === id) {
      const superseded = pending.current; clear();
      // The published A can have a still-unpublished B in the original owner.
      if (superseded) { if (id === null) value.actions.closeDocument(); else value.actions.selectDocument(id); }
      if (mode !== "navigation") write(id, mode);
      return;
    }
    const request: Intent = { basis: key(starting), scope, model: value.model, origin: selected, id, mode };
    pending.current = request; setIntent(request);
    // These original methods flush checks, but never discard drafts or unknown receipts.
    if (id === null) value.actions.closeDocument(); else value.actions.selectDocument(id);
  }
  useEffect(() => {
    if (!active) { if (pending.current) clear(); return; }
    if (!admitted()) return;
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
    if (scopeChanged) { clear(); if (route.documentId) write(null, "replace"); return; }
    if (!owner || owner.scopeKey !== scope || owner.model.condition === "lost") return;
    const request = pending.current, selected = owner.model.selected;
    if (request) {
      if (request.scope !== scope || !admitted(request.basis)) clear();
      else {
        if (owner.model === request.model) return;
        if ((selected?.id ?? null) !== request.id) {
          if ((selected?.id ?? null) === request.origin) return;
          clear();
          if (selected?.status === "archived") { write(selected.id, "replace"); return; }
        } else if (request.mode === "navigation") return; // The category/filter commits its complete route.
        else { clear(); write(request.id, request.mode); return; }
      }
    }
    // A pure Back to the index hides readonly context, without inventing a discard.
    if (!route.documentId) return;
    const requested = owner.model.documents.find(item => item.id === route.documentId);
    if (selected?.id === route.documentId && selected.status === "active") { write(null, "replace"); return; }
    if (requested?.status === "archived" && selected?.id !== requested.id) select(requested.id, "replace");
  }, [route, scope, scopeChanged, owner, active, intent, authority, navigation, router]);
  const requested = route.documentId, eligible = !!requested && owner?.model.documents.some(item => item.id === requested && item.status === "archived");
  return {
    selectedId: !scopeChanged && owner?.model.condition !== "lost" && eligible && owner?.model.selected?.id === requested && owner.model.selected.status === "archived" ? requested : null,
    message: requested && !eligible && owner?.model.condition !== "lost" ? owner?.model.condition === "loading" ? "正在讀取歸檔準備單…" : "這份準備單未在目前已載入的歸檔清單中。可載入更多，或返回清單選擇。" : "",
    href: id => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "preparations", documentId: id }) }),
    open: id => select(id, "push"), close: () => select(null, "replace"), closeForNavigation: () => select(null, "navigation"),
  };
}
