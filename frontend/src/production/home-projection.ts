import type { ProfileViewModel } from "../profile-view-model";
import { childProfileAgeLabel } from "../child-overview-view-model";
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
      ageLabel: "年齡資料未載入", regionLabel: "地區資料未載入", allergiesLabel: null, profileConfirmed: false, profileState: "unread" })),
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
    guideStatus: !knownChildren ? "unknown" : state.children.length === 0 ? "first_login" : "complete",
    focus: { kind: "unavailable", detail: "暫時無法顯示待辦" },
    overview: selected ? { childId: selected.id,
      agentImportant: { state: "unsupported", items: [], loadedAt: null },
      attention: { state: "unavailable", items: [], detail: "暫時無法顯示待辦" },
      ongoing: { state: "unavailable", items: [], detail: "暫時無法顯示持續關注" },
    } : undefined,
  };
}

/** One read-only profile projection for Home and Settings; siblings remain unread. */
export function projectCurrentHomeChildren(base: HomeViewModel, workspace: { scopeKey: string | null; model: ProfileViewModel } | null | undefined): HomeViewModel["children"] {
  const profile = workspace?.scopeKey === base.scopeKey && workspace?.model.child?.id === base.selectedChildId
    && workspace.model.access !== "lost" && !workspace.model.needsRefresh && !workspace.model.operation?.resultUnavailable ? workspace.model : null;
  return base.children.map(child => {
    const current = child.id === base.selectedChildId ? profile : null;
    const data = current?.current?.data;
    return { ...child,
      ageLabel: data ? childProfileAgeLabel(data) : current && !current.reading ? "年齡未知（可稍後補充）" : "年齡資料尚未核對",
      regionLabel: data?.region ?? "地區未提供", allergiesLabel: data?.allergies ?? null,
      profileConfirmed: !!data && !!current?.current?.confirmedAtLabel,
      profileState: data && current?.current?.confirmedAtLabel ? "confirmed" : current && !current.reading ? "optional" : "unread",
    };
  });
}
