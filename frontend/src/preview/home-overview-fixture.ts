import type { HomeAgentImportantSection, HomeOverviewView } from "../home-overview";
import { createMemoryFixture } from "./memory-fixture.ts";
import { createTaskFixture } from "./task-fixture.ts";
import type { PreviewScenario } from "./fixture";

// Separate, removable synthetic projections feed the Agent section and the task rail.
// Formal selection, authorization, ordering and cross-page freshness belong to the adapter.
function createAgentImportantFixture(childId: string, scenario: PreviewScenario): HomeAgentImportantSection {
  const synthetic = true;
  if (scenario === "loading") return { state: "loading", items: [], loadedAt: null, synthetic, detail: "正在讀取 Agent 重要事項的合成示例…" };
  if (scenario === "focus_unavailable") return { state: "unavailable", items: [], loadedAt: null, synthetic,
    detail: "暫未能取得 Agent 重要事項；不能當作沒有提醒。" };
  if (scenario === "failed") return { state: "error", items: [], loadedAt: null, synthetic,
    detail: "Agent 重要事項讀取失敗的合成示例，請稍後重新讀取。" };
  const loadedAt = "2026-10-04T09:05:00+08:00";
  if (childId.startsWith("preview-new-child-") || scenario === "first_login" || scenario === "empty") {
    return { state: "ready", items: [], loadedAt, synthetic, detail: "這次合成快照沒有 Agent 重要事項。" };
  }
  const unknown = scenario === "unknown";
  const runId = `${childId}:preview-important-run`;
  return { state: "ready", loadedAt, synthetic, items: [{
    id: `${childId}:preview-agent-important`, title: unknown ? "一項 Agent 結果仍待查核" : "先核對一項照顧建議",
    detail: unknown ? "示例結果尚未確認。請回到原 Agent 結果核對，不能據此當作已完成。"
      : "先核對照顧內容及共享範圍，再決定是否接受建議。",
    whyNow: unknown ? null : "這項照顧建議仍待你核對，尚未成為已確認安排。",
    statusLabel: unknown ? "結果未知" : "待你核對",
    sourceLabel: "合成 Agent 結果，沒有真實推送或來源證據",
    source: { kind: "agent_run", runId, createdAt: "2026-10-04T09:00:00+08:00", status: unknown ? "unknown" : "completed" },
    ...(unknown ? {} : { proposal: { id: `${runId}:proposal`, version: 1, status: "pending" as const, expiresAt: "2026-10-05T09:00:00+08:00" } }),
    action: { label: "前往 Agent 對話", target: { destination: "chat" } },
  }] };
}

export function createHomeOverviewFixture(childId: string, scenario: PreviewScenario): HomeOverviewView {
  const agentImportant = createAgentImportantFixture(childId, scenario);
  const unavailable = scenario === "loading" || scenario === "focus_unavailable";
  if (unavailable) return { childId, agentImportant,
    attention: { state: scenario === "loading" ? "loading" : "unavailable", items: [], detail: scenario === "loading" ? "正在讀取待辦與提醒…" : "暫未能取得待辦與提醒；不能當作沒有事項。" },
    ongoing: { state: scenario === "loading" ? "loading" : "unavailable", items: [], detail: "持續關注的資料尚未可用。" } };
  const memory = createMemoryFixture(childId).data;
  const topics = memory.topics.filter(topic => topic.status === "pending");
  const sleepContext = memory.facts.find(fact => fact.status === "confirmed" && fact.sourceState === "current" && fact.key === "睡前觀察");
  const ongoing = topics.map(topic => ({ id: topic.id, title: topic.title,
    detail: sleepContext?.content ?? "回看原有話題，再補充最近的情況。",
    statusLabel: "待續話題", sourceLabel: "本人話題及已確認睡前觀察 · 合成示例",
    action: { label: "查看話題與依據", target: { destination: "memory" as const } } }));
  const taskFixture = createTaskFixture(childId, "normal");
  // Explicit sample order, not a client-side due-date/risk ranking engine.
  const taskItems = [taskFixture.items.find(item => item.occurrence.state === "needs_review"),
    taskFixture.items.find(item => item.id.endsWith("-ordinary")), taskFixture.items.find(item => item.kind === "appointment")]
    .filter(item => item !== undefined).map(item => ({ id: item.id, title: item.title, detail: item.details,
      statusLabel: item.occurrence.state === "needs_review" ? "需要覆核" : `安排時間：${item.occurrence.dueAt}（${item.occurrence.timeZone}）`,
      sourceLabel: "任務與預約的合成快照", action: { label: item.occurrence.state === "needs_review" ? "查看並覆核" : "查看安排", target: { destination: "tasks" as const, taskId: item.id } } }));
  return { childId, agentImportant,
    attention: { state: "ready", items: scenario === "focus_task" ? taskItems
      : scenario === "focus_growth" && !childId.startsWith("preview-new-child-") ? [{ id: `${childId}:growth-focus`, title: "核對一項成長關注",
        detail: "先查看關注理由及來源，再決定如何處理；合成示例沒有評估孩子的發展。",
        statusLabel: "等待你的決定", sourceLabel: "前端合成樣本，沒有真來源證據",
        action: { label: "查看成長關注", target: { destination: "growth" } } }] : [],
      detail: "目前合成快照沒有指定待處理事項。" },
    ongoing: { state: "ready", items: ongoing, detail: "目前沒有已載入的待續話題。" } };
}
