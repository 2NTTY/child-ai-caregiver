import { createContext, use, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createMemoryReaderViewState, emptyMemoryDisclosures, type MemoryFactDisclosure, type MemoryReaderDisclosures } from "./memory-reader-view-state";

type ReaderState = ReturnType<typeof createMemoryReaderViewState>;
const Context = createContext<ReaderState | null>(null);
const noSubscribe = () => () => {};
const emptyRevision = () => 0;

/** Presentation lifetime follows the existing application owner, not a replaceable route. */
export function MemoryReaderViewStateHost({ read, subscribe, children }: {
  read: Parameters<typeof createMemoryReaderViewState>[0]; subscribe(listener: () => void): () => void; children: ReactNode;
}) {
  const [state] = useState(() => createMemoryReaderViewState(read));
  useLayoutEffect(() => { state.observe(); return subscribe(state.observe); }, [state, subscribe]);
  return <Context value={state}>{children}</Context>;
}

export function useMemoryReaderDisclosures(scopeKey: string, loadedFacts: readonly { id: string; version: number }[] | null) {
  const state = use(Context);
  useSyncExternalStore(state?.subscribe ?? noSubscribe, state?.getRevision ?? emptyRevision, state?.getRevision ?? emptyRevision);
  const token = state?.capture(scopeKey) ?? null;
  // Standalone/preview readers keep the original route-local behavior without a production host.
  const [local, setLocal] = useState<MemoryReaderDisclosures>(emptyMemoryDisclosures);
  const retained = state?.get(token) ?? emptyMemoryDisclosures;
  useLayoutEffect(() => { if (loadedFacts) state?.reconcile(token, loadedFacts); }, [state, token, loadedFacts]);
  return { disclosures: state ? retained : local,
    setDisclosure(id: string, version: number, next: MemoryFactDisclosure) {
      if (state) state.write(token, id, version, next);
      else setLocal(before => ({ ...before, [id]: { version, ...next } }));
    },
  };
}
