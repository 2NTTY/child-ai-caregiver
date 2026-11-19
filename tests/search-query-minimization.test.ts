import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { FinishReason } from "@google/genai";
import { AgentBudget } from "../server/agent-budget.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import { FamilyError } from "../server/family-access.ts";
import {
  assertPublicKnowledgeQuery,
  findExternalQueryPrivacyViolation,
} from "../server/knowledge-query-minimization.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import type { KnowledgeCandidate, KnowledgeFilter } from "../src/shared/knowledge.ts";

const vector = [1, ...Array<number>(1023).fill(0)];
const childId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const scope = {
  userId: "synthetic-user",
  childId,
  workspaceId: "synthetic-workspace",
  authorizationVersion: "1",
  dataVersion: "1",
};
const baseFilter: KnowledgeFilter = {
  region: "HK",
  classification: "official_guidance",
  age: null,
  topics: [],
};

function createTestBudget(t: TestContext): AgentBudget {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  return budget;
}

function syntheticCandidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    chunkId: "44444444-4444-4444-8444-444444444444",
    distance: 0.1,
    key: "synthetic-fever",
    section: "Synthetic pediatric fever care",
    sourceExcerpt: "Synthetic official excerpt covering 6-12 month infants in Hong Kong.",
    text: "合成指引：6個月大嬰兒發燒應留意精神狀態及適時求醫，不作診斷或處方。",
    keywords: ["發燒", "6個月"],
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 0, maxAgeMonths: 12, topics: ["fever"], conditions: [] },
    sourceId: "synthetic-dh-source",
    versionId: "55555555-5555-4555-8555-555555555555",
    versionHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    url: "https://www.fhs.gov.hk/synthetic-fever",
    title: "Synthetic Official Child Care Reference",
    publisher: "Synthetic Health Department",
    classification: "official_guidance",
    sourcePublishedAt: null,
    sourceUpdatedAt: null,
    sourceDateText: null,
    validUntil: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    checkedAt: "2026-01-01T00:00:00Z",
    reviewState: "reviewed",
    ...overrides,
  };
}

test("blocks exact numeric and Chinese/punctuated birth dates while allowing age brackets and symptom durations", () => {
  const blockedBirthDates = [
    "2025-03-14 BB發燒",
    "2025年3月14日 BB發燒",
    "2025 年 03 月 14 號 加固原則",
    "２０２５年３月１４日 幼兒飲食",
    "14/3/2025 嬰兒吐奶",
    "2025/3/4 嬰兒體溫",
    "2025.03.14 咳嗽",
    "14 March 2025 feeding guidance",
    "March 14, 2025 infant sleep",
    "出生日期：2025年3月 發燒",
    "生於2024年11月 幼兒發展",
  ];
  for (const query of blockedBirthDates) {
    assert.throws(
      () => assertPublicKnowledgeQuery(query),
      error => error instanceof FamilyError && error.code === "public_query_required",
      `Expected birth date rejection for: ${query}`,
    );
  }

  const allowedQueries = [
    "6個月大嬰兒加固原則 沙田區",
    "18個月幼兒語言發展遊戲 香港",
    "4歲半兒童手眼協調及專注力評估 新界",
    "6-12 months solid food introduction",
    "BB持續發燒3日 37.3度",
    "BB 37.5 38.5 39 度 發燒",
    "2024-2025 疫苗",
    "2025年香港嬰幼兒流感疫苗接種建議",
    "BB 每日飲奶 180ml 5次 持續2星期",
  ];
  for (const query of allowedQueries) {
    assert.equal(findExternalQueryPrivacyViolation(query), null, `Unexpected rejection for: ${query}`);
    assert.equal(assertPublicKnowledgeQuery(query), query);
  }
});

