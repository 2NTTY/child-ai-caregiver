import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { projectAgentProposal } from "../frontend/src/production/agent-projection.ts";
import { createAgentActionTools } from "../server/agent-action-tools.ts";
import { handleAgentActionsRequest } from "../server/agent-actions-api.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import type { AgentRunContext } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreProductAgentStore } from "../server/firestore-product-agent-store.ts";
import { createFirestoreProductAgent } from "../server/firestore-product-agent.ts";
import { handleProductAgentRequest } from "../server/product-agent-api.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createAgentActionsApi } from "../src/client/agent-actions-api.ts";
import { createProductAgentApi } from "../src/client/product-agent-api.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import {
  allowsDirectActionByPolicy,
  evaluateFormalSaveGate,
  resolveAgentExecutionMode,
} from "../src/shared/agent-actions.ts";
import {
  DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY,
  describeOperationUndoCapability,
  OPERATION_UNDO_CAPABILITIES,
} from "../src/shared/operation-undo.ts";
import { proposalTargetKey } from "../src/shared/product-agent.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

async function createReq003Fixture(userId = "parent") {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 19)),
    projectId: "synthetic-req003-project",
    namespace: "synthetic_req003",
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
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const services = createFirestoreProductAgentStore({
    ...options,
    chat,
    care,
    memory,
    online,
    validateKnowledge: async () => {},
    continuationKnowledge: async () => [],
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

function makeBudgetedRun(scope: { userId: string; childId: string; workspaceId: string; authorizationVersion: string; dataVersion: string }, runId: string) {
  const budget = new AgentBudget();
  budget.configurePersonal({ modelCalls: 4, queryEmbeddings: 2, toolCalls: 8 });
  const run = {
    runId,
    scope,
    budget,
    authorize: async () => true,
  } as unknown as AgentRunContext;
  return { budget, run, call: (callId: string) => ({ scope: run.scope, runId: run.runId, callId, signal: budget.signal }) };
}

test("1. default policy resolves to confirm_first while legacy auto policy stays compatible", async () => {
  const f = await createReq003Fixture();
  const initial = await f.actions.policy(f.userId, f.childId);
  assert.ok(initial);
  assert.equal(initial.version, 0);
  assert.equal(initial.effective, false);
  assert.equal(resolveAgentExecutionMode(initial), "confirm_first");

  // Legacy caller omits executionMode while enabling feeding auto-save -> resolves auto_authorized.
  const legacyAuto = await f.actions.savePolicy(f.userId, f.childId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    recordKinds: ["feeding"],
    allowPrivateNotes: false,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: true,
  });
  assert.equal(legacyAuto?.executionMode, "auto_authorized");

  // Legacy/empty caller with all permissions off -> resolves confirm_first.
  const allOff = await f.actions.savePolicy(f.userId, f.childId, {
    operationId: randomUUID(),
    expectedVersion: 1,
    recordKinds: [],
    allowPrivateNotes: false,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: false,
  });
  assert.equal(allOff?.executionMode, "confirm_first");
});

test("2. confirm_first mode blocks direct store execution and routes ordinary write tools to confirmable drafts", async () => {
  const f = await createReq003Fixture();
  const policy = await f.actions.savePolicy(f.userId, f.childId, {
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
  });
  assert.equal(policy?.executionMode, "confirm_first");

  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "剛飲咗120毫升奶，仲想記低之後覆診想問水溫。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");
  assert.ok(claim);

  await assert.rejects(
    f.actions.execute(claim.scope, claim.runId, "direct-call-blocked", {
      kind: "save_record",
      sourceQuote: msg!.text,
      expectedPolicyVersion: policy!.version,
      text: "剛喝了120毫升奶",
      quantityEvidence: "120毫升",
      details: {
        kind: "feeding",
        quantity: { rawValue: "120", unit: "毫升", precision: "exact" },
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    }),
    { code: "agent_confirm_first_required" },
  );

  const { budget, run, call } = makeBudgetedRun(claim.scope, claim.runId);
  try {
    const tools = createAgentActionTools(f.actions, run, async () => true, f.store);
    const saveRecordTool = tools.find(t => t.name === "save_ordinary_record")!;
    const saveNoteTool = tools.find(t => t.name === "save_private_instruction")!;

    const recordRes = await saveRecordTool.execute({
      sourceQuote: msg!.text,
      expectedPolicyVersion: policy!.version,
      text: "喝了120毫升奶",
      quantityEvidence: "120毫升",
      details: {
        kind: "feeding",
        quantity: { rawValue: "120", unit: "毫升", precision: "exact" },
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    }, call("call-rec-1"));
    assert.equal(recordRes.status, "succeeded");
    assert.equal((recordRes.data as Record<string, unknown>).mode, "confirm_first_draft");
    assert.equal((recordRes.data as Record<string, unknown>).formalSave, false);
    assert.equal((recordRes.data as Record<string, unknown>).confirmationRequired, true);

    const noteRes = await saveNoteTool.execute({
      sourceQuote: msg!.text,
      expectedPolicyVersion: policy!.version,
      title: "覆診問題",
      text: "想問清楚奶水溫度指引",
    }, call("call-note-1"));
    assert.equal(noteRes.status, "succeeded");
    assert.equal((noteRes.data as Record<string, unknown>).mode, "confirm_first_draft");
    assert.equal((noteRes.data as Record<string, unknown>).formalSave, false);

    assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);
    assert.equal((await f.actions.notes(f.userId, f.childId))?.items.length, 0);
    assert.equal((await f.store.pendingProposals(f.userId, f.childId))?.proposals.length, 2);
  } finally {
    budget.close();
  }
});

test("3. confirming care_record_create and care_record_revise requires confirmShared and preserves version + idempotency", async () => {
  const f = await createReq003Fixture();
  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "下午飲咗120毫升奶。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");
  assert.ok(claim);

  const createdProp = await f.store.propose(claim.scope, claim.runId, "care-create", {
    kind: "care_record_create",
    sourceQuote: msg!.text,
    text: "下午喝了120毫升奶",
    quantityEvidence: "120毫升",
    details: {
      kind: "feeding",
      quantity: { rawValue: "120", unit: "毫升", precision: "exact" },
      eventTime: { rawText: "下午", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
    },
  });
  assert.ok(createdProp);
  assert.equal(createdProp.targetVisibility, "family");

  await assert.rejects(
    f.store.decide(f.userId, f.childId, claim.runId, createdProp.id, {
      expectedVersion: 1,
      decision: "accept",
      confirmShared: false,
    }),
    { code: "sharing_confirmation_required" },
  );

  const accepted = await f.store.decide(f.userId, f.childId, claim.runId, createdProp.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: true,
  });
  assert.equal(accepted?.status, "accepted");
  assert.equal(accepted?.result?.kind, "care_record");
  const savedId = accepted!.result!.id;

  // Idempotent retry on same decision returns same accepted proposal without creating duplicate record.
  const replayed = await f.store.decide(f.userId, f.childId, claim.runId, createdProp.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: true,
  });
  assert.equal(replayed?.result?.id, savedId);
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 1);

  const msg2 = await f.chat.createUserMessageForUser(f.userId, f.childId, "更正為喝了150毫升奶。");
  const claim2 = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg2!.id }, "product-interactive");
  const reviseProp = await f.store.propose(claim2!.scope, claim2!.runId, "care-rev", {
    kind: "care_record_revise",
    recordId: savedId,
    expectedVersion: 1,
    previousText: "下午喝了120毫升奶",
    text: "更正：下午喝了150毫升奶",
    reason: "家長修正實際飲奶量",
    sourceQuote: msg2!.text,
    quantityEvidence: "150毫升",
    details: {
      kind: "feeding",
      quantity: { rawValue: "150", unit: "毫升", precision: "exact" },
      eventTime: { rawText: "下午", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
    },
  });
  const revised = await f.store.decide(f.userId, f.childId, claim2!.runId, reviseProp!.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: true,
  });
  assert.equal(revised?.status, "accepted");
  assert.equal(revised?.result?.version, 2);

  const msg3 = await f.chat.createUserMessageForUser(f.userId, f.childId, "再次更正飲奶量。");
  const claim3 = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg3!.id }, "product-interactive");
  await assert.rejects(
    f.store.propose(claim3!.scope, claim3!.runId, "care-rev-stale", {
      kind: "care_record_revise",
      recordId: savedId,
      expectedVersion: 1,
      text: "舊版本",
      reason: "測試",
      sourceQuote: msg3!.text,
      details: {
        kind: "feeding",
        quantity: null,
        eventTime: { rawText: "下午", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    }),
    { code: "version_conflict" },
  );
});

