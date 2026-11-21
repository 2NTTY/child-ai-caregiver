import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { AgentBudget } from "../server/agent-budget.ts";
import { createAgentRuntime, type AgentRunContext } from "../server/agent-runtime.ts";
import type { AgentModelProvider } from "../server/agent-model-gateway.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { FamilyDocumentStore } from "../server/family-document-store.ts";
import { createProductAgent } from "../server/product-agent.ts";
import {
  createSpecialistArtifactTools,
  runSpecialistArtifactLoop,
  SPECIALIST_ARTIFACT_TOOL_NAME,
} from "../server/specialist-artifact-agent.ts";
import {
  buildFamilyArtifactHtml,
  buildFamilyArtifactPdf,
  createSharpVisualArtifactVerifier,
  inspectHtmlArtifactIsolated,
  inspectPdfArtifactIsolated,
} from "../server/specialist-artifact-renderer.ts";
import { projectDocumentExport } from "../src/shared/document-export-view.ts";
import type { DocumentSnapshot, FamilyDocument } from "../src/shared/family-documents.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";
import {
  PIXEL_SCREENSHOT_UNVERIFIED_CHECK,
  SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS,
  SPECIALIST_ARTIFACT_POLICY_VERSION,
} from "../src/shared/specialist-artifact.ts";

const userId = "parent-user";
const childId = "11111111-1111-4111-8111-111111111111";
const documentId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";
const runId = "22222222-2222-4222-8222-222222222222";
const messageRef = "55555555-5555-4555-8555-555555555555";
const authorityVersion = "epoch:12";

const baseScope = {
  userId,
  workspaceId: "workspace-1",
  childId,
  authorizationVersion: "1",
  dataVersion: "epoch:1",
};

function makeSnapshot(overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return {
    id: snapshotId,
    version: 3,
    generatedAt: "2026-10-14T00:00:00.000Z",
    sourceBasis: "synthetic",
    title: "兒科覆診準備單",
    summary: "整理過去兩週體溫紀錄、飲食習慣與門診提問。",
    ageLabel: "2歲3個月",
    period: { from: "2026-10-01", to: "2026-10-14" },
    eventDate: "2026-10-20",
    coverageNote: "僅包含已確認家庭紀錄與門診準備項目。",
    sections: [
      {
        id: "checklist",
        title: "隨行物品核對表",
        kind: "checklist",
        domain: null,
        items: [
          { id: "bottle", text: "保溫水壺及常用吸管杯", sourceIds: [], checked: true },
          { id: "card", text: "過敏紀錄卡與覆診轉介信", sourceIds: [], checked: false },
        ],
      },
      {
        id: "questions",
        title: "醫生問診重點",
        kind: "questions",
        domain: "concerns",
        items: [
          { id: "q1", text: "晚間偶爾乾咳持續四天應如何觀察", sourceIds: [] },
        ],
      },
    ],
    sources: [
      {
        id: "src-1",
        resourceId: "rec-1",
        kind: "record",
        version: 2,
        label: "家庭日常紀錄",
        text: "連續三晚睡前喝奶後出現輕微咳嗽。",
        at: "2026-10-12T21:00:00.000Z",
      },
    ],
    changes: ["新增門診咳嗽觀察提問"],
    ...overrides,
  };
}

function makeFamilyDocument(snapshot = makeSnapshot(), overrides: Partial<FamilyDocument> = {}): FamilyDocument {
  return {
    id: documentId,
    childId,
    kind: "preparation",
    purpose: "appointment",
    version: 3,
    status: "active",
    archivedAt: null,
    current: snapshot,
    history: [],
    readState: "ready",
    autoRefresh: false,
    ...overrides,
  };
}

