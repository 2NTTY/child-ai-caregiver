import { useNavigationScope } from "../navigation/NavigationScope";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { Link, usePathname, useRouter, type Href } from "expo-router";
import { AppDialog as Dialog } from "../components/AppDialog";
import { AppButton } from "../components/ui";
import { chineseFont, colors, typeScale } from "../theme";
import { isProductionRouteConnected } from "../production/routes";
import { guardBrowserHistory, type HistoryGuardWindow, type HistoryRecoveryError } from "./browser-history-guard";
import { currentBrowserTraversal, type BrowserTraversalReceipt } from "./browser-history-events";

export type LeaveScope = "child" | "account";
export type LeavePendingKind = "saving" | "unknown";
type LeaveIntent = "navigation" | "workspace" | "child";
export type LeavePromptCopy = { message: string; actionLabel: string };
export type LeaveRouteRetention = { pathname: string; routeName: string; isCurrent(): boolean };
type LeaveState = { retainedRoute?: LeaveRouteRetention; dirty: boolean; pending: boolean; scope: LeaveScope; copy?: LeavePromptCopy; retainedInWorkspace?: boolean; pendingKind?: LeavePendingKind };
type RetainedDrafts = readonly string[];
type LeaveRequest = { blocked: boolean; action: () => void; intent: LeaveIntent; copy?: LeavePromptCopy; pendingKind?: LeavePendingKind };
type LeavePrompt = { key: number; request: LeaveRequest; closing: boolean };
type Guard = { external: ReturnType<typeof createExternalGuard>["port"]; register(id: string, value: LeaveState): void; remove(id: string): void; has(id: string): boolean; request(action: () => void, intent?: LeaveIntent, retained?: RetainedDrafts): void };
const Context = createContext<Guard | null>(null);

// LOCAL compare authority only: raw registrations, never product retention/approval bypasses.
type ExternalState = "clean" | "dirty" | "saving" | "unknown" | "unavailable";
type ExternalRefusal = { readonly status: "refused"; readonly reason: string };
function createExternalGuard(values: () => Iterable<LeaveState>, barrier: () => "clear" | "blocked" | "unavailable", requestCommit: () => void) {
  let revision = 0, live = false, everLive = false, observerFailed = false, notifying = false;
  let registrationRevision = 0, registrationPending = false;
  let active: { revoked: boolean; used: boolean; revision: number } | null = null;
  const listeners = new Set<() => void>();
  const refuse = (reason: string): ExternalRefusal => Object.freeze({ status: "refused", reason });
  const state = (): ExternalState => {
    if (!live || observerFailed) return "unavailable";
    const blocked = barrier();
    if (blocked === "unavailable") return "unavailable";
    if (registrationPending || blocked === "blocked") return "unknown";
    const raw = [...values()], pending = raw.filter(value => value.pending);
    if (pending.length) return pending.every(value => value.pendingKind === "saving") ? "saving" : "unknown";
    return raw.some(value => value.dirty) ? "dirty" : "clean";
  };
  const invalidate = () => {
    if (active) active.revoked = true;
    active = null;
    if (revision < 1_000_000_000) revision++;
    else observerFailed = true;
  };
  const changed = () => {
    invalidate();
    if (notifying) return;
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(); } catch { observerFailed = true; invalidate(); }
      }
    } finally { notifying = false; }
  };
  const port = Object.freeze({
    read: () => Object.freeze({ revision, state: state() }),
    subscribe(listener: () => void) {
      if (typeof listener !== "function") throw new TypeError("COMPARE_GUARD_LISTENER");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    acquire(expectedRevision: number) {
      const currentState = state();
      if (currentState !== "clean") return refuse(currentState === "unavailable" ? "GUARD_UNAVAILABLE" : currentState.toUpperCase());
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== revision) return refuse("STALE_CONTEXT");
      if (active) return refuse("BUSY");
      const ticket = { revoked: false, used: false, revision };
      active = ticket;
      const current = () => active === ticket && !ticket.revoked && ticket.revision === revision && state() === "clean";
      const lease = Object.freeze({
        current,
        runOnce<T,>(action: () => T): ExternalRefusal | { readonly status: "executed"; readonly value: T } {
          if (!current()) return refuse("STALE_CONTEXT");
          if (ticket.used) return refuse("ALREADY_DISPATCHED");
          if (typeof action !== "function") return refuse("INVALID_ACTION");
          ticket.used = true; // Consume before reentrant native callbacks or throws.
          return Object.freeze({ status: "executed", value: action() });
        },
        revoke() { ticket.revoked = true; if (active === ticket) active = null; },
      });
      return Object.freeze({ status: "granted" as const, lease });
    },
  });
  return Object.freeze({
    port, changed,
    registrationRevision: () => registrationRevision,
    registrationChanged() {
      // A native layout cleanup/re-register is not a legitimate clean interval.
      registrationPending = true;
      if (registrationRevision < 1_000_000_000) registrationRevision++;
      else observerFailed = true;
      changed();
      if (live || !everLive) requestCommit();
    },
    commitRegistration(renderedRevision: number) {
      if (!live || !registrationPending || renderedRevision !== registrationRevision) return;
      registrationPending = false;
      changed(); // A reentrant registration sets a NEW fence; never clear it afterward.
    },
    setLive(value: boolean) {
      live = value; if (value) everLive = true;
      changed();
      if (!value) listeners.clear();
      else if (registrationPending) requestCommit();
    },
  });
}

