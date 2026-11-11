import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { PRODUCT_AGENT_TOOL_CATALOG } from "../server/product-agent-capabilities.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import { memoryFactReferencedByParagraph, looksLikeDurableMemoryFactQuestion, looksLikeDurableMemoryFactStatement } from "../server/memory-policy.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreAgentRuns } from "../server/firestore-agent-runs.ts";
import { createFirestoreAgentProposals } from "../server/firestore-agent-proposals.ts";
import { createFirestoreAgentConfirmations } from "../server/firestore-agent-confirmations.ts";
import { ProductAgentOwner } from "../frontend/src/production/ProductAgentOwner.ts";
import { createProductAgentApi, type ProductAgentErrorCode } from "../src/client/product-agent-api.ts";
import type { AgentRunContext, AgentTool } from "../server/agent-runtime.ts";
import type { MemoryFact } from "../src/shared/memory.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

const scope = {
  userId: "synthetic-caregiver",
  childId: "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808",
  workspaceId: "synthetic-workspace",
  authorizationVersion: "1",
  dataVersion: "epoch:1",
};
const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";

function toolContext(callId: string): Parameters<AgentTool["execute"]>[1] {
  return { scope, runId, callId, signal: new AbortController().signal };
}

test("read_memory_facts and request_confirmation accept omitted optional nulls without invalid_parameters rejection", async () => {
  const budget = new AgentBudget();
  try {
    const fact: MemoryFact = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      childId: scope.childId,
      key: "allergy-peanut",
      content: "BB 對花生過敏",
      source: { kind: "manual", description: "家長確認" },
      validUntil: null,
      visibility: "private",
      intendedVisibility: "private",
      status: "confirmed",
      version: 1,
      createdBy: scope.userId,
      confirmedBy: scope.userId,
      confirmedAt: "2026-10-18T00:00:00.000Z",
      reason: "已確認",
      applicable: true,
      sourceState: "current",
    };
    const confirmations: Array<Record<string, unknown>> = [];
    const surface = createProductAgentTools({
      run: { scope, runId, budget } as unknown as AgentRunContext,
      authorize: async () => true,
      store: {
        propose: async () => ({
          id: "b1b1b1b1-2222-4333-8444-555555555555",
          runId,
          childId: scope.childId,
          version: 1,
          status: "pending",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          value: {
            kind: "memory_fact_revise",
            factId: fact.id,
            expectedVersion: 1,
            key: fact.key,
            content: "BB 對花生及蛋白嚴重過敏",
            sourceMessageId: "7de5a0e8-e106-4485-b7d2-3b572741da39",
            validUntil: null,
            reason: "補充蛋白過敏",
          },
          targetLabel: fact.key,
          targetVisibility: "private",
          result: null,
        }),
        requestConfirmation: async (_scope: unknown, _askingRunId: string, input: Record<string, unknown>) => {
          confirmations.push(input);
          return {
            id: "c1c1c1c1-2222-4333-8444-555555555555",
            proposalRunId: String(input.runId),
            proposalId: String(input.proposalId),
            proposalVersion: Number(input.expectedVersion),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            question: "確認更正？",
          };
        },
      } as never,
      memory: {
        recall: async () => ({ facts: [fact], topics: [], missingKeys: [] }),
        facts: async () => ({ items: [fact], nextAfterId: null }),
        getFact: async () => fact,
        context: async () => ({
          profile: { childId: scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [fact],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({}) } as never,
    });

    assert.ok(PRODUCT_AGENT_TOOL_CATALOG.coreToolNames.includes("read_memory_facts"));

    const readFacts = surface.tools.find(tool => tool.name === "read_memory_facts")!;
    assert.equal(readFacts.parameters.safeParse({ keys: ["allergy-peanut"] }).success, true);
    assert.equal(readFacts.parameters.safeParse({}).success, true);
    assert.equal((await readFacts.execute({ keys: ["allergy-peanut"] }, toolContext("read-keys"))).status, "succeeded");
    assert.equal((await readFacts.execute({}, toolContext("read-page"))).status, "succeeded");

    const requestConfirmation = surface.tools.find(tool => tool.name === "request_confirmation")!;
    const minimalConfirm = {
      runId,
      proposalId: "b1b1b1b1-2222-4333-8444-555555555555",
      expectedVersion: 1,
    };
    assert.equal(requestConfirmation.parameters.safeParse(minimalConfirm).success, true);
    const confirmResult = await requestConfirmation.execute(minimalConfirm, toolContext("confirm-no-workid"));
    assert.equal(confirmResult.status, "succeeded");
    assert.equal(confirmations[0]?.workId, null);

    // Revision auto-prepares confirmation too, avoiding redundant calls or state mismatches.
    const revise = surface.tools.find(tool => tool.name === "propose_fact_revision")!;
    const revised = await revise.execute({
      factId: fact.id,
      expectedVersion: 1,
      key: fact.key,
      content: "BB 對花生及蛋白嚴重過敏",
      sourceMessageId: "7de5a0e8-e106-4485-b7d2-3b572741da39",
      validUntil: null,
      reason: "補充蛋白過敏",
    }, toolContext("revise-1"));
    assert.equal(revised.status, "succeeded");
    assert.equal((revised.data as { result?: { confirmationPrepared?: boolean } })?.result?.confirmationPrepared, true);
  } finally {
    budget.close();
  }
});

test("mixed comma-after-imperative remember sentences allow propose_fact while keeping question guards", async () => {
  const commaMessage = "記住，BB 對花生同蛋白有嚴重過敏。請問出街買餸有咩要注意？";
  assert.equal(looksLikeDurableMemoryFactQuestion(commaMessage), false);
  assert.equal(looksLikeDurableMemoryFactStatement(commaMessage), true);

  const sameSentenceMixed = "請記住：BB 對雞蛋過敏，明天要帶甚麼？";
  assert.equal(looksLikeDurableMemoryFactQuestion(sameSentenceMixed), false);
  assert.equal(looksLikeDurableMemoryFactStatement(sameSentenceMixed), true);

  for (const [message, content] of [
    [commaMessage, "BB 對花生同蛋白有嚴重過敏"],
    [sameSentenceMixed, "BB 對雞蛋過敏"],
  ] as const) {
    const budget = new AgentBudget();
    try {
      const surface = createProductAgentTools({
        run: { scope, runId, budget } as unknown as AgentRunContext,
        authorize: async () => true,
        trustedUserMessage: message,
        store: {
          propose: async (_s: unknown, _r: unknown, _c: unknown, val: unknown) => ({
            id: randomUUID(),
            runId,
            childId: scope.childId,
            version: 1,
            status: "pending",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            value: val,
            targetLabel: null,
            result: null,
          }),
          requestConfirmation: async () => ({
            id: randomUUID(),
            proposalRunId: runId,
            proposalId: randomUUID(),
            proposalVersion: 1,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            question: "確認？",
          }),
        } as never,
        memory: {} as never,
        tasks: {} as never,
        knowledge: { createRun: () => ({}) } as never,
      });
      const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
      const result = await propose.execute({
        key: "allergy-test",
        content,
        intendedVisibility: "private",
        validUntil: null,
      }, toolContext("mixed-comma"));
      assert.equal(result.status, "succeeded", message);
    } finally {
      budget.close();
    }
  }
});

test("duplicate active fact keys are caught at propose_fact time with recovery guidance instead of failing on UI accept", async () => {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 17)),
    projectId: "synthetic-project",
    namespace: "synthetic_ns",
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: "parent@example.test", expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: "parent", email: "parent@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "parent", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });

  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const proposals = createFirestoreAgentProposals({ runs, chat, memory, online });
  const confirmations = createFirestoreAgentConfirmations({ runs, chat, proposals, policyVersion: async () => 1 });

  const createdScope = await online.context("parent", { path: "/api/children", payload: { displayName: "小明" } });
  const child = await online.submit("parent", { path: "/api/children", payload: { displayName: "小明" }, operation: { ...createdScope, opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (child.result as { child: { id: string } }).child.id;

  const firstMsg = (await chat.createUserMessageForUser("parent", childId, "記住 BB 對花生過敏"))!;
  const firstClaim = await runs.claim("parent", childId, { kind: "interactive", reference: firstMsg.id }, "product-interactive");
  const firstProposal = await proposals.propose(firstClaim.scope, firstClaim.runId, "p1", {
    kind: "memory_fact",
    key: "allergy",
    content: "BB 對花生過敏",
    intendedVisibility: "private",
    validUntil: null,
  });
  const accepted = await proposals.decide("parent", childId, firstClaim.runId, firstProposal.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: false,
  });
  assert.equal(accepted?.status, "accepted");

  // Second run re-uses same key "allergy": tool guard rejects cleanly with fact_key_conflict + nextAction.
  const secondMsg = (await chat.createUserMessageForUser("parent", childId, "記住 BB 對蛋白過敏"))!;
  const secondClaim = await runs.claim("parent", childId, { kind: "interactive", reference: secondMsg.id }, "product-interactive");
  const budget = new AgentBudget();
  try {
    const surface = createProductAgentTools({
      run: { scope: secondClaim.scope, runId: secondClaim.runId, budget } as unknown as AgentRunContext,
      authorize: async () => true,
      trustedUserMessage: secondMsg.text,
      store: {
        propose: proposals.propose,
        requestConfirmation: confirmations.requestConfirmation,
      } as never,
      memory,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({}) } as never,
    });
    const proposeFact = surface.tools.find(tool => tool.name === "propose_fact")!;
    const conflict = await proposeFact.execute({
      key: "allergy",
      content: "BB 對蛋白過敏",
      intendedVisibility: "private",
      validUntil: null,
    }, { scope: secondClaim.scope, runId: secondClaim.runId, callId: "dup-key", signal: budget.signal });
    assert.equal(conflict.status, "conflict");
    assert.equal((conflict.data as { code?: string })?.code, "fact_key_conflict");
    assert.match(String((conflict.data as { nextAction?: string })?.nextAction), /propose_fact_revision/u);

    // Distinct key succeeds & accepts cleanly without 未接受成功.
    const unique = await proposeFact.execute({
      key: "allergy-egg-white",
      content: "BB 對蛋白過敏",
      intendedVisibility: "private",
      validUntil: null,
    }, { scope: secondClaim.scope, runId: secondClaim.runId, callId: "unique-key", signal: budget.signal });
    assert.equal(unique.status, "succeeded");
    const uniqueProposalId = (unique.data as { result: { id: string } }).result.id;

    // Attempting a third proposal in the same run with the pending key "allergy-egg-white" is also blocked before UI confirm.
    await assert.rejects(
      proposals.propose(secondClaim.scope, secondClaim.runId, "dup-pending", {
        kind: "memory_fact",
        key: "allergy-egg-white",
        content: "BB 對牛奶過敏",
        intendedVisibility: "private",
        validUntil: null,
      }),
      error => (error as { code?: string }).code === "fact_key_conflict",
    );

    const acceptedUnique = await proposals.decide("parent", childId, secondClaim.runId, uniqueProposalId, {
      expectedVersion: 1,
      decision: "accept",
      confirmShared: false,
    });
    assert.equal(acceptedUnique?.status, "accepted");
  } finally {
    budget.close();
  }
});

test("owner confirmation UI gives specific feedback on residual fact_key_conflict", async () => {
  const proposal = {
    id: randomUUID(),
    runId,
    childId: scope.childId,
    version: 1,
    status: "pending" as const,
    createdAt: "2026-11-11T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    targetLabel: "allergy",
    targetVisibility: "private" as const,
    value: { kind: "memory_fact" as const, key: "allergy", content: "BB 對蛋白過敏", intendedVisibility: "private" as const, validUntil: null },
    result: null,
  };
  const runResult: ProductAgentResult = {
    runId,
    status: "completed",
    stopReason: null,
    text: "待確認",
    citations: [],
    retrievalMode: "not_used",
    tools: [{ name: "propose_fact", status: "succeeded" }],
    countsKnown: true,
    counts: { modelCalls: 2, toolCalls: 2, queryEmbeddings: 0 },
    proposals: [proposal],
    provenance: null,
  };
  const owner = new ProductAgentOwner("/api", true, () => {}, () => {}, () => createProductAgentApi("/api", (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Response.json({ error: { code: "fact_key_conflict" satisfies ProductAgentErrorCode } }, { status: 409 });
    }
    assert.match(String(url), new RegExp(`/agent/runs/${runId}$`));
    return Response.json({ result: runResult });
  }) as typeof fetch));
  owner.syncContext({ key: "s1", userId: scope.userId, childId: scope.childId }, true, { identityKey: "s1" });
  owner.selectRun(runId);
  await new Promise(resolve => setTimeout(resolve, 20));
  owner.decide(proposal.id, "accept");
  await new Promise(resolve => setTimeout(resolve, 20));
  const notice = owner.getSnapshot().model.notice;
  assert.equal(notice?.tone, "error");
  assert.match(notice?.text ?? "", /^未接受成功.*相同鍵/u);
  owner.dispose();
});