test("4. confirming private_note_create and private_note_revise saves privately and enforces key and version bounds", async () => {
  const f = await createReq003Fixture();
  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "記住本人偏好用溫水開奶。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");

  const noteProp = await f.store.propose(claim!.scope, claim!.runId, "note-create", {
    kind: "private_note_create",
    title: "開奶水溫偏好",
    text: "記住本人偏好用溫水開奶。",
    memoryKey: "feeding_water_temp",
    sourceQuote: msg!.text,
  });
  assert.equal(noteProp?.targetVisibility, "private");

  const accepted = await f.store.decide(f.userId, f.childId, claim!.runId, noteProp!.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: false,
  });
  assert.equal(accepted?.status, "accepted");
  assert.equal(accepted?.result?.kind, "private_note");
  const noteId = accepted!.result!.id;

  const msg2 = await f.chat.createUserMessageForUser(f.userId, f.childId, "改為記住偏好40度溫水。");
  const claim2 = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg2!.id }, "product-interactive");
  const reviseProp = await f.store.propose(claim2!.scope, claim2!.runId, "note-rev", {
    kind: "private_note_revise",
    noteId,
    expectedVersion: 1,
    previousTitle: "開奶水溫偏好",
    previousText: "記住本人偏好用溫水開奶。",
    title: "開奶水溫偏好",
    text: "改為偏好40度溫水開奶。",
    sourceQuote: msg2!.text,
  });
  const revised = await f.store.decide(f.userId, f.childId, claim2!.runId, reviseProp!.id, {
    expectedVersion: 1,
    decision: "accept",
    confirmShared: false,
  });
  assert.equal(revised?.status, "accepted");
  assert.equal(revised?.result?.version, 2);

  const stored = await f.actions.notes(f.userId, f.childId, "40度");
  assert.equal(stored?.items.length, 1);
  assert.equal(stored?.items[0]?.memoryKey, "feeding_water_temp");
});

