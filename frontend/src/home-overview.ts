import type { HomeTarget } from "./home-target.ts";
import type { HomeViewModel } from "./view-model.ts";
import type { AgentProposalStatus, AgentRunStatus } from "./agent-view-model.ts";

// Presentation only: the owning adapter supplies authorized items in display order.
// Neither timestamps nor record counts imply urgency, task completion or health risk.
export interface HomeOverviewItem {
  id: string;
  title: string;
  detail: string;
  statusLabel: string;
  sourceLabel?: string;
  action: { label: string; target: HomeTarget };
}
export interface HomeOverviewSection {
  state: "ready" | "loading" | "error" | "stale" | "unavailable";
  items: HomeOverviewItem[];
  coverage?: { moreLoaded: boolean; moreUnloaded: boolean };
  groups?: { key: "scheduled" | "review" | "undated"; label: string; items: HomeOverviewItem[] }[];
  detail?: string;
}
// An explicit Agent selection, never inferred from the task list or care records.
// These fields are a display boundary, not a new feed, ranking or read/dismiss API.
export interface HomeAgentImportantItem extends HomeOverviewItem {
  whyNow: string | null;
  source: { kind: "agent_run"; runId: string; createdAt: string | null; status: AgentRunStatus };
  proposal?: { id: string; version: number; status: AgentProposalStatus; expiresAt: string };
}
export interface HomeAgentImportantSection {
  state: "ready" | "loading" | "error" | "unavailable" | "unsupported";
  items: HomeAgentImportantItem[];
  loadedAt: string | null;
  detail?: string;
  // The preview must remain identifiable when shown outside the preview toolbar.
  synthetic?: boolean;
}
export interface HomeOverviewView {
  childId: string;
  agentImportant?: HomeAgentImportantSection;
  attention: HomeOverviewSection;
  ongoing: HomeOverviewSection;
}

export function selectHomeAgentImportant(model: HomeViewModel): HomeAgentImportantSection | null {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  return overview.agentImportant ?? { state: "unavailable", items: [], loadedAt: null,
    detail: "暫時無法顯示助手提醒" };
}

export function selectHomeOverview(model: HomeViewModel): HomeOverviewView | null {
  if (!model.selectedChildId || !model.children.some(child => child.id === model.selectedChildId)) return null;
  if (model.overview?.childId === model.selectedChildId) return model.overview;
  // Preserve existing callers while a formal adapter is still pending. Missing is not empty.
  const focus = model.overview ? undefined : model.focus;
  return {
    childId: model.selectedChildId,
    attention: !focus || focus.kind === "unavailable"
      ? { state: "unavailable", items: [], detail: focus?.detail ?? "暫時無法顯示待辦與提醒" }
      : focus.kind === "none" ? { state: "ready", items: [], detail: focus.detail }
        : { state: "ready", items: [{ id: `focus:${model.selectedChildId}:${focus.kind}`, title: focus.title,
          detail: focus.detail, statusLabel: focus.whyNow ?? (focus.kind === "task" ? "待查看安排" : "待核對關注"),
          sourceLabel: focus.sourceLabel, action: focus.action }] },
    ongoing: { state: "unavailable", items: [], detail: "暫時無法顯示持續關注" },
  };
}
