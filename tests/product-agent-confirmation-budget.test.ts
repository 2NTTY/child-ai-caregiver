import assert from "node:assert/strict";
import test from "node:test";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunInput, AgentRunResult } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { handleProductAgentRequest } from "../server/product-agent-api.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { AGENT_LIMITS, AgentStopped } from "../server/agent-budget.ts";
import { AGENT_CONFIRMATION_PENDING_TEXT } from "../server/agent-work-tool-descriptions.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";
import type { ChatMessage } from "../src/shared/chat.ts";

const ids = { run: "d4a1b662-d13d-476b-bf52-40a28aa1a1a7", child: "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808",
  message: "7de5a0e8-e106-4485-b7d2-3b572741da39", proposal: "f49a222e-77e4-4980-ae87-4c335b2b5c39",
  task: "83a3109f-cdf2-46eb-a845-473802e0766f", answer: "06a6334c-343d-4934-9dcf-5ceaa7707731" };
const userId = "synthetic-caregiver", question = "是否將合成任務標記為完成？尚未執行，請明確確認。";
const answerText = "已儲存任務候選，仍待你確認。";
// The pending task has no saved business-effect receipt; use its real confirmation state.
type Fault = "model_output_limit" | "unavailable" | "unknown" | "failed" | "rejected" | "conflict" | "last_read" | "citation_revalidation";
interface FixtureOptions { normal?: boolean; fault?: Fault; questions?: "empty" | "expired" | "multiple" | "blank" | "missing_getter";
  revokeAfterRead?: boolean; cancelAfterRead?: boolean; deadlineDuringRead?: boolean; stageSummary?: boolean; initialSummary?: boolean }

