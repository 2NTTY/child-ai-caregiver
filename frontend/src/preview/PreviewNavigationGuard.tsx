import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { Link, usePathname, useRouter, type Href } from "expo-router";
import { AppDialog as Dialog } from "../components/AppDialog";
import { AppButton } from "../components/ui";
import { chineseFont, colors, typeScale } from "../theme";
import { guardBrowserHistory, type HistoryGuardWindow } from "./browser-history-guard";

export type LeaveScope = "child" | "account";
type LeaveIntent = "navigation" | "child";
export type LeavePromptCopy = { message: string; actionLabel: string };
type LeaveState = { dirty: boolean; pending: boolean; scope: LeaveScope; copy?: LeavePromptCopy };
type LeaveRequest = { blocked: boolean; action: () => void; intent: LeaveIntent; copy?: LeavePromptCopy };
type Guard = { register(id: string, value: LeaveState): void; remove(id: string): void; request(action: () => void, intent?: LeaveIntent): void };
const Context = createContext<Guard | null>(null);

// Mounted drafts remain owned by their workspace. Unknown writes cannot be discarded as drafts.
export function PreviewNavigationGuard({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, LeaveState>());
  const approved = useRef(false);
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  // Personal settings survive child selection; leaving their route still checks every guard.
  const statesFor = (intent: LeaveIntent) => [...entries.current.values()].filter(value => intent === "navigation" || value.scope === "child");
  const leave = useCallback((action: () => void, intent: LeaveIntent = "navigation") => {
    if (approved.current) { action(); return; }
    const states = statesFor(intent);
    if (states.some(value => value.pending)) setRequest({ blocked: true, action, intent });
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
      () => [...entries.current.values()].some(value => value.dirty || value.pending), leave);
  }, [leave]);
  return <Context.Provider value={guard}>{children}
    <Dialog visible={request !== null} onDismiss={() => setRequest(null)} testID="leave-preview-dialog">
      <Dialog.Title>{request?.blocked ? "先處理原操作" : "離開未保存草稿？"}</Dialog.Title>
      <Dialog.Content><Text style={styles.body}>{request?.blocked
        ? "原操作仍在處理、結果未知或待重讀。請留在此頁查核同一操作；原內容及參考會保留。"
        : request?.copy?.message ?? "此頁有未保存內容。留在此頁可繼續編輯；確認離開會捨棄這份草稿。"}</Text></Dialog.Content>
      <Dialog.Actions><AppButton label={request?.blocked ? "留在此頁查核" : "繼續編輯"} variant="quiet" onPress={() => setRequest(null)} />
        {request && !request.blocked ? <AppButton label={request.copy?.actionLabel ?? "捨棄草稿並離開"} variant="danger" onPress={() => {
          // Recheck at confirmation: a pending request may have started while the dialog was open.
          if (statesFor(request.intent).some(value => value.pending)) { setRequest({ ...request, blocked: true }); return; }
          const action = request.action; setRequest(null); approved.current = true;
          try { action(); } finally { approved.current = false; }
        }} /> : null}</Dialog.Actions>
    </Dialog>
  </Context.Provider>;
}

export function usePreviewNavigation() {
  const guard = useContext(Context);
  return guard?.request ?? ((action: () => void, _intent?: LeaveIntent) => action());
}

export function PreviewLink({ href, children }: { href: Href; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const leave = usePreviewNavigation();
  return <Link href={href} asChild onPress={event => {
    event.preventDefault();
    if (href === pathname) return;
    leave(() => router.push(href));
  }}>{children}</Link>;
}

export function usePreviewLeaveGuard(dirty: boolean, pending = false, scope: LeaveScope = "child", copy?: LeavePromptCopy) {
  const guard = useContext(Context);
  const id = useId();
  const navigation = useNavigation();
  useEffect(() => { guard?.register(id, { dirty, pending, scope, copy }); return () => guard?.remove(id); }, [guard, id, dirty, pending, scope, copy?.message, copy?.actionLabel]);
  usePreventRemove(!!guard && (dirty || pending), ({ data }) => guard?.request(() => navigation.dispatch(data.action)));
  useEffect(() => {
    if (Platform.OS !== "web" || !guard || !(dirty || pending)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard, dirty, pending]);
}
const styles = StyleSheet.create({ body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24 } });
