import { useEffect, useId, useRef, useState } from "react";
import type { useDomainEnvironment } from "./useDomainEnvironment";
export type SettingsEnvironment = ReturnType<typeof useDomainEnvironment>;
export function settingsFailure(error: unknown) {
  const value = error as { status?: number; code?: string | null; onlineCode?: string | null; confirmed?: boolean; unknownResult?: boolean };
  return { status: value?.status ?? 0, code: value?.onlineCode ?? value?.code ?? null,
    confirmed: value?.confirmed === true, unknown: value?.unknownResult === true };
}
export function settingsAccessError(env: SettingsEnvironment, error: unknown, account = false) {
  const failure = settingsFailure(error);
  if (failure.status === 401 || failure.code === "session_changed") {
    env.accessError({ status: failure.status, code: failure.code }); return true;
  }
  if (failure.status === 403 || failure.code === "access_denied") {
    if (!account && env.childId && env.current()) env.accessError({ status: failure.status, code: failure.code });
    return true;
  }
  return false;
}
/** Request lifetime only; operation identity and recovery remain in the existing APIs. */
export function useSettingsRequests(env: SettingsEnvironment, account = false) {
  const latest = useRef(env); latest.current = env;
  const active = useRef<AbortController | null>(null), mounted = useRef(true), id = useId();
  const [busy, setBusy] = useState(false);
  const available = () => mounted.current && latest.current.online && !!latest.current.userId
    && (account ? latest.current.currentIdentity() : latest.current.current());
  const start = (writing = false, original = false) => {
    if (!available() || active.current || writing && !original && !latest.current.canStartWrite()) return null;
    const basis = account ? latest.current.identityKey : latest.current.scopeKey;
    const generation = latest.current.owner.getSnapshot().sessionGeneration;
    const controller = new AbortController(); active.current = controller; setBusy(true);
    if (writing) latest.current.owner.setDomainPending(id, true);
    return { signal: controller.signal,
      current: () => available() && !controller.signal.aborted && generation === latest.current.owner.getSnapshot().sessionGeneration && basis === (account ? latest.current.identityKey : latest.current.scopeKey),
      finish: (pending = false) => {
        if (active.current !== controller) return;
        active.current = null;
        latest.current.owner.setDomainPending(id, pending);
        if (mounted.current) setBusy(false);
      } };
  };
  useEffect(() => {
    if (!env.online) { active.current?.abort(); active.current = null; latest.current.owner.setDomainPending(id, false); setBusy(false); }
  }, [env.online]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; active.current?.abort(); active.current = null; latest.current.owner.setDomainPending(id, false);
  }; }, [id]);
  return { start, busy, available };
}
export function settingsRead<T>(env: SettingsEnvironment, domain: string, account: boolean, read: () => Promise<T>) {
  return env.queryClient.fetchQuery({ queryKey: ["production", account ? env.identityKey : env.scopeKey, "settings-domains", env.owner.getSnapshot().sessionGeneration, domain],
    queryFn: read, staleTime: 0, gcTime: 0, retry: false });
}
export function useSettingsRefresh(env: SettingsEnvironment, refresh: () => void, safe: boolean, account = false) {
  const latest = useRef({ refresh, safe }); latest.current = { refresh, safe };
  const deferred = useRef(false);
  useEffect(() => {
    if (env.online && latest.current.safe) latest.current.refresh();
    // Reconnection may read current state, but never retries a pending write.
  }, [env.online, account ? env.identityKey : env.scopeKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const changed = () => { if (latest.current.safe) latest.current.refresh(); else deferred.current = true; };
    window.addEventListener("yuban-online-refresh", changed);
    return () => window.removeEventListener("yuban-online-refresh", changed);
  }, []);
  useEffect(() => { if (safe && env.online && deferred.current) { deferred.current = false; latest.current.refresh(); } }, [safe, env.online]);
}