function createFakeDocumentStore(doc: FamilyDocument | null, authVersion = authorityVersion) {
  let mutationCalls = 0;
  const store = {
    describe: async () => (doc ? { item: doc, authorityVersion: authVersion } : null),
    create: async () => { mutationCalls += 1; throw new Error("unexpected_mutation"); },
    change: async () => { mutationCalls += 1; throw new Error("unexpected_mutation"); },
  } as unknown as FamilyDocumentStore;
  return {
    store,
    getMutationCalls: () => mutationCalls,
  };
}

function createBudgetedContext(maxToolCalls = 8, signal?: AbortSignal): { budget: AgentBudget; run: AgentRunContext } {
  const budget = new AgentBudget(signal);
  budget.configurePersonal({ modelCalls: 4, queryEmbeddings: 2, toolCalls: maxToolCalls });
  const run = {
    runId,
    scope: { ...baseScope },
    budget,
    authorize: async () => true,
  } as unknown as AgentRunContext;
  return { budget, run };
}

test("1. zero-network A4 PDF build and isolated worker verification extracts Traditional Chinese text cleanly", async () => {
  const { budget, run } = createBudgetedContext();
  const { store, getMutationCalls } = createFakeDocumentStore(makeFamilyDocument());
  try {
    const outcome = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "請整理兒科覆診準備單PDF草稿預覽",
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "整理兒科覆診準備單PDF草稿",
        intent: "建立覆診列印PDF預覽並核對排版",
        includeRevision: true,
        includeSources: true,
      },
    });
    assert.equal(outcome.result.policyVersion, SPECIALIST_ARTIFACT_POLICY_VERSION);
    assert.equal(outcome.result.status, "partial");
    assert.equal(outcome.result.stopReason, "verification_incomplete");
    assert.equal(outcome.result.repairIterations, 0);
    assert.equal(outcome.result.formalSave, false);
    assert.equal(outcome.result.published, false);
    assert.equal(outcome.result.requiresFormalConfirmation, true);
    assert.ok(outcome.bytes && outcome.bytes.byteLength > 200);
    assert.ok(outcome.result.artifact);
    assert.equal(outcome.result.artifact.mimeType, "application/pdf");
    assert.equal(outcome.result.artifact.artifactVersion, 1);
    assert.ok(outcome.result.verification);
    assert.equal(outcome.result.verification.passed, false);
    assert.deepEqual(outcome.result.verification.defects, []);
    assert.deepEqual(outcome.result.verification.unverifiedChecks, [PIXEL_SCREENSHOT_UNVERIFIED_CHECK]);
    assert.ok(outcome.result.verification.extractedTextSample.includes("兒科覆診準備單"));
    assert.equal(budget.counts.toolCalls, 1);
    assert.equal(getMutationCalls(), 0);
  } finally {
    budget.close();
  }
});

test("2. multi-page A4 PDF pagination and safe HTTPS link keep footers separated from body content", async () => {
  const manyItems = Array.from({ length: 58 }, (_, idx) => ({
    id: `item-${idx + 1}`,
    text: `第 ${idx + 1} 項檢查紀錄：每日量度體溫、觀察飲水量與睡眠安穩程度，必要時帶備最近紀錄。`,
    sourceIds: [],
    checked: idx % 2 === 0,
  }));
  const largeDoc = makeFamilyDocument(makeSnapshot({
    sections: [
      { id: "s1", title: "多頁照護觀察明細", kind: "checklist", domain: null, items: manyItems },
    ],
  }));
  const { budget, run } = createBudgetedContext();
  const { store } = createFakeDocumentStore(largeDoc);
  try {
    const outcome = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "產出完整多頁PDF預覽",
      safeHttpsUrl: "https://example.org/family/guide",
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "產出完整多頁PDF預覽",
        intent: "產出多頁覆診預覽",
        includeRevision: true,
        includeSources: true,
      },
    });
    assert.equal(outcome.result.status, "partial");
    assert.ok(outcome.result.artifact && outcome.result.artifact.pageCount >= 2);
    assert.equal(outcome.result.verification?.passed, false);
    assert.equal(outcome.result.stopReason, "verification_incomplete");
    assert.deepEqual(outcome.result.verification?.defects, []);
  } finally {
    budget.close();
  }
});

