import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { LlmRequest } from "@google/adk";
import { projectAgentProposal } from "../frontend/src/production/agent-projection.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { discussionToolNames } from "../server/chat-discussion.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreProductAgent } from "../server/firestore-product-agent.ts";
import { createFirestoreProductAgentStore } from "../server/firestore-product-agent-store.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { handleProductAgentRequest } from "../server/product-agent-api.ts";
import { CHAT_ONLY_ALLOWED_TOOL_NAMES } from "../server/product-agent-capabilities.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createTemporaryChatService } from "../server/temporary-chat-agent.ts";
import { handleTemporaryChatRequest } from "../server/temporary-chat-api.ts";
import { createTemporaryChatStore } from "../server/temporary-chat-store.ts";
import { createProductAgentApi } from "../src/client/product-agent-api.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import {
  DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY,
  OPERATION_UNDO_CAPABILITIES,
  describeOperationUndoCapability,
} from "../src/shared/operation-undo.ts";
import type { KnowledgeCandidate } from "../src/shared/knowledge.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

async function createCloseoutFixture(
  userId = "parent",
  extras: { discussionCitationsReadable?: () => Promise<boolean> } = {},
) {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 41)),
    projectId: "synthetic-req003-closeout",
    namespace: "synthetic_req003_closeout",
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const id of [userId, "other"]) {
    const email = `${id}@example.test`;
    await authority.issueInvitation({
      email,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      operationId: randomUUID(),
    });
    await authority.admitIdentity({ userId: id, email, emailVerified: true });
    await authority.acknowledge({
      userId: id,
      operationId: randomUUID(),
      policyVersion: SERVICE_POLICY_VERSION,
    });
  }
  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({
    ...options,
    mutations: [chat.mutation, care.mutation, memory.mutation],
  });
  const services = createFirestoreProductAgentStore({
    ...options,
    chat,
    care,
    memory,
    online,
    validateKnowledge: async () => {},
    continuationKnowledge: async () => [],
    discussionCitationsReadable: extras.discussionCitationsReadable,
  });
  const ctx = await online.context(userId, { path: "/api/children", payload: { displayName: "小晴" } });
  const created = await online.submit(userId, {
    path: "/api/children",
    payload: { displayName: "小晴" },
    operation: { ...ctx, opId: randomUUID(), deviceId: randomUUID() },
  });
  const childId = (created.result as { child: { id: string } }).child.id;
  return { ...options, userId, childId, fake, authority, chat, care, memory, online, ...services };
}

function makeSampleChunk(): KnowledgeCandidate {
  const text = "發燒照顧期間應鼓勵孩子少量多次補充水分，並按情況觀察精神狀態。";
  return {
    chunkId: "11111111-1111-4111-8111-111111111111",
    sourceId: "fhs-fever-hk",
    versionId: "22222222-2222-4222-8222-222222222222",
    versionHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/fever.html",
    title: "兒童發燒照顧指引",
    publisher: "香港衞生署家庭健康服務",
    classification: "official_guidance",
    sourcePublishedAt: "2026-01-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    validUntil: null,
    fetchedAt: "2026-02-01T00:00:00.000Z",
    checkedAt: "2026-02-01T00:00:00.000Z",
    reviewState: "reviewed",
    key: "fever-hydration",
    section: "補水建議",
    sourceExcerpt: text,
    text,
    keywords: ["發燒", "補水"],
    distance: 0.1,
    applicability: {
      region: "HK",
      ageBasis: "any",
      minAgeMonths: 0,
      maxAgeMonths: 72,
      topics: ["發燒", "護理"],
      conditions: [],
    },
  };
}

function parseServerContext(request: LlmRequest): Record<string, unknown> {
  const joined = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
  const marker = joined.indexOf("\"recentConversationCoverage\"");
  assert.ok(marker >= 0, "Expected server context JSON in prompt");
  const start = joined.lastIndexOf("{", marker);
  let depth = 0;
  for (let i = start; i < joined.length; i++) {
    if (joined[i] === "{") depth++;
    else if (joined[i] === "}") {
      depth--;
      if (depth === 0) return JSON.parse(joined.slice(start, i + 1)) as Record<string, unknown>;
    }
  }
  throw new Error("Unclosed JSON object in server context");
}