test("blocks Hong Kong street, estate-block and flat addresses while retaining coarse districts and public facilities", () => {
  const blockedAddresses = [
    "沙田瀝源邨福海樓 6個月BB發燒",
    "瀝源邨福海樓12樓C室 幼兒護理",
    "旺角彌敦道123號 母嬰健康院",
    "太古城海天閣 嬰兒飲食",
    "黃埔花園翠楊苑3座2樓B室 幼兒睡覺",
    "123 Nathan Road 6 month infant fever",
    "Flat A, 12/F, Block 3 toddler development",
    "地址：大埔區廣福邨 發燒",
    "屋企住沙田第一城 6個月加固",
    "12樓C 6個月BB發燒",
    "12樓C座 6個月BB發燒",
    "C座12樓 幼兒護理",
    "住喺麗港城 6個月BB發燒",
    "住喺海怡半島 幼兒護理",
    "住喺青山公路 6個月BB發燒",
    "Rm 2 of Block 3 幼兒護理",
    "Rm 2 of BLOCK 3",
    "Rm 2 of BLK 3",
    "Rm 2 of TOWER 3",
    "Rm 2 of PHASE 2",
    "fLaT A",
    "uNiT 3",
  ];
  for (const query of blockedAddresses) {
    assert.equal(findExternalQueryPrivacyViolation(query), "street_or_home_address", `Expected address block for: ${query}`);
  }

  const allowedDistrictAndFacilityQueries = [
    "沙田區 6個月嬰兒發燒",
    "九龍城區 6個月嬰兒發燒",
    "油尖旺區 母嬰健康院時間",
    "大埔區 兒童體能智力測驗中心評估",
    "香港 急症室 幼兒高燒抽筋處理",
    "新界區 育嬰室 及 母乳講座",
    "住喺沙田區 6個月BB打針",
    "住喺沙田6個月BB打針",
    "住喺沙田區6個月BB打針",
    "住在香港 疫苗",
    "家住新界 BB 疫苗",
    "屋企住沙田區 健康院",
    "BB喺屋企住3日",
    "喺屋企住3日 發燒點算",
    "屋企住咗2星期隔離",
    "家住3日發燒",
    "住在1歲",
    "住在2樓 醫院",
    "住喺1號風球",
    "住喺唔知道點算",
    "住喺高速公路附近",
    "住喺快速公路附近",
    "住喺高速路附近",
    "住喺快速路附近",
    "屋企喺花園附近有冇母嬰健康院",
    "住喺花園",
    "住喺中環街市",
    "Block feeding breastfeeding",
    "Room temperature formula milk",
    "Floor time play baby",
    "Unit dose paracetamol infant",
    "Tower of blocks toddler milestone",
    "flat head syndrome baby",
    "Flat head 扁頭症",
    "Flat feet toddler",
    "Room 1",
    "Block 3 playground",
    "Apt 2 months",
    "Apt 2 WEEKS",
    "Unit 2 MONTHS",
    "UNIT 2 MONTHS",
    "Unit 2 vaccine schedule",
    "Unit 2 VACCINE schedule",
    "Unit 2 MCG",
    "Unit 2 DOSES",
    "Rm 2 of cough",
    "Rm 2 OF cough",
    "Rm 2 Of cough",
    "3樓",
    "1樓 兒科 門診",
    "屯門醫院兒科病房 5樓",
    "大城市BB上落樓梯",
  ];
  for (const query of allowedDistrictAndFacilityQueries) {
    assert.equal(findExternalQueryPrivacyViolation(query), null, `Unexpected address block for: ${query}`);
  }
});

