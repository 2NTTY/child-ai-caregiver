import { useProductionHomeValue } from "./ProductionProvider";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { growthConcernFollowUpLabel } from "../growth-view-model";
import { projectCurrentHomeChildren } from "./home-projection";
import { HOME_TASK_SUMMARY_LIMIT, projectHomeTasks } from "../home-task-projection";
import type { TaskView } from "../task-view-model";
import { careKindOptions } from "../care-view-model";
import type { HomeOverviewSection } from "../home-overview";
import type { HomeViewModel, HomeRecord } from "../view-model";

/** Read-only composition of the exact owners used by domain pages. No home data copy. */
export function useProductionHome() {
  const production = useProductionHomeValue(), care = useCareWorkspace(), profile = useProfileWorkspace(), tasks = useTasksWorkspace(), growth = useGrowthWorkspace();
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
    action: { label: "查看關注經過", target: { destination: "growth" as const, concernId: item.id } },
  })), detail: ongoingState === "loading" ? "正在讀取關注…" : ongoingState === "stale" ? "暫時無法更新，顯示較早的關注"
    : ongoingState === "error" || ongoingState === "unavailable" ? "暫時無法顯示持續關注" : undefined };
  const tasksAvailable = !!currentTasks && currentTasks.access !== "lost";
  const groups = projectHomeTasks(tasksAvailable ? currentTasks.items : [], base.selectedChildId ?? "");
  const pending = groups.scheduled;
  const taskTime = (item: TaskView) => {
    if (!Number.isFinite(Date.parse(item.occurrence.dueAt))) return "時間待核對";
    try { return new Intl.DateTimeFormat("zh-HK", { timeZone: item.occurrence.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.occurrence.dueAt)); }
    catch { return "時間待核對"; }
  };
  const taskReadState = currentTasks?.readState ?? (currentTasks?.reading ? "loading" : "ready");
  const attentionState: HomeOverviewSection["state"] = !tasksAvailable ? "unavailable"
    : taskReadState === "ready" && !currentTasks.online ? "stale" : taskReadState;
  const tasksReady = attentionState === "ready";
  const attention: HomeOverviewSection = { state: attentionState, items: (["scheduled", "undated", "review"] as const).flatMap(group => groups[group].slice(0, HOME_TASK_SUMMARY_LIMIT).map(item => ({
    id: item.id, title: item.title, detail: taskTime(item), group,
    statusLabel: group === "review" ? "待覆核 · 已停催" : group === "undated" ? "時間待核對" : "待處理",
    action: { label: "查看事項", target: { destination: "tasks" as const, taskId: item.id } },
  }))), detail: attentionState === "loading" ? "正在讀取待辦…" : attentionState === "stale" ? "暫時無法更新，顯示較早的已載入待辦"
    : attentionState === "error" || attentionState === "unavailable" ? "未能讀取待辦，請重新讀取。"
      : currentTasks?.hasMoreTasks ? "只顯示已載入的待辦，尚有事項未載入。" : Object.values(groups).some(items => items.length > HOME_TASK_SUMMARY_LIMIT) ? "首頁只列出部分已載入事項，查看全部可接續其餘安排。" : undefined };
  const model: HomeViewModel = { ...base,
    children: projectCurrentHomeChildren(base, profile),
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
      ? { kind: "task", title: pending[0].title, detail: taskTime(pending[0]), action: { label: "查看事項", target: { destination: "tasks", taskId: pending[0].id } } }
      : { kind: "none", detail: currentTasks?.hasMoreTasks ? "已載入部分沒有待辦，尚有未載入的事項" : "目前沒有待處理事項。" },
    overview: base.overview ? { ...base.overview, attention, ongoing } : undefined,
  };
  return { ...production, model, actions: { ...production.actions, refresh() {
    production.actions.refresh();
    if (tasks?.scopeKey === scope) tasks.recovery.reloadCurrent?.();
    if (growth?.scopeKey === scope) growth.actions.refresh();
  } } };
}
