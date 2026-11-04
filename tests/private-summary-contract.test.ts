import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";
import type { ChatMessage } from "../src/shared/chat.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { createProductAgentTools, uncoveredConversation } from "../server/product-agent-tools.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { saveSummary, summaryInput } from "../server/memory-summary.ts";

function toolsFixture(options: { moreUncovered?: boolean; characters?: number; visibility?: "private" | "family"; summaryMode?: "isolated_batch" } = {}) {
  const budget = new AgentBudget(), userId = "synthetic-owner", childId = randomUUID();
  const scope = { userId, childId, workspaceId: randomUUID(), authorizationVersion: "1", dataVersion: "1" };
  const messages: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({ id: randomUUID(), childId, authorUserId: userId,
    role: index % 2 ? "model" : "user", inReplyTo: null, text: `Synthetic source ${index}: ` + "x".repeat(options.characters ?? 20),
    createdAt: "2026-10-07T00:00:00.000Z" }));
  const previous = { id: randomUUID(), childId, version: 7, text: "Previous synthetic summary", createdAt: "2026-10-06T00:00:00.000Z",
    previousId: null, coveredMessageIds: [randomUUID()], lastCoveredMessageId: randomUUID() };
  const prepared = { previous: options.summaryMode ? null : previous, previousVersion: 7, basis: "a".repeat(64), messages,
    moreUncovered: options.moreUncovered ?? false, ...(options.summaryMode ? { summaryMode: options.summaryMode } : {}) };
  const context = { profile: { childId, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null }, profileApplicable: false, facts: [], topics: [], summary: previous,
    recentMessages: messages, conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: prepared.moreUncovered } };
  let prepares = 0;
  const runId = randomUUID();
  const product = createProductAgentTools({ run: { scope, runId, budget }, visibility: options.visibility ?? "private",
    memory: { context: async () => context, prepareSummary: async () => { prepares++; return prepared; } },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, store: {},
    knowledge: { createRun: () => ({}) }, authorize: async () => true,
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const call = { scope, runId, callId: "synthetic-call", signal: budget.signal };
  const tool = (name: string) => { const found = product.tools.find(value => value.name === name); assert.ok(found); return found; };
  // Use the same strict parameter boundary as agent-runtime beforeToolCallback.
  const execute = (name: string, args: unknown) => { const selected = tool(name); return selected.execute(selected.parameters.strict().parse(args), call); };
  return { budget, messages, previous, prepared, product, tool, execute, prepares: () => prepares };
}

test("private summary tool accepts only nonblank text up to 6000 characters", () => {
  const fixture = toolsFixture();
  try {
    const schema = fixture.tool("stage_private_summary").parameters.strict();
    assert.deepEqual(Object.keys(schema.shape), ["text"]);
    for (const text of ["Synthetic summary", "x".repeat(6000)]) assert.equal(schema.safeParse({ text }).success, true);
    for (const text of ["", "   ", "x".repeat(6001)]) assert.equal(schema.safeParse({ text }).success, false);
    for (const extra of [{ coveredMessageIds: [randomUUID()] }, { lastCoveredMessageId: randomUUID() },
      { cursor: "opaque-cursor" }, { previousVersion: 7 }, { basis: "a".repeat(64) }, { moreUncovered: true }]) {
      assert.equal(schema.safeParse({ text: "Synthetic summary", ...extra }).success, false);
    }
  } finally { fixture.budget.close(); }
});

for (const moreUncovered of [false, true]) test(`complete displayed batch can stage a text-only summary with moreUncovered=${moreUncovered}`, async () => {
  const fixture = toolsFixture({ moreUncovered });
  try {
    const response = await fixture.execute("read_context", {});
    assert.equal(response.status, "succeeded");
    const data = response.data!.result as any;
    assert.deepEqual(data.uncoveredConversation.messages, fixture.messages);
    assert.deepEqual(data.privateSummaryInput.messageIds, fixture.messages.map(message => message.id));
    assert.equal(data.privateSummaryInput.moreUncovered, moreUncovered);
    assert.equal(data.uncoveredConversation.complete, !moreUncovered);
    assert.deepEqual(data.privateSummaryInput, { previousSummaryId: fixture.previous.id, summaryMode: "cumulative",
      messageIds: fixture.messages.map(message => message.id), moreUncovered });
    assert.equal(data.summary.id, fixture.previous.id);
    assert.deepEqual(await fixture.execute("stage_private_summary", { text: "Synthetic summary body only" }),
      { status: "succeeded", data: { result: { staged: true, saved: false } } });
    assert.deepEqual(fixture.product.summaryDraft(), { previousVersion: 7, basis: fixture.prepared.basis,
      coveredMessageIds: fixture.messages.map(message => message.id), text: "Synthetic summary body only" });
    await fixture.execute("read_context", {});
    assert.equal(fixture.product.summaryDraft(), undefined);
  } finally { fixture.budget.close(); }
});

test("isolated summary coverage excludes previous text while retaining source roles and the current version", async () => {
  const fixture = toolsFixture({ summaryMode: "isolated_batch", moreUncovered: true });
  try {
    const response = await fixture.execute("read_context", {}), data = response.data!.result as any;
    assert.equal(response.status, "succeeded");
    assert.equal(data.summary, null);
    assert.deepEqual(data.privateSummaryInput, { previousSummaryId: null, summaryMode: "isolated_batch",
      messageIds: fixture.messages.map(message => message.id), moreUncovered: true });
    assert.deepEqual(data.uncoveredConversation.messages, fixture.messages);
    assert.equal(data.uncoveredConversation.messages.filter((message: ChatMessage) => message.role === "user").length, 6);
    assert.equal(data.uncoveredConversation.messages.filter((message: ChatMessage) => message.role === "model").length, 6);
    assert.equal(data.uncoveredConversation.complete, false);
    assert.doesNotMatch(JSON.stringify(data), /Previous synthetic summary/);
    assert.deepEqual(await fixture.execute("stage_private_summary", { text: "Only this complete isolated batch" }),
      { status: "succeeded", data: { result: { staged: true, saved: false } } });
    assert.deepEqual(fixture.product.summaryDraft(), { previousVersion: 7, basis: fixture.prepared.basis,
      coveredMessageIds: fixture.messages.map(message => message.id), text: "Only this complete isolated batch" });
  } finally { fixture.budget.close(); }
});

test("a bounded read binds only its complete displayed prefix and excludes later source IDs", async () => {
  const fixture = toolsFixture({ characters: 800 });
  try {
    const response = await fixture.execute("read_context", {}), data = response.data!.result as any;
    const selected = data.uncoveredConversation.messages as ChatMessage[];
    assert.ok(selected.length > 0 && selected.length < fixture.messages.length);
    assert.deepEqual(selected, fixture.messages.slice(0, selected.length));
    assert.deepEqual(data.privateSummaryInput.messageIds, selected.map(message => message.id));
    assert.equal(data.privateSummaryInput.moreUncovered, true);
    assert.equal(data.uncoveredConversation.complete, false);
    await fixture.execute("stage_private_summary", { text: "Only the displayed prefix" });
    assert.deepEqual(fixture.product.summaryDraft()!.coveredMessageIds, selected.map(message => message.id));
    assert.equal(fixture.product.summaryDraft()!.coveredMessageIds.includes(fixture.messages[selected.length]!.id), false);
  } finally { fixture.budget.close(); }
});

test("summary staging requires a prepared private batch and family reads never prepare one", async () => {
  const privateFixture = toolsFixture(), familyFixture = toolsFixture({ visibility: "family" });
  try {
    assert.deepEqual(await privateFixture.execute("stage_private_summary", { text: "Unprepared" }),
      { status: "rejected", data: { code: "summary_not_prepared" } });
    const response = await familyFixture.execute("read_context", {}), data = response.data!.result as any;
    assert.equal(data.privateSummaryInput, null);
    assert.equal(data.uncoveredConversation, null);
    assert.equal(familyFixture.prepares(), 0);
    assert.equal(familyFixture.product.tools.some(tool => tool.name === "stage_private_summary"), false);
  } finally { privateFixture.budget.close(); familyFixture.budget.close(); }
});

test("persistence advances only an ordered prefix while more history remains and rejects stale coverage", async () => {
  const cipher = createStorageCipher(Buffer.alloc(32, 41)), user = "synthetic-owner", child = randomUUID();
  let profileVersion = 0, savedRow: any = null;
  const coverage = new Set<string>();
  const rows = Array.from({ length: 52 }, (_, index) => { const id = randomUUID(); return { id, author_user_id: user, role: "user", in_reply_to: null,
    created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, index)), text_encrypted: cipher.encrypt(`Synthetic source ${index}`, `chat_messages:${id}:${child}:${user}:user::text`) }; });
  const client = { async query(sql: string, params: any[] = []) {
    const result = (value: any[]) => ({ rows: value, rowCount: value.length });
    const normalized = sql.replace(/\s+/gu, " ").trim();
    const authorityQuery = `WITH checked AS MATERIALIZED (SELECT clock_timestamp() AS at)
    SELECT md5(jsonb_build_array(
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM text_records WHERE child_id=$1),
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version,status,visibility,valid_until,valid_until IS NULL OR valid_until>checked.at) ORDER BY id),'[]'::jsonb)
      FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2)),
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM memory_topics WHERE child_id=$1 AND (visibility='family' OR created_by=$2))
    )::text) AS authority, NOT EXISTS(SELECT 1 FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed) AS metadata_complete,
    checked.at AS checked_at, (SELECT min(valid_until) FROM memory_facts WHERE child_id=$1
      AND (visibility='family' OR created_by=$2) AND valid_until>checked.at) AS fact_valid_until FROM checked`.replace(/\s+/gu, " ").trim();
    if (normalized === authorityQuery) {
      assert.deepEqual(params, [child, user]);
      return result([{ authority: "f".repeat(32), metadata_complete: true, checked_at: new Date("2026-10-09T09:00:00.000Z"), fact_valid_until: null }]);
    }
    if (sql.includes("ORDER BY version DESC LIMIT 1")) return result(savedRow ? [savedRow] : []);
    if (sql.startsWith("SELECT profile_version")) return result([{ profile_version: profileVersion }]);
    if (sql.includes("SELECT m.* FROM chat_messages")) return result(rows.filter(row => params[2] || !coverage.has(row.id)).slice(0, 51));
    if (sql.startsWith("INSERT INTO conversation_summaries")) { savedRow = { id: params[0], payload_encrypted: params[5], invalidated: false }; return result([]); }
    if (sql.startsWith("DELETE FROM summary_message_coverage")) { coverage.clear(); return result([]); }
    if (sql.startsWith("INSERT INTO summary_message_coverage")) { params[0].forEach((id: string) => coverage.add(id)); return result([]); }
    const emptyQueries = [
      "SELECT id,version,payload_encrypted FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed ORDER BY id LIMIT 100",
      "SELECT version,payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version=$2",
      "SELECT 1 FROM conversation_summaries s WHERE s.child_id=$1 AND s.owner_user_id=$2 AND NOT s.invalidated AND (SELECT count(*) FROM summary_message_coverage c WHERE c.summary_id=s.id) <> s.covered_count LIMIT 1",
      "UPDATE conversation_summaries SET invalidated=true WHERE child_id=$1 AND owner_user_id=$2",
    ];
    if (emptyQueries.includes(normalized)) return result([]);
    throw new Error("Unexpected synthetic summary SQL: " + sql);
  } } as unknown as PoolClient;
  const first = await summaryInput(client, cipher, user, child);
  assert.equal(first.moreUncovered, true); assert.equal(first.messages.length, 50);
  const draft = { previousVersion: first.previousVersion, basis: first.basis, text: "Only the first two sources",
    coveredMessageIds: first.messages.slice(0, 2).map(message => message.id) };
  for (const ids of [[], [rows[1]!.id], [rows[0]!.id, rows[2]!.id], [rows[1]!.id, rows[0]!.id], [rows[0]!.id, rows[0]!.id]]) {
    await assert.rejects(saveSummary(client, cipher, user, child, { ...draft, coveredMessageIds: ids }));
    assert.equal(coverage.size, 0);
  }
  const saved = await saveSummary(client, cipher, user, child, draft);
  assert.deepEqual(saved.coveredMessageIds, draft.coveredMessageIds);
  assert.equal(saved.lastCoveredMessageId, rows[1]!.id);
  assert.deepEqual([...coverage], draft.coveredMessageIds);
  const next = await summaryInput(client, cipher, user, child);
  assert.equal(next.previousVersion, 1);
  assert.deepEqual(next.messages.map(message => message.id), rows.slice(2).map(row => row.id));
  assert.equal(next.moreUncovered, false);
  await assert.rejects(saveSummary(client, cipher, user, child, draft), /summary_coverage_changed/u);
  profileVersion++;
  await assert.rejects(saveSummary(client, cipher, user, child, { previousVersion: next.previousVersion, basis: next.basis,
    text: "Stale authority", coveredMessageIds: next.messages.map(message => message.id) }), /summary_coverage_changed/u);
  assert.equal(coverage.size, 2);
});