test("3. isolated PDF verifier detects overflow, unsafe link, overlap, empty page, and missing glyph faults", async () => {
  const doc = makeFamilyDocument();
  const view = projectDocumentExport(doc.current!, {
    snapshotId: doc.current!.id,
    snapshotVersion: doc.current!.version,
    authorityVersion,
    purpose: "appointment",
    includeSources: true,
    includeRevision: false,
  });

  const overflowPdf = buildFamilyArtifactPdf(view, { faultMode: "inject_overflow_and_unsafe_link" });
  const overflowReport = await inspectPdfArtifactIsolated(overflowPdf.bytes, {
    artifactVersion: 1,
    expectedHash: overflowPdf.hash,
    expectedTitle: view.title,
    requiredSections: view.sections.map(s => s.title),
  });
  assert.equal(overflowReport.passed, false);
  assert.ok(overflowReport.defects.some(d => d.kind === "overflow" || d.kind === "clipping"));
  assert.ok(overflowReport.defects.some(d => d.kind === "unsafe_link"));

  const overlapPdf = buildFamilyArtifactPdf(view, { faultMode: "inject_overlap" });
  const overlapReport = await inspectPdfArtifactIsolated(overlapPdf.bytes, {
    artifactVersion: 1,
    expectedHash: overlapPdf.hash,
    expectedTitle: view.title,
  });
  assert.equal(overlapReport.passed, false);
  assert.ok(overlapReport.defects.some(d => d.kind === "overlap"));

  const emptyPagePdf = buildFamilyArtifactPdf(view, { faultMode: "inject_empty_page" });
  const emptyReport = await inspectPdfArtifactIsolated(emptyPagePdf.bytes, {
    artifactVersion: 1,
    expectedHash: emptyPagePdf.hash,
    expectedTitle: view.title,
  });
  assert.equal(emptyReport.passed, false);
  assert.ok(emptyReport.defects.some(d => d.kind === "empty_page"));

  const missingGlyphPdf = buildFamilyArtifactPdf(view, { faultMode: "inject_missing_glyph" });
  const glyphReport = await inspectPdfArtifactIsolated(missingGlyphPdf.bytes, {
    artifactVersion: 1,
    expectedHash: missingGlyphPdf.hash,
    expectedTitle: view.title,
  });
  assert.equal(glyphReport.passed, false);
  assert.ok(glyphReport.defects.some(d => d.kind === "missing_glyph"));
});

test("4. specialist bounded loop auto-repairs initial defects and binds final report to repaired version and hash", async () => {
  const { budget, run } = createBudgetedContext(6);
  const { store } = createFakeDocumentStore(makeFamilyDocument());
  try {
    const outcome = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "請修復後產生覆診PDF草稿",
      initialFaultMode: "inject_overflow_and_unsafe_link",
      repairFaultMode: "none",
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "修復後產生覆診PDF草稿",
        intent: "建立並自我修復可列印PDF草稿",
        includeRevision: false,
        includeSources: true,
      },
    });
    assert.equal(outcome.result.status, "partial");
    assert.equal(outcome.result.stopReason, "verification_incomplete");
    assert.equal(outcome.result.repairIterations, 1);
    assert.ok(outcome.result.artifact);
    assert.equal(outcome.result.artifact.artifactVersion, 2);
    assert.ok(outcome.result.verification);
    assert.equal(outcome.result.verification.passed, false);
    assert.equal(outcome.result.verification.artifactVersion, 2);
    assert.equal(outcome.result.verification.artifactHash, outcome.result.artifact.artifactHash);
    assert.equal(budget.counts.toolCalls, 2);
  } finally {
    budget.close();
  }
});

