import type { HomeOverviewView } from "../home-overview";
import { createMemoryFixture } from "./memory-fixture.ts";
import { createTaskFixture } from "./task-fixture.ts";
import type { PreviewScenario } from "./fixture";

// One removable synthetic projection feeds the home summary and the complete rail.
// Formal selection, authorization, ordering and cross-page freshness belong to the adapter.
export function createHomeOverviewFixture(childId: string, scenario: PreviewScenario): HomeOverviewView {
  const unavailable = scenario === "loading" || scenario === "focus_unavailable";
  if (unavailable) return { childId,
    attention: { state: scenario === "loading" ? "loading" : "unavailable", items: [], detail: scenario === "loading" ? "正在讀取待辦與提醒…" : "暫未能取得待辦與提醒；不能當作沒有事項。" },
    ongoing: { state: scenario === "loading" ? "loading" : "unavailable", items: [], detail: "持續關注的資料尚未可用。" } };
  const memory = createMemoryFixture(childId).data;
  const topics = memory.topics.filter(topic => topic.status === "pending");
  const sleepContext = memory.facts.find(fact => fact.status === "confirmed" && fact.sourceState === "current" && fact.key === "睡前觀察");
  const ongoing = topics.map(topic => ({ id: topic.id, title: topic.title,
    detail: sleepContext?.content ?? "回看原有話題，再補充最近的情況。",
    statusLabel: "待續話題", sourceLabel: "本人話題及已確認睡前觀察 · 合成示例",
    action: { label: "查看話題與依據", destination: "memory" as const } }));
  const taskFixture = createTaskFixture(childId, "normal");
  // Explicit sample order, not a client-side due-date/risk ranking engine.
  const taskItems = [taskFixture.items.find(item => item.occurrence.state === "needs_review"),
    taskFixture.items.find(item => item.id.endsWith("-ordinary")), taskFixture.items.find(item => item.kind === "appointment")]
    .filter(item => item !== undefined).map(item => ({ id: item.id, title: item.title, detail: item.details,
      statusLabel: item.occurrence.state === "needs_review" ? "需要覆核" : `安排時間：${item.occurrence.dueAt}（${item.occurrence.timeZone}）`,
      sourceLabel: "任務與預約的合成快照", action: { label: item.occurrence.state === "needs_review" ? "查看並覆核" : "查看安排", destination: "tasks" as const } }));
  return { childId,
    attention: { state: "ready", items: scenario === "focus_task" ? taskItems
      : scenario === "focus_growth" && !childId.startsWith("preview-new-child-") ? [{ id: `${childId}:growth-focus`, title: "核對一項成長關注",
        detail: "先查看關注理由及來源，再決定如何處理；合成示例沒有評估孩子的發展。",
        statusLabel: "等待你的決定", sourceLabel: "前端合成樣本，沒有真來源證據",
        action: { label: "查看成長關注", destination: "growth" } }] : [],
      detail: "目前合成快照沒有指定待處理事項。" },
    ongoing: { state: "ready", items: ongoing, detail: "目前沒有已載入的待續話題。" } };
}
