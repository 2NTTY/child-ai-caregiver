import { useCallback, useSyncExternalStore } from "react";
import { privateQueries } from "./private-query-cache";

export function usePrivateQuery(scopeKey: string | null, route: string): [string, (value: string) => void] {
  const getSnapshot = useCallback(() => privateQueries.get(scopeKey, route), [scopeKey, route]);
  const value = useSyncExternalStore(privateQueries.subscribe, getSnapshot, getSnapshot);
  return [value, next => privateQueries.set(scopeKey, route, next)];
}