test("5. specialist loop caps automated retries at 2 and returns honest partial report when persistent defects remain", async () => {
  const { budget, run } = createBudgetedContext(8);
  const { store } = createFakeDocumentStore(makeFamilyDocument());
  try {
    const outcome = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "測試持續無法自動消除的版面溢位",
      initialFaultMode: "persistent_overflow",
      repairFaultMode: "persistent_overflow",
      maxRepairIterations: 5, // Server clamps strictly to SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS (2).
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "持續無法自動消除的版面溢位",
        intent: "測試修復上限",
        includeRevision: false,
        includeSources: false,
      },
    });
    assert.equal(outcome.result.status, "partial");
    assert.equal(outcome.result.stopReason, "repair_limit_reached");
    assert.equal(outcome.result.repairIterations, SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS);
    assert.equal(outcome.result.formalSave, false);
    assert.equal(outcome.result.published, false);
    assert.equal(outcome.result.artifact?.artifactVersion, 3);
    assert.equal(outcome.result.verification?.passed, false);
    assert.equal(budget.counts.toolCalls, 3);
  } finally {
    budget.close();
  }
});

test("6. specialist loop shares caller AgentBudget and stops cleanly with partial output on tool_limit", async () => {
  const { budget, run } = createBudgetedContext(1);
  const { store } = createFakeDocumentStore(makeFamilyDocument());
  try {
    const outcome = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "用有限預算測試PDF修復",
      initialFaultMode: "inject_overflow_and_unsafe_link",
      repairFaultMode: "none",
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "有限預算測試PDF修復",
        intent: "驗證單一預算邊界",
        includeRevision: false,
        includeSources: false,
      },
    });
    assert.equal(outcome.result.status, "partial");
    assert.equal(outcome.result.stopReason, "tool_limit");
    assert.equal(outcome.result.repairIterations, 0);
    assert.equal(outcome.result.artifact?.artifactVersion, 1);
    assert.equal(outcome.result.verification?.passed, false);
    assert.equal(budget.counts.toolCalls, 1);
  } finally {
    budget.close();
  }
});

test("7. isolated HTML verifier catches script/unsafe-URI/overflow and specialist loop repairs HTML artifacts", async () => {
  const maliciousHtml = Buffer.from(
    `<!doctype html><html><body><h1>惡意預覽</h1><script>evil()</script><div style="width:1800px"><a href="javascript:alert(1)" onclick="x()">bad</a></div></body></html>`,
    "utf8",
  );
  const badReport = await inspectHtmlArtifactIsolated(maliciousHtml, {
    artifactVersion: 1,
    expectedTitle: "兒科覆診準備單",
  });
  assert.equal(badReport.passed, false);
  assert.ok(badReport.defects.some(d => d.kind === "unsafe_link"));
  assert.ok(badReport.defects.some(d => d.kind === "overflow"));
  assert.ok(badReport.defects.some(d => d.kind === "unreadable_text"));

  const doc = makeFamilyDocument();
  const cleanView = projectDocumentExport(doc.current!, {
    snapshotId: doc.current!.id,
    snapshotVersion: doc.current!.version,
    authorityVersion,
    purpose: "appointment",
    includeSources: true,
    includeRevision: false,
  });
  const builtHtml = buildFamilyArtifactHtml(cleanView, { safeHttpsUrl: "https://example.org/info" });
  const cleanReport = await inspectHtmlArtifactIsolated(builtHtml.bytes, {
    artifactVersion: 1,
    expectedHash: builtHtml.hash,
    expectedTitle: cleanView.title,
    requiredSections: cleanView.sections.map(s => s.title),
  });
  assert.equal(cleanReport.passed, false);
  assert.deepEqual(cleanReport.defects, []);
  assert.deepEqual(cleanReport.unverifiedChecks, [PIXEL_SCREENSHOT_UNVERIFIED_CHECK]);

  const { budget, run } = createBudgetedContext(6);
  const { store } = createFakeDocumentStore(doc);
  try {
    const repaired = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "產生並修復HTML預覽",
      initialFaultMode: "inject_overflow_and_unsafe_link",
      repairFaultMode: "none",
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "html",
        sourceQuote: "產生並修復HTML預覽",
        intent: "修復HTML預覽連結與闊度",
        includeRevision: false,
        includeSources: true,
      },
    });
    assert.equal(repaired.result.status, "partial");
    assert.equal(repaired.result.repairIterations, 1);
    assert.equal(repaired.result.artifact?.mimeType, "text/html");
    assert.equal(repaired.result.artifact?.artifactVersion, 2);
  } finally {
    budget.close();
  }
});