test("blocks explicit names, contacts, raw transcripts and loaded household child names without false-positive blocking generic BB or ingredients", async t => {
  const blockedIdentityQueries = [
    "姓名：陳大文 6個月嬰兒發燒",
    "身份證：A123456(7) 兒童福利",
    "病歷號：987654 BB覆診",
    "我個仔叫陳小明 持續發燒3日",
    "我個仔叫陳小明持續發燒3日",
    "BB叫張保仔 加固食物",
    "BB叫張保仔加固食物",
    "BB叫張保仔發燒",
    "6個月BB叫張保仔發燒",
    "BB 叫張保仔 加固食物",
    "BB名叫張保仔 發燒",
    "我叫做陳小明 BB發燒",
    "BB叫做Jason 發燒",
    "陳先生 6個月BB睡覺問題",
    "Mrs Chan 6 months solid food",
    "parent@example.com 6個月發燒",
    "https://private.example.com/record/123 濕疹",
    "WhatsApp: +852 9123 4567 BB嘔奶",
    "Telegram @parent_private 濕疹處理",
    "Line ID: chan123 BB濕疹",
    "IG: @chan_parent 嬰兒飲奶",
    "IG: mother_hk 嬰兒飲奶",
    "Signal: hello_user 濕疹",
    "家長：我個BB發燒點算\n助手：請提供更多資料",
  ];
  for (const query of blockedIdentityQueries) {
    assert.throws(
      () => assertPublicKnowledgeQuery(query),
      error => error instanceof FamilyError && error.code === "public_query_required",
      `Expected identity/contact rejection for: ${query}`,
    );
  }

  const allowedCareAndColloquialQueries = [
    "陳皮煲湯 嬰兒飲食",
    "6個月大BB 輕微濕疹護理 香港",
    "BB叫唔停點算",
    "BB 叫唔停",
    "寶寶叫媽媽",
    "BB叫媽媽係幾多個月",
    "孩子叫唔醒 發燒",
    "寶寶叫唔停 夜晚",
    "我個仔叫極都唔應",
    "我叫咗白車",
    "孩子叫痛 肚痛",
    "BB叫痛",
    "我叫做啲咩好",
    "我名叫咩名好",
    "BB名叫唔出嚟",
    "BB叫做乜好",
    "BB叫幾聲 發燒",
    "BB叫發燒點算",
    "BB叫咳嗽",
    "BB叫嘔吐",
    "孩子叫黃疸",
    "BB叫肺炎",
    "BB叫感冒",
    "BB叫開飯",
    "寶寶叫喝奶",
    "BB叫奶粉",
    "BB叫陳皮煲湯得唔得",
    "孩子叫退燒",
    "BB叫鼻敏感",
    "BB叫哮喘",
    "BB叫腸胃炎",
    "BB叫手足口",
    "BB叫中耳炎",
    "BB叫過敏",
    "BB叫開燈",
    "BB叫開窗",
    "BB叫疫苗",
    "BB叫加固",
    "BB叫打針",
    "BB叫飲茶",
    "BB叫水痘",
    "BB叫麻疹",
    "BB叫腮腺炎",
    "BB叫結膜炎",
    "BB叫熱痱",
    "BB叫尿布疹",
    "BB叫支氣管炎",
    "BB叫口腔潰瘍",
    "BB叫鼻鼾",
    "BB叫流汗",
    "BB叫大人",
    "護照 BB 坐飛機 幾多個月",
    "身份證 BB 幾時申請",
    "聯絡人 學校",
    "BB姓名 改名",
    "Line: 嬰兒",
    "IG: 衞生署",
    "line 1234 疫苗",
    "Signal 1234",
    "@ 嬰兒",
    "First line: infant fever",
    "媽媽：BB發燒點算",
    "家長: 6個月BB發燒",
    "爸爸: 點樣沖奶",
    "planning BB annual check",
    "BB 喺 Annex 跌親",
  ];
  for (const query of allowedCareAndColloquialQueries) {
    assert.equal(findExternalQueryPrivacyViolation(query, ["BB", "寶寶", "Ann"]), null, `Unexpected rejection for: ${query}`);
  }
  assert.equal(findExternalQueryPrivacyViolation("Ann 6個月發燒", ["Ann"]), "personal_name_or_transcript");

  // Known non-generic child names loaded during the run via selected-care/summary tools must also be blocked if echoed.
  const budget = createTestBudget(t);
  let embedCalls = 0;
  let storeCalls = 0;
  const gateway = createEmbeddingGateway({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { embed: async () => { embedCalls++; return { values: vector, inputTokens: 3, billableCharacters: 9 }; } },
  });
  const knowledge = createKnowledgeRetriever({
    candidates: async () => { storeCalls++; return [syntheticCandidate()]; },
  }, gateway);
  const baseOptions = {
    run: { scope, runId, budget },
    authorize: async () => true,
    memory: {
      context: async () => ({
        profile: { childId, version: 1, data: { age: { kind: "approximate", rawValue: "6", unit: "months", asOf: "2026-01-01" }, dueDate: null, gestationalWeeksRaw: null, region: "HK", language: "zh-HK", allergies: null, specialNeeds: null, preferences: null, source: "test", validUntil: null } },
        profileApplicable: true, facts: [], topics: [], summary: null, recentMessages: [],
        conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false },
      }),
    } as unknown as Parameters<typeof createProductAgentTools>[0]["memory"],
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: { readHistory: async () => null } as unknown as Parameters<typeof createProductAgentTools>[0]["store"],
    knowledge,
  };
  const multiSurface = createProductAgentTools({
    ...baseOptions,
    mixedTasks: async () => ({
      children: [{ childId, childName: "李小花", tasks: [], nextCursor: null }],
      nextFrom: null,
    }),
    mixedCare: async () => ({
      children: [{
        childId, childName: "陳大文", records: [], scanned: 0, undatedMatches: 0, nextCursor: null,
      }],
      nextFrom: null,
    }),
  });

  const careTool = multiSurface.tools.find(item => item.name === "search_selected_care")!;
  const readResult = await careTool.execute({ filters: {} }, { scope, runId, callId: "c-care", signal: budget.signal });
  assert.equal(readResult.status, "succeeded");

  const tasksTool = multiSurface.tools.find(item => item.name === "read_selected_tasks")!;
  const tasksResult = await tasksTool.execute({ from: 0 }, { scope, runId, callId: "c-tasks", signal: budget.signal });
  assert.equal(tasksResult.status, "succeeded");

  const multiSearchTool = multiSurface.tools.find(item => item.name === "search_knowledge")!;
  for (const loadedName of ["陳大文", "李小花"]) {
    const leaked = await multiSearchTool.execute(
      { query: `${loadedName} 6個月 發燒3日`, classification: "official_guidance" },
      { scope, runId, callId: `c-leak-${loadedName}`, signal: budget.signal },
    );
    assert.equal(leaked.status, "rejected");
    assert.equal(leaked.data?.code, "public_query_required");
  }

  const summarySurface = createProductAgentTools({
    ...baseOptions,
    summary: {
      get: async () => ({
        childId, childName: "張保仔", profile: null, period: "day", endDayExclusive: "2026-01-02",
        generatedAt: "2026-01-01T00:00:00Z", basisVersion: "1", counts: {}, metrics: {}, missing: [],
        records: [], appointments: [], conflicts: [], preparation: null, reviewCurrent: true,
      }),
    } as unknown as Parameters<typeof createProductAgentTools>[0]["summary"],
  });
  const summaryTool = summarySurface.tools.find(item => item.name === "read_care_summary")!;
  const summaryResult = await summaryTool.execute(
    { startDay: "2026-01-01", period: "day", timeZone: "Asia/Hong_Kong" },
    { scope, runId, callId: "c-summary", signal: budget.signal },
  );
  assert.equal(summaryResult.status, "succeeded");
  const summarySearchTool = summarySurface.tools.find(item => item.name === "search_knowledge")!;
  const summaryLeaked = await summarySearchTool.execute(
    { query: "張保仔 6個月 發燒3日", classification: "official_guidance" },
    { scope, runId, callId: "c-leak-summary", signal: budget.signal },
  );
  assert.equal(summaryLeaked.status, "rejected");
  assert.equal(summaryLeaked.data?.code, "public_query_required");

  assert.equal(embedCalls, 0);
  assert.equal(storeCalls, 0);
});

