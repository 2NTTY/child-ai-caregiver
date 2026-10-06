import { useProduction } from "./ProductionProvider";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { growthConcernFollowUpLabel } from "../growth-view-model";
import { childProfileAgeLabel } from "../child-overview-view-model";
import { careKindOptions } from "../care-view-model";
import type { HomeViewModel, HomeRecord } from "../view-model";

/** Read-only composition of the exact owners used by domain pages. No home data copy. */
export function useProductionHome() {
  const production = useProduction(), care = useCareWorkspace(), profile = useProfileWorkspace(), tasks = useTasksWorkspace(), growth = useGrowthWorkspace();
  const base = production.model, scope = production.scopeKey;
  const currentCare = care?.scopeKey === scope ? care.model : null;
  const currentProfile = profile?.scopeKey === scope ? profile.model : null;
  const currentTasks = tasks?.scopeKey === scope ? tasks.model : null;
  const currentGrowth = growth?.scopeKey === scope ? growth.model : null;
  const concerns = currentGrowth?.access !== "lost" && currentGrowth?.load === "ready" && currentGrowth.page?.concerns?.state === "ready"
    ? currentGrowth.page.concerns.items.filter(item => item.childId === base.selectedChildId && item.status !== "closed") : null;
  const ongoing = concerns ? { state: "ready" as const, items: concerns.map(item => ({
    id: item.id, title: item.title, detail: item.reason, statusLabel: growthConcernFollowUpLabel(item) ?? "持續關注",
    action: { label: "查看關注經過", destination: "growth" as const },
  })), detail: "目前沒有已取得的持續關注。" }
    : { state: currentGrowth?.access !== "lost" && currentGrowth?.load === "loading" ? "loading" as const : "unavailable" as const,
      items: [], detail: "尚未確認目前關注歷程，不能當作沒有需要觀察的事情。" };
  const profileData = currentProfile && !currentProfile.reading && !currentProfile.needsRefresh ? currentProfile.current?.data : null;
  const pending = currentTasks?.items.filter(item => item.occurrence.state === "scheduled" || item.occurrence.state === "needs_review") ?? [];
  const tasksReady = !!currentTasks && currentTasks.online && currentTasks.access !== "lost" && !currentTasks.reading && currentTasks.operation.state !== "failed";
  const attention = tasksReady ? { state: "ready" as const, items: pending.slice(0, 6).map(item => ({
    id: item.id, title: item.title, detail: `${new Date(item.occurrence.dueAt).toLocaleString("zh-HK", { timeZone: item.occurrence.timeZone })} · ${item.occurrence.timeZone}`,
    statusLabel: item.occurrence.state === "needs_review" ? "待覆核 · 已停催" : "待處理",
    action: { label: "查看事項", destination: "tasks" as const },
  })), detail: currentTasks?.hasMoreTasks ? "顯示已載入事項；尚有更早或其他分頁。" : undefined }
    : { state: currentTasks?.reading ? "loading" as const : "unavailable" as const, items: [], detail: "尚未確認目前事項，不能當作沒有待辦。" };
  const model: HomeViewModel = { ...base,
    children: base.children.map(child => child.id !== base.selectedChildId ? child : { ...child,
      ageLabel: profileData ? childProfileAgeLabel(profileData) : "年齡資料未確認",
      regionLabel: profileData?.region ?? "地區未提供", allergiesLabel: profileData?.allergies ?? null,
      profileConfirmed: !!profileData && !!currentProfile?.current?.confirmedAtLabel,
    }),
    profileLoad: currentProfile?.reading ? "loading" : currentProfile?.current && !currentProfile.needsRefresh ? "ready" : base.profileLoad,
    recordsLoad: currentCare?.list.state === "ready" ? "ready" : currentCare?.list.state === "loading" || currentCare?.list.state === "loading_more" ? "loading" : "error",
    lastReadLabel: null,
    records: currentCare ? currentCare.list.records.map(record => ({
      id: record.id, childId: record.childId,
      kind: (["sleep", "feeding", "measurement", "appointment"].includes(record.current.values.kind) ? record.current.values.kind : "note") as HomeRecord["kind"],
      title: careKindOptions.find(item => item.value === record.current.values.kind)?.label ?? record.title,
      detail: record.current.values.text, eventTimeLabel: record.current.values.eventTimeRaw || "事件時間未提供",
      confirmedAtLabel: record.current.confirmedAtLabel,
    })) : [],
    focus: !tasksReady ? { kind: "unavailable", detail: attention.detail! } : pending[0]
      ? { kind: "task", title: pending[0].title, detail: attention.items[0].detail, action: { label: "查看事項", destination: "tasks" } }
      : { kind: "none", detail: currentTasks?.hasMoreTasks ? "已讀取部分沒有待處理事項；其他分頁仍未讀取。" : "目前沒有待處理事項。" },
    overview: base.overview ? { ...base.overview, attention, ongoing } : undefined,
  };
  return { ...production, model, actions: { ...production.actions, refresh() {
    production.actions.refresh();
    if (growth?.scopeKey === scope) growth.actions.refresh();
  } } };
}