test("8. single-flight lock rejects overlapping specialist runs and rejects sourceQuote or version mismatches", async () => {
  const { budget, run } = createBudgetedContext(8);
  const { store } = createFakeDocumentStore(makeFamilyDocument());
  try {
    let releaseFirstBuild: () => void = () => {};
    const firstBuildGate = new Promise<void>(resolve => { releaseFirstBuild = resolve; });
    const firstPromise = runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "同時只跑一個專家預覽工作",
      onBeforeBuild: () => firstBuildGate,
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "同時只跑一個專家預覽工作",
        intent: "驗證單一併發鎖",
      },
    });

    const tool = createSpecialistArtifactTools({
      documents: store,
      run,
      authorize: async () => true,
      trustedUserMessage: "同時只跑一個專家預覽工作",
    })[0]!;
    const overlapping = await tool.execute({
      documentId,
      expectedVersion: 3,
      authorityVersion,
      format: "pdf",
      sourceQuote: "同時只跑一個專家預覽工作",
      intent: "第二個併發呼叫",
    }, { functionCallId: "overlap-1" } as unknown as Parameters<typeof tool.execute>[1]);
    assert.equal(overlapping.status, "conflict");
    assert.deepEqual(overlapping.data, {
      code: "specialist_task_in_progress", draftAvailable: false, formalSave: false, published: false, requiresFormalConfirmation: true,
    });

    releaseFirstBuild();
    const firstDone = await firstPromise;
    assert.equal(firstDone.result.status, "partial");

    const sourceMismatch = await tool.execute({
      documentId,
      expectedVersion: 3,
      authorityVersion,
      format: "pdf",
      sourceQuote: "原話中不存在的片段",
      intent: "測試來源引文核對",
    }, { functionCallId: "quote-mismatch" } as unknown as Parameters<typeof tool.execute>[1]);
    assert.equal(sourceMismatch.status, "rejected");
    assert.equal((sourceMismatch.data as Record<string, unknown>).code, "agent_source_mismatch");

    const versionMismatch = await tool.execute({
      documentId,
      expectedVersion: 99,
      authorityVersion,
      format: "pdf",
      sourceQuote: "同時只跑一個專家預覽工作",
      intent: "測試版本衝突",
    }, { functionCallId: "ver-mismatch" } as unknown as Parameters<typeof tool.execute>[1]);
    assert.equal(versionMismatch.status, "rejected");
    assert.equal((versionMismatch.data as Record<string, unknown>).code, "version_conflict");

    const { store: staleStore } = createFakeDocumentStore(makeFamilyDocument(makeSnapshot(), { readState: "stale" }));
    const staleTool = createSpecialistArtifactTools({
      documents: staleStore,
      run,
      authorize: async () => true,
      trustedUserMessage: "同時只跑一個專家預覽工作",
    })[0]!;
    const staleResult = await staleTool.execute({
      documentId,
      expectedVersion: 3,
      authorityVersion,
      format: "pdf",
      sourceQuote: "同時只跑一個專家預覽工作",
      intent: "測試過時狀態阻擋",
    }, { functionCallId: "stale-doc" } as unknown as Parameters<typeof tool.execute>[1]);
    assert.equal(staleResult.status, "rejected");
    assert.equal((staleResult.data as Record<string, unknown>).code, "document_not_ready");
  } finally {
    budget.close();
  }
});

