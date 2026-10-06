import type { QueryClient } from "@tanstack/react-query";
import { ClientApiError, type RecordsApi } from "../../../src/client/records-api.ts";

export interface RecordsReadScope {
  identityKey: string | null;
  childId: string | null;
  scopeKey: string | null;
}

// Session verification always goes to the server. Query owns read caches only.
export function withRecordsQueries(api: RecordsApi, queryClient: QueryClient, scope: () => RecordsReadScope): RecordsApi {
  async function read<T>(key: readonly unknown[], outerSignal: AbortSignal, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return queryClient.fetchQuery({ queryKey: key, staleTime: 0, retry: false,
      queryFn: async ({ signal }) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        outerSignal.addEventListener("abort", abort, { once: true });
        signal.addEventListener("abort", abort, { once: true });
        if (outerSignal.aborted || signal.aborted) controller.abort();
        try { return await load(controller.signal); }
        finally { outerSignal.removeEventListener("abort", abort); signal.removeEventListener("abort", abort); }
      },
    });
  }
  return { ...api,
    listChildren(signal) {
      const current = scope();
      if (!current.identityKey) return Promise.reject(new ClientApiError(401));
      return read(["production", current.identityKey, "children"], signal, next => api.listChildren(next));
    },
    listRecords(childId, signal) {
      const current = scope();
      if (!current.scopeKey || current.childId !== childId) return Promise.reject(new ClientApiError(403));
      return read(["production", current.scopeKey, "records"], signal, next => api.listRecords(childId, next));
    },
  };
}
