import { ProfileWorkspaceProvider as InjectProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { usePreview } from "./PreviewContext";
import { useProfilePreview } from "./useProfilePreview";

export type ProfilePreviewWorkspaceValue = ReturnType<typeof useProfilePreview> & { scopeKey: string };
const ProfileWorkspaceContext = createContext<ProfilePreviewWorkspaceValue | null>(null);

// Mount once under PreviewProvider. Scope changes withhold stale data without remounting routes.
export function ProfileWorkspaceProvider({ children }: { children: ReactNode }) {
  const { model } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId) ?? null;
  const pathname = usePathname();
  const scopeKey = JSON.stringify(["preview-server", model.caregiverName, child?.id ?? null, child?.accessRole ?? null]);
  const preview = useProfilePreview(child, model.connection === "online", model.profileLoad === "loading", scopeKey, pathname === "/profile" ? "profile" : "");
  const value = preview.scopeReady ? { ...preview, scopeKey } : null;
  const consumer = value ? { scopeKey, model: value.model, actions: value.actions, dataLabel: "合成資料預覽 · 沒有連接 Server" } : null;
  return <ProfileWorkspaceContext.Provider value={value}><InjectProfileWorkspace scopeKey={scopeKey} value={consumer}>{children}</InjectProfileWorkspace></ProfileWorkspaceContext.Provider>;
}
export function useProfilePreviewWorkspace() { return useContext(ProfileWorkspaceContext); }
