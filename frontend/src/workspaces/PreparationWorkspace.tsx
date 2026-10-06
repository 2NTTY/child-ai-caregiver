import { createContext, useContext, type ReactNode } from "react";
import type { PreparationCondition, PreparationDocumentView, PreparationScope } from "../preparation-view-model";
import type { HomeChild, WriteOperationView, WriteRecoveryActions } from "../view-model";

// Presentation injection only. The external domain controller owns reads, writes and authorization.
export interface PreparationWorkspaceValue {
  scopeKey: string;
  model: {
    child: HomeChild;
    scope: PreparationScope;
    documents: readonly PreparationDocumentView[];
    selected: PreparationDocumentView | null;
    condition: PreparationCondition;
    online: boolean;
    notice: string | null;
    justArchivedId: string | null;
    dataLabel?: string;
    archiveNotice?: string;
    operation?: WriteOperationView;
    capabilities?: { archive: boolean; checkItem: boolean };
  };
  actions: {
    selectDocument(id: string): void;
    closeDocument(): void;
    archiveDocument(id: string, expectedVersion: number): void;
    checkItem(id: string, expectedVersion: number, sectionId: string, itemId: string, checked: boolean): void;
  };
  recovery?: WriteRecoveryActions;
}
const Context = createContext<PreparationWorkspaceValue | null>(null);

// The host passes its current identity/server/child/role scope independently of the loaded value.
// No preview hook runs here; mismatched or not-yet-loaded authority is withheld synchronously.
export function PreparationWorkspaceProvider({ scopeKey, value, children }: {
  scopeKey: string; value: PreparationWorkspaceValue | null; children: ReactNode;
}) {
  const current = value && scopeKey && value.scopeKey === scopeKey ? value : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function usePreparationWorkspace() { return useContext(Context); }