test("9. corrupt PDF returns render_error cleanly and VisualArtifactRendererPort clears or adds pixel checks", async () => {
  const corruptReport = await inspectPdfArtifactIsolated(Buffer.from("%PDF-corrupt-truncated", "utf8"), {
    artifactVersion: 1,
    expectedTitle: "任何標題",
  });
  assert.equal(corruptReport.passed, false);
  assert.ok(corruptReport.defects.some(d => d.kind === "render_error"));
  assert.deepEqual(corruptReport.unverifiedChecks, [PIXEL_SCREENSHOT_UNVERIFIED_CHECK]);

  const { budget, run } = createBudgetedContext(6);
  const { store } = createFakeDocumentStore(makeFamilyDocument());
  try {
    const cleanVisual = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "帶像素截圖檢查器產出PDF",
      visualRenderer: {
        verifyRenderedVisuals: async () => ({ defects: [], unverifiedChecks: [] }),
      },
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "帶像素截圖檢查器產出PDF",
        intent: "像素驗證通過情境",
      },
    });
    assert.equal(cleanVisual.result.status, "verified");
    assert.deepEqual(cleanVisual.result.verification?.unverifiedChecks, []);
    assert.equal(cleanVisual.result.verification?.passed, true);
    // Even passing the internal inspection is not delivery of usable draft bytes.
    const adapter = createSpecialistArtifactTools({
      documents: store, run, authorize: async () => true, trustedUserMessage: "帶像素截圖檢查器產出PDF",
      visualRenderer: { verifyRenderedVisuals: async () => ({ defects: [], unverifiedChecks: [] }) },
    })[0]!;
    const delivery = await adapter.execute({
      documentId, expectedVersion: 3, authorityVersion, format: "pdf",
      sourceQuote: "帶像素截圖檢查器產出PDF", intent: "核對交付狀態",
    }, { scope: run.scope, runId: run.runId, callId: "inspect-only", signal: budget.signal });
    assert.equal(delivery.status, "failed");
    assert.equal(delivery.reference, undefined);
    assert.deepEqual(delivery.data, {
      code: "specialist_draft_unavailable", inspectionStatus: "verified", inspectionReason: "verified",
      draftAvailable: false, formalSave: false, published: false, requiresFormalConfirmation: true,
    });

    const flaggedVisual = await runSpecialistArtifactLoop({
      documents: store,
      run,
      trustedUserMessage: "帶像素截圖檢查器產出PDF",
      visualRenderer: {
        verifyRenderedVisuals: async () => ({
          defects: [{ kind: "clipping", page: 1, message: "Visual screenshot crop detected on page 1" }],
          unverifiedChecks: [],
        }),
      },
      input: {
        documentId,
        expectedVersion: 3,
        authorityVersion,
        format: "pdf",
        sourceQuote: "帶像素截圖檢查器產出PDF",
        intent: "像素驗證偵測裁切情境",
      },
    });
    assert.equal(flaggedVisual.result.status, "partial");
    assert.equal(flaggedVisual.result.stopReason, "repair_limit_reached");
    assert.ok(flaggedVisual.result.verification?.defects.some(d => d.kind === "clipping"));
  } finally {
    budget.close();
  }
});