test("1. confirm_first draft -> pre-confirmation editProposal -> version-gated accept & undo/cancel distinction", async () => {
  const f = await createCloseoutFixture();
  const policy = (await f.actions.savePolicy(f.userId, f.childId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    executionMode: "confirm_first",
    recordKinds: ["feeding"],
    allowPrivateNotes: true,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: true,
  }))!;
  const msg = (await f.chat.createUserMessageForUser(f.userId, f.childId, "小晴剛飲咗140毫升奶。"))!;

  let step = 0;
  const product = await createFirestoreProductAgent({
    database: f.fake.database,
    cipher: f.cipher,
    projectId: f.projectId,
    namespace: f.namespace,
    chat: f.chat,
    care: f.care,
    memory: f.memory,
    online: f.online,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: f.projectId }),
    platformProvider: {
      async generate(request) {
        const promptText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const body = JSON.parse(promptText.slice(promptText.indexOf("{")));
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          };
        }
        step++;
        if (step === 1) {
          return {
            content: { role: "model", parts: [{ functionCall: { id: "c1", name: "load_capabilities", args: { capabilities: ["care_records"] } } }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          };
        }
        if (step === 2) {
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "c2",
                  name: "save_ordinary_record",
                  args: {
                    sourceQuote: msg.text,
                    expectedPolicyVersion: policy.version,
                    text: "飲咗140毫升奶",
                    quantityEvidence: "140毫升",
                    details: {
                      kind: "feeding",
                      quantity: { rawValue: "140", unit: "毫升", precision: "exact" },
                      eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
                    },
                  },
                },
              }],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
          };
        }
        return {
          content: {
            role: "model",
            parts: [{ functionCall: { id: "c3", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "已準備待確認餵食草稿，請核對後再保存。", citationIds: [] }] } } }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 },
        };
      },
    },
  });

  const runResult = await product.agent.reply(f.userId, f.childId, msg.id, async () => true);
  assert.equal(runResult?.status, "completed");
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);

  const pendingBeforeEdit = (await f.store.pendingProposals(f.userId, f.childId))?.proposals ?? [];
  assert.equal(pendingBeforeEdit.length, 1);
  const draft = pendingBeforeEdit[0]!;
  assert.equal(draft.value.kind, "care_record_create");
  assert.equal(draft.version, 1);

  const productApi = createProductAgentApi("https://synthetic.local", async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handleProductAgentRequest(new Request(url, init), f.userId, {
      agent: product.agent,
      store: f.store,
      chat: f.chat,
      isCurrentUser: async id => id === f.userId,
    });
  });

  const controller = new AbortController();
  const edited = await productApi.editProposal!(f.childId, runResult.runId, draft.id, {
    expectedVersion: 1,
    value: {
      kind: "care_record_create",
      text: "飲咗160毫升奶",
      sourceQuote: msg.text,
      details: {
        kind: "feeding",
        quantity: { rawValue: "160", unit: "毫升", precision: "exact" },
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    },
  }, controller.signal, f.userId);
  assert.equal(edited.version, 2);

  const projectedEdited = projectAgentProposal(edited);
  assert.ok(projectedEdited.details.some(row => row.label === "建議內容" && row.value === "飲咗160毫升奶"));

  await assert.rejects(
    () => productApi.decideProposal(f.childId, runResult.runId, draft.id, {
      expectedVersion: 1,
      decision: "accept",
      confirmShared: true,
    }, controller.signal, f.userId),
  );
  // Client replay guard requires reading original run before a modified decision payload.
  await productApi.getRun(f.childId, runResult.runId, controller.signal, f.userId);

  const accepted = await productApi.decideProposal(f.childId, runResult.runId, draft.id, {
    expectedVersion: 2,
    decision: "accept",
    confirmShared: true,
  }, controller.signal, f.userId);
  assert.equal(accepted.status, "accepted");

  const committedRecords = (await f.care.listRecords(f.userId, f.childId)).records;
  assert.equal(committedRecords.length, 1);
  assert.equal(committedRecords[0]?.text, "飲咗160毫升奶");

  // Cancelling an unrelated pending draft leaves previously committed records intact and never impersonates history undo.
  const msg2 = (await f.chat.createUserMessageForUser(f.userId, f.childId, "記住買奶咀"))!;
  const claim2 = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg2.id }, "product-interactive");
  const noteDraft = (await f.store.propose(claim2!.scope, claim2!.runId, "draft-cancel", {
    kind: "private_note_create",
    title: "臨時備忘",
    text: "要買新奶咀",
    sourceQuote: msg2.text,
  }))!;
  const decidedReject = await productApi.decideProposal(f.childId, claim2!.runId, noteDraft.id, {
    expectedVersion: 1,
    decision: "dismiss",
    confirmShared: false,
  }, controller.signal, f.userId);
  assert.equal(decidedReject.status, "dismissed");
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 1);
  assert.match(DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY, /不會撤銷/);
  for (const kind of Object.keys(OPERATION_UNDO_CAPABILITIES) as Array<keyof typeof OPERATION_UNDO_CAPABILITIES>) {
    const cap = describeOperationUndoCapability(kind);
    assert.ok(cap.label.length > 0 && cap.limitation.length > 0);
  }
});

