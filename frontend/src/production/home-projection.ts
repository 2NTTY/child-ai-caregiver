import type { HomeViewModel } from "../view-model";
import type { ProductionSnapshot } from "./ProductionOwner";
import { sharedChildChoiceId } from '../../../src/client/shared-child-controller.ts';

export function projectProductionHome(snapshot: ProductionSnapshot): HomeViewModel {
  const state = snapshot.records;
  const knownChildren = state.childrenLoadedAt !== null && !state.childrenError;
  const selected = snapshot.activeChild;
  const shared = snapshot.sharedChild.view;
  const choiceId = shared ? sharedChildChoiceId(shared.spaceId,shared.childId) : selected?.id ?? null;
  const childOperation = state.busy === "createChild" ? "saving"
    : state.childOutcome === "unknown" || state.childOutcome === "checked" ? "unknown" : state.childMessage ? "failed" : "none";
  return {
    scopeKey: snapshot.scopeKey,
    caregiverName: state.user?.name ?? "",
    children: [...state.children.map(child => ({ id: child.id, displayName: child.displayName, accessRole: child.accessRole,
      ageLabel: "年齡資料未載入", regionLabel: "地區資料未載入", allergiesLabel: null, profileConfirmed: false })),
      ...(shared ? [{id:choiceId!,displayName:`${shared.childName}（${shared.spaceName}）`,accessRole:shared.role,
        ageLabel:'已分享模組',regionLabel:'',allergiesLabel:null,profileConfirmed:false}]:[])],
    selectedChildId: choiceId,
    connection: !state.online ? "offline" : snapshot.identityKey ? "online" : "checking",
    recordsLoad: state.recordsLoading ? "loading" : state.recordsError || !state.recordsLoadedAt ? "error" : "ready",
    profileLoad: state.childrenLoading ? "loading" : knownChildren && state.children.length === 0 ? "ready" : "error",
    records: selected && !snapshot.sharedChild.target ? state.records.filter(record => record.childId === selected.id).map(record => ({
      id: record.id, childId: record.childId, kind: "note", title: "文字記錄", detail: record.text,
      eventTimeLabel: "事件時間未提供", confirmedAtLabel: new Date(record.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
    })) : [],
    lastReadLabel: state.recordsLoadedAt ? new Date(state.recordsLoadedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : null,
    operation: { state: childOperation, title: childOperation === "none" ? "" : "建立孩子", detail: state.childMessage ?? (childOperation === "saving" ? "正在建立孩子…" : "") },
    guideStatus: shared ? "incomplete" : !knownChildren ? "unknown" : state.children.length === 0 ? "first_login" : "incomplete",
    focus: { kind: "unavailable", detail: "暫時無法顯示待辦" },
    overview: selected ? { childId: choiceId!,
      agentImportant: { state: "unavailable", items: [], loadedAt: null, detail: "暫時無法顯示助手提醒" },
      attention: { state: "unavailable", items: [], detail: "暫時無法顯示待辦" },
      ongoing: { state: "unavailable", items: [], detail: "暫時無法顯示持續關注" },
    } : undefined,
  };
}
