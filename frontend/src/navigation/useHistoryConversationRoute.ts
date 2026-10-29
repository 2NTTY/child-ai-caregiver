import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useFocusEffect, useIsFocused, useRoute } from "expo-router/react-navigation";
import type { PersonalHistoryOwner } from "../production/usePersonalHistory";
import { useNavigationAuthority } from "./NavigationAuthority";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";

type HistoryRoute = ReturnType<typeof parseHistoryRoute>;
const key = (route: HistoryRoute) => JSON.stringify(serializeHistoryRoute(route));
export type ConversationHistoryNavigation = {
  selectedId: string | null; message: string; ownsRead: boolean;
  href(id: string): Href; open(id: string): void; close(): void; closeForNavigation(): void;
};

/** URL admission for the original segmented reader; never an independent message cache. */
export function useHistoryConversationRoute(owner: PersonalHistoryOwner | null): ConversationHistoryNavigation {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/history" && focused && route.category === "conversations";
  const authority = useNavigationAuthority(), leave = useGuardedNavigation();
  const scope = owner ? JSON.stringify([authority?.identityKey ?? null, owner.scopeKey]) : null;
  const mounted = useRef(true), serial = useRef(0), bound = useRef<string | null | undefined>(undefined);
  const owned = useRef<{ scope: string; id: string } | null>(null);
  const current = useRef({ owner, route, active, scope, authority }); current.current = { owner, route, active, scope, authority };
  type Intent = { scope: string; basis: string; read: object; id: string | null; mode: "push" | "replace" | "navigation" };
  const [intent, setIntent] = useState<Intent | null>(null), pending = useRef(intent); pending.current = intent;
  const scopeChanged = bound.current !== undefined && bound.current !== scope;
  function readable(value: PersonalHistoryOwner | null): value is PersonalHistoryOwner {
    return !!value && !value.messageOnly && !!value.childId && value.access === "active" && value.message.scopeKey === value.scopeKey
      && (!authority || authority.scopeKey === value.scopeKey);
  }
  const available = readable(owner);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  function admitted(basis?: string) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key && current.current.scope === scope
      && (!authority || authority.isCurrent()) && (basis === undefined || key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis);
  }
  function clear() { pending.current = null; setIntent(null); }
  function write(id: string | null, mode: "push" | "replace") {
    if (current.current.route.messageId === id) return;
    const params = serializeHistoryRoute({ ...current.current.route, messageId: id });
    if (mode === "push") router.push({ pathname: "/history", params }); else router.setParams(params);
  }
  function loaded(value: PersonalHistoryOwner, id: string) {
    return value.history.scopeKey === value.scopeKey && value.history.data?.matches.some(match => match.id === id)
      || value.message.scopeKey === value.scopeKey && value.message.data?.id === id;
  }
  function release() {
    const latest = current.current, previous = owned.current;
    owned.current = null;
    // The getter reads the original target even before a newer consumer publishes.
    if (previous?.scope === latest.scope && latest.owner?.selectedMessageId === previous.id
      && (!latest.authority || latest.authority.isCurrent())) latest.owner.actions.closeMessage();
  }
  function select(id: string | null, mode: Intent["mode"], retry = false) {
    const value = current.current.owner;
    if (!admitted(key(current.current.route)) || !readable(value) || !scope) return;
    if (id !== null && !loaded(value, id)) return;
    if (id !== null && mode === "push" && !value.online) return;
    if (id === null && (!owned.current || value.selectedMessageId !== owned.current.id)) {
      clear(); if (mode !== "navigation") write(null, mode); return;
    }
    if (id !== null && pending.current?.id === id && pending.current.read === value.message && value.selectedMessageId === id) return;
    if (id !== null && value.selectedMessageId === id && value.message.state !== "unavailable"
      && (!value.message.data || value.message.data.id === id) && (!retry || value.message.state !== "error")) {
      clear(); owned.current = { scope, id }; if (mode !== "navigation") write(id, mode); return;
    }
    if (id !== null && !value.online) return;
    const request: Intent = { scope, basis: key(current.current.route), read: value.message, id, mode };
    pending.current = request; setIntent(request);
    if (id === null) value.actions.closeMessage();
    else { owned.current = { scope, id }; value.actions.readMessage(id); }
  }
  useEffect(() => {
    if (!active) {
      if (pending.current) clear();
      if (pathname === "/history" && focused) release();
      return;
    }
    if (!admitted()) return;
    if (scope !== null || bound.current !== undefined) bound.current = scope;
    if (scopeChanged) { clear(); owned.current = null; if (route.messageId) write(null, "replace"); return; }
    if (!available || !owner) return;
    const request = pending.current;
    if (request) {
      if (request.scope !== scope || !admitted(request.basis)) clear();
      else {
        if (owner.message === request.read) return;
        if (owner.selectedMessageId !== request.id) { clear(); write(null, "replace"); return; }
        if (request.id && (owner.message.state === "unavailable" || owner.message.data && owner.message.data.id !== request.id)) return;
        if (request.mode === "navigation") return;
        clear(); if (request.id === null) owned.current = null;
        write(request.id, request.mode); return;
      }
    }
    if (!route.messageId) return; // Pure index navigation hides, rather than discards, readonly context.
    if (owner.selectedMessageId === route.messageId && owner.message.state !== "unavailable") owned.current = { scope: scope!, id: route.messageId };
    else if (loaded(owner, route.messageId)) select(route.messageId, "replace");
  }, [route, owner, scope, scopeChanged, available, active, pathname, focused, intent, authority, navigation, router]);
  useFocusEffect(useCallback(() => () => {
    if (navigation.isFocused()) return; // Strict replay is not a departure.
    const state = navigation.getState(), live = state?.routes[state.index];
    if (live?.name === entry.name && parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>).messageId === owned.current?.id) return;
    release();
  }, [navigation, entry.name]));
  const ownedRead = owned.current;
  const selected = available && !scopeChanged && route.messageId && owner.selectedMessageId === route.messageId && owner.message.state !== "unavailable"
    && (!owner.message.data || owner.message.data.id === route.messageId) ? route.messageId : null;
  return {
    selectedId: selected,
    ownsRead: !!selected || available && !!ownedRead && ownedRead.scope === scope && owner.selectedMessageId === ownedRead.id,
    message: route.messageId && available && !selected && !loaded(owner, route.messageId) ? "這則對話未在目前已搜尋的結果中。可繼續搜尋，或返回清單選擇。" : "",
    href: id => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "conversations", messageId: id }) }),
    open(id) {
      const value = current.current.owner;
      if (!admitted(key(route)) || !readable(value) || !value.online || !loaded(value, id)) return;
      const token = ++serial.current, basis = key(current.current.route);
      leave(() => { if (token === serial.current && admitted(basis)) select(id, "push", true); }, "workspace");
    },
    close() { serial.current++; select(null, "replace"); },
    closeForNavigation() { serial.current++; select(null, "navigation"); },
  };
}