test("memoryFactReferencedByParagraph and mixed official and memory runs bind both sources cleanly", async () => {
  const compoundFact = "BB 對花生同蛋白有嚴重過敏";
  assert.equal(memoryFactReferencedByParagraph(compoundFact, "已確認記憶：小明對花生同蛋白嚴重過敏。"), true);
  assert.equal(memoryFactReferencedByParagraph(compoundFact, "小明對花生及蛋白嚴重過敏，千祈唔好買。"), true);
  assert.equal(memoryFactReferencedByParagraph(compoundFact, "BB 對花生過敏。"), true);
  assert.equal(memoryFactReferencedByParagraph(compoundFact, "媽媽對花生同蛋白嚴重過敏。"), false);
  assert.equal(memoryFactReferencedByParagraph("BB 對花生過敏", "BB 對花生並不過敏。"), false);
  assert.equal(memoryFactReferencedByParagraph("BB 對花生過敏", "BB 冇花生過敏。"), false);
  assert.equal(memoryFactReferencedByParagraph("BB 喜歡藍色", "BB 對雞蛋並不過敏。"), false);

  const fact: MemoryFact = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    childId: scope.childId,
    key: "allergy-peanut-egg",
    content: compoundFact,
    source: { kind: "manual", description: "家長確認" },
    validUntil: null,
    visibility: "private",
    intendedVisibility: "private",
    status: "confirmed",
    version: 1,
    createdBy: scope.userId,
    confirmedBy: scope.userId,
    confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認",
    applicable: true,
    sourceState: "current",
  };
  const officialChunk = {
    chunkId: "00000000-0000-4000-8000-000000000099",
    versionId: "00000000-0000-4000-8000-000000000098",
    sourceId: "fhs-solid-food",
    classification: "official_guidance" as const,
    text: "一歲前嬰兒不應進食蜂蜜；引入新食物後應觀察數天留意過敏反應。",
  };

  // Even if the model picks kind="caregiving" without first calling read_context/read_memory_facts,
  // present_answer hydrates confirmed memory and attaches BOTH official chunkId and memory-fact evidence.
  const budget = new AgentBudget();
  try {
    const surface = createProductAgentTools({
      run: { scope, runId, budget } as unknown as AgentRunContext,
      authorize: async () => true,
      trustedUserMessage: "我想買輔食，有咩食物千祈唔好買畀小明？",
      store: {} as never,
      memory: {
        getFact: async () => fact,
        facts: async () => ({ items: [fact], nextAfterId: null }),
        context: async () => ({
          profile: { childId: scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [fact],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: "vector_keyword", chunks: [officialChunk] }),
          revalidateCitations: async () => true,
        }),
      } as never,
    });
    const search = surface.tools.find(tool => tool.name === "search_knowledge")!;
    const present = surface.tools.find(tool => tool.name === "present_answer")!;
    assert.equal((await search.execute({ query: "嬰兒固體食物 過敏", classification: "official_guidance" }, { ...toolContext("s1"), queryEmbeddingAttemptKey: "emb-1" })).status, "succeeded");
    assert.equal((await present.execute({
      kind: "caregiving",
      paragraphs: [{
        text: "根據記錄，小明對花生同蛋白嚴重過敏，千祈唔好買任何花生或蛋類食品；此外一歲前嬰兒不應進食蜂蜜。",
        citationIds: [officialChunk.chunkId],
      }],
    }, toolContext("p1"))).status, "succeeded");
    await surface.presentation();
    const draft = surface.deliveryDraft()!;
    assert.deepEqual(
      draft.sources.map(source => source.citationId).sort(),
      [officialChunk.chunkId, `memory-fact:${fact.id}`].sort(),
    );
  } finally {
    budget.close();
  }

  // Full product-agent run: read_memory_facts + search_knowledge in turn 1 -> present_answer -> single delivery-review pass in <= 3 modelCalls.
  const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
  let saved: ProductAgentResult | null = null;
  let modelCalls = 0;
  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        modelCalls++;
        const userText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
        if (userText.includes("chat-delivery-review")) {
          const payload = JSON.parse(userText.slice(userText.indexOf("{"))) as {
            draftHash: string;
            sources: Array<{ citationId: string }>;
          };
          assert.ok(payload.sources.some(source => source.citationId === `memory-fact:${fact.id}`), "Reviewer must receive confirmed memory-fact source");
          assert.ok(payload.sources.some(source => source.citationId === officialChunk.chunkId), "Reviewer must receive official chunk source");
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
          };
        }
        if (modelCalls === 1) {
          assert.ok(Object.hasOwn(request.toolsDict, "read_memory_facts"), "read_memory_facts must be immediately available alongside search_knowledge");
          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "c-mem", name: "read_memory_facts", args: {} } },
                { functionCall: { id: "c-know", name: "search_knowledge", args: { query: "嬰兒輔食禁忌", classification: "official_guidance" } } },
              ],
            },
            finishReason: FinishReason.STOP,
          };
        }
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "c-present",
                name: "present_answer",
                args: {
                  kind: "mixed",
                  paragraphs: [
                    { kind: "record_restatement", text: "根據已確認記錄，小明對花生同蛋白嚴重過敏，買餸時須完全避開。", citationIds: [] },
                    { kind: "caregiving", text: officialChunk.text, citationIds: [officialChunk.chunkId] },
                  ],
                },
              },
            }],
          },
          finishReason: FinishReason.STOP,
        };
      },
    },
  });

  const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8"));
  const prompt = await loadAgentPrompt("product-interactive", "tool_cycle", ["run", "scope", "conversation", "context", "evidence", "capabilities"]);
  assert.equal(prompt.packVersion, manifest.version);
  assert.match(prompt.text, /read_memory_facts、propose_fact、propose_fact_revision 及 propose_fact_deactivation 已是核心工具/u);

  const service = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      authorize: async () => true,
      finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
      get: async () => saved,
    } as never,
    memory: {
      getFact: async () => fact,
      facts: async () => ({ items: [fact], nextAfterId: null }),
      context: async () => ({
        profile: { childId: scope.childId, version: 0, data: null },
        profileApplicable: false,
        facts: [fact],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
    } as never,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, childId: scope.childId, role: "user", text: "出街買餸整輔食有咩唔買得？" }] }) } as never,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
    knowledge: {
      createRun: () => ({
        search: async () => ({ mode: "vector_keyword", chunks: [officialChunk] }),
        revalidateCitations: async () => true,
      }),
    } as never,
  });

  const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);
  assert.equal(result?.status, "completed");
  assert.equal(result.deliveryReview?.decision, "pass");
  assert.match(result.text, /花生同蛋白嚴重過敏/u);
  assert.match(result.text, /不應進食蜂蜜/u);
  assert.equal(result.counts.modelCalls, 3);
});

