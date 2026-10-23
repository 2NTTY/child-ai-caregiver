import { useProduction } from "./ProductionProvider";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { growthConcernFollowUpLabel } from "../growth-view-model";
import { childProfileAgeLabel } from "../child-overview-view-model";
import { careKindOptions } from "../care-view-model";
import type { HomeOverviewSection } from "../home-overview";
import type { HomeViewModel, HomeRecord } from "../view-model";

/** Read-only composition of the exact owners used by domain pages. No home data copy. */
export function useProductionHome() {
  const production = useProduction(), care = useCareWorkspace(), profile = useProfileWorkspace(), tasks = useTasksWorkspace(), growth = useGrowthWorkspace();
  const base = production.model, scope = production.scopeKey;
  const currentCare = care?.scopeKey === scope ? care.model : null;
  const currentProfile = profile?.scopeKey === scope ? profile.model : null;
  const currentTasks = tasks?.scopeKey === scope ? tasks.model : null;
  const currentGrowth = growth?.scopeKey === scope ? growth.model : null;
  const concerns = currentGrowth?.access !== "lost" && currentGrowth?.page?.concerns?.state === "ready"
    ? currentGrowth.page.concerns.items.filter(item => item.childId === base.selectedChildId && item.status !== "closed") : null;
  const ongoingState: HomeOverviewSection["state"] = !currentGrowth || currentGrowth.access === "lost" ? "unavailable"
    : currentGrowth.load === "loading" && !currentGrowth.page || currentGrowth.page?.concerns?.state === "loading" ? "loading" : concerns && (currentGrowth.load === "error" || !currentGrowth.online) ? "stale"
      : currentGrowth.load === "error" || currentGrowth.page?.concerns?.state === "error" ? "error" : concerns ? "ready" : "unavailable";
  const ongoing: HomeOverviewSection = { state: ongoingState, items: (concerns ?? []).map(item => ({
    id: item.id, title: item.title, detail: item.reason, statusLabel: growthConcernFollowUpLabel(item) ?? "持續關注",
    action: { label: "查看關注經過", destination: "growth" as const },
  })), detail: ongoingState === "loading" ? "正在讀取關注…" : ongoingState === "stale" ? "暫時無法更新，顯示較早的關注"
    : ongoingState === "error" || ongoingState === "unavailable" ? "暫時無法顯示持續關注" : undefined };
  const profileData = currentProfile && currentProfile.access !== "lost" && !currentProfile.needsRefresh ? currentProfile.current?.data : null;
  const tasksAvailable = !!currentTasks && currentTasks.access !== "lost";
  const pending = tasksAvailable ? currentTasks.items.filter(item => item.childId === base.selectedChildId && (item.occurrence.state === "scheduled" || item.occurrence.state === "needs_review")) : [];
  const taskReadState = currentTasks?.readState ?? (currentTasks?.reading ? "loading" : "ready");
  const attentionState: HomeOverviewSection["state"] = !tasksAvailable ? "unavailable"
    : taskReadState === "ready" && !currentTasks.online ? "stale" : taskReadState;
  const tasksReady = attentionState === "ready";
  const attention: HomeOverviewSection = { state: attentionState, items: pending.slice(0, 6).map(item => ({
    id: item.id, title: item.title, detail: new Date(item.occurrence.dueAt).toLocaleString("zh-HK", { timeZone: item.occurrence.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
    statusLabel: item.occurrence.state === "needs_review" ? "待覆核 · 已停催" : "待處理",
    action: { label: "查看事項", destination: "tasks" as const },
  })), detail: attentionState === "loading" ? "正在讀取待辦…" : attentionState === "stale" ? "暫時無法更新，顯示較早的待辦"
    : attentionState === "error" || attentionState === "unavailable" ? "暫時無法顯示待辦"
      : currentTasks?.hasMoreTasks ? pending.length ? "尚有未載入的事項" : "已載入部分沒有待辦，尚有未載入的事項" : undefined };
  const model: HomeViewModel = { ...base,
    children: base.children.map(child => child.id !== base.selectedChildId ? child : { ...child,
      ageLabel: profileData ? childProfileAgeLabel(profileData) : "年齡資料未確認",
      regionLabel: profileData?.region ?? "地區未提供", allergiesLabel: profileData?.allergies ?? null,
      profileConfirmed: !!profileData && !!currentProfile?.current?.confirmedAtLabel,
    }),
    profileLoad: currentProfile?.reading && !currentProfile.current ? "loading" : currentProfile?.current && !currentProfile.needsRefresh ? "ready" : base.profileLoad,
    recordsLoad: currentCare?.list.state === "ready" || currentCare?.list.hasSnapshot && (currentCare.list.state === "loading" || currentCare.list.state === "loading_more") ? "ready" : currentCare?.list.state === "loading" || currentCare?.list.state === "loading_more" ? "loading" : "error",
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
      : { kind: "none", detail: currentTasks?.hasMoreTasks ? "已載入部分沒有待辦，尚有未載入的事項" : "目前沒有待處理事項。" },
    overview: base.overview ? { ...base.overview, attention, ongoing } : undefined,
  };
  return { ...production, model, actions: { ...production.actions, refresh() {
    production.actions.refresh();
    if (tasks?.scopeKey === scope) tasks.recovery.reloadCurrent?.();
    if (growth?.scopeKey === scope) growth.actions.refresh();
  } } };
}
