import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { FirstScreenGate } from "../startup/FirstScreenGate";
import { productionStartupReadiness, type StartupReadiness } from "../startup/dataReadiness";
import { useProduction } from "./ProductionProvider";

type Report = { key: string; state: StartupReadiness };
const StartupContext = createContext<{ key: string; report(value: Report): void } | null>(null);

export function ProductionFirstScreenGate({ width, launch, children }: { width: number; launch: ReactNode; children: ReactNode }) {
  const pathname = usePathname(), { tab, category, section, view } = useGlobalSearchParams();
  const { identityKey, scopeKey, recordsState } = useProduction();
  const key = JSON.stringify([identityKey, scopeKey, pathname, tab ?? null, category ?? null, section ?? null, view ?? null]);
  const [readiness, setReadiness] = useState<Report | null>(null);
  const report = useCallback((value: Report) => setReadiness(current => current?.key === value.key && current.state === value.state ? current : value), []);
  const context = useMemo(() => ({ key, report }), [key, report]);
  const state = productionStartupReadiness(recordsState, scopeKey, readiness?.key === key ? readiness.state : "loading");
  return <StartupContext.Provider value={context}>
    <FirstScreenGate pathname={pathname} width={width} launch={launch} dataState={state} startupKey={identityKey ?? "anonymous"}>
      {children}
    </FirstScreenGate>
  </StartupContext.Provider>;
}

/** Report only the mounted route's existing projections; this hook never starts a read. */
export function useProductionStartupReadiness(state: StartupReadiness) {
  const context = useContext(StartupContext);
  useLayoutEffect(() => { if (context) context.report({ key: context.key, state }); }, [context, state]);
}
