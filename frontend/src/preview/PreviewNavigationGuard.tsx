import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { Link, usePathname, useRouter, type Href } from "expo-router";
import { AppDialog as Dialog } from "../components/AppDialog";
import { AppButton } from "../components/ui";
import { chineseFont, colors, readingType } from "../theme";
import { isProductionRouteConnected } from "../production/routes";
import { currentBrowserTraversal, type BrowserTraversalReceipt } from "./browser-history-events";
import { guardBrowserHistory, type HistoryGuardWindow, type HistoryRecoveryError } from "./browser-history-guard";

export type LeaveScope = "child" | "account";
export type LeavePendingKind = "saving" | "unknown";
type LeaveIntent = "navigation" | "workspace" | "child";
export type LeavePromptCopy = { message: string; actionLabel: string };
export type LeaveRouteRetention = { pathname: string; routeName: string; isCurrent(): boolean };
type ConfirmedDiscard = () => boolean | Promise<boolean>;
type LeaveState = { retainedRoute?: LeaveRouteRetention; onDiscard?: ConfirmedDiscard; dirty: boolean; pending: boolean; scope: LeaveScope; copy?: LeavePromptCopy; retainedInWorkspace?: boolean; pendingKind?: LeavePendingKind };
type RetainedDrafts = readonly string[];
type LeaveRequest = { dirty: readonly (readonly [string, LeaveState])[]; retained: RetainedDrafts; confirming?: boolean; onCancel?: () => void; blocked: boolean; action: () => void; intent: LeaveIntent; copy?: LeavePromptCopy; pendingKind?: LeavePendingKind };
type Guard = { register(id: string, value: LeaveState): void; remove(id: string): void; has(id: string): boolean; request(action: () => void, intent?: LeaveIntent, retained?: RetainedDrafts, onCancel?: () => void): void };
const Context = createContext<Guard | null>(null);

