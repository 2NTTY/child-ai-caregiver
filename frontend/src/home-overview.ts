import type { HomeDestination, HomeViewModel } from "./view-model";

// Presentation only: the owning adapter supplies authorized items in display order.
// Neither timestamps nor record counts imply urgency, task completion or health risk.
export interface HomeOverviewItem {
  id: string;
  title: string;
  detail: string;
  statusLabel: string;
  sourceLabel?: string;
  action: { label: string; destination: HomeDestination };
}
export interface HomeOverviewSection {
  state: "ready" | "loading" | "unavailable";
  items: HomeOverviewItem[];
  detail?: string;
}
export interface HomeOverviewView {
  childId: string;
  attention: HomeOverviewSection;
  ongoing: HomeOverviewSection;
}

export function selectHomeOverview(model: HomeViewModel): HomeOverviewView | null {
  if (!model.selectedChildId || !model.children.some(child => child.id === model.selectedChildId)) return null;
  if (model.overview?.childId === model.selectedChildId) return model.overview;
  // Preserve existing callers while a formal adapter is still pending. Missing is not empty.
  const focus = model.overview ? undefined : model.focus;
  return {
    childId: model.selectedChildId,
    attention: !focus || focus.kind === "unavailable"
      ? { state: "unavailable", items: [], detail: focus?.detail ?? "尚未取得待辦與提醒，不能確認有沒有需要處理的事項。" }
      : focus.kind === "none" ? { state: "ready", items: [], detail: focus.detail }
        : { state: "ready", items: [{ id: `focus:${model.selectedChildId}:${focus.kind}`, title: focus.title,
          detail: focus.detail, statusLabel: focus.whyNow ?? (focus.kind === "task" ? "待查看安排" : "待核對關注"),
          sourceLabel: focus.sourceLabel, action: focus.action }] },
    ongoing: { state: "unavailable", items: [], detail: "尚未取得持續關注的話題；不從最近記錄推斷。" },
  };
}