test("REQ-005: 9,000 ASCII message is admitted when interactive tool allowance is abundant, and gracefully omitted when allowance is insufficient", async () => {
  const userId = "synthetic-owner", childId = randomUUID();
  const scope = { userId, childId, workspaceId: randomUUID(), authorizationVersion: "1", dataVersion: "1" };
  const msg9000: ChatMessage = {
    id: randomUUID(), childId, authorUserId: userId,
    role: "user", inReplyTo: null, text: "a".repeat(9000), createdAt: "2026-10-07T00:00:00.000Z",
  };
  const otherMessages: ChatMessage[] = Array.from({ length: 11 }, (_, i) => ({
    id: randomUUID(), childId, authorUserId: userId, role: i % 2 ? "model" : "user",
    inReplyTo: null, text: `Short message ${i}`, createdAt: "2026-10-07T00:00:00.000Z"
  }));
  const allMessages = [msg9000, ...otherMessages];
  const prepared = { previous: null, previousVersion: 0, basis: "a".repeat(64), messages: allMessages, moreUncovered: false };
  const context = {
    profile: { childId, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: allMessages, conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false },
  };

  const abundantBudget = new AgentBudget();
  const constrainedBudget = new AgentBudget();
  try {
    // 1. Abundant budget: 9,000 ASCII message is admitted
    abundantBudget.configureInputCharacters(64000);
    abundantBudget.prepareToolResponseBudget(20000, 200);
    const runId1 = randomUUID();
    const tools1 = createProductAgentTools({
      run: { scope, runId: runId1, budget: abundantBudget }, visibility: "private",
      memory: { context: async () => context, prepareSummary: async () => prepared },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, store: {},
      knowledge: { createRun: () => ({}) }, authorize: async () => true,
    } as any);
    const readTool1 = tools1.tools.find(t => t.name === "read_context")!;
    const res1 = await readTool1.execute({}, { scope, runId: runId1, callId: "call1", signal: abundantBudget.signal });
    assert.equal(res1.status, "succeeded");
    const data1 = res1.data!.result as any;
    assert.ok(data1.uncoveredConversation.messages.length >= 1);
    assert.equal(data1.uncoveredConversation.messages[0].id, msg9000.id);
    assert.equal(data1.privateSummaryInput.messageIds[0], msg9000.id);
    assert.deepEqual(data1.privateSummaryInput.messageIds, data1.uncoveredConversation.messages.map((m: ChatMessage) => m.id));

    // 2. Constrained budget: 9,000 ASCII message gracefully omitted without crash or fake progress
    constrainedBudget.configureInputCharacters(32000);
    constrainedBudget.prepareToolResponseBudget(22000, 200);
    const runId2 = randomUUID();
    const tools2 = createProductAgentTools({
      run: { scope, runId: runId2, budget: constrainedBudget }, visibility: "private",
      memory: { context: async () => context, prepareSummary: async () => prepared },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, store: {},
      knowledge: { createRun: () => ({}) }, authorize: async () => true,
    } as any);
    const readTool2 = tools2.tools.find(t => t.name === "read_context")!;
    const res2 = await readTool2.execute({}, { scope, runId: runId2, callId: "call2", signal: constrainedBudget.signal });
    assert.equal(res2.status, "succeeded");
    const data2 = res2.data!.result as any;
    assert.equal(data2.uncoveredConversation.messages.length, 0);
    assert.equal(data2.uncoveredConversation.omittedFromLoadedBatch, 12);
    assert.equal(data2.uncoveredConversation.complete, false);
    assert.equal(data2.privateSummaryInput, null);
  } finally {
    abundantBudget.close();
    constrainedBudget.close();
  }
});


