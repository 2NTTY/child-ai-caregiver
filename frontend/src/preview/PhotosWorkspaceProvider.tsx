import { createContext, useContext, type ReactNode } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import type { HomeChild } from "../view-model";
import { usePreview } from "./PreviewContext";
import { usePhotosPreview } from "./usePhotosPreview";

type PhotosWorkspaceValue = ReturnType<typeof usePhotosPreview> & {scopeKey: string};
const PhotosWorkspaceContext = createContext<PhotosWorkspaceValue | null>(null);
const absentChild: HomeChild = {id:"no-authorized-photo-child",displayName:"",ageLabel:"未提供",regionLabel:"未提供",allergiesLabel:null,profileConfirmed:false,accessRole:"viewer"};

// One domain controller serves every photo entry. This is synthetic data,
// not a PhotoApi adapter or a new global business store. Scope changes never
// remount unrelated dashboard children; an unmatched scope is withheld.
export function PhotosWorkspaceProvider({children}: {children: ReactNode}) {
  const {model} = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const pathname = usePathname();
  const {view} = useGlobalSearchParams<{view?: string}>();
  const active = pathname === "/photos" || pathname === "/care" && view === "photos";
  const scopeKey = JSON.stringify(["preview-server", model.caregiverName, child?.id ?? null, child?.accessRole ?? null]);
  const controller = usePhotosPreview(child ?? absentChild, model.connection === "online", model.recordsLoad === "loading", active && !!child, scopeKey, active ? pathname : "");
  return <PhotosWorkspaceContext.Provider value={child && controller.scopeReady ? {...controller, scopeKey} : null}>{children}</PhotosWorkspaceContext.Provider>;
}
export function usePhotosWorkspace() {
  return useContext(PhotosWorkspaceContext);
}
