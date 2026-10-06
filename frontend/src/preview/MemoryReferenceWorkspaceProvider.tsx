import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MemoryReferenceWorkspaceValue } from "../memory-reference-view-model";
import type { MemoryRole } from "../memory-view-model";
import { MemoryReferenceWorkspaceProvider as InjectMemoryReferenceWorkspace } from "../workspaces/MemoryReferenceWorkspace";
import { useMemoryPreview } from "./useMemoryPreview";
import { usePreview } from "./PreviewContext";
import { useOwnerProjection } from "./useOwnerProjection";

interface MemoryReferencePreviewTools {
  sourceChanged: boolean; expired: boolean; revoked: boolean;
  setSourceChanged(value: boolean): void; setExpired(value: boolean): void; setRevoked(value: boolean): void;
}
const ToolsContext = createContext<MemoryReferencePreviewTools | null>(null);
type MemoryOwnerInput = {
  scopeKey: string; childId: string; childName: string; role: MemoryRole; online: boolean;
  loading: boolean; error: boolean; sourceChanged: boolean; expired: boolean;
};

// Mount once above the routes. This is the existing Memory preview's sole state owner.
// The page receives only read snapshots; none of useMemoryPreview's writers escape this adapter.
const MemoryReadOwner = memo(function MemoryReadOwner({ input, publish, isCurrent }: {
  input: MemoryOwnerInput; publish(value: MemoryReferenceWorkspaceValue): void; isCurrent(): boolean;
}) {
  const { scopeKey, childId, childName, role, online, loading, error, sourceChanged, expired } = input;
  const owner = useMemoryPreview(childId, role, sourceChanged, expired);
  const revision = JSON.stringify(owner.factsPage.items.map(fact => [fact.id, fact.version, fact.sourceState, fact.applicable]));
  const current = useRef({ scopeKey, revision });
  current.current = { scopeKey, revision };
  const unavailable = { scopeKey, state: "unavailable" as const, revision: null, asOf: null, data: null };
  const value: MemoryReferenceWorkspaceValue = { scopeKey, model: {
    scopeKey, childId, childName, access: "active", online, dataLabel: "合成記憶示例",
    shortTerm: unavailable,
    references: unavailable,
    longTerm: loading || error ? { ...unavailable, state: loading ? "loading" : "error" } : {
      scopeKey, state: online ? "ready" : "stale", revision, asOf: null,
      data: { childId, facts: owner.factsPage.items, hasMoreFacts: !!owner.factsPage.nextAfterId, summary: owner.data.summary,
        histories: Object.fromEntries(owner.factsPage.items.map(fact => [fact.id, {
          factVersion: fact.version, state: "ready" as const, items: owner.data.factVersions[fact.id] ?? [], hasMore: false,
        }])) },
    },
  }, reads: { loadMoreFacts() {
    if (isCurrent() && current.current.scopeKey === scopeKey && current.current.revision === revision && online && !loading && !error) owner.loadMoreFacts();
  } } };
  useLayoutEffect(() => publish(value), [value, publish]);
  return null;
});
export function MemoryReferenceWorkspaceProvider({ children }: { children: ReactNode }) {
  const { model } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const authorityKey = JSON.stringify(["preview-memory-server", model.caregiverName, child?.id, child?.accessRole]);
  const [scenario, setScenario] = useState({ authorityKey, sourceChanged: false, expired: false, revoked: false });
  const { sourceChanged, expired, revoked } = scenario.authorityKey === authorityKey ? scenario : emptyScenario;
  useLayoutEffect(() => {
    if (scenario.authorityKey !== authorityKey) setScenario({ authorityKey, ...emptyScenario });
  }, [authorityKey, scenario.authorityKey]);
  const scopeKey = JSON.stringify([authorityKey, sourceChanged, expired, revoked]);
  const input = useMemo(() => child && !revoked ? { scopeKey, childId: child.id, childName: child.displayName,
    role: child.accessRole ?? "viewer", online: model.connection === "online", loading: model.recordsLoad === "loading",
    error: model.recordsLoad === "error", sourceChanged, expired } : null,
  [scopeKey, child, revoked, model.connection, model.recordsLoad, sourceChanged, expired]);
  const projection = useOwnerProjection<MemoryReferenceWorkspaceValue>(scopeKey, input ?? emptyScenario);
  function changeScenario(field: "sourceChanged" | "expired" | "revoked", value: boolean) {
    if (!projection.isCurrent()) return;
    setScenario(previous => ({ ...(previous.authorityKey === authorityKey ? previous : { authorityKey, ...emptyScenario }), [field]: value }));
  }
  return <ToolsContext.Provider value={child ? { sourceChanged, expired, revoked,
    setSourceChanged: value => changeScenario("sourceChanged", value), setExpired: value => changeScenario("expired", value), setRevoked: value => changeScenario("revoked", value) } : null}>
    <InjectMemoryReferenceWorkspace scopeKey={scopeKey} value={input ? projection.value : null}>
      {input ? <MemoryReadOwner key={projection.generation} input={input} publish={projection.publish} isCurrent={projection.isCurrent} /> : null}
      {children}
    </InjectMemoryReferenceWorkspace>
  </ToolsContext.Provider>;
}
const emptyScenario = { sourceChanged: false, expired: false, revoked: false };
export function useMemoryReferencePreviewTools() { return useContext(ToolsContext); }
