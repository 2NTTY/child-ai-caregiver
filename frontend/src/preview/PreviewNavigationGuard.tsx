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

export type LeaveScope = "child" | "account";
export type LeavePendingKind = "saving" | "unknown";
type LeaveIntent = "navigation" | "workspace" | "child";
export type LeavePromptCopy = { message: string; actionLabel: string };
type LeaveState = { dirty: boolean; pending: boolean; scope: LeaveScope; copy?: LeavePromptCopy; retainedInWorkspace?: boolean; pendingKind?: LeavePendingKind };
type RetainedDrafts = readonly string[];
type LeaveRequest = { blocked: boolean; action: () => void; intent: LeaveIntent; copy?: LeavePromptCopy; pendingKind?: LeavePendingKind };
type Guard = { register(id: string, value: LeaveState): void; remove(id: string): void; request(action: () => void, intent?: LeaveIntent, retained?: RetainedDrafts): void };
const Context = createContext<Guard | null>(null);

// Only a provider that outlives dashboard pages can retain pending operations on a route change.
export function navigationStates(entries: readonly (readonly [string, LeaveState])[], intent: LeaveIntent, retained: RetainedDrafts = []) {
  return entries.filter(([, value]) => intent !== "child" || value.scope === "child")
    .map(([id, value]) => intent === "workspace" && value.retainedInWorkspace ? { ...value, dirty: false, pending: false }
      : retained.includes(id) && intent !== "child" ? { ...value, dirty: false } : value);
}
function staysInDashboard(from: string, href: Href) {
  const to = typeof href === "string" ? href.split(/[?#]/)[0] : href.pathname;
  return from !== "/login" && to !== "/login" && isProductionRouteConnected(from) && typeof to === "string" && isProductionRouteConnected(to);
}
// Mounted drafts remain owned by their workspace. Unknown writes are never discarded or replayed.
export function PreviewNavigationGuard({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, LeaveState>());
  const approved = useRef(false);
  const [historyError, setHistoryError] = useState<HistoryRecoveryError | null>(null);
  const [request, setRequest] = useState<LeaveRequest | null>(null);
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
  const guard = useRef<Guard>({ register: (id, value) => entries.current.set(id, value), remove: id => entries.current.delete(id), request: leave }).current;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    return guardBrowserHistory(window as unknown as HistoryGuardWindow,
      () => [...entries.current.values()].some(value => value.dirty || value.pending), leave, setHistoryError);
  }, [leave]);
  return <Context.Provider value={guard}>{children}
    {historyError ? <View accessibilityRole="alert" testID="history-recovery-error" style={styles.recovery}>
      <Text style={styles.body}>瀏覽器未能返回原頁，導航尚未完成，網址與目前頁面暫未同步。未保存內容仍保留在此頁。請重試返回原頁，或確認離開。</Text>
      <AppButton label="重試返回原頁" variant="quiet" onPress={historyError.retry} />
      <AppButton label="確認離開目前頁面" variant="danger" onPress={() => leave(historyError.leave)} />
    </View> : null}
    {/* Mount the prompt last so RN Web visual portal order matches its active focus stack. */}
    {request ? <Dialog visible onDismiss={() => setRequest(null)} testID="leave-preview-dialog">
      <Dialog.Title>{request.blocked ? request.pendingKind === "saving" ? "正在儲存" : request.pendingKind === "unknown" ? "儲存結果未確認" : "尚有變更待確認" : "尚有未儲存的修改"}</Dialog.Title>
      <Dialog.Content><Text style={styles.body}>{request?.blocked
        ? request.pendingKind === "saving" ? "這次修改仍在儲存，請稍候再離開。" : request.pendingKind === "unknown" ? "暫時未能確認是否儲存成功。內容已保留，請返回查看結果後再離開。" : "請返回頁面查看未完成的變更，再離開。內容會保留。"
        : request?.copy?.message ?? "離開會捨棄這些修改；已儲存的內容不受影響。"}</Text></Dialog.Content>
      <Dialog.Actions><AppButton label={request?.blocked ? "留在此頁" : "繼續編輯"} variant="quiet" onPress={() => setRequest(null)} />
        {request && !request.blocked ? <AppButton label={request.copy?.actionLabel ?? "捨棄並離開"} variant="danger" onPress={() => {
          // Recheck at confirmation: a pending request may have started while the dialog was open.
          if (statesFor(request.intent).some(value => value.pending)) { setRequest({ ...request, blocked: true }); return; }
          const action = request.action; setRequest(null); approved.current = true;
          try { action(); } finally { approved.current = false; }
        }} /> : null}</Dialog.Actions>
    </Dialog> : null}
  </Context.Provider>;
}

export function usePreviewNavigation() {
  const guard = useContext(Context);
  return guard?.request ?? ((action: () => void, _intent?: LeaveIntent, _retained?: RetainedDrafts) => action());
}

export function PreviewLink({ href, children }: { href: Href; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const leave = usePreviewNavigation();
  return <Link href={href} asChild onPress={event => {
    if (event.defaultPrevented) return;
    // Let the browser own modifier/target behavior; keep the guard for ordinary
    // same-context SPA navigation instead of replacing native link semantics.
    if (Platform.OS === "web" && "button" in event) {
      const target = event.currentTarget.target;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || (target && target.toLowerCase() !== "_self")) return;
    }
    event.preventDefault();
    if (href === pathname) return;
    leave(() => router.push(href), staysInDashboard(pathname, href) ? "workspace" : "navigation");
  }}>{children}</Link>;
}

export function usePreviewLeaveGuard(dirty: boolean, pending = false, scope: LeaveScope = "child", copy?: LeavePromptCopy, retainedInWorkspace = false, pendingKind?: LeavePendingKind) {
  const guard = useContext(Context);
  const id = useId();
  const navigation = useNavigation();
  useLayoutEffect(() => { guard?.register(id, { dirty, pending, scope, copy, retainedInWorkspace, pendingKind }); return () => guard?.remove(id); }, [guard, id, dirty, pending, scope, copy?.message, copy?.actionLabel, retainedInWorkspace, pendingKind]);
  usePreventRemove(!!guard && (dirty || pending), ({ data }) => guard?.request(() => navigation.dispatch(data.action)));
  useEffect(() => {
    if (Platform.OS !== "web" || !guard || !(dirty || pending)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard, dirty, pending]);
  return id;
}
const styles = StyleSheet.create({ recovery: { position: "absolute", bottom: 16, left: 16, right: 16, zIndex: 1000, padding: 16, gap: 8, backgroundColor: colors.statusWarm, borderWidth: 1, borderColor: colors.ink }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24 } });