test("2. chat_only mode stays strictly orthogonal to REQ-009 three-role discussion and preserves chatMode", async () => {
  const f = await createCloseoutFixture("parent", { discussionCitationsReadable: async () => true });
  const sampleChunk = makeSampleChunk();

  const chatOnlyQuestion = (await f.chat.createUserMessageForUser(f.userId, f.childId, "發燒期間飲水點計？", "chat_only"))!;
  const claim0 = (await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: chatOnlyQuestion.id }, "product-interactive"))!;
  const completedPriorRun: ProductAgentResult = {
    runId: claim0.runId,
    provenance: null,
    status: "completed",
    stopReason: null,
    text: "可按孩子情況少量多次補水。",
    citations: [],
    retrievalMode: "not_used",
    tools: [{ name: "present_answer", status: "succeeded" }],
    proposals: [],
    countsKnown: true,
    counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 },
  };
  await f.store.finish(claim0.scope, completedPriorRun);
  const priorAnswer = (await f.chat.createModelMessageForUser(
    f.userId,
    f.childId,
    chatOnlyQuestion.id,
    "可按孩子情況少量多次補水。",
  ))!;

  const linkedDiscussion = await f.chat.questionForDiscussion!(f.userId, f.childId, priorAnswer.id, true);
  assert.ok(linkedDiscussion);
  assert.equal(linkedDiscussion.discussion, true);
  assert.equal(linkedDiscussion.discussionOf, priorAnswer.id);
  assert.equal(linkedDiscussion.chatMode, "chat_only");

  const exposedToolNamesPerCall: string[][] = [];
  let modelStep = 0;
  const turns = [
    "知識觀點：發燒時每次飲幾口已經有助補水。",
    "家長觀點：晚上唔想成日叫醒佢點處理？",
    "方法比較：醒着時頻密少量給水，比強迫一次飲完更實際。",
  ];

  const discussionConfig = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: f.projectId });
  const discussionUsage = { reserve: async () => true, record: async () => {} };
  const unusedCall = async () => { throw new Error("Unexpected call"); };
  const discussionProvider: Parameters<typeof createAgentRuntime>[0]["provider"] = {
    async generate(request) {
      const promptText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
      if (promptText.includes("Please summarize the interactions concisely")) {
        return { content: { role: "model", parts: [{ text: "Three viewpoints discussed." }] }, finishReason: FinishReason.STOP };
      }
      if (promptText.includes("chat-delivery-review")) {
        const payload = JSON.parse(promptText.slice(promptText.indexOf("{")));
        assert.deepEqual(payload.discussionRoles, ["knowledge", "parent", "methods"]);
        return {
          content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [], claimedAppChanges: [] }) }] },
          finishReason: FinishReason.STOP,
        };
      }

      exposedToolNamesPerCall.push(Object.keys(request.toolsDict ?? {}));
      const stepIndex = modelStep++;
      const previous = request.contents.flatMap(c => c.parts ?? [])
        .map(p => p.functionResponse?.response?.data as { nextTurn?: string } | undefined)
        .filter(Boolean).at(-1);
      const toolName = stepIndex === 0 ? "search_knowledge"
        : stepIndex <= 3 ? discussionToolNames[stepIndex - 1]!
        : "present_answer";
      const toolArgs = stepIndex === 0
        ? { query: "兒童發燒 補水", classification: "official_guidance" }
        : stepIndex <= 3
          ? { previous: previous?.nextTurn ?? "start", kind: "caregiving", text: turns[stepIndex - 1]!, citationIds: [sampleChunk.chunkId] }
          : { kind: "caregiving", paragraphs: [{ kind: "caregiving", text: "整合三個觀點：少量多次飲水。", citationIds: [sampleChunk.chunkId] }] };
      return {
        content: { role: "model", parts: [{ functionCall: { id: "d-" + stepIndex, name: toolName, args: toolArgs } }] },
        finishReason: FinishReason.STOP,
      };
    },
  };
  const runtime = createAgentRuntime({
    config: discussionConfig,
    usage: discussionUsage,
    provider: discussionProvider,
    resolve: async () => ({
      config: discussionConfig,
      provider: discussionProvider,
      usage: { ...discussionUsage, getForUser: unusedCall },
      authorize: async () => true,
      model: { generate: unusedCall },
      embeddings: { embed: async () => [1, 0, 0] },
      runLimits: { modelCalls: 7, queryEmbeddings: 1 },
    }),
  });

  let finishSummarySeen: unknown = "uninitialized";
  const agent = createProductAgent({
    runtime,
    store: {
      ...f.store,
      finish: async (scope, result, summaryDraft) => {
        finishSummarySeen = summaryDraft;
        return f.store.finish(scope, result, summaryDraft);
      },
    },
    chat: f.chat,
    memory: f.memory,
    actions: f.actions,
    tasks: f.online.tasks,
    knowledge: createKnowledgeRetriever(
      { candidates: async () => [sampleChunk] },
      { embed: async () => [1, 0, 0] },
    ),
  });

  const result = await agent.reply(f.userId, f.childId, linkedDiscussion.id, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.equal(result.discussion?.length, 3);
  assert.equal(result.deliveryReview?.decision, "pass");
  assert.equal(finishSummarySeen, undefined, "chat_only discussion must not produce summary drafts");

  const allowedSet = new Set<string>([...CHAT_ONLY_ALLOWED_TOOL_NAMES, ...discussionToolNames, "load_capabilities"]);
  assert.ok(exposedToolNamesPerCall.length >= 5);
  for (const exposed of exposedToolNamesPerCall) {
    for (const toolName of exposed) {
      assert.ok(allowedSet.has(toolName), `Disallowed tool in chat_only discussion: ${toolName}`);
    }
    for (const forbidden of ["read_context", "propose_fact", "save_ordinary_record", "request_confirmation", "contact_caregiver"]) {
      assert.ok(!exposed.includes(forbidden), `Forbidden tool leaked into chat_only discussion: ${forbidden}`);
    }
  }
  assert.equal((await f.store.pendingProposals(f.userId, f.childId))?.proposals.length, 0);
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);
});

