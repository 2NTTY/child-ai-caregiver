import { useEffect, useRef, useState } from "react";
import { useDomainEnvironment } from "./useDomainEnvironment";

export type TaskKnowledgeEnvironment = ReturnType<typeof useDomainEnvironment>;
export const domainFailure = (error: unknown) => {
  const value = error as { status?: number; code?: string | null; onlineCode?: string | null; confirmed?: boolean } | null;
  return { status: value?.status ?? 0, code: value?.code ?? value?.onlineCode ?? null, confirmed: value?.confirmed === true };
};
export const mergeById = <T extends { id: string }>(before: readonly T[], after: readonly T[]) => {
  const incoming = new Map(after.map(item => [item.id, item]));
  return [...before.map(item => incoming.get(item.id) ?? item), ...after.filter(item => !before.some(old => old.id === item.id))];
};

/** Scope-local request lifetime; the host QueryClient remains the sole read cache. */
export function useTaskKnowledgeRuntime(env: TaskKnowledgeEnvironment, domain: string) {
  const [lost, setLost] = useState(false);
  const life = useRef({ mounted: true, generation: 0, revoked: false });
  const requests = useRef(new Set<AbortController>());
  const live = () => life.current.mounted && !life.current.revoked && env.current();
  useEffect(() => {
    life.current.mounted = true;
    env.queryClient.setQueryDefaults(["production", env.scopeKey, domain], { gcTime: Infinity });
    return () => {
      life.current.mounted = false; life.current.generation++;
      for (const request of requests.current) request.abort();
      requests.current.clear();
      void env.queryClient.cancelQueries({ queryKey: ["production", env.scopeKey, domain] });
      env.queryClient.removeQueries({ queryKey: ["production", env.scopeKey, domain] });
    };
  }, [env.queryClient, env.scopeKey, domain]);
  const accessError = (error: unknown) => {
    const failure = domainFailure(error);
    if (![401, 403, 404].includes(failure.status) && failure.code !== "session_changed" && failure.code !== "unauthorized") return false;
    life.current.revoked = true; life.current.generation++;
    for (const request of requests.current) request.abort();
    requests.current.clear();
    env.queryClient.removeQueries({ queryKey: ["production", env.scopeKey, domain] });
    setLost(true); env.accessError(failure);
    return true;
  };
  const request = async <T,>(action: (signal: AbortSignal, current: () => boolean) => Promise<T>): Promise<T | undefined> => {
    if (!live()) return;
    const controller = new AbortController(); requests.current.add(controller);
    const generation = life.current.generation;
    const current = () => live() && !controller.signal.aborted && generation === life.current.generation;
    try { return await action(controller.signal, current); }
    finally { requests.current.delete(controller); }
  };
  const read = <T,>(key: readonly unknown[], action: (signal: AbortSignal) => Promise<T>, outerSignal: AbortSignal) => env.queryClient.fetchQuery({
    queryKey: ["production", env.scopeKey, domain, ...key], staleTime: 0, retry: false,
    queryFn: async ({ signal }) => {
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true }); outerSignal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || outerSignal.aborted) abort();
      try { return await action(controller.signal); }
      finally { signal.removeEventListener("abort", abort); outerSignal.removeEventListener("abort", abort); }
    },
  });
  return { lost, live, request, read, accessError };
}

export function useTaskKnowledgeRefresh(refresh: () => void, enabled: boolean, busy = false) {
  const latest = useRef({ refresh, enabled, busy }); latest.current = { refresh, enabled, busy };
  const queued = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    if (busy) queued.current = true;
    else latest.current.refresh();
  }, [enabled]);
  useEffect(() => {
    if (enabled && !busy && queued.current) { queued.current = false; latest.current.refresh(); }
  }, [enabled, busy]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const updated = () => {
      const current = latest.current;
      if (!current.enabled) { queued.current = true; return; }
      if (current.busy) queued.current = true;
      else current.refresh();
    };
    window.addEventListener("yuban-online-refresh", updated);
    return () => window.removeEventListener("yuban-online-refresh", updated);
  }, []);
}