test("runtime enforces external query minimization and retries with clean terms without clearing internal memory or invoking an extra classifier LLM", async t => {
  const budget = createTestBudget(t);
  let modelCalls = 0;
  let embedCalls = 0;
  let storeQueries: string[] = [];
  const candidate = syntheticCandidate();
  const gateway = createEmbeddingGateway({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      embed: async input => {
        embedCalls++;
        storeQueries.push(input.text);
        return { values: vector, inputTokens: 5, billableCharacters: input.text.length };
      },
    },
  });
  const knowledge = createKnowledgeRetriever({
    candidates: async (_filter, _vector, searchOptions) => {
      if (searchOptions?.query) storeQueries.push(searchOptions.query);
      return [candidate];
    },
  }, gateway);

  const memoryFacts = [{
    id: "fact-1", childId, visibility: "private" as const, intendedVisibility: "private" as const,
    status: "confirmed" as const, version: 1, createdBy: "synthetic-user", confirmedBy: "synthetic-user",
    confirmedAt: "2026-01-01T00:00:00Z", reason: "confirmed", applicable: true, sourceState: "current" as const,
    key: "allergy", content: "BB 對花生過敏", source: { kind: "manual" as const, description: "parent" }, validUntil: null,
  }];

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        modelCalls++;
        if (modelCalls === 1) {
          return {
            finishReason: FinishReason.STOP,
            content: { role: "model", parts: [{ functionCall: {
              id: "call-1", name: "search_knowledge",
              args: { query: "陳大文 2025年3月14日 沙田瀝源邨福海樓 持續發燒3日", classification: "official_guidance" },
            } }] },
          };
        }
        const toolResponse = request.contents.flatMap(c => c.parts ?? []).find(p => p.functionResponse?.name === "search_knowledge");
        if (modelCalls === 2) {
          assert.equal((toolResponse?.functionResponse?.response as { status?: string; data?: { code?: string; nextAction?: string } })?.status, "rejected");
          assert.equal((toolResponse?.functionResponse?.response as { data?: { code?: string } })?.data?.code, "public_query_required");
          assert.equal((toolResponse?.functionResponse?.response as { data?: { nextAction?: string } })?.data?.nextAction, "search_knowledge");
          return {
            finishReason: FinishReason.STOP,
            content: { role: "model", parts: [{ functionCall: {
              id: "call-2", name: "search_knowledge",
              args: { query: "6個月大嬰兒 持續發燒3日 沙田區", classification: "official_guidance" },
            } }] },
          };
        }
        return {
          finishReason: FinishReason.STOP,
          content: { role: "model", parts: [{ functionCall: {
            id: "call-3", name: "present_answer",
            args: {
              kind: "caregiving",
              paragraphs: [{ text: "6個月大嬰兒持續發燒3日須密切觀察並適時求醫。", citationIds: [candidate.chunkId] }],
            },
          } }] },
        };
      },
    },
  });

  let readContextFacts = 0;
  let toolsSurface: ReturnType<typeof createProductAgentTools> | undefined;
  const result = await runtime.run({
    scope,
    runId,
    recipeId: "product-interactive",
    trigger: { kind: "interactive", reference: "msg-1" },
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    messages: [{ role: "user", text: "我叫陳大文，BB於2025年3月14日出生，住沙田瀝源邨福海樓，電話91234567。想問BB持續發燒3日點算？" }],
    authorize: async () => true,
    tools: runContext => {
      toolsSurface = createProductAgentTools({
        run: runContext,
        authorize: async () => true,
        knownPrivateIdentifiers: ["陳大文"],
        memory: {
          context: async () => {
            readContextFacts = memoryFacts.length;
            return {
              profile: { childId, version: 1, data: { age: { kind: "approximate", rawValue: "6", unit: "months", asOf: "2026-01-01" }, dueDate: null, gestationalWeeksRaw: null, region: "香港", language: "zh-HK", allergies: "花生", specialNeeds: null, preferences: null, source: "test", validUntil: null } },
              profileApplicable: true, facts: memoryFacts, topics: [], summary: null, recentMessages: [],
              conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false },
            };
          },
          prepareSummary: async () => null,
        } as unknown as Parameters<typeof createProductAgentTools>[0]["memory"],
        tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
        store: { readHistory: async () => null } as unknown as Parameters<typeof createProductAgentTools>[0]["store"],
        knowledge,
      });
      return toolsSurface.tools;
    },
    finalize: async () => (await toolsSurface!.presentation())?.text ?? null,
  });

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(modelCalls, 3);
  assert.equal(embedCalls, 1);
  assert.deepEqual(storeQueries, ["6個月大嬰兒 持續發燒3日 沙田區", "6個月大嬰兒 持續發燒3日 沙田區"]);
  assert.equal(readContextFacts, 1);
  assert.equal(memoryFacts.length, 1);
  assert.equal(memoryFacts[0]!.content, "BB 對花生過敏");
});