test("10. document_compose loads the existing compose action but does not offer an undeliverable artifact preview", async () => {
  let claimed = false;
  let saved: ProductAgentResult | null = null;
  const { store, getMutationCalls } = createFakeDocumentStore(makeFamilyDocument());
  const call = (name: string, args: Record<string, unknown>, id: string) => ({
    content: { role: "model", parts: [{ functionCall: { name, args, id }, thoughtSignature: "opaque-original" }] },
    finishReason: FinishReason.STOP,
  });

  let modelTurn = 0;
  const generate: AgentModelProvider["generate"] = async request => {
    const text = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
    if (text.includes("chat-delivery-review")) {
      const body = JSON.parse(text.slice(text.indexOf("{")));
      return {
        content: {
          role: "model",
          parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }],
        },
        finishReason: FinishReason.STOP,
      };
    }
    modelTurn += 1;
    if (modelTurn === 1) {
      return call("load_capabilities", { capabilities: ["document_compose"] }, "load-doc-compose");
    }
    if (modelTurn === 2) {
      const declarations = (request.config?.tools ?? []).flatMap(tool =>
        "functionDeclarations" in tool ? tool.functionDeclarations?.map(decl => decl.name) ?? [] : []);
      assert.ok(declarations.includes("compose_family_data"), "existing compose action remains available");
      assert.ok(!declarations.includes(SPECIALIST_ARTIFACT_TOOL_NAME), "no parent-openable draft is available");
    }
    return call("present_answer", {
      kind: "operation",
      paragraphs: [{ text: "這個對話沒有可開啟的專家草稿，本次沒有建立、保存或發布附件。", citationIds: [] }],
    }, "present-done");
  };

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { generate },
  });

  const agent = createProductAgent({
    runtime,
    store: {
      claim: async () => {
        const created = !claimed;
        claimed = true;
        return { runId, scope: baseScope, created, expiresAt: new Date(Date.now() + 90_000).toISOString() };
      },
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => {
        saved = productAgentResultSchema.parse(JSON.parse(JSON.stringify(result)));
        return true;
      },
      get: async () => saved,
    },
    memory: {
      context: async () => ({
        profile: { childId, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
    },
    chat: {
      listForUser: async () => ({
        messages: [{ id: messageRef, role: "user", text: "請幫我整理兒科覆診準備單的PDF預覽。" }],
      }),
    },
    tasks: {
      list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }),
    },
    knowledge: {
      createRun: () => ({}),
    },
    documents: store,
  } as unknown as Parameters<typeof createProductAgent>[0]);

  const result = await agent.reply(userId, childId, messageRef, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.deepEqual(result.tools.map(t => [t.name, t.status]), [
    ["load_capabilities", "succeeded"],
    ["present_answer", "succeeded"],
  ]);
  assert.equal(getMutationCalls(), 0);
});