// Business stores and provider are synthetic. ADK Runner, runtime, product tools,
// finalizer and HTTP handler remain the actual implementation.
function fixture(options: FixtureOptions = {}) {
  const scope = { userId, childId: ids.child, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  const controller = new AbortController(), proposals: AgentProposal[] = [], attempts: string[] = [], calls: string[][] = [];
  const finalizations: { reason: string; error?: string }[] = [], summaryInputs: unknown[] = [], modelMessages: ChatMessage[] = [];
  const requests: LlmRequest[] = []; let initialSummaryReads = 0;
  let claimed = false, authorized = true, saved: ProductAgentResult | null = null;
  let candidateWrites = 0, taskWrites = 0, confirmationWrites = 0, questionReads = 0, bindings = 0;
  const now = new Date().toISOString();
  const task = { id: ids.task, childId: ids.child, version: 1, title: "Synthetic pending task", details: "Synthetic fixture",
    kind: "ordinary", assigneeUserId: userId, createdBy: userId, createdAt: now, updatedAt: now,
    occurrence: { id: "ed132f95-5ebc-44e5-a84c-a262fa1dd8f6", dueAt: new Date(Date.now() + 3600000).toISOString(),
      timeZone: "Asia/Hong_Kong", state: "scheduled", terminalBasisVersion: null } };
  const sourceMessages: ChatMessage[] = Array.from({ length: options.stageSummary ? 12 : 0 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, childId: ids.child, authorUserId: userId, role: "user", text: `Synthetic message ${index}`, inReplyTo: null, createdAt: now,
  }));
  const context = { profile: { childId: ids.child, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: sourceMessages, conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } };
  const step = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
  const read = step("read_context"), load = step("load_capabilities", { capabilities: ["tasks", ...(options.stageSummary ? ["memory_summary"] : [])] });
  const propose = step("propose_task_change", { taskId: ids.task, expectedVersion: 1, action: "complete", note: "Synthetic pending candidate",
    dueAt: null, timeZone: null, assigneeUserId: null });
  const confirm = step("request_confirmation", { runId: ids.run, proposalId: ids.proposal, expectedVersion: 1, workId: null });
  const present = step("present_answer", { kind: options.fault === "citation_revalidation" ? "caregiving" : "operation",
    paragraphs: [{ text: answerText, citationIds: options.fault === "citation_revalidation" ? ["reviewed-chunk"] : [] }] });
  const readWork = step("read_work", { workId: null, cursor: null });
  // Two work turns leave the third generation for presentation and the fourth
  // call protected for independent review. The non-normal fixtures inject a
  // provider model_limit at that presentation turn; real zero-budget compose is
  // covered by chat-delivery-review.test.ts.
  const summary = step("stage_private_summary", { text: "Synthetic staged summary" });
  const first = [read, load, ...(options.fault === "citation_revalidation"
    ? [step("search_knowledge", { query: "合成照護主題", classification: "official_guidance" })] : [])];
  const second = [propose, ...(options.stageSummary ? [summary] : []), options.fault === "last_read" ? readWork : confirm];
  const sequence = [first, second, ...(options.normal || ["model_output_limit", "unavailable", "citation_revalidation"].includes(options.fault ?? "") ? [[present]] : [])];
  const realRuntime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async record => { attempts.push(record.outcome); } },
    provider: { generate: async (request: LlmRequest): Promise<LlmResponse> => {
      const index = calls.length, batch = sequence[index];
      if (!batch) {
        // Finish-phase / presentation-repair turn: only present_answer is exposed. Pending-fallback
        // fixtures omit a scripted present so model.failure=model_limit can finalize the pending reply.
        calls.push(["present_answer"]);
        throw new AgentStopped("model_limit");
      }
      calls.push(batch.map(call => call.name));
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      for (const call of batch) assert.ok(Object.hasOwn(request.toolsDict, call.name));
      if (index === 2 && options.fault === "unavailable") throw new Error("Synthetic provider unavailable");
      if (index === 2 && options.fault === "model_output_limit") return { content: { role: "model", parts: [{ text: "Unvalidated closing text" }] }, finishReason: FinishReason.MAX_TOKENS };
      return { content: { role: "model", parts: batch.map((call, part) => ({ functionCall: { ...call, id: `scripted-${index}-${part}` } })) }, finishReason: FinishReason.STOP };
    } } });
  const runtime = { run: async (input: AgentRunInput) => {
    const finalize = input.finalize!;
    const tools = input.tools;
    return realRuntime.run({ ...input, tools: run => (typeof tools === "function" ? tools(run) : tools).map(tool => {
      if (tool.name !== "request_confirmation" || !["unknown", "failed", "rejected", "conflict"].includes(options.fault ?? "")) return tool;
      return { ...tool, execute: async (...args) => {
        if (options.fault === "unknown") { await tool.execute(...args); throw new Error("Synthetic uncertain outcome"); }
        return { status: options.fault as "failed" | "rejected" | "conflict" };
      } };
    }), finalize: async (...args: Parameters<typeof finalize>) => {
      const entry: typeof finalizations[number] = { reason: args[2] }; finalizations.push(entry);
      try { return await finalize(...args); } catch (error) { entry.error = error instanceof Error ? error.message : "unknown"; throw error; }
    } });
  } };
  const store = {
    claim: async () => { const created = !claimed; claimed = true; return { runId: ids.run, scope, created, state: "running",
      expiresAt: new Date(Date.now() + (options.deadlineDuringRead ? 20000 : 90000)).toISOString() }; },
    authorize: async () => authorized,
    consumeConfirmation: async () => null,
    propose: async (_scope: unknown, runId: string, _callId: string, value: AgentProposal["value"]) => {
      assert.equal(runId, ids.run); candidateWrites++;
      const proposal: AgentProposal = { id: ids.proposal, runId, childId: ids.child, version: 1, status: "pending", createdAt: now,
        expiresAt: new Date(Date.now() + 86400000).toISOString(), value, result: null, targetLabel: task.title };
      proposals.push(proposal); return proposal;
    },
    requestConfirmation: async () => { assert.equal(proposals[0]?.status, "pending"); confirmationWrites++;
      return { id: "63b3f13a-e1af-4ad7-b9fa-fb349c8b9c7f", proposalRunId: ids.run, proposalId: ids.proposal, proposalVersion: 1,
        expiresAt: new Date(Date.now() + 86400000).toISOString(), question }; },
    confirmationQuestions: options.questions === "missing_getter" ? undefined : async (actor: string, child: string, runId: string) => {
      assert.deepEqual([actor, child, runId], [userId, ids.child, ids.run]); questionReads++;
      if (options.revokeAfterRead) authorized = false;
      if (options.cancelAfterRead) controller.abort();
      if (options.deadlineDuringRead) await new Promise(resolve => setTimeout(resolve, 21000));
      return options.questions === "multiple" ? [question, "Another synthetic question"]
        : options.questions === "blank" ? ["  "] : ["empty", "expired"].includes(options.questions ?? "") ? [] : [question];
    },
    bindConfirmationQuestion: async () => { bindings++; return true; },
    readWork: async () => ({ items: [], nextCursor: null, complete: true }),
    finish: async (_scope: unknown, result: ProductAgentResult, summary?: unknown) => {
      summaryInputs.push(summary); saved = { ...result, proposals: structuredClone(proposals) }; return true;
    },
    get: async () => saved,
  };
  const chat = { listForUser: async () => ({ messages: [{ id: ids.message, childId: ids.child, role: "user", text: "合成任務待確認。", createdAt: now }, ...modelMessages] }),
    createModelMessageForUser: async (_userId: string, _childId: string, messageId: string, text: string) => {
      const message: ChatMessage = { id: ids.answer, childId: ids.child, authorUserId: null, role: "model", text, createdAt: now, inReplyTo: messageId };
      modelMessages.push(message); return message;
    } };
  const agentOptions = { runtime, store, chat, memory: { context: async () => structuredClone(context),
    ...(options.initialSummary ? { initialConversationSummary: async () => {
      initialSummaryReads++;
      return { summary: { id: "old-synthetic-summary", version: 1, text: "Synthetic initial private history", createdAt: now,
        lastCoveredMessageId: ids.message }, basis: "a".repeat(64), validUntil: null };
    } } : {}),
    prepareSummary: async () => ({ previous: null, previousVersion: 0, basis: "synthetic-basis", messages: sourceMessages, moreUncovered: false }) },
    tasks: { list: async () => ({ items: [task], eligibleAssignees: [{ userId, name: "Synthetic caregiver" }], nextAfterId: null }),
      change: async () => { taskWrites++; throw new Error("Unexpected task write"); }, create: async () => { taskWrites++; throw new Error("Unexpected task write"); } },
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [{ chunkId: "reviewed-chunk", classification: "official_guidance", text: "Synthetic reviewed evidence" }] }),
      revalidateCitations: async () => options.fault !== "citation_revalidation" }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  const service = createProductAgent(agentOptions);
  return { calls, attempts, proposals, summaryInputs, finalizations, modelMessages, requests, initialSummaryReads: () => initialSummaryReads,
    ledger: () => ({ candidateWrites, taskWrites, confirmationWrites, questionReads, bindings, taskState: task.occurrence.state, taskVersion: task.version }),
    reply: () => service.reply(userId, ids.child, ids.message, async () => true, controller.signal),
    apiReply: () => handleProductAgentRequest(new Request(`https://synthetic.invalid/api/children/${ids.child}/messages/${ids.message}/reply`,
      { method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": userId }, body: "{}" }), userId,
      { agent: service, store, chat, isCurrentUser: async () => true } as unknown as Parameters<typeof handleProductAgentRequest>[2]),
  };
}

function assertPending(s: ReturnType<typeof fixture>, result: ProductAgentResult | null) {
  assert.ok(result); assert.equal(result.proposals[0]?.status, "pending"); assert.equal(result.proposals[0]?.result, null);
  assert.equal(s.ledger().candidateWrites, 1); assert.equal(s.ledger().taskWrites, 0);
  assert.equal(s.ledger().taskState, "scheduled"); assert.equal(s.ledger().taskVersion, 1); return result;
}

test("successful tools complete only a server-owned pending confirmation reply at model-limit finalization", async () => {
  const s = fixture(), result = assertPending(s, await s.reply());
  assert.equal(AGENT_LIMITS.modelCalls, 4); assert.equal(result.status, "completed"); assert.equal(result.stopReason, null);
  assert.equal(result.text, AGENT_CONFIRMATION_PENDING_TEXT); assert.ok(!result.text.includes(question));
  assert.deepEqual(result.citations, []); assert.deepEqual(result.privateSourceCitations, []); assert.equal(result.retrievalMode, "not_used");
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 4, queryEmbeddings: 0 });
  assert.deepEqual(result.tools.map(tool => [tool.name, tool.status]), [["read_context", "succeeded"], ["load_capabilities", "succeeded"],
    ["propose_task_change", "succeeded"], ["request_confirmation", "succeeded"]]);
  assert.deepEqual(s.attempts, ["succeeded", "succeeded", "unavailable"]);
  assert.deepEqual(s.finalizations, [{ reason: "model_limit" }]); assert.deepEqual(s.summaryInputs, [undefined]);
  assert.equal(s.ledger().questionReads, 1); assert.deepEqual(await s.reply(), result); assert.equal(s.calls.length, 3);
});