// Only a provider that outlives dashboard pages can retain pending operations on a route change.
export function navigationStates(entries: readonly (readonly [string, LeaveState])[], intent: LeaveIntent, retained: RetainedDrafts = []) {
  return entries.filter(([, value]) => intent !== "child" || value.scope === "child")
    .map(([id, value]) => intent === "workspace" && value.retainedInWorkspace ? { ...value, dirty: false, pending: false }
      : retained.includes(id) && intent !== "child" ? { ...value, dirty: false } : value);
}
// Only a known stack removal within the same named route can retain this UI draft.
// Unknown actions, another navigator, a non-current source and tabs stay guarded.
export function retainsRouteOnRemoval(state: { type: string; key: string; index: number; routes: readonly { key: string; name: string }[] } | undefined,
  action: { type: string; target?: string; source?: string; payload?: unknown }, retained: LeaveRouteRetention) {
  if (!state) return false;
  const source = state.routes[state.index];
  if (!retained.isCurrent() || state.type !== "stack" || source?.name !== retained.routeName
    || action.target && action.target !== state.key || action.source && action.source !== source.key) return false;
  const count = action.type === "GO_BACK" ? 1 : action.type === "POP" && action.payload && typeof action.payload === "object" && "count" in action.payload ? action.payload.count : null;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0 && state.index >= count
    && state.routes[state.index - count]?.name === retained.routeName;
}
type RemovalState = { type: string; key: string; index: number; routes: readonly { key: string; name: string; state?: unknown }[] };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
// Expo's missing history-record fallback resets to a parsed, keyless route tree.
// During a real same-page traversal, keep the existing draft host instead. This
// does not admit arbitrary RESETs or alter entries in browser history.
export function retainedBrowserResetParams(states: readonly RemovalState[], action: { type: string; target?: string; source?: string; payload?: unknown },
  retained: LeaveRouteRetention, traversal: BrowserTraversalReceipt | null): Record<string, unknown> | null {
  if (!traversal?.isCurrent() || !retained.isCurrent() || action.type !== "RESET" || action.source !== undefined
    || traversal.destination.pathname !== retained.pathname) return null;
  const target = states.findIndex(state => state.key === action.target);
  if (target < 0) return null;
  let parsed = object(action.payload);
  for (let index = target; index >= 0; index--) {
    const state = states[index], current = state.routes[state.index];
    if (state.type !== "stack" || !current || !parsed || parsed.key !== undefined || parsed.type !== undefined
      || parsed.index !== undefined && parsed.index !== 0 || !Array.isArray(parsed.routes) || parsed.routes.length !== 1) return null;
    const route = object(parsed.routes[0]);
    if (!route || route.key !== undefined || route.name !== current.name) return null;
    if (index > 0) {
      if (object(current.state)?.key !== states[index - 1].key) return null;
      parsed = object(route.state);
    } else {
      const url = traversal.destination;
      if (current.name !== retained.routeName || route.state !== undefined || route.path !== url.pathname + url.search + url.hash) return null;
      const params = route.params === undefined ? {} : object(route.params);
      if (!params) return null;
      const keys = [...new Set(url.searchParams.keys())];
      if (Object.keys(params).length !== keys.length || keys.some(key => {
        const values = url.searchParams.getAll(key), value = params[key];
        return values.length === 1 ? value !== values[0] : !Array.isArray(value) || value.length !== values.length || value.some((item, i) => item !== values[i]);
      })) return null;
      return params;
    }
  }
  return null;
}
function staysInDashboard(from: string, href: Href) {
  const to = typeof href === "string" ? href.split(/[?#]/)[0] : href.pathname;
  return from !== "/login" && to !== "/login" && isProductionRouteConnected(from) && typeof to === "string" && isProductionRouteConnected(to);
}
// Mounted drafts remain owned by their workspace. Unknown writes are never discarded or replayed.
export function PreviewNavigationGuard({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, LeaveState>());
  const approved = useRef(false);
  const [historyError, setHistoryErrorValue] = useState<HistoryRecoveryError | null>(null);
  // Logical approval may finish before RN Modal's physical close. Retain only
  // that closing prompt, then mount a fresh portal for the next logical request.
  const [prompt, setPromptValue] = useState<LeavePrompt | null>(null);
  const promptRef = useRef<LeavePrompt | null>(null), promptKey = useRef(0), promptLive = useRef(false);
  const barriers = useRef({ historyError: null as HistoryRecoveryError | null, request: null as LeaveRequest | null });
  const historyPort = useRef<ReturnType<typeof guardBrowserHistory> | null>(null);
  const externalRef = useRef<ReturnType<typeof createExternalGuard> | null>(null);
  const [, signalExternalCommit] = useState(0);
  if (!externalRef.current) externalRef.current = createExternalGuard(() => entries.current.values(), () => {
    const port = historyPort.current;
    if (!port || port.readBarrier() === "unavailable") return "unavailable";
    return approved.current || barriers.current.historyError || barriers.current.request || port.readBarrier() === "blocked" ? "blocked" : "clear";
  }, () => signalExternalCommit(value => value + 1));
  const external = externalRef.current;
  const setHistoryError = useCallback((value: HistoryRecoveryError | null) => {
    barriers.current.historyError = value; external.changed(); setHistoryErrorValue(value);
  }, [external]);
  const publishPrompt = useCallback((value: LeavePrompt | null) => {
    promptRef.current = value; setPromptValue(value);
  }, []);
  const setRequest = useCallback((value: LeaveRequest | null) => {
    barriers.current.request = value;
    const current = promptRef.current;
    if (!current && value) publishPrompt({ key: ++promptKey.current, request: value, closing: false });
    else if (current && !current.closing) publishPrompt(value ? { ...current, request: value } : { ...current, closing: true });
    // A closing prompt keeps its content and identity. The latest logical
    // request stays guarded until actual close completion creates its new portal.
    external.changed();
  }, [external, publishPrompt]);
  const ownsPrompt = (value: LeavePrompt) => promptLive.current && promptRef.current === value
    && !value.closing && barriers.current.request === value.request;
  const dismissPrompt = (value: LeavePrompt) => { if (ownsPrompt(value)) setRequest(null); };
  const closedPrompt = (value: LeavePrompt) => {
    if (!promptLive.current || promptRef.current !== value || !value.closing) return;
    const next = barriers.current.request;
    publishPrompt(next ? { key: ++promptKey.current, request: next, closing: false } : null);
  };
  const renderedRegistrationRevision = external.registrationRevision();
  useLayoutEffect(() => {
    promptLive.current = true; external.setLive(true);
    return () => { promptLive.current = false; external.setLive(false); };
  }, [external]);
  useLayoutEffect(() => { external.commitRegistration(renderedRegistrationRevision); });
  // Personal settings survive child selection; leaving their route still checks every guard.
  const statesFor = (intent: LeaveIntent, retained: RetainedDrafts = []) => navigationStates([...entries.current.entries()], intent, retained);
  const leave = useCallback((action: () => void, intent: LeaveIntent = "navigation", retained: RetainedDrafts = []) => {
    if (approved.current) { action(); return; }
    const states = statesFor(intent, retained);
    if (states.some(value => value.pending)) {
      const pending = states.filter(value => value.pending), kind = pending[0]?.pendingKind;
      setRequest({ blocked: true, action, intent, pendingKind: pending.every(value => value.pendingKind === kind) ? kind : undefined });
    }
    else if (states.some(value => value.dirty)) {
      const dirty = states.filter(value => value.dirty), firstCopy = dirty[0]?.copy;
      // A specific attachment prompt must not conceal another ordinary draft guard.
      const copy = firstCopy && dirty.every(value => value.copy?.message === firstCopy.message && value.copy?.actionLabel === firstCopy.actionLabel) ? firstCopy : undefined;
      setRequest({ blocked: false, action, intent, copy });
    }
    else action();
  }, []);
  const guard = useRef<Guard>({ external: external.port, register: (id, value) => { entries.current.set(id, value); external.registrationChanged(); }, remove: id => { entries.current.delete(id); external.registrationChanged(); }, has: id => entries.current.has(id), request: leave }).current;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const retainedFor = (from: URL, to: URL) => from.origin === to.origin && from.pathname === to.pathname
      ? [...entries.current.entries()].filter(([, value]) => value.retainedRoute?.pathname === from.pathname && value.retainedRoute.isCurrent()).map(([id]) => id) : [];
    const port = guardBrowserHistory(window as unknown as HistoryGuardWindow,
      (from, to) => statesFor("navigation", retainedFor(from, to)).some(value => value.dirty || value.pending),
      (action, from, to) => {
        const captured = [...entries.current.entries()].filter(([, value]) => value.retainedRoute);
        leave(() => {
          // A delayed browser approval must not act on a replacement identity/form.
          if (captured.some(([id, value]) => !entries.current.has(id) || !value.retainedRoute!.isCurrent() || !entries.current.get(id)?.retainedRoute?.isCurrent())) return;
          action();
        }, "navigation", retainedFor(from, to));
      }, setHistoryError, external.changed);
    historyPort.current = port; external.changed(); // Store exact read port before publishing installation.
    return () => { if (historyPort.current === port) { historyPort.current = null; external.changed(); } port(); };
  }, [leave]);
  return <Context.Provider value={guard}>{children}
    {historyError ? <View accessibilityRole="alert" testID="history-recovery-error" style={styles.recovery}>
      <Text style={styles.body}>瀏覽器未能返回原頁，導航尚未完成，網址與目前頁面暫未同步。未保存內容仍保留在此頁。請重試返回原頁，或確認離開。</Text>
      <AppButton label="重試返回原頁" variant="quiet" onPress={historyError.retry} />
      <AppButton label="確認離開目前頁面" variant="danger" onPress={() => leave(historyError.leave)} />
    </View> : null}
    {/* Mount each prompt last; retain its false-visible close before retiring the portal. */}
    {prompt ? <Dialog key={prompt.key} visible={!prompt.closing} onDismiss={() => dismissPrompt(prompt)} onClosed={() => closedPrompt(prompt)} testID="leave-preview-dialog">
      <Dialog.Title>{prompt.request.blocked ? prompt.request.pendingKind === "saving" ? "正在儲存" : prompt.request.pendingKind === "unknown" ? "儲存結果未確認" : "尚有變更待確認" : "尚有未儲存的修改"}</Dialog.Title>
      <Dialog.Content><Text style={styles.body}>{prompt.request.blocked
        ? prompt.request.pendingKind === "saving" ? "這次修改仍在儲存，請稍候再離開。" : prompt.request.pendingKind === "unknown" ? "暫時未能確認是否儲存成功。內容已保留，請返回查看結果後再離開。" : "請返回頁面查看未完成的變更，再離開。內容會保留。"
        : prompt.request.copy?.message ?? "離開會捨棄這些修改；已儲存的內容不受影響。"}</Text></Dialog.Content>
      <Dialog.Actions><AppButton label={prompt.request.blocked ? "留在此頁" : "繼續編輯"} variant="quiet" onPress={() => dismissPrompt(prompt)} />
        {!prompt.request.blocked ? <AppButton label={prompt.request.copy?.actionLabel ?? "捨棄並離開"} variant="danger" onPress={() => {
          if (!ownsPrompt(prompt)) return;
          const request = prompt.request;
          // Recheck at confirmation: a pending request may have started while the dialog was open.
          if (statesFor(request.intent).some(value => value.pending)) { setRequest({ ...request, blocked: true }); return; }
          const action = request.action; approved.current = true; external.changed(); setRequest(null);
          try { action(); } finally { approved.current = false; external.changed(); }
        }} /> : null}</Dialog.Actions>
    </Dialog> : null}
  </Context.Provider>;
}