// Only a provider that outlives dashboard pages can retain pending operations on a route change.
export function navigationStates(entries: readonly (readonly [string, LeaveState])[], intent: LeaveIntent, retained: RetainedDrafts = []) {
  return entries.filter(([, value]) => intent !== "child" || value.scope === "child")
    .map(([id, value]) => intent === "workspace" && value.retainedInWorkspace ? { ...value, dirty: false, pending: false }
      : retained.includes(id) && intent !== "child" ? { ...value, dirty: false } : value);
}
// Retain only a known stack removal between entries of the same leaf route.
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
  const activeRequest = useRef<LeaveRequest | null>(null);
  const [historyError, setHistoryError] = useState<HistoryRecoveryError | null>(null);
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  // Personal settings survive child selection; leaving their route still checks every guard.
  const statesFor = (intent: LeaveIntent, retained: RetainedDrafts = []) => navigationStates([...entries.current.entries()], intent, retained);
  const showRequest = (next: LeaveRequest | null) => { activeRequest.current = next; setRequest(next); };
  const dirtyFor = (intent: LeaveIntent, retained: RetainedDrafts = []) => [...entries.current.entries()]
    .filter(entry => navigationStates([entry], intent, retained).some(value => value.dirty));
  const leave = useCallback((action: () => void, intent: LeaveIntent = "navigation", retained: RetainedDrafts = [], onCancel?: () => void) => {
    if (approved.current) { action(); return; }
    const states = statesFor(intent, retained);
    if (states.some(value => value.pending)) {
      const pending = states.filter(value => value.pending), kind = pending[0]?.pendingKind;
      showRequest({ dirty: dirtyFor(intent, retained), retained, blocked: true, action, intent, onCancel, pendingKind: pending.every(value => value.pendingKind === kind) ? kind : undefined });
    }
    else if (states.some(value => value.dirty)) {
      const dirty = states.filter(value => value.dirty), firstCopy = dirty[0]?.copy;
      // A specific attachment prompt must not conceal another ordinary draft guard.
      const copy = firstCopy && dirty.every(value => value.copy?.message === firstCopy.message && value.copy?.actionLabel === firstCopy.actionLabel) ? firstCopy : undefined;
      showRequest({ dirty: dirtyFor(intent, retained), retained, blocked: false, action, intent, copy, onCancel });
    }
    else { showRequest(null); action(); }
  }, []);
  const guard = useRef<Guard>({ register: (id, value) => entries.current.set(id, value), remove: id => entries.current.delete(id), has: id => entries.current.has(id), request: leave }).current;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const retainedFor = (from: URL, to: URL) => from.origin === to.origin && from.pathname === to.pathname
      ? [...entries.current.entries()].filter(([, value]) => value.retainedRoute?.pathname === from.pathname && value.retainedRoute.isCurrent()).map(([id]) => id) : [];
    return guardBrowserHistory(window as unknown as HistoryGuardWindow,
      (from, to) => statesFor("navigation", retainedFor(from, to)).some(value => value.dirty || value.pending),
      (action, from, to) => {
        const captured = [...entries.current.entries()].filter(([, value]) => value.retainedRoute);
        leave(() => {
          if (captured.some(([id, value]) => !entries.current.has(id) || !value.retainedRoute!.isCurrent() || !entries.current.get(id)?.retainedRoute?.isCurrent())) return;
          action();
        }, "navigation", retainedFor(from, to));
      }, setHistoryError);
  }, [leave]);
  useEffect(() => () => { activeRequest.current = null; }, []);
  const cancelRequest = () => { const canceled = activeRequest.current; showRequest(null); canceled?.onCancel?.(); };
  const confirmRequest = () => {
    const currentRequest = activeRequest.current;
    if (!currentRequest || currentRequest.blocked || currentRequest.confirming) return;
    let captured: LeaveRequest = currentRequest;
    const recheck = () => {
      if (activeRequest.current !== captured) return false;
      // Never let approval for a departed form cover a newly mounted draft.
      if (statesFor(captured.intent, captured.retained).some(value => value.pending)) {
        showRequest({ ...captured, confirming: false, blocked: true }); return false;
      }
      if (dirtyFor(captured.intent, captured.retained).some(([id]) => !captured.dirty.some(([originalId]) => originalId === id))) {
        leave(captured.action, captured.intent, captured.retained, captured.onCancel); return false;
      }
      return true;
    };
    if (!recheck()) return;
    captured = { ...captured, confirming: true }; showRequest(captured);
    const complete = (accepted: boolean) => {
      if (activeRequest.current !== captured) return;
      if (!accepted) { cancelRequest(); return; }
      if (!recheck()) return;
      showRequest(null); approved.current = true;
      try { captured.action(); } finally { approved.current = false; }
    };
    let receipts: (boolean | Promise<boolean>)[];
    try { receipts = captured.dirty.flatMap(([id, state]) => entries.current.get(id)?.dirty && state.onDiscard ? [state.onDiscard()] : []); }
    catch { complete(false); return; }
    if (receipts.some(result => typeof result !== "boolean")) void Promise.all(receipts).then(results => complete(results.every(Boolean)), () => complete(false));
    else complete(receipts.every(Boolean));
  };
  return <Context.Provider value={guard}>{children}
    {historyError ? <View accessibilityRole="alert" testID="history-recovery-error" style={styles.recovery}>
      <Text style={styles.body}>瀏覽器未能返回原頁，導航尚未完成，網址與目前頁面暫未同步。未保存內容仍保留在此頁。請重試返回原頁，或確認離開。</Text>
      <AppButton label="重試返回原頁" variant="quiet" onPress={historyError.retry} />
      <AppButton label="確認離開目前頁面" variant="danger" onPress={() => leave(historyError.leave)} />
    </View> : null}
    {/* Mount the prompt last so RN Web visual portal order matches its active focus stack. */}
    {request ? <Dialog visible onDismiss={cancelRequest} testID="leave-preview-dialog">
      <Dialog.Title>{request.blocked ? request.pendingKind === "saving" ? "正在儲存" : request.pendingKind === "unknown" ? "儲存結果未確認" : "尚有變更待確認" : "尚有未儲存的修改"}</Dialog.Title>
      <Dialog.Content><Text style={styles.body}>{request?.blocked
        ? request.pendingKind === "saving" ? "這次修改仍在儲存，請稍候再離開。" : request.pendingKind === "unknown" ? "暫時未能確認是否儲存成功。內容已保留，請返回查看結果後再離開。" : "請返回頁面查看未完成的變更，再離開。內容會保留。"
        : request?.copy?.message ?? "離開會捨棄這些修改；已儲存的內容不受影響。"}</Text></Dialog.Content>
      <Dialog.Actions><AppButton label={request?.blocked ? "留在此頁" : "繼續編輯"} variant="quiet" onPress={cancelRequest} />
        {request && !request.blocked ? <AppButton label={request.copy?.actionLabel ?? "捨棄並離開"} variant="danger" disabled={request.confirming} onPress={confirmRequest} /> : null}</Dialog.Actions>
    </Dialog> : null}
  </Context.Provider>;
}

