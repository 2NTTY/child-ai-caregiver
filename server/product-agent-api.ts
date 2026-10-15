import { agentStopMessage } from "../src/shared/agent-stop-message.ts";
import { agentFeedbackStream } from './agent-feedback-stream.ts';
import type { AgentProgress } from '../src/shared/agent-feedback.ts';
import { z } from "zod";
import type { ProductAgent } from "./product-agent.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { ChatStore } from "./chat.ts";
import { readAgentWorkSchema, historySearchSchema, historyReadSchema } from "../src/shared/agent-work.ts";
import { agentDecisionSchema } from "../src/shared/product-agent.ts";
import { FamilyError } from "./family-access.ts";
import { FirestoreDomainError } from './firestore-domain-data.ts';
import { apiError, jsonResponse } from "./workspace-api.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const runRoute = new RegExp("^/api/children/(" + uuid + ")/agent/runs/(" + uuid + ")(?:/proposals/(" + uuid + ")/decide)?$", "i");
const listRoute = new RegExp("^/api/children/(" + uuid + ")/agent/runs$", "i");
const pendingRoute = new RegExp("^/api/children/(" + uuid + ")/agent/pending$", "i");
const workRoute = new RegExp("^/api/children/(" + uuid + ")/agent/work(?:/(" + uuid + "))?$", "i");
const historyRoute = new RegExp("^/api/children/(" + uuid + ")/agent/history(?:/messages/(" + uuid + "))?$", "i");
const replyRoute = new RegExp("^/api/children/(" + uuid + ")/messages/(" + uuid + ")/reply(/cancel)?$", "i");
export async function handleProductAgentRequest(request: Request, userId: string | null, options: {
  agent: ProductAgent; store: ProductAgentStore; chat: ChatStore; isCurrentUser: (userId: string) => Promise<boolean>;
}): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (expected !== userId || !await options.isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
  const url = new URL(request.url), path = url.pathname, reply = replyRoute.exec(path), run = runRoute.exec(path), list = listRoute.exec(path), pending = pendingRoute.exec(path), work = workRoute.exec(path), history = historyRoute.exec(path);
  if (!reply && !run && !list && !pending && !work && !history) return apiError("not_found", "找不到資料。", 404);
  const childId = (reply ?? run ?? list ?? pending ?? work ?? history)![1].toLowerCase();
  try {
    if (work || history) {
      if (request.method !== "GET") return apiError("method_not_allowed", "不支援此操作。", 405);
      for (const key of url.searchParams.keys()) if (url.searchParams.getAll(key).length > 1) throw new FamilyError(400, "invalid_input");
      const page = work ? await options.store.readWork(userId, childId, readAgentWorkSchema.parse({ workId: work[2]?.toLowerCase() ?? null, cursor: url.searchParams.get("cursor") }))
        : history![2] ? await options.store.readHistory(userId, childId, historyReadSchema.parse({ messageId: history![2].toLowerCase(), offset: Number(url.searchParams.get("offset") ?? 0), limit: Number(url.searchParams.get("limit") ?? 4000) }))
        : await options.store.searchHistory(userId, childId, historySearchSchema.parse({ kind: url.searchParams.get("kind") ?? "message", query: url.searchParams.get("query") ?? "", cursor: url.searchParams.get("cursor") }));
      return page && await options.isCurrentUser(userId) ? jsonResponse(page) : apiError("not_found", "找不到可讀取的資料。", 404);
    }
    if (pending) {
      if (request.method !== "GET") return apiError("method_not_allowed", "不支援此操作。", 405);
      if (url.searchParams.getAll("cursor").length > 1) return apiError("invalid_input", "請重新讀取待確認事項。", 400);
      const page = await options.store.pendingProposals(userId, childId, url.searchParams.get("cursor"));
      return page && await options.isCurrentUser(userId) ? jsonResponse(page) : apiError("not_found", "找不到可讀取的事項。", 404);
    }
    if (list) {
      if (request.method !== "GET") return apiError("method_not_allowed", "不支援此操作。", 405);
      const runs = await options.store.backgroundRuns(userId, childId);
      return runs && await options.isCurrentUser(userId) ? jsonResponse({ runs }) : apiError("not_found", "找不到可讀取的結果。", 404);
    }
    let body: unknown;
    if (request.method === "POST") {
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
      try { body = await request.json(); } catch { return apiError("invalid_json", "請檢查輸入。", 400); }
    }
    if (reply) {
      if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
      if (!z.object({}).strict().safeParse(body).success) return apiError("invalid_input", "請檢查輸入。", 400);
      const messageId = reply[2].toLowerCase();
      if (reply[3]) return jsonResponse({ accepted: await options.agent.cancelReply(userId, childId, messageId, () => options.isCurrentUser(userId)) });
      const page = await options.chat.listForUser(userId, childId);
      if (!page) return apiError("not_found", "找不到可讀取的孩子。", 404);
      const old = page.messages.find(item => item.role === "model" && item.inReplyTo === messageId);
      if (old) {
        await options.store.bindConfirmationQuestion?.(userId, childId, old.id);
        return await options.isCurrentUser(userId) ? jsonResponse({ message: old }) : apiError("unauthorized", "存取權已改變。", 401);
      }
      const execute = async (signal?: AbortSignal, publish?: (event: AgentProgress) => void): Promise<Response> => {
        const result = await options.agent.reply(userId, childId, messageId, () => options.isCurrentUser(userId), signal, publish);
        if (!result) return apiError("not_found", "存取權或資料已改變，請重新讀取。", 404);
        if (result.status === "running") return apiError("ai_busy", "Agent 正在處理這則訊息；請稍後查核原結果。", 429);
        if (!await options.isCurrentUser(userId)) return apiError("unauthorized", "登入已失效。", 401);
        // Only a known zero-effect refusal may invite a new message. Confirmation consumption can precede admission.
        if (result.status === "stopped" && result.stopReason === "busy" && result.countsKnown === true
          && result.counts.modelCalls === 0 && result.counts.toolCalls === 0 && result.counts.queryEmbeddings === 0
          && result.tools.length === 0 && result.proposals.length === 0)
          return apiError("ai_capacity_busy", "AI 正忙碌；原訊息已保存，但未開始處理，也沒有排隊。稍後請以新訊息重新提出要求。", 429);
        const questions = await options.store.confirmationQuestions?.(userId, childId, result.runId) ?? [];
        const content = questions.length ? [result.text, ...questions].filter(Boolean).join("\n\n") : result.text || (result.proposals.length
          ? "Agent 未完成文字回覆，但已保存待你核對的候選；尚未確認的事項不代表已執行。請查看來源與待確認事項。"
          : result.status === "unknown" ? "這次 Agent 運行中斷，結果未知；沒有自動重新執行。請查核原運行結果。"
          : "Agent 暫未能完成回覆；原訊息仍已保存。請查看運行狀態及未完成事項。");
        const reason = result.status === "stopped" || result.status === "unknown" ? agentStopMessage(result.stopReason) : null;
        const text = reason ? `這次回覆未完成：${reason}。\n\n${content}` : content;
        const saved = await options.chat.createModelMessageForUser(userId, childId, messageId, text);
        const message = saved ?? (await options.chat.listForUser(userId, childId))?.messages.find(item => item.role === "model" && item.inReplyTo === messageId);
        if (!message || !await options.isCurrentUser(userId)) return apiError("ai_unavailable", "未能確認回覆保存，請重新讀取。", 503);
        await options.store.bindConfirmationQuestion(userId, childId, message.id);
        return jsonResponse({ message: { ...message, agentRunId: result.runId } });
      };
      if (request.headers.get('accept')?.split(',').some(value => value.trim().split(';')[0] === 'text/event-stream'))
        return agentFeedbackStream(publish => execute(undefined, publish), () => options.isCurrentUser(userId));
      return await execute(request.signal);

    }
    if (run![3]) {
      if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
      const input = agentDecisionSchema.safeParse(body);
      if (!input.success) return apiError("invalid_input", "請核對確認事項。", 400);
      const proposal = await options.store.decide(userId, childId, run![2].toLowerCase(), run![3].toLowerCase(), input.data);
      if (!proposal || !await options.isCurrentUser(userId)) return apiError("not_found", "找不到可確認的事項。", 404);
      return jsonResponse({ proposal });
    }
    if (request.method !== "GET") return apiError("method_not_allowed", "不支援此操作。", 405);
    const result = await options.store.get(userId, childId, run![2].toLowerCase());
    return result && await options.isCurrentUser(userId) ? jsonResponse({ result }) : apiError("not_found", "找不到運行結果。", 404);
  } catch (error) {
    if (error instanceof FamilyError || error instanceof FirestoreDomainError) return apiError(error.code, error.status === 409 ? "事項、權限或版本已改變，請重新讀取並核對。" : "無法處理此事項，請核對資料與權限。", error.status);
    if (error instanceof z.ZodError) return apiError("invalid_input", "請檢查輸入。", 400);
    return apiError("ai_unavailable", "未能確認操作結果，請先查核原運行；不要另建重複操作。", 503);
  }
}
