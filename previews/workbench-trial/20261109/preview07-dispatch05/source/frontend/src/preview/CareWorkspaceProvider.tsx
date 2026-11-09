import { CareWorkspaceProvider as InjectCareWorkspace } from "../workspaces/CareWorkspace";
import { createContext, useContext, type ReactNode } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import type { HomeChild } from "../view-model";
import { usePreview } from "./PreviewContext";
import { useCarePreview } from "./useCarePreview";

type CarePreviewWorkspaceValue = ReturnType<typeof useCarePreview> & { scopeKey: string };
const CareWorkspaceContext = createContext<CarePreviewWorkspaceValue | null>(null);
const absentChild: HomeChild = { id: "no-authorized-care-child", displayName: "", ageLabel: "未提供", regionLabel: "未提供", allergiesLabel: null, profileConfirmed: false, accessRole: "viewer" };

// One synthetic owner for the approval gate, review history and canonical care records.
export function CareWorkspaceProvider({ children }: { children: ReactNode }) {
  const { model } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const pathname = usePathname();
  const { category, view, compose, record } = useGlobalSearchParams<{ category?: string; view?: string; compose?: string; record?: string }>();
  const scopeKey = JSON.stringify(["preview-server", model.caregiverName, child?.id ?? null, child?.accessRole ?? null]);
  const entry = pathname === "/care" && view !== "photos" ? `care:${compose ?? ""}:${record ?? ""}` : pathname === "/history" && category === "review" ? "review-history" : pathname === "/history" && category === "care" ? "care-history" : "";
  const preview = useCarePreview(child ?? absentChild, model.connection === "online", model.recordsLoad === "loading", undefined, undefined, scopeKey, entry);
  const value = child && preview.scopeReady && preview.entryReady ? { ...preview, scopeKey } : null;
  const consumer = value ? { scopeKey, model: value.model, actions: value.actions } : null;
  return <CareWorkspaceContext.Provider value={value}><InjectCareWorkspace scopeKey={scopeKey} value={consumer}>{children}</InjectCareWorkspace></CareWorkspaceContext.Provider>;
}
export function useCarePreviewWorkspace() { return useContext(CareWorkspaceContext); }
