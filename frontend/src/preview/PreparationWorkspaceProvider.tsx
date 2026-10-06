import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  archivePreparation, canChangePreparation, checkPreparationItem, preparationAuthorityKey, preparationScopeKey, projectPreparations,
  type PreparationCondition, type PreparationDocumentView, type PreparationScope,
} from "../preparation-view-model";
import type { HomeChild } from "../view-model";
import { createPreparationFixture } from "./preparation-fixture";
import { usePreview } from "./PreviewContext";

import { PreparationWorkspaceProvider as InjectPreparationWorkspace, type PreparationWorkspaceValue } from "../workspaces/PreparationWorkspace";

interface PreparationPreviewToolsValue {
  scopeKey: string;
  condition: PreparationCondition;
  setCondition(condition: PreparationCondition): void;
}
const PreviewContext = createContext<PreparationPreviewToolsValue | null>(null);

// Mount once above Summary and History. This owner holds only session-local, synthetic documents.
export function PreparationWorkspaceProvider({ children }: { children: ReactNode }) {
  const { model: home } = usePreview();
  const child = home.children.find(item => item.id === home.selectedChildId);
  const authorityKey = preparationAuthorityKey(home.caregiverName, home.children);
  const [state, setState] = useState(() => createPreparationFixture(authorityKey, home.children));
  const [selection, setSelection] = useState<{ scopeKey: string; id: string } | null>(null);
  const [scenario, setScenario] = useState<{ scopeKey: string; value: PreparationCondition } | null>(null);
  const [attempt, setAttempt] = useState<{ scopeKey: string; id: string; version: number; kind: "archive" | "check" } | null>(null);
  const scope: PreparationScope = { authorityKey, childId: child?.id ?? "", role: child?.accessRole ?? "viewer",
    online: home.connection === "online", condition: "ready" };
  const scopeKey = preparationScopeKey(scope);
  scope.condition = home.recordsLoad === "loading" ? "loading" : scenario?.scopeKey === scopeKey ? scenario.value : "ready";
  const current = useRef({ scopeKey, scope, selection, authorityKey, state });
  current.current = { scopeKey, scope, selection, authorityKey, state };
  // Render masks a mismatched authority before this effect can expose a new fixture.
  useLayoutEffect(() => {
    if (state.authorityKey === authorityKey) return;
    setState(createPreparationFixture(authorityKey, home.children));
    setSelection(null); setScenario(null); setAttempt(null);
  }, [authorityKey, state.authorityKey]);
  useLayoutEffect(() => { setSelection(null); setAttempt(null); setScenario(null); }, [scopeKey]);

  const documents = projectPreparations(state, scope);
  const selected = selection?.scopeKey === scopeKey ? documents.find(item => item.id === selection.id) ?? null : null;
  const stillCurrent = () => current.current.scopeKey === scopeKey && current.current.authorityKey === authorityKey;
  const currentDocument = (id: string, expectedVersion: number) => {
    if (!stillCurrent() || current.current.selection?.scopeKey !== scopeKey || current.current.selection.id !== id) return null;
    const document = projectPreparations(current.current.state, current.current.scope).find(item => item.id === id && item.version === expectedVersion);
    return document && canChangePreparation(document, current.current.scope) ? document : null;
  };
  const actions: PreparationWorkspaceValue["actions"] = {
    selectDocument(id) {
      if (!stillCurrent() || !documents.some(item => item.id === id)) return;
      setSelection({ scopeKey, id }); setAttempt(null);
    },
    closeDocument() { if (stillCurrent()) { setSelection(null); setAttempt(null); } },
    archiveDocument(id, expectedVersion) {
      if (!currentDocument(id, expectedVersion)) return;
      const at = new Date().toISOString();
      setAttempt({ scopeKey, id, version: expectedVersion, kind: "archive" });
      setState(previous => archivePreparation(previous, current.current.scope, { authorityKey, childId: scope.childId, documentId: id, expectedVersion, at }));
      // The UI derives success from the next source projection, not a timer or a pretend receipt.
    },
    checkItem(id, expectedVersion, sectionId, itemId, checked) {
      const document = currentDocument(id, expectedVersion);
      const section = document?.revision?.sections.find(section => section.id === sectionId && section.kind === "checklist");
      const item = section?.items.find(item => item.id === itemId);
      if (!item || item.checked === checked) return;
      const at = new Date().toISOString();
      setAttempt({ scopeKey, id, version: expectedVersion, kind: "check" });
      setState(previous => checkPreparationItem(previous, current.current.scope, { authorityKey, childId: scope.childId, documentId: id, expectedVersion, at, sectionId, itemId, checked }));
    },
  };
  const changed = attempt?.scopeKey === scopeKey ? documents.find(document => document.id === attempt.id && document.version === attempt.version + 1) : null;
  const value: PreparationWorkspaceValue | null = child && state.authorityKey === authorityKey ? {
    scopeKey, model: { child, scope, documents, selected, condition: scope.condition, online: scope.online,
      notice: changed && attempt?.kind === "check" ? "清單只更新本次合成預覽，沒有傳送或保存到伺服器。" : null,
      justArchivedId: changed?.status === "archived" && attempt?.kind === "archive" ? changed.id : null, dataLabel: "合成準備單示例", archiveNotice: "這次操作只保留在本次合成預覽。", capabilities: { archive: true, checkItem: true } }, actions,
  } : null;
  const previewTools: PreparationPreviewToolsValue | null = value ? { scopeKey, condition: scope.condition,
    setCondition(condition) { if (stillCurrent()) { setScenario({ scopeKey, value: condition }); setAttempt(null); } },
  } : null;
  return <PreviewContext.Provider value={previewTools}><InjectPreparationWorkspace scopeKey={scopeKey} value={value}>{children}</InjectPreparationWorkspace></PreviewContext.Provider>;
}

export function usePreparationPreviewTools() { return useContext(PreviewContext); }