test("5. editing draft proposal before confirmation bumps version, blocks old card, and prevents target hijacking", async () => {
  const f = await createReq003Fixture();
  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "記錄午睡睡了1小時。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");

  const draft = await f.store.propose(claim!.scope, claim!.runId, "sleep-1", {
    kind: "care_record_create",
    sourceQuote: msg!.text,
    text: "午睡睡了1小時",
    quantityEvidence: "1小時",
    details: {
      kind: "sleep",
      quantity: { rawValue: "1", unit: "小時", precision: "exact" },
      eventTime: { rawText: "午", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
    },
  });
  assert.equal(draft?.version, 1);

  await assert.rejects(
    f.store.editProposal!(f.userId, f.childId, claim!.runId, draft!.id, {
      expectedVersion: 1,
      value: {
        kind: "private_note_create",
        title: "劫持目標",
        text: "跨種類切換",
        sourceQuote: msg!.text,
      },
    }),
    { code: "invalid_input" },
  );

  const edited = await f.store.editProposal!(f.userId, f.childId, claim!.runId, draft!.id, {
    expectedVersion: 1,
    value: {
      kind: "care_record_create",
      sourceQuote: msg!.text,
      text: "午睡安穩睡了1.5小時（已手動修正草稿）",
      quantityEvidence: "1小時",
      details: {
        kind: "sleep",
        quantity: { rawValue: "1", unit: "小時", precision: "exact" },
        eventTime: { rawText: "午", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    },
  });
  assert.equal(edited?.version, 2);
  assert.equal(edited?.status, "pending");
  assert.equal(edited?.result, null);

  await assert.rejects(
    f.store.decide(f.userId, f.childId, claim!.runId, draft!.id, {
      expectedVersion: 1,
      decision: "accept",
      confirmShared: true,
    }),
    { code: "version_conflict" },
  );

  const confirmed = await f.store.decide(f.userId, f.childId, claim!.runId, draft!.id, {
    expectedVersion: 2,
    decision: "accept",
    confirmShared: true,
  });
  assert.equal(confirmed?.status, "accepted");
  assert.equal(confirmed?.result?.kind, "care_record");
  const records = await f.care.listRecords(f.userId, f.childId);
  assert.equal(records.records[0]?.text, "午睡安穩睡了1.5小時（已手動修正草稿）");
});

test("6. cancelling an unexecuted draft writes nothing and stays distinct from history undo", async () => {
  const f = await createReq003Fixture();
  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "記住明天帶外套。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");
  const draft = await f.store.propose(claim!.scope, claim!.runId, "cancel-draft", {
    kind: "private_note_create",
    title: "出門提醒",
    text: "明天帶外套",
    sourceQuote: msg!.text,
  });
  const dismissed = await f.store.decide(f.userId, f.childId, claim!.runId, draft!.id, {
    expectedVersion: 1,
    decision: "dismiss",
    confirmShared: false,
  });
  assert.equal(dismissed?.status, "dismissed");
  assert.equal(dismissed?.result, null);
  assert.equal((await f.actions.notes(f.userId, f.childId))?.items.length, 0);
  assert.ok(DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY.includes("不會撤銷"));
  assert.equal(describeOperationUndoCapability("care_record").reversible, false);
  assert.equal(describeOperationUndoCapability("private_note").mechanism, "delete");
});

test("7. auto_authorized saves permitted categories directly and falls back to draft for unauthorized categories", async () => {
  const f = await createReq003Fixture();
  const policy = await f.actions.savePolicy(f.userId, f.childId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    executionMode: "auto_authorized",
    recordKinds: ["feeding"],
    allowPrivateNotes: false,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: true,
  });
  assert.equal(policy?.executionMode, "auto_authorized");

  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "飲咗90毫升奶，又換咗一次片。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");
  const { budget, run, call } = makeBudgetedRun(claim!.scope, claim!.runId);
  try {
    const tools = createAgentActionTools(f.actions, run, async () => true, f.store);
    const saveRecordTool = tools.find(t => t.name === "save_ordinary_record")!;

    const autoSaved = await saveRecordTool.execute({
      sourceQuote: msg!.text,
      expectedPolicyVersion: policy!.version,
      text: "喝了90毫升奶",
      quantityEvidence: "90毫升",
      details: {
        kind: "feeding",
        quantity: { rawValue: "90", unit: "毫升", precision: "exact" },
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    }, call("auto-feeding"));
    assert.equal(autoSaved.status, "succeeded");
    assert.equal((autoSaved.data as Record<string, unknown>).mode, "auto_saved");
    assert.equal((autoSaved.data as Record<string, unknown>).formalSave, true);

    // Out-of-scope category ("diaper") must NOT auto-save; falls back to confirm_first_draft.
    const outOfScope = await saveRecordTool.execute({
      sourceQuote: msg!.text,
      expectedPolicyVersion: policy!.version,
      text: "換了一次片",
      quantityEvidence: "一次",
      details: {
        kind: "diaper",
        quantity: { rawValue: "一", unit: "次", precision: "exact" },
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    }, call("fallback-diaper"));
    assert.equal(outOfScope.status, "succeeded");
    assert.equal((outOfScope.data as Record<string, unknown>).mode, "confirm_first_draft");
    assert.equal((outOfScope.data as Record<string, unknown>).formalSave, false);

    // Stale expectedPolicyVersion is rejected cleanly.
    const staleVersion = await saveRecordTool.execute({
      sourceQuote: msg!.text,
      expectedPolicyVersion: 0,
      text: "喝了90毫升奶",
      details: {
        kind: "feeding",
        quantity: null,
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    }, call("stale-policy"));
    assert.equal(staleVersion.status, "conflict");
    assert.equal((staleVersion.data as Record<string, unknown>).code, "agent_policy_changed");
  } finally {
    budget.close();
  }
});

test("8. content verification and action authorization are strictly independent gates", async () => {
  assert.deepEqual(evaluateFormalSaveGate({
    contentCheck: { passed: true, expectedDraftVersion: 2, actualDraftVersion: 2 },
    actionAuthorization: { authorized: false, mode: "confirm_first" },
  }).allowed, false);
  assert.deepEqual(evaluateFormalSaveGate({
    contentCheck: { passed: true },
    actionAuthorization: { authorized: false, mode: "confirm_first" },
  }), { allowed: false, code: "action_authorization_required", reason: "尚未取得目前動作的有效使用者授權或確認。" });

  const gateFailedContent = evaluateFormalSaveGate({
    contentCheck: { passed: false, reason: "缺少原文依據" },
    actionAuthorization: { authorized: true, mode: "auto_authorized" },
  });
  assert.deepEqual(gateFailedContent, { allowed: false, code: "content_check_failed", reason: "缺少原文依據" });

  const gateVersionMismatch = evaluateFormalSaveGate({
    contentCheck: { passed: true, expectedDraftVersion: 1, actualDraftVersion: 2 },
    actionAuthorization: { authorized: true, mode: "explicit_proposal_accept" },
  });
  assert.equal(gateVersionMismatch.allowed, false);
  if (!gateVersionMismatch.allowed) assert.equal(gateVersionMismatch.code, "version_mismatch");

  const f = await createReq003Fixture();
  const policy = await f.actions.savePolicy(f.userId, f.childId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    executionMode: "auto_authorized",
    recordKinds: ["feeding"],
    allowPrivateNotes: false,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: true,
  });
  assert.equal(allowsDirectActionByPolicy(policy!, {
    kind: "save_record",
    sourceQuote: "任何",
    expectedPolicyVersion: policy!.version,
    text: "喝了奶",
    details: { kind: "feeding", quantity: null, eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" } },
  }).allowed, true);

  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "今天散步二十分鐘。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");
  // Even with auto_authorized enabled, ungrounded sourceQuote fails content check and never writes.
  await assert.rejects(
    f.actions.execute(claim!.scope, claim!.runId, "ungrounded-quote", {
      kind: "save_record",
      sourceQuote: "唔存在於原對話嘅句子",
      expectedPolicyVersion: policy!.version,
      text: "喝了100毫升奶",
      details: { kind: "feeding", quantity: null, eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" } },
    }),
    { code: "agent_source_mismatch" },
  );
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);
});

test("9. HTTP handlers and typed clients execute savePolicy(executionMode), editProposal, and decideProposal end-to-end", async () => {
  const f = await createReq003Fixture();
  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "記住帶水壺上學。");
  const claim = await f.runs.claim(f.userId, f.childId, { kind: "interactive", reference: msg!.id }, "product-interactive");
  const draft = await f.store.propose(claim!.scope, claim!.runId, "http-draft", {
    kind: "private_note_create",
    title: "上學物品",
    text: "帶水壺",
    sourceQuote: msg!.text,
  });

  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    if (url.includes("/agent/policy") || url.includes("/agent/actions") || url.includes("/agent/notes")) {
      return handleAgentActionsRequest(req, f.userId, f.actions, async id => id === f.userId);
    }
    return handleProductAgentRequest(req, f.userId, {
      agent: {} as Parameters<typeof handleProductAgentRequest>[2]["agent"],
      store: f.store,
      chat: f.chat,
      isCurrentUser: async id => id === f.userId,
    });
  };

  const actionsApi = createAgentActionsApi("https://synthetic.local", fetcher);
  const productApi = createProductAgentApi("https://synthetic.local", fetcher);
  const controller = new AbortController();

  const savedPolicy = await actionsApi.savePolicy(f.childId, {
    operationId: randomUUID(),
    expectedVersion: 0,
    executionMode: "confirm_first",
    recordKinds: ["note"],
    allowPrivateNotes: true,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
    confirm: true,
    confirmShared: true,
  }, controller.signal, f.userId);
  assert.equal(savedPolicy.executionMode, "confirm_first");

  const fetchedPolicy = await actionsApi.getPolicy(f.childId, controller.signal, f.userId);
  assert.equal(fetchedPolicy.executionMode, "confirm_first");

  const edited = await productApi.editProposal!(f.childId, claim!.runId, draft!.id, {
    expectedVersion: 1,
    value: {
      kind: "private_note_create",
      title: "上學必備物品",
      text: "帶保溫水壺同後備口水肩",
      sourceQuote: msg!.text,
    },
  }, controller.signal, f.userId);
  assert.equal(edited.version, 2);

  const decided = await productApi.decideProposal(f.childId, claim!.runId, draft!.id, {
    expectedVersion: 2,
    decision: "accept",
    confirmShared: false,
  }, controller.signal, f.userId);
  assert.equal(decided.status, "accepted");
  assert.equal(decided.result?.kind, "private_note");
});