test("3. switching back from chat_only -> assistant blocks retroactive saves but allows explicit follow-up save", async () => {
  const f = await createCloseoutFixture();
  const policy = (await f.actions.savePolicy(f.userId, f.childId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    executionMode: "confirm_first",
    recordKinds: ["feeding"],
    allowPrivateNotes: true,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: true,
  }))!;

  const chatOnlyTurn = (await f.chat.createUserMessageForUser(f.userId, f.childId, "小晴下午飲咗 130 毫升配方奶", "chat_only"))!;
  await f.chat.createModelMessageForUser(f.userId, f.childId, chatOnlyTurn.id, "純聊天記錄供參考。");
  const unrelatedAssistant = (await f.chat.createUserMessageForUser(f.userId, f.childId, "今日天氣怎樣？", "assistant"))!;

  let firstContext: Record<string, unknown> | undefined;
  let saveStep = 0;
  const product = await createFirestoreProductAgent({
    database: f.fake.database,
    cipher: f.cipher,
    projectId: f.projectId,
    namespace: f.namespace,
    chat: f.chat,
    care: f.care,
    memory: f.memory,
    online: f.online,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: f.projectId }),
    platformProvider: {
      async generate(request) {
        const promptText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const body = JSON.parse(promptText.slice(promptText.indexOf("{")));
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
          };
        }
        if (!firstContext) {
          firstContext = parseServerContext(request as LlmRequest);
          return {
            content: { role: "model", parts: [{ functionCall: { id: "u1", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: "今日天晴暖和。", citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        }
        saveStep++;
        if (saveStep === 1) {
          return {
            content: { role: "model", parts: [{ functionCall: { id: "s1", name: "load_capabilities", args: { capabilities: ["care_records"] } } }] },
            finishReason: FinishReason.STOP,
          };
        }
        if (saveStep === 2) {
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "s2",
                  name: "save_ordinary_record",
                  args: {
                    sourceQuote: "把剛才那份記下來",
                    sourceMessages: [{ messageId: chatOnlyTurn.id, quote: chatOnlyTurn.text }],
                    expectedPolicyVersion: policy.version,
                    text: "下午飲咗 130 毫升配方奶",
                    quantityEvidence: "130 毫升",
                    details: {
                      kind: "feeding",
                      quantity: { rawValue: "130", unit: "毫升", precision: "exact" },
                      eventTime: { rawText: "下午", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
                    },
                  },
                },
              }],
            },
            finishReason: FinishReason.STOP,
          };
        }
        return {
          content: {
            role: "model",
            parts: [{ functionCall: { id: "s3", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "已為剛才那份內容建立待確認草稿。", citationIds: [] }] } } }],
          },
          finishReason: FinishReason.STOP,
        };
      },
    },
  });

  const unrelatedRes = await product.agent.reply(f.userId, f.childId, unrelatedAssistant.id, async () => true);
  assert.equal(unrelatedRes?.status, "completed");
  const topology = (firstContext?.recentConversationCoverage as { messageTopology: Array<{ id: string; chatMode?: string }> }).messageTopology;
  const byId = new Map(topology.map(item => [item.id, item.chatMode]));
  assert.equal(byId.get(chatOnlyTurn.id), "chat_only");
  assert.equal(byId.get(unrelatedAssistant.id), "assistant");
  assert.equal((await f.store.pendingProposals(f.userId, f.childId))?.proposals.length, 0);
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);

  await f.chat.createModelMessageForUser(f.userId, f.childId, unrelatedAssistant.id, "今日天晴暖和。");
  const explicitSaveTurn = (await f.chat.createUserMessageForUser(f.userId, f.childId, "把剛才那份記下來", "assistant"))!;
  const explicitRes = await product.agent.reply(f.userId, f.childId, explicitSaveTurn.id, async () => true);
  assert.equal(explicitRes?.status, "completed");

  const drafts = (await f.store.pendingProposals(f.userId, f.childId))?.proposals ?? [];
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.value.kind, "care_record_create");
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);

  const productApi = createProductAgentApi("https://synthetic.local", async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handleProductAgentRequest(new Request(url, init), f.userId, {
      agent: product.agent,
      store: f.store,
      chat: f.chat,
      isCurrentUser: async id => id === f.userId,
    });
  });
  const committed = await productApi.decideProposal(f.childId, explicitRes.runId, drafts[0]!.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: true,
  }, new AbortController().signal, f.userId);
  assert.equal(committed.status, "accepted");
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 1);
});

