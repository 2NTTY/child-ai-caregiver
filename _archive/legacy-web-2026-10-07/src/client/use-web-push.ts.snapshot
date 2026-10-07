import { useEffect, useRef, useState } from "react";
import type { PushBinding, WebPushStatus } from "../shared/web-push.ts";
import { createWebPushApi, WebPushApiError } from "./web-push-api.ts";
import { activatePushBrowser, ownedBrowserBinding, pushBrowserSupported, pushPermission, requestPushPermission,
  subscribePushBrowser, suspendPushBrowser, unsubscribePushBrowser } from "./push-browser.ts";

export function useWebPush(apiBaseUrl: string, userId: string | null, online: boolean) {
  const [api] = useState(() => createWebPushApi(apiBaseUrl));
  const [status, setStatus] = useState<WebPushStatus | null>(null);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [permission, setPermission] = useState<ReturnType<typeof pushPermission>>("unsupported");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0), active = useRef<AbortController | null>(null), latestUser = useRef(userId);
  latestUser.current = userId;
  const retry = useRef<((signal: AbortSignal) => Promise<unknown>) | null>(null);
  const current = (token: number, id: string) => generation.current === token && latestUser.current === id;
  async function refresh(signal: AbortSignal, token: number, id: string) {
    const epoch = await suspendPushBrowser();
    const value = await api.status(signal, id);
    if (!current(token, id) || signal.aborted) return;
    const binding = await ownedBrowserBinding(value);
    if (!current(token, id) || signal.aborted) return;
    if (epoch && binding) await activatePushBrowser(epoch, { userId: id, id: binding.id, version: binding.version });
    if (!current(token, id) || signal.aborted) return;
    setStatus(value); setBindingId(binding?.id ?? null); setPermission(pushPermission());
  }
  async function run(action?: (signal: AbortSignal, id: string) => Promise<void>) {
    const id = latestUser.current;
    if (!id || !online || active.current) return;
    const controller = new AbortController(), token = generation.current;
    active.current = controller; setBusy(true); setError(null);
    try {
      if (action) await action(controller.signal, id);
      if (!current(token, id) || controller.signal.aborted) return;
      await refresh(controller.signal, token, id);
    } catch (caught) {
      if (!current(token, id)) return;
      setPermission(pushPermission());
      if (caught instanceof WebPushApiError && (caught.status === 401 || caught.onlineCode === "session_changed")) {
        setStatus(null); setBindingId(null);
        await suspendPushBrowser().catch(() => {});
        setError("登入身份已改變，請先重新確認登入。");
      } else setError(api.hasPendingOnline()
        ? "操作結果尚未確認；請查核／重試原操作，不要建立另一通知。"
        : caught instanceof WebPushApiError && caught.status === 409
          ? "訂閱版本、限額或服務狀態已改變；請重新讀取後確認。"
          : "未能完成通知操作。請核對連線、通知權限及服務狀態後重試。");
    } finally {
      if (active.current === controller) active.current = null;
      if (current(token, id)) { setBusy(false); setPending(api.hasPendingOnline()); if (!api.hasPendingOnline()) retry.current = null; }
    }
  }
  useEffect(() => {
    generation.current++; active.current?.abort(); active.current = null;
    api.resetOnline(); retry.current = null;
    setStatus(null); setBindingId(null); setBusy(false); setPending(false); setError(null); setPermission(pushPermission());
    if (userId && online) void run();
    else void suspendPushBrowser().catch(() => { setError("未能確認本機通知已停用，請在瀏覽器網站設定關閉通知。"); });
    return () => { generation.current++; active.current?.abort(); };
    // Account transitions clear locally; closing the page deliberately leaves the confirmed binding for background delivery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, userId]);
  function enable() {
    if (!userId || !status?.publicKey || busy || active.current || pending || !online) return;
    // Keep the browser permission request in the original click's activation context.
    const permissionRequest = requestPushPermission();
    void run(async (signal, id) => {
      if (await permissionRequest !== "granted") throw new Error("push_permission_denied");
      if (signal.aborted || latestUser.current !== id) return;
      const browser = await subscribePushBrowser(status.publicKey!, bindingId !== null);
      if (signal.aborted || latestUser.current !== id) { await suspendPushBrowser(); return; }
      const input = { subscription: browser.subscription, label: "我的瀏覽器" };
      retry.current = innerSignal => api.register(input, innerSignal, id);
      await retry.current(signal);
    });
  }
  function revoke(binding: PushBinding) {
    if (pending) return;
    void run(async (signal, id) => {
      if (binding.id === bindingId) { await unsubscribePushBrowser(); setBindingId(null); }
      if (signal.aborted || latestUser.current !== id) return;
      retry.current = innerSignal => api.revoke(binding.id, binding.version, innerSignal, id);
      await retry.current(signal);
    });
  }
  function test(binding: PushBinding) {
    if (pending) return;
    void run(async (signal, id) => {
      retry.current = innerSignal => api.test(binding.id, binding.version, innerSignal, id);
      await retry.current(signal);
    });
  }
  function reconcile() {
    void run(async (signal, id) => {
      const receipt = await api.reconcilePending(signal, id);
      if (receipt?.state === "unconfirmed") {
        if (!retry.current) throw new Error("push_original_operation_unavailable");
        await retry.current(signal);
      }
    });
  }
  return { status: status?.userId === userId ? status : null, currentBindingId: status?.userId === userId ? bindingId : null, browserSupported: pushBrowserSupported(), permission,
    busy: busy || !online, error, hasPending: pending,
    onEnable: enable, onRevoke: revoke, onTest: test, onRefresh: () => { void run(); }, onReconcile: reconcile };
}