test("HTTP reply appends the saved confirmation question once and reuses its saved message", async () => {
  const s = fixture(), response = await s.apiReply(); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.message.text, AGENT_CONFIRMATION_PENDING_TEXT + "\n\n" + question);
  assert.equal(value.message.text.split(question).length - 1, 1); assert.equal(s.modelMessages.length, 1);
  const repeated = await s.apiReply(); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).message.text, value.message.text);
  assert.equal(s.calls.length, 3); assert.equal(s.modelMessages.length, 1); assert.equal(s.ledger().bindings, 2);
});

test("normal presentation still continues after nonterminal confirmation and never uses fallback", async () => {
  const s = fixture({ normal: true }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "completed"); assert.equal(result.text, AGENT_CONFIRMATION_PENDING_TEXT);
  assert.ok(result.tools.some(tool => tool.name === "present_answer"));
  assert.equal(result.text.includes(answerText), false);
  assert.equal(s.calls.length, 3); assert.deepEqual(s.finalizations, [{ reason: "normal" }]); assert.equal(s.ledger().questionReads, 1);
});

test("pending confirmation fallback discards a real staged summary", async () => {
  const s = fixture({ stageSummary: true }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "completed"); assert.equal(result.text, AGENT_CONFIRMATION_PENDING_TEXT);
  assert.ok(result.tools.some(tool => tool.name === "stage_private_summary" && tool.status === "succeeded"));
  assert.deepEqual(s.summaryInputs, [undefined]); assert.equal(s.calls.length, 3);
});