test("enforces the same outbound boundary directly on createKnowledgeRetriever and under family visibility", async t => {
  const budget = createTestBudget(t);
  let embedCalls = 0;
  let storeCalls = 0;
  const gateway = createEmbeddingGateway({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { embed: async () => { embedCalls++; return { values: vector, inputTokens: 3, billableCharacters: 9 }; } },
  });
  const knowledge = createKnowledgeRetriever({
    candidates: async () => { storeCalls++; return [syntheticCandidate()]; },
  }, gateway);

  // Direct retriever call bypasses product-agent-tools yet still rejects before debiting embedding quota.
  const directRun = knowledge.createRun({
    actor: { kind: "query_embedding", actorId: "synthetic-user", operationId: runId },
    budget,
    authorize: async () => true,
  });
  await assert.rejects(
    directRun.search("2025年3月14日 沙田瀝源邨福海樓 發燒", baseFilter),
    error => error instanceof FamilyError && error.code === "public_query_required",
  );
  assert.equal(embedCalls, 0);
  assert.equal(storeCalls, 0);
  assert.equal(budget.counts.queryEmbeddings, 0);

  // Shared family visibility (`visibility: "family"` without private profile leakage) enforces the exact same outbound guard.
  const familyTools = createProductAgentTools({
    run: { scope, runId, budget },
    visibility: "family",
    authorize: async () => true,
    memory: {
      context: async () => ({
        profile: { childId, version: 0, data: null },
        profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [],
        conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false },
      }),
    } as unknown as Parameters<typeof createProductAgentTools>[0]["memory"],
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: { readHistory: async () => null } as unknown as Parameters<typeof createProductAgentTools>[0]["store"],
    knowledge,
  });
  const searchTool = familyTools.tools.find(item => item.name === "search_knowledge")!;
  const blocked = await searchTool.execute(
    { query: "姓張叫保仔 生於2025年3月 沙田區發燒", classification: "official_guidance" },
    { scope, runId, callId: "c-fam-block", signal: budget.signal },
  );
  assert.equal(blocked.status, "rejected");
  assert.equal(blocked.data?.code, "public_query_required");
  assert.equal(embedCalls, 0);
  assert.equal(storeCalls, 0);

  const allowed = await searchTool.execute(
    { query: "6個月嬰兒 發燒3日 香港", classification: "official_guidance" },
    { scope, runId, callId: "c-fam-ok", signal: budget.signal },
  );
  assert.equal(allowed.status, "succeeded");
  assert.equal(embedCalls, 1);
  assert.equal(storeCalls, 1);
});

