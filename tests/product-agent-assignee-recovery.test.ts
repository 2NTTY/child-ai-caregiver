import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import { AGENT_LIMITS, AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentDiagnostic } from "../server/agent-observer.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createTaskStore } from "../server/tasks.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";

const privateValue = "SYNTHETIC_PRIVATE_ASSIGNEE";
const recovery = { status: "rejected", data: { code: "invalid_assignee", nextAction: "read_context", field: "values.assigneeUserId",
  message: "請先讀取 read_context 的 eligibleAssignees。指派給本人時，使用其中與 Server scope.userId 相符的 userId；若本人不在名單內，請如實說明不能指派。不得猜測 ID 或改派他人。" } };
const task = { title: "Synthetic task", details: privateValue, kind: "ordinary" as const,
  assigneeUserId: privateValue, dueAt: "2026-10-12T11:30:00Z", timeZone: "Asia/Hong_Kong" };

// Real proposal/task stores with a strictly bounded SQL double; no PostgreSQL or external services.
function fixture() {
  const userId = "synthetic-viewer", ownerId = "synthetic-owner", otherFamilyId = "synthetic-other-family-caregiver";
  const childId = randomUUID(), runId = randomUUID(), workspaceId = randomUUID(), messageId = randomUUID();
  const scope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: "epoch:1" };
  let role = "caregiver", inserts = 0, proposalReads = 0, saved: ProductAgentResult | null = null, claimed = false;
  const rows: Record<string, unknown>[] = [];
  const run = { id: runId, child_id: childId, owner_user_id: userId, trigger_kind: "interactive", state: "running",
    authorization_version: "1", data_version: "epoch:1", expires_at: new Date(Date.now() + 90000) };
  async function query(sql: string, values: unknown[] = []) {
    let result: Record<string, unknown>[] = [];
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SAVEPOINT|RELEASE SAVEPOINT)/u.test(sql)) {}
    else if (sql === "SELECT workspace_id FROM children WHERE id=$1") {
      assert.deepEqual(values, [childId]); result = [{ workspace_id: workspaceId }];
    } else if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")) {
      assert.deepEqual(values, [workspaceId]); result = [{ owner_user_id: ownerId, access_version: 1 }];
    } else if (sql.startsWith("SELECT role FROM family_members")) {
      assert.deepEqual(values, [workspaceId, userId]); result = role ? [{ role }] : [];
    } else if (sql === "SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2") {
      assert.deepEqual(values, [childId, workspaceId]); result = [{}];
    } else if (sql.startsWith("SELECT * FROM agent_runs WHERE id=$1 AND owner_user_id=$2 AND child_id=$3")) {
      assert.deepEqual(values, [runId, userId, childId]); result = [run];
    } else if (sql.startsWith("SELECT access_version::text,storage_epoch,change_seq::text FROM workspaces")) {
      assert.deepEqual(values, [workspaceId]); result = [{ access_version: "1", storage_epoch: "epoch", change_seq: "1" }];
    } else if (sql.includes("FROM care_tasks t JOIN task_occurrences")) {
      assert.deepEqual(values, [childId, null]);
    } else if (sql.startsWith('SELECT u.id AS "userId",u.name FROM workspaces')) {
      assert.deepEqual(values, [workspaceId]); assert.match(sql, /m\.workspace_id=\$1 AND m\.role='caregiver'/u);
      result = [{ userId: ownerId, name: "Synthetic Owner" }, ...(role === "caregiver" ? [{ userId, name: privateValue }] : [])];
    } else if (sql === "SELECT * FROM agent_proposals WHERE run_id=$1") {
      assert.deepEqual(values, [runId]); proposalReads++; result = rows;
    } else if (sql.startsWith("INSERT INTO agent_proposals(")) {
      assert.equal(values[1], runId); inserts++;
      const row = { id: values[0], run_id: values[1], call_id: values[2], payload_encrypted: values[3], version: 1,
        state: "pending", created_at: new Date(), expires_at: new Date(Date.now() + 86400000) };
      rows.push(row); result = [row];
    } else assert.fail(`Unexpected SQL in assignee fixture: ${sql}`);
    return { rows: result, rowCount: result.length };
  }
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const cipher = createStorageCipher(Buffer.alloc(32, 1));
  const realStore = createProductAgentStore(pool, cipher), tasks = createTaskStore(pool, cipher);
  const candidates: AgentProposal[] = [], calls: string[] = [];
  const store = { ...realStore,
    claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, expiresAt: run.expires_at.toISOString() }; },
    authorize: async () => Boolean(role),
    propose: async (...args: Parameters<typeof realStore.propose>) => {
      calls.push(args[2]); const proposal = await realStore.propose(...args);
      if (proposal && !candidates.some(item => item.id === proposal.id)) candidates.push(proposal);
      return proposal;
    },
    finish: async (_scope: unknown, value: ProductAgentResult) => { saved = { ...value, proposals: candidates }; return true; },
    get: async () => saved,
  };
  const memory = { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
    facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
    truncated: { facts: false, topics: false, messages: false } }) };
  const knowledge = { createRun: () => ({ revalidateCitations: async () => true }) };
  return { userId, ownerId, otherFamilyId, childId, runId, messageId, scope, store, tasks, memory, knowledge, candidates, calls,
    inserts: () => inserts, proposalReads: () => proposalReads, setRole: (value: string) => { role = value; } };
}