test("core memory proposal tools are exposed directly and missing keys guide full listing", async () => {
  for (const name of ["read_memory_facts", "propose_fact", "propose_fact_revision", "propose_fact_deactivation"]) {
    assert.ok((PRODUCT_AGENT_TOOL_CATALOG.coreToolNames as readonly string[]).includes(name), `${name} must be directly exposed in coreToolNames`);
  }

  assert.equal(memoryFactReferencedByParagraph("BB平時下晝 2 點會瞓晏晝覺", "根據紀錄，BB 對花生、蛋白及蝦過敏，平時下晝 2 點會瞓晏晝覺。"), true);
  assert.equal(memoryFactReferencedByParagraph("BB平時下晝 2 點會瞓晏晝覺", "根據已記錄的資料，BB 目前對花生、蛋白同蝦過敏，而平時會在下晝 2 點瞓晏晝覺。"), true);
  assert.equal(memoryFactReferencedByParagraph("BB平時下晝 2 點會瞓晏晝覺", "至於休息習慣，BB 平時在下午 2 點會睡午覺。"), true);
  assert.equal(memoryFactReferencedByParagraph("BB平時下晝 2 點會瞓晏晝覺", "媽媽對花生過敏，平時下晝 2 點會瞓晏晝覺。"), false);
  assert.equal(memoryFactReferencedByParagraph("BB對花生、蛋白同蝦過敏，平時下晝 2 點會瞓晏晝覺。", "小明目前有以下已確認的過敏記錄：對花生、蛋白以及蝦過敏。"), true);
  assert.equal(memoryFactReferencedByParagraph("BB對花生、蛋白同蝦過敏，平時下晝 2 點會瞓晏晝覺。", "BB 對花生、蛋白並不過敏。"), false);

  const b3 = new AgentBudget();
  try {
    let revConfirmPrepared = false;
    const revProposal = {
      id: "00000000-0000-4000-8000-000000000066",
      runId,
      childId: scope.childId,
      version: 1,
      status: "pending" as const,
      createdAt: "2026-11-11T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      targetLabel: "allergy-and-schedule",
      value: {
        kind: "memory_fact_revise" as const,
        factId: "00000000-0000-4000-8000-000000000065",
        expectedVersion: 1,
        key: "allergy-and-schedule",
        content: "BB對花生、蛋白同蝦過敏",
        sourceMessageId: "00000000-0000-4000-8000-000000000064",
        reason: "更正過敏記錄",
        validUntil: null,
      },
      result: null,
    };
    const surface = createProductAgentTools({
      run: { scope, runId, budget: b3 } as unknown as AgentRunContext,
      authorize: async () => true,
      trustedUserMessage: "更正返：BB而家唔止對花生同蛋白過敏，仲對蝦過敏，記低佢。",
      store: {
        propose: async () => revProposal,
        requestConfirmation: async () => {
          revConfirmPrepared = true;
          return {
            id: "00000000-0000-4000-8000-000000000067",
            proposalRunId: runId,
            proposalId: revProposal.id,
            proposalVersion: 1,
            expiresAt: revProposal.expiresAt,
            question: "確認更正過敏記錄？",
          };
        },
        confirmationQuestions: async () => revConfirmPrepared ? ["確認更正過敏記錄？"] : [],
      } as never,
      memory: {
        context: async () => ({ profile: { childId: scope.childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }),
        recall: async () => ({ facts: [], topics: [], missingKeys: ["allergy-peanut-egg"] }),
        facts: async () => ({ items: [], nextAfterId: null }),
      } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }), revalidateCitations: async () => true }) } as never,
    });
    const readFacts = surface.tools.find(tool => tool.name === "read_memory_facts")!;
    const emptyKeysRes = await readFacts.execute({ keys: [] }, toolContext("empty-keys-read"));
    assert.equal(emptyKeysRes.status, "succeeded");
    const res = await readFacts.execute({ keys: ["allergy-peanut-egg"] }, toolContext("missing-key-read"));
    assert.equal(res.status, "succeeded");
    assert.match(String(((res.data as { result?: { note?: string } })?.result?.note) ?? ""), /read_memory_facts\(\{\}\)/u);

    const reviseFact = surface.tools.find(tool => tool.name === "propose_fact_revision")!;
    const present = surface.tools.find(tool => tool.name === "present_answer")!;
    const revRes = await reviseFact.execute({
      factId: "00000000-0000-4000-8000-000000000065",
      expectedVersion: 1,
      key: "allergy-and-schedule",
      content: "BB對花生、蛋白同蝦過敏",
      sourceMessageId: "00000000-0000-4000-8000-000000000064",
      reason: "更正過敏記錄",
      validUntil: null,
    }, toolContext("revise-call"));
    assert.equal(revRes.status, "succeeded");
    const afterRevisePresent = await present.execute({
      kind: "operation",
      paragraphs: [{ kind: "operation", text: "已準備待確認記憶更正候選，尚未正式保存，請核對並確認。", citationIds: [] }],
    }, toolContext("present-after-revise"));
    assert.equal(afterRevisePresent.status, "succeeded");
  } finally {
    b3.close();
  }
});
