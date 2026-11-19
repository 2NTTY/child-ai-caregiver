import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudget } from "../server/agent-budget.ts";
import { enforceChatDeliveryReview } from "../server/chat-delivery-review.ts";
import type { AgentRunContext } from "../server/agent-runtime.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";

const scope = { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" };

test("mixed task, care record and coverage repair bind only the selected child's original pages", async () => {
  const budget = new AgentBudget(), run: AgentRunContext = { scope, budget, runId: "selected-repair" };
  const first = "11111111-1111-4111-8111-111111111111", selected = "22222222-2222-4222-8222-222222222222";
  const recordId = "33333333-3333-4333-8333-333333333333", at = "2026-06-15T09:00:00Z";
  const cursor = { createdAt: at, id: recordId, basis: "a".repeat(64) }, filters = { kind: "note" as const };
  const task = { id: recordId, version: 1, title: "清單", dueAt: at, state: "scheduled" as const };
  const taskChild = { childId: selected, childName: "乙", tasks: [task], nextCursor: null };
  const record = { id: recordId, version: 1, text: "帶了水樽", textComplete: true, createdAt: at,
    details: { kind: "note" as const, quantity: null,
      eventTime: { rawText: "", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" as const } } };
  const care = { childId: selected, childName: "乙", records: [record], scanned: 1, undatedMatches: 1, nextCursor: null };
  type Options = Parameters<typeof createProductAgentTools>[0];
  let granted = true, removeTask = false, revokeDuringRead = false;
  const taskReads: Parameters<NonNullable<Options["mixedTasks"]>>[0][] = [];
  const careReads: Parameters<NonNullable<Options["mixedCare"]>>[0][] = [];
  const tools = createProductAgentTools({ run, authorize: async () => granted,
    knowledge: { createRun: () => ({}) } as unknown as Options["knowledge"],
    memory: {} as Options["memory"], tasks: {} as Options["tasks"], store: {} as Options["store"],
    mixedTasks: async query => {
      taskReads.push(query);
      return { children: query.childId ? removeTask ? [] : [taskChild]
        : [{ ...taskChild, childId: first, childName: "甲" }, taskChild], nextFrom: null };
    },
    mixedCare: async query => {
      careReads.push(query);
      if (revokeDuringRead) granted = false;
      // Exercise the existing smaller-page fallback; repair must use the final limit, not the first one.
      return { children: [{ ...care, records: query.limit === 1 ? care.records
        : [...care.records, { ...record, id: first, text: "x".repeat(8000) }] }], nextFrom: null };
    },
  });
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const result = await tools.tools.find(tool => tool.name === name)!.execute(args, { scope, runId: run.runId, callId: name, signal: budget.signal });
    assert.equal(result.status, "succeeded", JSON.stringify(result.data));
    return result.data!.result;
  };
  try {
    const taskPage = await invoke("read_selected_tasks", { from: 0 }) as { children: { citationId: string }[] };
    const carePage = await invoke("search_selected_care", { from: 1, filters, cursor }) as {
      children: { coverageCitationId: string; records: { citationId: string }[] }[] };
    const citationIds = [taskPage.children[1]!.citationId, carePage.children[0]!.records[0]!.citationId, carePage.children[0]!.coverageCitationId];
    await invoke("present_answer", { kind: "private_reference", paragraphs: [{ text: "資料提到清單和水樽。", citationIds }] });
    const original = await tools.presentation();
    assert.ok(original);
    assert.match(original.text, /\[待辦資料\]\[照護記錄 1\]\[查詢範圍\]/u);
    taskReads.length = careReads.length = 0;
    const current = tools.bindRepairEvidence();
    assert.equal(await current(), true);
    assert.deepEqual(taskReads, [{ from: 1, childId: selected }]);
    assert.deepEqual(careReads, [{ from: 1, filters, cursor, limit: 1, singleChild: true }], "record and coverage share one scoped read per check");

    let reviews = 0;
    run.completeText = async input => {
      budget.take("modelCalls");
      if (input.purpose === "delivery_repair") return JSON.stringify({ kind: "private_reference", paragraphs: [{ text: "清單的記錄寫着帶了水樽。", citationIds }] });
      const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
      return JSON.stringify({ draftHash: payload.draftHash, decision: ++reviews === 1 ? "revise" : "pass",
        issues: reviews === 1 ? [{ paragraph: 0, reason: "Clarify the note", support: "The note mentions a bottle" }] : [] });
    };
    const result = await enforceChatDeliveryReview({ tools, presentation: original, context: run,
      provenance: { packVersion: "synthetic", model: "synthetic" } });
    assert.equal(result.review?.decision, "pass");
    assert.equal(budget.counts.modelCalls, 3);

    task.title = "已改"; assert.equal(await current(), false); task.title = "清單";
    record.text = "不同文字"; assert.equal(await current(), false); record.text = "帶了水樽";
    care.scanned++; assert.equal(await current(), false); care.scanned--;
    care.childId = first; assert.equal(await current(), false); care.childId = selected;
    removeTask = true; assert.equal(await current(), false); removeTask = false;
    revokeDuringRead = true;
    assert.equal(await current(), false, "revocation while reading invalidates this attempt");
    taskReads.length = careReads.length = 0;
    assert.equal(await run.authorizeModelEvidence!(), false);
    assert.equal(taskReads.length + careReads.length, 0);
  } finally { budget.close(); }
});

type MixedOptions = Parameters<typeof createProductAgentTools>[0];
function mixedFixture(readers: Pick<MixedOptions, "mixedTasks" | "mixedCare">, signal?: AbortSignal) {
  const budget = new AgentBudget(signal), run: AgentRunContext = { scope, budget, runId: "mixed-page-proof" };
  const tools = createProductAgentTools({ run, authorize: async () => true, ...readers,
    knowledge: { createRun: () => ({}) } as unknown as MixedOptions["knowledge"],
    memory: {} as MixedOptions["memory"], tasks: {} as MixedOptions["tasks"], store: {} as MixedOptions["store"] });
  async function invoke(name: string, args: Record<string, unknown>) {
    const out = await tools.tools.find(tool => tool.name === name)!.execute(args, { scope, runId: run.runId, callId: name, signal: budget.signal });
    assert.equal(out.status, "succeeded", JSON.stringify(out.data));
    return out.data!.result;
  }
  return { budget, tools, invoke };
}

test("repeated care pages share a scoped proof; different filters or cursors cannot replace its first registration", async () => {
  const childId = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  const at = "2026-06-15T09:00:00Z", filters = { kind: "note" as const }, cursor = { createdAt: at, id: childId, basis: "a".repeat(64) };
  const row = { id: childId, version: 1, text: "帶了水樽", textComplete: true, createdAt: at,
    details: { kind: "note" as const, quantity: null, eventTime: { rawText: "", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" as const } } };
  const second = { ...row, id: other };
  let originalRows = [row];
  const reads: Parameters<NonNullable<MixedOptions["mixedCare"]>>[0][] = [];
  const { tools, budget, invoke } = mixedFixture({ mixedTasks: async () => ({ children: [], nextFrom: null }),
    mixedCare: async query => {
      reads.push(query);
      const original = query.cursor?.basis === cursor.basis && query.filters.kind === "note";
      const records = original ? originalRows : [row];
      return { children: [{ childId, childName: "甲", records, scanned: records.length, undatedMatches: 0, nextCursor: null }], nextFrom: null };
    } });
  const read = async (args: Record<string, unknown>) =>
    (await invoke("search_selected_care", args) as { children: { records: { citationId: string }[] }[] }).children[0]!.records;
  try {
    const a = { from: 3, filters, cursor }, firstId = (await read(a))[0]!.citationId;
    originalRows = [row, second];
    const secondId = (await read(a))[1]!.citationId;
    // The same stable record locator can legitimately be rediscovered through an unrelated query.
    assert.equal((await read({ ...a, filters: { query: "水樽" } }))[0]!.citationId, firstId);
    assert.equal((await read({ ...a, cursor: { ...cursor, basis: "b".repeat(64) } }))[0]!.citationId, firstId);
    await invoke("present_answer", { kind: "private_reference", paragraphs: [{ text: "帶了水樽。", citationIds: [firstId, secondId] }] });
    const check = tools.bindRepairEvidence();
    reads.length = 0;
    assert.equal(await check(), true);
    assert.deepEqual(reads, [{ ...a, limit: 3, singleChild: true }]);
    originalRows = [second];
    assert.equal(await check(), false, "finding the first record on another page does not authorize this page");
    originalRows = [{ ...row, text: "不同的同版文字" }, second];
    await read(a);
    originalRows = [row, second];
    assert.equal(await tools.bindRepairEvidence()(), false, "conflicting data under one stable locator is not a usable proof");
  } finally { budget.close(); }
});

test("cancellation during the first pending mixed page never dispatches a second private page", async () => {
  const controller = new AbortController(), first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
  const children = [first, second].map((childId, index) => ({ childId, childName: String(index), tasks: [], nextCursor: null }));
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const dispatched: string[] = [];
  const { tools, budget, invoke } = mixedFixture({ mixedTasks: async query => {
    if (!query.childId) return { children, nextFrom: null };
    dispatched.push(query.childId);
    if (query.childId === first) { entered(); await barrier; }
    return { children: children.filter(child => child.childId === query.childId), nextFrom: null };
  } }, controller.signal);
  try {
    const page = await invoke("read_selected_tasks", { from: 0 }) as { children: { citationId: string }[] };
    await invoke("present_answer", { kind: "private_reference", paragraphs: [{ text: "沒有待辦。", citationIds: page.children.map(child => child.citationId) }] });
    const operation = tools.bindRepairEvidence()();
    const outcome = operation.then(() => "completed", error => error.reason);
    const outer = budget.wait(() => operation);
    await pending;
    controller.abort();
    await assert.rejects(outer, { reason: "cancelled" });
    release();
    assert.equal(await outcome, "cancelled");
    assert.deepEqual(dispatched, [first], "the late first read must never schedule a sibling or retry");
  } finally { release(); budget.close(); }
});