test("4. temporary chat isolates main store, purges on close, and is wired in both Firebase and PostgreSQL runtimes", async () => {
  const f = await createCloseoutFixture();
  const store = createTemporaryChatStore();
  try {
    const service = createTemporaryChatService({
      store,
      resolveExecution: async () => ({
        config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: f.projectId }),
        usage: { reserve: async () => true, record: async () => {} },
        authorize: async () => true,
        provider: {
          async generate(request) {
            const promptText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
            if (promptText.includes("chat-delivery-review")) {
              const body = JSON.parse(promptText.slice(promptText.indexOf("{")));
              return { content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }] }, finishReason: FinishReason.STOP };
            }
            return {
              content: { role: "model", parts: [{ functionCall: { id: "t1", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: "臨時聊天只回答公共育兒資訊。", citationIds: [] }] } } }] },
              finishReason: FinishReason.STOP,
            };
          },
        },
      }),
    });

    const badChildReq = new Request("https://synthetic.local/api/temporary-chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-expected-user-id": f.userId },
      body: JSON.stringify({ childId: f.childId }),
    });
    const badChildRes = await handleTemporaryChatRequest(badChildReq, f.userId, service, {
      isCurrentUser: async id => id === f.userId,
    });
    assert.equal(badChildRes.status, 400);

    const createdRes = await handleTemporaryChatRequest(
      new Request("https://synthetic.local/api/temporary-chat/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-expected-user-id": f.userId },
        body: "{}",
      }),
      f.userId,
      service,
      { isCurrentUser: async id => id === f.userId },
    );
    assert.equal(createdRes.status, 201);
    const createdBody = (await createdRes.json()) as { session: { sessionId: string; generation: number }; messages: unknown[] };
    assert.deepEqual(createdBody.messages, []);

    const msgRes = await handleTemporaryChatRequest(
      new Request(`https://synthetic.local/api/temporary-chat/sessions/${createdBody.session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-expected-user-id": f.userId },
        body: JSON.stringify({ text: "你好", generation: createdBody.session.generation }),
      }),
      f.userId,
      service,
      { isCurrentUser: async id => id === f.userId },
    );
    assert.equal(msgRes.status, 200);
    assert.equal((await f.chat.listForUser(f.userId, f.childId))?.messages.length, 0);
    assert.equal((await f.memory.facts(f.userId, f.childId))?.items.length, 0);

    const closeRes = await handleTemporaryChatRequest(
      new Request(`https://synthetic.local/api/temporary-chat/sessions/${createdBody.session.sessionId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-expected-user-id": f.userId },
        body: JSON.stringify({ reason: "user_exit" }),
      }),
      f.userId,
      service,
      { isCurrentUser: async id => id === f.userId },
    );
    assert.equal(closeRes.status, 200);
    const afterClose = await handleTemporaryChatRequest(
      new Request(`https://synthetic.local/api/temporary-chat/sessions/${createdBody.session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-expected-user-id": f.userId },
        body: JSON.stringify({ text: "重用舊會話", generation: 1 }),
      }),
      f.userId,
      service,
      { isCurrentUser: async id => id === f.userId },
    );
    assert.equal(afterClose.status, 410);
    assert.equal((await afterClose.json()).error.code, "temporary_session_closed");
  } finally {
    store.dispose();
  }

  for (const runtimePath of ["server/firebase-runtime.ts", "server/index.ts"]) {
    const src = readFileSync(path.join(ROOT_DIR, runtimePath), "utf8");
    assert.match(src, /createTemporaryChatStore\(/, `${runtimePath} must construct temporaryChatStore`);
    assert.match(src, /createTemporaryChatService\(/, `${runtimePath} must construct temporaryChat service`);
    assert.match(src, /\btemporaryChat\b/, `${runtimePath} must pass temporaryChat to request handler`);
    assert.match(src, /temporaryChatStore\??\.dispose\(\)/, `${runtimePath} must dispose temporaryChatStore on shutdown`);
  }
});

test("5. PLAN.md#req003-closeout01 maps all 5 PRs, all 21 §7 items, all 7 §8 decisions, and deployment/provider boundaries", () => {
  const plan = readFileSync(path.join(ROOT_DIR, "PLAN.md"), "utf8");
  const idx = plan.indexOf('<a id="req003-closeout01"></a>');
  assert.ok(idx >= 0, "Missing <a id=\"req003-closeout01\"></a> anchor in PLAN.md");
  const section = plan.slice(idx);

  for (const marker of [
    "codex/req003-auth-mode-and-draft-binding", "#690", "9d4d9b44161fcf412a0ff0ab4bfb279e92efc6e5",
    "codex/req003-unified-pending-shortcut-ui", "#691", "571bb04a6250e01461e35ce6eae8cfe1cb30c065",
    "codex/req003-main-chat-mode-switch", "#692", "c0775b280e537f2a2103d17ce24fa12a9d47aa69",
    "codex/req003-ephemeral-temporary-chat", "#693", "5013853b3548ee285d8dccc6eca0463e12ea1de8",
    "codex/req003-acceptance-closeout",
    "server/firebase-runtime.ts", "server/index.ts",
    "sticky session routing", "404 temporary_session_not_found",
    "第三方模型", "離線合成",
  ]) {
    assert.ok(section.includes(marker), `Missing marker in PLAN.md closeout section: ${marker}`);
  }

  for (let i = 1; i <= 21; i++) {
    assert.ok(section.includes(`S7-${String(i).padStart(2, "0")}`), `Missing S7 row ${i}`);
  }
  for (let i = 1; i <= 7; i++) {
    assert.ok(section.includes(`D8-0${i}`), `Missing D8 row ${i}`);
  }
});

test("6. docs/REQUIREMENTS_BACKLOG.md lines 25 and 579 sync with PLAN.md#req003-closeout01 and contain zero forbidden working codes", () => {
  const backlog = readFileSync(path.join(ROOT_DIR, "docs/REQUIREMENTS_BACKLOG.md"), "utf8");
  const lines = backlog.split(/\r?\n/);
  const row25 = lines[24] ?? "";
  const status579 = lines[578] ?? "";

  assert.match(row25, /^\| REQ-003 \|/);
  assert.ok(row25.includes("../PLAN.md#req003-closeout01"));
  assert.ok(!row25.includes("未實施"));
  assert.match(row25, /真模型/);

  assert.ok(status579.startsWith("**目前狀態：**"));
  assert.ok(status579.includes("../PLAN.md#req003-closeout01"));
  assert.ok(!status579.includes("尚未啟動本需求包工程"));
  assert.match(status579, /實機|物理手機|原生實機/);

  const worklog = readFileSync(path.join(ROOT_DIR, "WORKLOG.md"), "utf8");
  assert.ok(worklog.includes("codex/req003-acceptance-closeout"));

  const plan = readFileSync(path.join(ROOT_DIR, "PLAN.md"), "utf8");
  const planCloseout = plan.slice(plan.indexOf('<a id="req003-closeout01"></a>'));
  const worklogReq003 = worklog.slice(worklog.indexOf("### 2026-11-19　REQ-003"));
  const ciScript = readFileSync(path.join(ROOT_DIR, "scripts/ci/verify-req003-acceptance-closeout-offline.sh"), "utf8");
  const forbidden = new RegExp("\\b(?:" + ["B-P\\d+", "PR-[A-E]", "BND-\\w+", "H2-R\\d+", "N18-\\w+", "R\\d{1,2}", "Slice\\s+B"].join("|") + ")\\b");

  for (const [label, text] of [
    ["PLAN#req003-closeout01", planCloseout],
    ["WORKLOG(REQ-003)", worklogReq003],
    ["BACKLOG row 25", row25],
    ["BACKLOG line 579", status579],
    ["CI closeout script", ciScript],
  ] as const) {
    assert.equal(forbidden.test(text), false, `Forbidden working code leaked into ${label}`);
  }
});
