// Generated pure presentation from project commit 2abe7aed60b192b253414f6464e3fd070cc377e7.
// Type annotations only removed. No original owner, API, router, or hook is executed.
export const growthTime=(value)=>new Date(value).toLocaleString("zh-HK",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
export function growthConcernFollowUpLabel(concern) {
  if (!concern.followUp) return null;
  const labels = { pending: "已安排", queued: "等候處理", completed: "已完成", stopped: "已停止", unknown: "結果待核對", cancelled: "已取消" };
  return `站內跟進：${growthTime(concern.followUp.at)} · ${labels[concern.followUp.state]}`;
}

export function selectHomeOverview(model) {
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

export function projectOngoing(production, growth) {
  const scope = production.scopeKey;
  const currentGrowth = growth?.scopeKey === scope ? growth.model : null;
  const concerns = currentGrowth?.access !== "lost" && currentGrowth?.page?.concerns?.state === "ready"
    ? currentGrowth.page.concerns.items.filter(item => item.childId === production.selectedChildId && item.status !== "closed") : null;
  const ongoingState = !currentGrowth || currentGrowth.access === "lost" ? "unavailable"
    : currentGrowth.load === "loading" && !currentGrowth.page || currentGrowth.page?.concerns?.state === "loading" ? "loading" : concerns && (currentGrowth.load === "error" || !currentGrowth.online) ? "stale"
      : currentGrowth.load === "error" || currentGrowth.page?.concerns?.state === "error" ? "error" : concerns ? "ready" : "unavailable";
  const ongoing = { state: ongoingState, items: (concerns ?? []).map(item => ({
    id: item.id, title: item.title, detail: item.reason, statusLabel: growthConcernFollowUpLabel(item) ?? "持續關注",
    action: { label: "查看關注經過", destination: "growth" },
  })), detail: ongoingState === "loading" ? "正在讀取關注…" : ongoingState === "stale" ? "暫時無法更新，顯示較早的關注"
    : ongoingState === "error" || ongoingState === "unavailable" ? "暫時無法顯示持續關注" : undefined };
  return ongoing;
}