test("allows English symptom predicates while rejecting explicit and loaded names", () => {
  for (const query of [
    "my baby is sick", "my child is coughing", "my daughter is allergic to peanuts",
    "MY BABY IS SICK", "My son is Sleeping poorly",
  ]) {
    assert.equal(findExternalQueryPrivacyViolation(query), null, query);
    assert.equal(assertPublicKnowledgeQuery(query), query);
  }
  for (const query of [
    "my name is alice", "MY NAME IS ALICE", "my child's name is Alice",
    "my son's name is bob", "My daughter’s name is Alice", "my baby's name is Anne",
  ]) {
    assert.equal(findExternalQueryPrivacyViolation(query), "personal_name_or_transcript", query);
  }
  assert.equal(findExternalQueryPrivacyViolation("my child is Alice", ["Alice"]), "personal_name_or_transcript");
});

test("rejects regrouped phone digits without joining decimal readings", () => {
  for (const query of [
    "電話 912-345-67 BB 發燒", "電話 9 1 2 3 4 5 6 7", "912 34 567 infant fever",
    "電話 ９１２－３４５－６７", "電話 9123 4567", "+852 912 345 67",
    "phone 912-345-67.",
  ]) {
    assert.equal(findExternalQueryPrivacyViolation(query), "numeric_identifier", query);
    assert.throws(() => assertPublicKnowledgeQuery(query), error =>
      error instanceof FamilyError && error.code === "public_query_required");
  }
  for (const query of ["BB 37.5 38.5 39 度 發燒", "2024-2025 guideline", "6-12 months feeding"]) {
    assert.equal(findExternalQueryPrivacyViolation(query), null, query);
  }
});