export function usePreviewExternalGuard() {
  return useContext(Context)?.external ?? null;
}

export function usePreviewNavigation() {
  const guard = useContext(Context);
  return guard?.request ?? ((action: () => void, _intent?: LeaveIntent, _retained?: RetainedDrafts) => action());
}

export function PreviewLink({ href, children }: { href: Href; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const leave = usePreviewNavigation(), scope = useNavigationScope();
  const hrefKey = JSON.stringify(href);
  const current = useRef({ pathname, hrefKey, scopeKey: scope?.key, mounted: true });
  current.current = { pathname, hrefKey, scopeKey: scope?.key, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  return <Link href={href} asChild onPress={event => {
    if (event.defaultPrevented) return;
    // Preserve browser modifier, non-primary and target semantics. Ordinary
    // activation still uses the dirty/pending guard before a single router push.
    if (Platform.OS === "web" && "button" in event) {
      const target = event.currentTarget?.target;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || event.button != null && event.button !== 0
        || target && target !== "_self" && target !== "self") return;
    }
    event.preventDefault();
    if (href === pathname) return;
    leave(() => {
      const live = current.current;
      if (!live.mounted || live.pathname !== pathname || live.hrefKey !== hrefKey || live.scopeKey !== scope?.key || scope && !scope.isCurrent()) return;
      router.push(href);
    }, staysInDashboard(pathname, href) ? "workspace" : "navigation");
  }}>{children}</Link>;
}

export function usePreviewLeaveGuard(dirty: boolean, pending = false, scope: LeaveScope = "child", copy?: LeavePromptCopy, retainedInWorkspace = false, pendingKind?: LeavePendingKind, retainedRoute?: LeaveRouteRetention) {
  const guard = useContext(Context);
  const id = useId();
  const navigation = useNavigation();
  useLayoutEffect(() => { guard?.register(id, { dirty, pending, scope, copy, retainedInWorkspace, pendingKind, retainedRoute }); return () => guard?.remove(id); }, [guard, id, dirty, pending, scope, copy?.message, copy?.actionLabel, retainedInWorkspace, pendingKind, retainedRoute?.pathname, retainedRoute?.routeName, retainedRoute?.isCurrent]);
  usePreventRemove(!!guard && (dirty || pending), ({ data }) => {
    if (!retainedRoute) { guard?.request(() => navigation.dispatch(data.action)); return; }
    const source = navigation.getState();
    const traversal = Platform.OS === "web" ? currentBrowserTraversal(window) : null;
    const states: RemovalState[] = [];
    for (let cursor: typeof navigation | undefined = navigation; cursor; cursor = cursor.getParent()) {
      const state = cursor.getState();
      if (!state) break;
      states.push(state);
    }
    const params = retainedBrowserResetParams(states, data.action, retainedRoute, traversal);
    const retained = params || retainsRouteOnRemoval(source, data.action, retainedRoute) ? [id] : [];
    guard?.request(() => {
      if (retainedRoute) {
        const current = navigation.getState();
        if (!retainedRoute.isCurrent() || source && (!current || current.key !== source.key || current.routes[current.index]?.key !== source.routes[source.index]?.key)) return;
      }
      if (params && source) {
        if (!guard?.has(id) || !traversal?.isCurrent()) return;
        navigation.dispatch({ type: "REPLACE_PARAMS", target: source.key, source: source.routes[source.index]?.key, payload: { params } });
        return;
      }
      navigation.dispatch(data.action);
    }, "navigation", retained);
  });
  useEffect(() => {
    if (Platform.OS !== "web" || !guard || !(dirty || pending)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard, dirty, pending]);
  return id;
}
const styles = StyleSheet.create({ recovery: { position: "absolute", bottom: 16, left: 16, right: 16, zIndex: 1000, padding: 16, gap: 8, backgroundColor: colors.statusWarm, borderWidth: 1, borderColor: colors.ink }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24 } });
