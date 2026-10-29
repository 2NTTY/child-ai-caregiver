import { childProfileAgeLabel } from "../child-overview-view-model";
import type { ProfileWorkspaceValue } from "../workspaces/ProfileWorkspace";
import type { HomeViewModel } from "../view-model";
import type { ProductionSnapshot } from "./ProductionOwner";

export function projectProductionHome(snapshot: ProductionSnapshot): HomeViewModel {
  const state = snapshot.records;
  const knownChildren = state.childrenLoadedAt !== null && !state.childrenError;
  const selected = snapshot.scopeKey ? state.children.find(child => child.id === state.selectedChildId) : undefined;
  const childOperation = state.busy === "createChild" ? "saving"
    : state.childOutcome === "unknown" || state.childOutcome === "checked" ? "unknown" : state.childMessage ? "failed" : "none";
  return {
    scopeKey: snapshot.scopeKey,
    caregiverName: state.user?.name ?? "",
    children: state.children.map(child => ({ id: child.id, displayName: child.displayName, accessRole: child.accessRole,
      ageLabel: "年齡資料未載入", regionLabel: "地區資料未載入", allergiesLabel: null, profileConfirmed: false, profileReadLabel: "檔案未載入" })),
    selectedChildId: selected?.id ?? null,
    connection: !state.online ? "offline" : snapshot.identityKey ? "online" : "checking",
    recordsLoad: state.recordsLoading ? "loading" : state.recordsError || !state.recordsLoadedAt ? "error" : "ready",
    profileLoad: state.childrenLoading ? "loading" : knownChildren && state.children.length === 0 ? "ready" : "error",
    records: selected ? state.records.filter(record => record.childId === selected.id).map(record => ({
      id: record.id, childId: record.childId, kind: "note", title: "文字記錄", detail: record.text,
      eventTimeLabel: "事件時間未提供", confirmedAtLabel: new Date(record.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
    })) : [],
    lastReadLabel: state.recordsLoadedAt ? new Date(state.recordsLoadedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : null,
    operation: { state: childOperation, title: childOperation === "none" ? "" : "建立孩子", detail: state.childMessage ?? (childOperation === "saving" ? "正在建立孩子…" : "") },
    guideStatus: !knownChildren ? "unknown" : state.children.length === 0 ? "first_login" : selected ? "not_required" : "unknown",
    focus: { kind: "unavailable", detail: "暫時無法顯示待辦" },
    overview: selected ? { childId: selected.id,
      agentImportant: { state: "unsupported", items: [], loadedAt: null },
      attention: { state: "unavailable", items: [], detail: "暫時無法顯示待辦" },
      ongoing: { state: "unavailable", items: [], detail: "暫時無法顯示持續關注" },
    } : undefined,
  };
}

/** Shared by Today and Settings; an unloaded sibling is never presented as confirmed. */
export function projectHomeChildren(base: HomeViewModel, profile: Pick<ProfileWorkspaceValue, "scopeKey" | "model"> | null) {
  const current = base.scopeKey && profile?.scopeKey === base.scopeKey && profile.model.child?.id === base.selectedChildId
    && profile.model.access !== "lost" && !profile.model.needsRefresh && !profile.model.operation?.resultUnavailable ? profile.model : null;
  return base.children.map(child => {
    const revision = child.id === base.selectedChildId ? current?.current : null;
    const data = revision?.data;
    return { ...child, ageLabel: data ? childProfileAgeLabel(data) : "年齡資料未載入",
      regionLabel: data?.region ?? "地區未提供", allergiesLabel: data?.allergies ?? null,
      profileConfirmed: !!data && !!revision?.confirmedAtLabel,
      profileReadLabel: data ? revision?.confirmedAtLabel ? "已確認檔案" : "檔案待核對"
        : revision ? "尚未補充檔案" : "檔案未載入", };
  });
}