test("retains care measurement sequences without exempting adjacent contact details", () => {
  const careQueries = [
    "BB 每餐奶量 120 150 180 ml 是否正常",
    "嬰兒奶量 90 120 150 ml",
    "兒童生長百分位 3 10 25 50 75 90 97",
  ];
  for (const query of careQueries) {
    assert.equal(findExternalQueryPrivacyViolation(query), null, query);
    assert.equal(findExternalQueryPrivacyViolation(query + "，電話 9 1 2 3 4 5 6 7"), "numeric_identifier", query);
    assert.equal(findExternalQueryPrivacyViolation(query + "，912-345-67"), "numeric_identifier", query);
  }
});

test("rejects identifying search text before embedding in a child-scoped run with empty fixture context", async t => {
  const budget = createTestBudget(t);
  let runtimeBudget: AgentBudget | undefined;
  let modelCalls = 0;
  let embeddingReservations = 0;
  let embeddingRecords = 0;
  let contextReads = 0;
  let embedCalls = 0;
  let storeSearchCalls = 0;
  let citationRevalidationCalls = 0;
  let readFactsCalls = 0;
  let readHistoryCalls = 0;
  const storeQueries: string[] = [];
  let factProposals = 0;
  const candidate = syntheticCandidate();

  const gateway = createEmbeddingGateway({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: {
      reserve: async () => { embeddingReservations++; return true; },
      record: async () => { embeddingRecords++; },
    },
    provider: {
      embed: async input => {
        embedCalls++;
        storeQueries.push(input.text);
        return { values: vector, inputTokens: 5, billableCharacters: input.text.length };
      },
    },
  });
  const knowledge = createKnowledgeRetriever({
    candidates: async (_filter, _vector, searchOptions) => {
      if (searchOptions?.chunkIds) citationRevalidationCalls++;
      else storeSearchCalls++;
      if (searchOptions?.query) storeQueries.push(searchOptions.query);
      return [candidate];
    },
  }, gateway);

  // This is an ordinary child-scoped run. Only the injected context is empty;
  // this fixture does not implement a temporary session or storage lifecycle.
  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        modelCalls++;
        if (modelCalls === 1) {
          return {
            finishReason: FinishReason.STOP,
            content: { role: "model", parts: [{ functionCall: {
              id: "call-scratch-1", name: "search_knowledge",
              args: { query: "我叫陳大文 BB於2025年3月14日出生 住沙田瀝源邨福海樓 電話91234567 發燒3日", classification: "official_guidance" },
            } }] },
          };
        }
        const toolResponses = request.contents.flatMap(c => c.parts ?? []).filter(p => p.functionResponse?.name === "search_knowledge");
        const lastResponse = toolResponses.at(-1)?.functionResponse?.response as { status?: string; data?: { code?: string; nextAction?: string } } | undefined;
        if (modelCalls === 2) {
          assert.equal(lastResponse?.status, "rejected");
          assert.equal(lastResponse?.data?.code, "public_query_required");
          assert.equal(lastResponse?.data?.nextAction, "search_knowledge");
          assert.equal(runtimeBudget?.counts.queryEmbeddings, 0);
          assert.equal(embeddingReservations, 0);
          assert.equal(embeddingRecords, 0);
          assert.equal(embedCalls, 0);
          assert.equal(storeSearchCalls, 0);
          assert.equal(citationRevalidationCalls, 0);
          return {
            finishReason: FinishReason.STOP,
            content: { role: "model", parts: [{ functionCall: {
              id: "call-scratch-2", name: "search_knowledge",
              args: { query: "6個月大嬰兒 發燒3日 沙田區", classification: "official_guidance" },
            } }] },
          };
        }
        return {
          finishReason: FinishReason.STOP,
          content: { role: "model", parts: [{ functionCall: {
            id: "call-scratch-3", name: "present_answer",
            args: {
              kind: "caregiving",
              paragraphs: [{ text: "6個月大嬰兒發燒應留意精神狀態及適時求醫。", citationIds: [candidate.chunkId] }],
            },
          } }] },
        };
      },
    },
  });

  let toolsSurface: ReturnType<typeof createProductAgentTools> | undefined;
  const result = await runtime.run({
    scope,
    runId,
    recipeId: "product-interactive",
    trigger: { kind: "interactive", reference: "msg-scratch-1" },
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    messages: [{ role: "user", text: "我叫陳大文，BB於2025年3月14日出生，住沙田瀝源邨福海樓，電話91234567。請問6個月大BB發燒3日點算？" }],
    authorize: async () => true,
    tools: runContext => {
      runtimeBudget = runContext.budget;
      toolsSurface = createProductAgentTools({
        run: runContext,
        authorize: async () => true,
        memory: {
          context: async (_userId: string, requestedChildId: string) => {
            contextReads++;
            assert.equal(requestedChildId, childId);
            return {
              profile: { childId, version: 0, data: null },
              profileApplicable: false,
              facts: [],
              topics: [],
              summary: null,
              recentMessages: [],
              conflictingKeys: [],
              unavailableFactKeys: [],
              truncated: { facts: false, topics: false, messages: false },
            };
          },
          facts: async () => { readFactsCalls++; return { items: [], nextAfterId: null }; },
          prepareSummary: async () => null,
          proposeFact: async () => { factProposals++; return {}; },
        } as unknown as Parameters<typeof createProductAgentTools>[0]["memory"],
        tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
        store: {
          readHistory: async () => { readHistoryCalls++; return null; },
        } as unknown as Parameters<typeof createProductAgentTools>[0]["store"],
        knowledge,
      });
      return toolsSurface.tools;
    },
    finalize: async (_result, runContext) => {
      // The clean retry spent one unit; the English rejection must not spend another.
      assert.equal(runContext.budget.counts.queryEmbeddings, 1);
      const tool = toolsSurface!.tools.find(item => item.name === "search_knowledge")!;
      const blocked = await tool.execute(
        { query: "my child's name is Leo phone 9123-4567 cough", classification: "official_guidance" },
        { scope, runId, callId: "c-scratch-en-block", signal: runContext.budget.signal },
      );
      assert.equal(blocked.status, "rejected");
      assert.equal(blocked.data?.code, "public_query_required");
      assert.equal(runContext.budget.counts.queryEmbeddings, 1);
      return (await toolsSurface!.presentation())?.text ?? null;
    },
  });

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(modelCalls, 3);
  assert.ok(contextReads > 0, "the clean query consults the empty child-scoped context stub");
  assert.equal(result.counts.queryEmbeddings, 1);
  assert.equal(embeddingReservations, 1);
  assert.equal(embeddingRecords, 1);
  assert.equal(embedCalls, 1);
  assert.equal(storeSearchCalls, 1);
  assert.equal(citationRevalidationCalls, 1);
  assert.equal(readFactsCalls, 0);
  assert.equal(readHistoryCalls, 0);
  assert.equal(factProposals, 0);
  assert.deepEqual(storeQueries, ["6個月大嬰兒 發燒3日 沙田區", "6個月大嬰兒 發燒3日 沙田區"]);

  // The direct retriever uses a fresh in-memory budget, independent of the runtime.
  const scratchRun = knowledge.createRun({
    actor: { kind: "query_embedding", actorId: "synthetic-scratch-user", operationId: runId },
    budget,
    authorize: async () => true,
  });
  await assert.rejects(
    scratchRun.search("陳先生 14 March 2025 Flat A 12/F 咳嗽", baseFilter),
    error => error instanceof FamilyError && error.code === "public_query_required",
  );
  assert.equal(budget.counts.queryEmbeddings, 0);
  assert.equal(embeddingReservations, 1);
  assert.equal(embeddingRecords, 1);
  assert.equal(embedCalls, 1);
  assert.equal(storeSearchCalls, 1);
  assert.equal(citationRevalidationCalls, 1);
});