test("REQ-005: uncoveredConversation respects fallback and dynamic limits on first message without artificial override", () => {
  const childId = randomUUID(), userId = "synthetic-owner";
  const msg9000: ChatMessage = {
    id: randomUUID(), childId, authorUserId: userId,
    role: "user", inReplyTo: null, text: "a".repeat(9000), createdAt: "2026-10-07T00:00:00.000Z",
  };
  const context = {
    profile: { childId, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: [msg9000], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false },
  };
  // Fallback (8,000 chars): 9,000 char message does NOT fit
  const fallbackRes = uncoveredConversation(context);
  assert.equal(fallbackRes.messages.length, 0);
  assert.equal(fallbackRes.omittedFromLoadedBatch, 1);
  assert.equal(fallbackRes.complete, false);

  // Dynamic allowance (15,000 chars): 9,000 char message fits cleanly
  const dynamicRes = uncoveredConversation(context, 15000);
  assert.equal(dynamicRes.messages.length, 1);
  assert.equal(dynamicRes.messages[0].id, msg9000.id);
  assert.equal(dynamicRes.omittedFromLoadedBatch, 0);
  assert.equal(dynamicRes.complete, true);
});

test("REQ-005: read_context gracefully trims when metadata itself approaches allowance", async () => {
  const userId = "synthetic-owner", childId = randomUUID();
  const scope = { userId, childId, workspaceId: randomUUID(), authorizationVersion: "1", dataVersion: "1" };
  const lotsOfFacts = Array.from({ length: 30 }, (_, i) => ({
    id: randomUUID(), childId, visibility: "private" as const, intendedVisibility: "private" as const,
    key: `fact_${i}`, value: `Heavy factual information item number ${i} with substantial detail`,
    sourceQuote: `Quote ${i}`, validUntil: null, operationId: randomUUID(), policyVersion: "1"
  }));
  const msg: ChatMessage = { id: randomUUID(), childId, authorUserId: userId, role: "user", inReplyTo: null, text: "hello", createdAt: "2026-10-07T00:00:00.000Z" };
  const context = {
    profile: { childId, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null }, profileApplicable: false, facts: lotsOfFacts, topics: [], summary: null,
    recentMessages: [msg], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false },
  };
  const budget = new AgentBudget();
  try {
    budget.configureInputCharacters(32000);
    // Prepare a constrained response budget where facts must be trimmed to fit
    budget.prepareToolResponseBudget(16000, 200);
    const runId = randomUUID();
    const tools = createProductAgentTools({
      run: { scope, runId, budget }, visibility: "private",
      memory: { context: async () => context, prepareSummary: async () => null },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, store: {},
      knowledge: { createRun: () => ({}) }, authorize: async () => true,
    } as any);
    const readTool = tools.tools.find(t => t.name === "read_context")!;
    const res = await readTool.execute({}, { scope, runId, callId: "call-meta", signal: budget.signal });
    assert.equal(res.status, "succeeded");
    const data = res.data!.result as any;
    assert.ok(data.facts.length < lotsOfFacts.length, "Facts must be trimmed to respect allowance");
    assert.equal(data.factsPartial, true, "Must flag factsPartial when facts are trimmed for capacity");
  } finally {
    budget.close();
  }
});

