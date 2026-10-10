import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { FirstScreenGate } from "../startup/FirstScreenGate";
import { productionStartupReadiness, type StartupReadiness } from "../startup/dataReadiness";
import { useProduction } from "./ProductionProvider";

type Report = { key: string; state: StartupReadiness };
type StartupContextValue = { key: string; state: StartupReadiness; report(value: Report): void;
  visibilityKey: string; settingsActive: boolean; section?: string;
  registerSection(key: string, section: string): () => void;
  registerRetry(key: string, retry: (additional?: readonly string[]) => void): () => void; retry?: (additional?: readonly string[]) => void };
const StartupContext = createContext<StartupContextValue | null>(null);

export function ProductionFirstScreenGate({ width, launch, children }: { width: number; launch: ReactNode; children: ReactNode }) {
  const pathname = usePathname(), { tab, category, section, view, taskId, recordId, record } = useGlobalSearchParams();
  const { identityKey, scopeKey, recordsState, controller } = useProduction();
  const visibilityKey = JSON.stringify([identityKey, scopeKey, pathname, tab ?? null, category ?? null, section ?? null, view ?? null, taskId ?? null, recordId ?? null, record ?? null]);
  const currentVisibilityKey = useRef(visibilityKey); currentVisibilityKey.current = visibilityKey;
  const [visibleSection, setVisibleSection] = useState<{ key: string; section: string } | null>(null);
  const registerSection = useCallback((key: string, section: string) => {
    const entry = { key, section };
    if (key === currentVisibilityKey.current) setVisibleSection(entry);
    return () => { setVisibleSection(current => current === entry ? null : current); };
  }, []);
  const settingsActive = pathname === "/settings";
  const activeSection = settingsActive && visibleSection?.key === visibilityKey ? visibleSection.section : undefined;
  const key = JSON.stringify([visibilityKey, settingsActive ? activeSection ?? null : null]);
  const currentKey = useRef(key); currentKey.current = key;
  const currentRecords = useRef({ recordsState, controller }); currentRecords.current = { recordsState, controller };
  const [readiness, setReadiness] = useState<Report | null>(null);
  const report = useCallback((value: Report) => {
    if (value.key === currentKey.current) setReadiness(current => current?.key === value.key && current.state === value.state ? current : value);
  }, []);
  const state = productionStartupReadiness(recordsState, scopeKey, readiness?.key === key && (!settingsActive || activeSection) ? readiness.state : "loading");
  const retryRef = useRef<{ key: string; retry(additional?: readonly string[]): void } | null>(null);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const registerRetry = useCallback((key: string, retry: (additional?: readonly string[]) => void) => {
    const entry = { key, retry }; retryRef.current = entry; setRetryKey(key);
    return () => { if (retryRef.current === entry) { retryRef.current = null; setRetryKey(null); } };
  }, []);
  const retry = useCallback((additional?: readonly string[]) => {
    const current = retryRef.current; if (key !== currentKey.current || current?.key !== key) return;
    const { recordsState, controller } = currentRecords.current;
    // Shared admission errors are part of readiness too; domain refresh alone cannot clear them.
    if (recordsState.childrenError || recordsState.childrenLoadedAt === null) void controller.reloadChildren();
    current.retry(additional);
  }, [key]);
  const context = useMemo(() => ({ key, state, report, registerRetry, retry: retryKey === key ? retry : undefined,
    visibilityKey, settingsActive, section: activeSection, registerSection }), [key, state, report, registerRetry, retry, retryKey, visibilityKey, settingsActive, activeSection, registerSection]);
  return <StartupContext.Provider value={context}>
    <FirstScreenGate pathname={pathname} width={width} launch={launch} dataState={state} startupKey={identityKey ?? "anonymous"}>
      {children}
    </FirstScreenGate>
  </StartupContext.Provider>;
}

/** Settings keeps its existing local tabs; report only the panel actually shown. */
export function useProductionVisibleSettingsSection(section?: string) {
  const context = useContext(StartupContext);
  useLayoutEffect(() => {
    if (context?.settingsActive && section) return context.registerSection(context.visibilityKey, section);
  }, [context?.settingsActive, context?.visibilityKey, context?.registerSection, section]);
  return context?.section;
}

/** Report only the mounted route's existing projections; this hook never starts a read. */
export function useProductionStartupReadiness(state: StartupReadiness, retry?: (additional?: readonly string[]) => void) {
  const context = useContext(StartupContext);
  const retryRef = useRef(retry); retryRef.current = retry;
  useLayoutEffect(() => { if (context) context.report({ key: context.key, state }); }, [context, state]);
  useLayoutEffect(() => {
    if (context && retry) return context.registerRetry(context.key, additional => retryRef.current?.(additional));
  }, [context?.key, context?.registerRetry, !!retry]);
}

/** The switch barrier shares the exact current startup report; old keys stay pending. */
export function useProductionSwitchReadiness() {
  const context = useContext(StartupContext);
  return { key: context?.key ?? "unregistered", state: context?.state ?? "loading" as StartupReadiness, retry: context?.retry };
}