function response(request: LlmRequest, id: string) {
  return request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.id === id)?.functionResponse?.response;
}

test("invalid assignee recovers through read_context and one pending proposal within the original four-model/eight-tool budget", async () => {
  const f = fixture(), requests: LlmRequest[] = [], diagnostics: AgentDiagnostic[] = [];
  let rejected: Record<string, unknown> | undefined;
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, diagnostics: event => { diagnostics.push(event); },
    provider: { generate: async request => {
      const index = requests.length; requests.push(structuredClone({ ...request, toolsDict: {} }));
      assert.ok(index < 4, "Recovery must not start a fifth model call");
      assert.ok(JSON.stringify({ contents: request.contents, config: request.config }).length < 64000);
      if (index === 1) {
        rejected = response(request, "invalid-task");
        assert.equal(rejected?.status, "rejected"); assert.equal((rejected?.data as Record<string, unknown>).code, "invalid_assignee");
        assert.equal(f.inserts(), 0); assert.equal(f.proposalReads(), 0); assert.equal(f.candidates.length, 0);
      }
      let selectedUserId = "";
      if (index === 2) {
        const read = response(request, "context"); assert.equal(read?.status, "succeeded");
        const data = read?.data as { result: { eligibleAssignees: { userId: string }[] } };
        selectedUserId = data.result.eligibleAssignees.find(item => item.userId === f.scope.userId)!.userId;
        assert.deepEqual(f.calls, ["invalid-task"]); assert.equal(f.inserts(), 0);
      }
      if (index === 3) {
        assert.equal(response(request, "valid-task")?.status, "succeeded");
        assert.equal(f.inserts(), 1); assert.equal(f.candidates[0]?.status, "pending");
      }
      const functionCall = index === 0 ? { id: "invalid-task", name: "propose_task", args: { values: task } }
        : index === 1 ? { id: "context", name: "read_context", args: {} }
        : index === 2 ? { id: "valid-task", name: "propose_task", args: { values: { ...task, assigneeUserId: selectedUserId } } }
        : { id: "answer", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "已保存待確認候選，尚未建立正式待辦。", citationIds: [] }] } };
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall }] } };
    } } });
  const service = createProductAgent({ ...f, runtime, chat: { listForUser: async () => ({ messages: [{ id: f.messageId,
    role: "user", text: "請新增純合成普通待辦，分派給我本人，2026年10月12日香港時間19:30整理繪本袋。" }] }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const result = await service.reply(f.userId, f.childId, f.messageId, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.deepEqual(rejected, recovery);
  for (const value of [privateValue, f.userId, f.childId, f.scope.workspaceId, f.ownerId, task.title]) assert.ok(!JSON.stringify(rejected).includes(value));
  assert.equal(AGENT_LIMITS.modelCalls, 4); assert.equal(AGENT_LIMITS.toolCalls, 8);
  assert.deepEqual(result.counts, { modelCalls: 4, toolCalls: 4, queryEmbeddings: 0 });
  assert.deepEqual(result.tools.map(({ name, status }) => ({ name, status })), [
    { name: "propose_task", status: "rejected" }, { name: "read_context", status: "succeeded" },
    { name: "propose_task", status: "succeeded" }, { name: "present_answer", status: "succeeded" },
  ]);
  assert.deepEqual(f.calls, ["invalid-task", "valid-task"]); assert.equal(f.inserts(), 1);
  assert.equal(result.proposals.length, 1); assert.equal(result.proposals[0].status, "pending"); assert.equal(result.proposals[0].result, null);
  const event = diagnostics.find(item => item.phase === "tool_rejection");
  assert.equal(event?.stage, "execution"); assert.equal(event?.code, "invalid_assignee"); assert.equal(event?.hints, undefined);
  assert.ok(!JSON.stringify(diagnostics).includes(privateValue));
  assert.deepEqual(await service.reply(f.userId, f.childId, f.messageId, async () => true), result);
  assert.equal(requests.length, 4); assert.equal(f.inserts(), 1); assert.deepEqual(f.calls, ["invalid-task", "valid-task"]);
});

test("recovery cannot make a viewer, a revoked member or another family's caregiver eligible", async () => {
  const f = fixture(), budget = new AgentBudget();
  try {
    const tools = createProductAgentTools({ ...f, run: { scope: f.scope, runId: f.runId, budget }, authorize: async () => true,
    } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
    const propose = tools.find(item => item.name === "propose_task")!, read = tools.find(item => item.name === "read_context")!;
    const context = { scope: f.scope, runId: f.runId, callId: "invalid-task", signal: budget.signal };
    for (const [role, assigneeUserId] of [["caregiver", f.otherFamilyId], ["viewer", f.userId]]) {
      f.setRole(role);
      assert.deepEqual(await propose.execute({ values: { ...task, assigneeUserId } }, context), recovery);
      const page = await read.execute({}, context);
      const data = page.data as { result: { eligibleAssignees: { userId: string }[] } };
      assert.ok(!data.result.eligibleAssignees.some(item => item.userId === assigneeUserId));
      assert.equal(f.inserts(), 0); assert.equal(f.candidates.length, 0); assert.equal(f.proposalReads(), 0);
    }
    f.setRole("");
    await assert.rejects(propose.execute({ values: { ...task, assigneeUserId: f.userId } }, context),
      error => error instanceof AgentStopped && error.reason === "unauthorized");
    assert.equal(f.inserts(), 0); assert.equal(f.candidates.length, 0);
  } finally { budget.close(); }
});

test("assignee recovery is limited to propose_task and preserves conflicts, unknown errors and citation hints", async () => {
  const f = fixture(), budget = new AgentBudget();
  let failure: Error | null = null;
  try {
    const tools = createProductAgentTools({ ...f, store: { propose: async () => { if (failure) throw failure; return null; } },
      run: { scope: f.scope, runId: f.runId, budget }, authorize: async () => true,
    } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
    const propose = tools.find(item => item.name === "propose_task")!;
    const context = { scope: f.scope, runId: f.runId, callId: "invalid-task", signal: budget.signal };
    for (const [status, code] of [[400, "invalid_input"], [409, "operation_conflict"], [409, "invalid_assignee"]] as const) {
      failure = new FamilyError(status, code);
      assert.deepEqual(await propose.execute({ values: task }, context), { status: status === 409 ? "conflict" : "rejected", data: { code } });
    }
    for (failure of [new Error(privateValue), new AgentStopped("unauthorized")])
      await assert.rejects(propose.execute({ values: task }, context), error => error === failure);
    failure = null;
    await assert.rejects(propose.execute({ values: task }, context), error => error instanceof AgentStopped && error.reason === "unauthorized");
    failure = new FamilyError(400, "invalid_assignee");
    const fact = tools.find(item => item.name === "propose_fact")!;
    assert.deepEqual(await fact.execute({ key: "synthetic", content: privateValue, intendedVisibility: "private", validUntil: null }, context),
      { status: "rejected", data: { code: "invalid_assignee" } });
    const present = tools.find(item => item.name === "present_answer")!;
    assert.deepEqual(await present.execute({ kind: "operation", paragraphs: [{ text: "Synthetic answer", citationIds: ["unregistered"] }] }, context), {
      status: "rejected", data: { code: "invalid_citation", nextAction: "search_knowledge", citationField: "chunks[].chunkId",
        message: "引用只能取本次 search_knowledge 結果的原始 chunkId；背景來源 metadata 不是已登記引用。不要猜測、拼接或重送同一無效 ID。" },
    });
  } finally { budget.close(); }
});
