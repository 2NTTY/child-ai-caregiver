import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { PersonalHistoryOwner } from "../production/usePersonalHistory";
import { useNavigationAuthority } from "./NavigationAuthority";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";

export type NotificationHistoryNavigation = { selectedId: string | null; message: string; href(id: string): Href; open(id: string): void; close(): void };
const key = (route: ReturnType<typeof parseHistoryRoute>) => JSON.stringify(serializeHistoryRoute(route));
const version = (item: { contents: readonly { channel: string; contentVersion: string }[] }) => item.contents.map(content => `${content.channel}:${content.contentVersion}`).sort().join("|");

/** Selection of already authorized personal messages; never a second read or permission owner. */
export function useHistoryNotificationRoute(owner: PersonalHistoryOwner | null): NotificationHistoryNavigation {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/history" && focused && route.category === "notifications";
  const authority = useNavigationAuthority(), leave = useGuardedNavigation();
  // Account-only messages have an empty child scope; identity still owns their selection.
  const scope = owner ? JSON.stringify([authority?.identityKey ?? null, owner.scopeKey]) : null;
  const boundScope = useRef<string | null | undefined>(undefined), mounted = useRef(true), serial = useRef(0);
  const observed = useRef<{ scope: string; id: string; version: string } | null>(null);
  const scopeChanged = boundScope.current !== undefined && boundScope.current !== scope;
  const current = useRef({ route, scope, active, owner }); current.current = { route, scope, active, owner };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  function admitted(basis?: string) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key && current.current.scope === scope
      && (!authority || authority.isCurrent()) && (basis === undefined || key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis);
  }
  function close() {
    if (!admitted(key(route))) return;
    serial.current++; observed.current = null;
    if (route.notificationId !== null) router.setParams(serializeHistoryRoute({ ...route, notificationId: null }));
  }
  const available = owner?.access === "active" && owner.notifications.scopeKey === owner.scopeKey;
  const selected = available ? owner.notifications.data?.items.find(item => item.id === route.notificationId) : undefined;
  const previous = observed.current, sameSelection = previous !== null && previous.scope === scope && previous.id === route.notificationId;
  const replaced = sameSelection && !!selected && previous.version !== version(selected);
  const removed = sameSelection && available && owner.notifications.state === "ready" && !selected;
  useEffect(() => {
    if (!admitted()) return;
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
    if (scopeChanged || replaced || removed) { close(); return; }
    if (scope && selected) observed.current = { scope, id: selected.id, version: version(selected) };
    else if (!route.notificationId) observed.current = null;
  }, [scope, scopeChanged, replaced, removed, selected, route.notificationId, active, authority, navigation, router]);
  return {
    selectedId: !scopeChanged && !replaced && !removed && selected ? selected.id : null,
    message: route.notificationId && !selected && available ? owner.notifications.state === "loading" ? "正在讀取本人消息…" : "這則消息未在目前已載入的清單中。可載入更多，或返回清單選擇。" : "",
    href: id => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "notifications", notificationId: id }) }),
    open(id) {
      const value = current.current.owner;
      if (!admitted(key(route)) || !value || value.access !== "active" || value.notifications.scopeKey !== value.scopeKey || !value.notifications.data?.items.some(item => item.id === id)) return;
      const token = ++serial.current;
      if (current.current.route.notificationId === id) return;
      const basis = key(current.current.route);
      leave(() => {
        const latest = current.current.owner;
        if (!admitted(basis) || token !== serial.current || !latest || latest.access !== "active" || latest.notifications.scopeKey !== latest.scopeKey || !latest.notifications.data?.items.some(item => item.id === id)) return;
        router.push({ pathname: "/history", params: serializeHistoryRoute({ ...current.current.route, notificationId: id }) });
      }, "workspace");
    },
    close,
  };
}