export function usePreviewNavigation() {
  const guard = useContext(Context);
  return guard?.request ?? ((action: () => void, _intent?: LeaveIntent, _retained?: RetainedDrafts, _onCancel?: () => void) => action());
}

export function PreviewLink({ href, children, scopeKey, isCurrent }: { href: Href; children: ReactNode; scopeKey?: string | null; isCurrent?: () => boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const leave = usePreviewNavigation();
  const current = useRef({ pathname, scopeKey, mounted: true });
  current.current = { pathname, scopeKey, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  return <Link href={href} asChild onPress={event => {
    // New-tab/window gestures do not leave this workspace, so keep browser link semantics.
    if (Platform.OS === "web") {
      const click = event as unknown as React.MouseEvent<HTMLElement>;
      const input = click.nativeEvent ?? click;
      const target = click.currentTarget?.getAttribute?.("target");
      if (click.defaultPrevented || input.defaultPrevented || input.metaKey || input.ctrlKey || input.shiftKey || input.altKey
        || input.button !== undefined && input.button !== 0 || target && target !== "_self" || click.currentTarget?.hasAttribute?.("download")) return;
    }
    event.preventDefault();
    if (href === pathname) return;
    leave(() => { if (current.current.mounted && current.current.pathname === pathname && current.current.scopeKey === scopeKey && (!isCurrent || isCurrent())) router.push(href); }, staysInDashboard(pathname, href) ? "workspace" : "navigation");
  }}>{children}</Link>;
}

export function usePreviewLeaveGuard(dirty: boolean, pending = false, scope: LeaveScope = "child", copy?: LeavePromptCopy, retainedInWorkspace = false, pendingKind?: LeavePendingKind, onDiscard?: ConfirmedDiscard, retainedRoute?: LeaveRouteRetention) {
  const guard = useContext(Context);
  const id = useId();
  const navigation = useNavigation();
  useLayoutEffect(() => { guard?.register(id, { dirty, pending, scope, copy, retainedInWorkspace, pendingKind, onDiscard, retainedRoute }); return () => guard?.remove(id); }, [guard, id, dirty, pending, scope, copy?.message, copy?.actionLabel, retainedInWorkspace, pendingKind, onDiscard, retainedRoute?.pathname, retainedRoute?.routeName, retainedRoute?.isCurrent]);
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
      const current = navigation.getState();
      if (!retainedRoute.isCurrent() || source && (!current || current.key !== source.key || current.routes[current.index]?.key !== source.routes[source.index]?.key)) return;
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
const styles = StyleSheet.create({ recovery: { position: "absolute", bottom: 16, left: 16, right: 16, zIndex: 1000, padding: 16, gap: 8, backgroundColor: colors.statusWarm, borderWidth: 1, borderColor: colors.ink }, body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body } });