test("normal presentation preserves the existing staged summary finalization", async () => {
  const s = fixture({ stageSummary: true, normal: true }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "completed"); assert.equal(result.text, AGENT_CONFIRMATION_PENDING_TEXT);
  assert.equal(result.text.includes(answerText), false);
  assert.equal(s.summaryInputs.length, 1); assert.ok(s.summaryInputs[0]);
  const summary = s.summaryInputs[0] as { text: string; coveredMessageIds: string[] };
  assert.equal(summary.text, "Synthetic staged summary"); assert.equal(summary.coveredMessageIds.length, 12);
  assert.equal(s.ledger().questionReads, 1); assert.equal(s.calls.length, 3);
});

for (const questions of ["empty", "expired", "multiple", "blank", "missing_getter"] as const) test(`pending confirmation fallback rejects ${questions} questions`, async () => {
  const s = fixture({ questions }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "stopped"); assert.equal(result.stopReason, "invalid_response"); assert.equal(result.text, "");
  assert.equal(s.calls.length, 3); assert.deepEqual(s.summaryInputs, [undefined]);
});

for (const fault of ["model_output_limit", "unavailable", "unknown", "failed", "rejected", "conflict", "last_read", "citation_revalidation"] as const) test(`pending confirmation fallback does not rescue ${fault}`, async () => {
  const s = fixture({ fault }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "stopped"); assert.equal(result.text, ""); assert.equal(s.ledger().questionReads, 0);
  assert.equal(result.stopReason, fault === "model_output_limit" ? "model_output_limit" : fault === "citation_revalidation" || fault === "last_read" ? "invalid_response"
    : fault === "unknown" ? "tool_unknown" : ["failed", "rejected", "conflict"].includes(fault) ? "model_limit" : "unavailable");
  if (["model_output_limit", "unavailable"].includes(fault)) assert.equal(s.ledger().confirmationWrites, 1);
  if (fault === "citation_revalidation") assert.deepEqual(s.finalizations, [{ reason: "normal", error: "invalid_response" }]);
  // unknown throws during confirm on the second call; presentation never runs.
  assert.equal(s.calls.length, fault === "unknown" ? 2 : 3);
});

for (const condition of ["revokeAfterRead", "cancelAfterRead", "deadlineDuringRead"] as const) test(`pending confirmation fallback stops on ${condition}`, async () => {
  const s = fixture({ [condition]: true }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "stopped"); assert.equal(result.text, ""); assert.deepEqual(result.tools, []);
  assert.equal(result.stopReason, condition === "revokeAfterRead" ? "unauthorized" : condition === "cancelAfterRead" ? "cancelled" : "deadline");
  assert.equal(s.ledger().questionReads, 1); assert.equal(s.calls.length, 3); assert.deepEqual(s.summaryInputs, [undefined]);
});


test("revalidated private summary survives capability loading while pending fallback discards the newly staged summary", async () => {
  const s = fixture({ stageSummary: true, initialSummary: true }), result = assertPending(s, await s.reply());
  assert.equal(result.status, "completed"); assert.equal(result.text, AGENT_CONFIRMATION_PENDING_TEXT);
  assert.ok(s.requests[0].contents.at(-1)?.parts?.[0]?.text?.includes("Synthetic initial private history"));
  for (const request of s.requests.slice(1)) assert.equal(JSON.stringify(request.contents).split("Synthetic initial private history").length - 1, 1);
  assert.ok(result.tools.some(tool => tool.name === "read_context" && tool.status === "succeeded"));
  assert.ok(result.tools.some(tool => tool.name === "load_capabilities" && tool.status === "succeeded"));
  assert.ok(result.tools.some(tool => tool.name === "stage_private_summary" && tool.status === "succeeded"));
  assert.deepEqual(s.summaryInputs, [undefined]); assert.equal(s.calls.length, 3); assert.equal(s.initialSummaryReads(), 3);
  assert.deepEqual(await s.reply(), result); assert.equal(s.calls.length, 3); assert.equal(s.initialSummaryReads(), 3);
  assert.deepEqual(s.finalizations, [{ reason: "model_limit" }]);
});