test("11. embedded subsetted TC font, Sharp raster visual verifier, and staged ProductAgent draft end-to-end", async () => {
  const doc = makeFamilyDocument();
  const view = projectDocumentExport(doc.current!, {
    snapshotId: doc.current!.id,
    snapshotVersion: doc.current!.version,
    authorityVersion,
    purpose: "appointment",
    includeSources: true,
    includeRevision: true,
  });

  // Embedded FontFile2 + CIDToGIDMap /Identity present in generated PDF.
  const builtPdf = buildFamilyArtifactPdf(view);
  const rawPdf = Buffer.from(builtPdf.bytes).toString("latin1");
  assert.ok(rawPdf.includes("/FontFile2"), "PDF should embed subsetted TrueType FontFile2 stream");
  assert.ok(rawPdf.includes("/CIDToGIDMap /Identity"), "PDF should declare CIDToGIDMap /Identity");

  // Sharp raster visual verifier catches injected overflow and passes clean PDF & HTML with zero unverified checks.
  const visualRenderer = createSharpVisualArtifactVerifier();
  const overflowPdf = buildFamilyArtifactPdf(view, { faultMode: "inject_overflow_and_unsafe_link" });
  const overflowReport = await inspectPdfArtifactIsolated(overflowPdf.bytes, {
    artifactVersion: 1,
    expectedHash: overflowPdf.hash,
    expectedTitle: view.title,
    visualRenderer,
  });
  assert.equal(overflowReport.passed, false);
  assert.deepEqual(overflowReport.unverifiedChecks, []);
  assert.ok(overflowReport.defects.some(d => d.kind === "overflow" || d.kind === "clipping"));

  const cleanHtmlReport = await inspectHtmlArtifactIsolated(buildFamilyArtifactHtml(view).bytes, {
    artifactVersion: 1,
    expectedTitle: view.title,
    visualRenderer,
  });
  assert.equal(cleanHtmlReport.passed, true);
  assert.deepEqual(cleanHtmlReport.unverifiedChecks, []);

  // ProductAgent with stageSpecialistDraft exposes prepare_family_artifact and attaches draft summary without mutating family_documents.
  const staged = new Map<string, { summary: any; bytes: Buffer }>();
  let claimed = false;
  let saved: ProductAgentResult | null = null;
  let turn = 0;
  const { store, getMutationCalls } = createFakeDocumentStore(doc);
  const call = (name: string, args: Record<string, unknown>, id: string) => ({
    content: { role: "model", parts: [{ functionCall: { name, args, id }, thoughtSignature: "opaque-original" }] },
    finishReason: FinishReason.STOP,
  });

  const agent = createProductAgent({
    runtime: createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const text = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (text.includes("chat-delivery-review")) {
            const body = JSON.parse(text.slice(text.indexOf("{")));
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          turn += 1;
          if (turn === 1) {
            return call("load_capabilities", { capabilities: ["document_compose"] }, "load-doc-compose");
          }
          if (turn === 2) {
            const declarations = (request.config?.tools ?? []).flatMap(tool =>
              "functionDeclarations" in tool ? tool.functionDeclarations?.map(decl => decl.name) ?? [] : []);
            assert.ok(declarations.includes(SPECIALIST_ARTIFACT_TOOL_NAME), "staged stores expose prepare_family_artifact");
            return call(SPECIALIST_ARTIFACT_TOOL_NAME, {
              documentId,
              expectedVersion: 3,
              authorityVersion,
              format: "pdf",
              sourceQuote: "請幫我整理兒科覆診準備單的PDF預覽。",
              intent: "產生綁定當前版本的覆診 PDF 草稿預覽",
              includeRevision: true,
              includeSources: true,
            }, "prep-pdf");
          }
          return call("present_answer", {
            kind: "operation",
            paragraphs: [{ text: "已為兒科覆診準備單產生第 3 版 PDF 草稿預覽（僅供核對，尚未正式保存或發布）。", citationIds: [] }],
          }, "present-draft");
        },
      },
    }),
    store: {
      claim: async () => {
        const created = !claimed;
        claimed = true;
        return { runId, scope: baseScope, created, expiresAt: new Date(Date.now() + 90_000).toISOString() };
      },
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => {
        saved = productAgentResultSchema.parse(JSON.parse(JSON.stringify(result)));
        return true;
      },
      get: async () => saved,
      stageSpecialistDraft: async (_scope: unknown, _runId: string, input: { artifactId: string; summary: any; bytes: Uint8Array }) => {
        staged.set(input.artifactId, { summary: input.summary, bytes: Buffer.from(input.bytes) });
        return input.summary;
      },
      specialistDrafts: async () => [...staged.values()].map(item => item.summary),
    },
    memory: {
      context: async () => ({
        profile: { childId, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
    },
    chat: {
      listForUser: async () => ({
        messages: [{ id: messageRef, role: "user", text: "請幫我整理兒科覆診準備單的PDF預覽。" }],
      }),
    },
    tasks: {
      list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }),
    },
    knowledge: {
      createRun: () => ({}),
    },
    documents: store,
  } as unknown as Parameters<typeof createProductAgent>[0]);

  const result = await agent.reply(userId, childId, messageRef, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.equal(result.specialistArtifacts?.length, 1);
  assert.equal(result.specialistArtifacts?.[0]?.formalSave, false);
  assert.equal(result.specialistArtifacts?.[0]?.published, false);
  assert.equal(result.specialistArtifacts?.[0]?.verification.passed, true);
  assert.deepEqual(result.specialistArtifacts?.[0]?.verification.unverifiedChecks, []);
  assert.equal(staged.size, 1);
  assert.equal(getMutationCalls(), 0);
});