test("10. frontend projections, full createFirestoreProductAgent confirm_first flow, and undo matrix remain consistent", async () => {
  const f = await createReq003Fixture();
  const policy = await f.actions.savePolicy(f.userId, f.childId, {
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
  });
  const msg = await f.chat.createUserMessageForUser(f.userId, f.childId, "小晴剛飲咗140毫升奶。");

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
        const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const body = JSON.parse(promptText.slice(promptText.indexOf("{")));
          return {
            content: {
              role: "model",
              parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          };
        }
        step += 1;
        if (step === 1) {
          return {
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "load-cap", name: "load_capabilities", args: { capabilities: ["care_records"] } } },
              ],
            },
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
                  id: "save-rec",
                  name: "save_ordinary_record",
                  args: {
                    sourceQuote: msg!.text,
                    expectedPolicyVersion: policy!.version,
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
            parts: [{
              functionCall: {
                id: "present",
                name: "present_answer",
                args: { kind: "operation", paragraphs: [{ text: "已為你準備待確認的餵食草稿，請確認後再正式保存。", citationIds: [] }] },
              },
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 14, candidatesTokenCount: 8 },
        };
      },
    },
  });

  const result = await product.agent.reply(f.userId, f.childId, msg!.id, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.equal((await f.care.listRecords(f.userId, f.childId)).records.length, 0);
  const pending = (await f.store.pendingProposals(f.userId, f.childId))?.proposals ?? [];
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.value.kind, "care_record_create");

  const projected = projectAgentProposal(pending[0]!);
  assert.equal(projected.scope, "family");
  assert.ok(projected.details.some(row => row.label === "建議內容" && row.value === "飲咗140毫升奶"));

  const revProjection = projectAgentProposal({
    ...pending[0]!,
    value: {
      kind: "care_record_revise",
      recordId: randomUUID(),
      expectedVersion: 1,
      previousText: "舊記錄",
      text: "新記錄",
      reason: "更正",
      sourceQuote: msg!.text,
      details: {
        kind: "feeding",
        quantity: null,
        eventTime: { rawText: "剛", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" },
      },
    },
  });
  assert.ok(revProjection.details.some(row => row.label === "修改前內容" && row.value === "舊記錄"));
  assert.ok(revProjection.details.some(row => row.label === "建議內容" && row.value === "新記錄"));

  assert.equal(
    proposalTargetKey({
      kind: "private_note_revise",
      noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedVersion: 1,
      title: "標題",
      text: "內容",
      sourceQuote: msg!.text,
    }),
    "private_note:revise:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.equal(Object.keys(OPERATION_UNDO_CAPABILITIES).length, 7);
});
