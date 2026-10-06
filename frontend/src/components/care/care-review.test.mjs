import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "../../../node_modules/typescript/lib/typescript.js";
import * as values from "../../care-view-model.ts";
import * as fixtures from "../../preview/care-fixture.ts";
import * as forms from "./care-form.ts";

const child = { id: "preview-child-1", displayName: "Test child", ageLabel: "Preview", accessRole: "caregiver" };
const code = ts.transpileModule(fs.readFileSync(new URL("../../preview/useCarePreview.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

// A deterministic hook harness exercises the real synthetic owner, without a browser or timer waits.
function owner(scenario = "prior_consent") {
  const slots = [], timers = new Map();
  let cursor = 0, dirty = false, effects = [], timerSerial = 0;
  let activeChild = child, scope = "test-scope", entry = "care", online = true;
  const react = {
    useState(initial) { const key = cursor++; if (!slots[key]) slots[key] = { value: typeof initial === "function" ? initial() : initial }; return [slots[key].value, next => { const value = typeof next === "function" ? next(slots[key].value) : next; if (!Object.is(value, slots[key].value)) { slots[key].value = value; dirty = true; } }]; },
    useRef(initial) { const key = cursor++; if (!slots[key]) slots[key] = { current: initial }; return slots[key]; },
    useEffect(callback, deps) { const key = cursor++, previous = slots[key]; if (!previous || deps?.some((dep, index) => !Object.is(dep, previous.deps?.[index]))) { slots[key] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[key].cleanup?.(); slots[key].cleanup = callback(); }); } },
  };
  const module = { exports: {} };
  const requires = { react, "./PreviewNavigationGuard": { usePreviewLeaveGuard() {} }, "../care-view-model": values, "./care-fixture": fixtures, "../components/care/care-form": forms };
  const run = vm.runInNewContext(`(function(require,module,exports,setTimeout,clearTimeout){${code}\n})`);
  run(name => { if (!(name in requires)) throw new Error(`Unexpected import ${name}`); return requires[name]; }, module, module.exports, callback => { const id = ++timerSerial; timers.set(id, callback); return id; }, id => timers.delete(id));
  function render() {
    let result;
    for (let count = 0; count < 12; count++) {
      cursor = 0; dirty = false; effects = [];
      result = module.exports.useCarePreview(activeChild, online, false, undefined, undefined, scope, entry);
      effects.forEach(effect => effect());
      if (!dirty) return result;
    }
    throw new Error("Unstable hook render");
  }
  if (scenario === "prior_consent") { render().changeCondition("prior_consent"); render(); }
  return { render, flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); return render(); }, timers,
    scope(nextChild, nextScope) { activeChild = nextChild; scope = nextScope; return render(); }, entry(next) { entry = next; return render(); }, online(next) { online = next; return render(); } };
}
const pending = (api, kind = "create") => api.model.review.items.find(item => item.reviewState === "pending" && item.writeState === "not_saved" && item.target.kind === kind);
const recordSnapshot = api => JSON.stringify(api.model.list.records);
const confirm = (api, proposal) => api.actions.confirmCapture(proposal.id, proposal.version, proposal.sourceVersion);

function createManual(h, text) {
  let api = h.render(); api.actions.startCreate(); api = h.render();
  api.actions.reviewDraft({ ...values.emptyCareForm(), text, source: "Explicit test data" }); api = h.render(); api.actions.submitReviewed(); return h.flush();
}

test("Pending proposals and opening an editable draft never change canonical records", () => {
  const h = owner(); let api = h.render(); const before = recordSnapshot(api), proposal = pending(api);
  api.actions.reviewCapture(proposal.id, proposal.version, proposal.sourceVersion); api = h.render();
  assert.equal(recordSnapshot(api), before); assert.equal(api.model.draft.captureSnapshot.originalText, proposal.originalText);
  assert.equal(api.model.draft.reviewedValues, null); assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "pending");
  api.actions.reviewDraft({ ...api.model.draft.initialValues, text: "An edited proposal" }); api = h.render();
  assert.equal(recordSnapshot(api), before); assert.equal(api.model.draft.captureSnapshot.originalText, proposal.originalText);
  api.actions.submitReviewed(); api = h.render(); assert.equal(api.model.operation.state, "saving"); assert.equal(recordSnapshot(api), before);
  api = h.flush(); assert.equal(api.model.operation.state, "saved"); assert.equal(api.model.list.records[0].current.values.text, "An edited proposal");
  assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "confirmed");
});

test("Confirming an update uses its existing record and expected version without creating a duplicate", () => {
  const h = owner(); let api = h.render(); const proposal = pending(api, "update"), count = api.model.list.records.length;
  confirm(api, proposal); api = h.render(); assert.equal(api.model.list.records.length, count);
  api = h.flush(); assert.equal(api.model.list.records.length, count);
  const saved = api.model.list.records.find(item => item.id === proposal.target.recordId);
  assert.equal(saved.current.version, proposal.target.expectedVersion + 1); assert.equal(saved.current.values.text, proposal.proposedValues.text);
  assert.equal(api.model.review.items.find(item => item.id === proposal.id).savedRecord.current.version, saved.current.version);
});

test("Skip preserves both canonical records and a distinct skipped item in the shared history", () => {
  const h = owner(); let api = h.render(); const proposal = pending(api), before = recordSnapshot(api);
  api.actions.skipCapture(proposal.id, proposal.version); api = h.render();
  assert.equal(recordSnapshot(api), before); assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "skipped");
  api = h.entry("review-history"); assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "skipped");
  assert.equal(recordSnapshot(api), before); confirm(api, api.model.review.items.find(item => item.id === proposal.id));
  assert.equal(h.render().model.operation.state, "none");
});

test("Unknown freezes the same approved body and result, with no duplicate write or skip", () => {
  const h = owner(); let api = h.render(); api.setOutcome("unknown"); api = h.render();
  const proposal = pending(api), before = recordSnapshot(api); confirm(api, proposal); confirm(api, proposal);
  assert.equal(h.timers.size, 1); api = h.flush(); const reference = api.model.operation.reference;
  assert.equal(api.model.operation.state, "unknown"); assert.equal(recordSnapshot(api), before);
  api.actions.skipCapture(proposal.id, proposal.version); api.actions.reviewCapture(proposal.id, proposal.version, proposal.sourceVersion); api.invalidateCaptureSource();
  api = h.render(); assert.equal(api.model.operation.reference, reference); assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "pending");
  api.setLookupOutcome("not_applied"); api = h.render(); api.actions.checkOriginalOperation(); api = h.flush();
  assert.equal(api.model.operation.state, "unknown"); assert.equal(api.model.operation.reference, reference); assert.equal(api.model.operation.retryAvailable, true);
  api.setLookupOutcome("saved"); api = h.render(); api.actions.checkOriginalOperation(); api = h.flush();
  assert.equal(api.model.operation.state, "saved"); assert.equal(api.model.operation.reference, reference);
  assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "confirmed");
  assert.equal(api.model.list.records.filter(item => item.id === api.model.detail.record.id).length, 1);
});

test("Failed writes remain pending and do not change canonical records", () => {
  const h = owner(); let api = h.render(); api.setOutcome("failed"); api = h.render(); const proposal = pending(api), before = recordSnapshot(api);
  confirm(api, proposal); api = h.flush(); assert.equal(api.model.operation.state, "failed");
  assert.equal(recordSnapshot(api), before); assert.equal(api.model.review.items.find(item => item.id === proposal.id).reviewState, "pending");
});

test("Source changes invalidate confirmation while preserving the uncommitted draft and raw snapshot", () => {
  const h = owner(); let api = h.render(); const proposal = pending(api), before = recordSnapshot(api);
  api.actions.reviewCapture(proposal.id, proposal.version, proposal.sourceVersion); api = h.render(); const staleConfirm = api.actions.confirmCapture; api.invalidateCaptureSource(); staleConfirm(proposal.id, proposal.version, proposal.sourceVersion); api = h.render();
  assert.equal(api.model.draft.captureSnapshot.originalText, proposal.originalText);
  api.actions.reviewDraft({ ...api.model.draft.initialValues, text: "Do not commit this" }); api = h.render();
  assert.equal(api.model.draft.reviewedValues, null); api.actions.submitReviewed(); api = h.flush(); assert.equal(recordSnapshot(api), before);
});

test("Read-only, changed source, stale record basis and create-only capability block inappropriate writes", () => {
  for (const condition of ["read_only", "source_changed", "proposal_stale", "create_only"]) {
    const h = owner(); let api = h.render(); api.changeCondition(condition); api = h.render(); const proposal = pending(api, "update"), before = recordSnapshot(api);
    confirm(api, proposal); api = h.flush(); assert.equal(recordSnapshot(api), before); assert.equal(api.model.operation.state, "none");
  }
});

test("Scope changes abort late callbacks and withhold other children's proposals", () => {
  const h = owner(); let api = h.render(); confirm(api, pending(api));
  api = h.scope({ ...child, id: "preview-child-2" }, "second-user-child-scope"); api = h.flush();
  assert.equal(api.model.operation.state, "none"); assert.equal(api.model.list.records.every(record => record.childId === "preview-child-2"), true);
  assert.equal(api.model.review.items.every(item => item.childId === "preview-child-2"), true);
  assert.equal(values.authorizedCareCaptureReview({ ...api.model, scopeKey: "mismatched" }).items.length, 0);
  api.changeCondition("access_lost"); api = h.render(); assert.equal(values.authorizedCareCaptureReview(api.model).items.length, 0);
});

test("An already written item reads current canonical values after later correction", () => {
  const h = owner(); let api = h.render(); const written = api.model.review.items.find(item => item.writeState === "saved");
  api.actions.startCorrection(written.resolution.recordId); api = h.render();
  api.actions.reviewDraft({ ...api.model.draft.initialValues, text: "Corrected canonical content", reason: "Original misunderstanding" }); api = h.render(); api.actions.submitReviewed(); api = h.flush();
  const item = api.model.review.items.find(item => item.id === written.id);
  assert.equal(item.savedRecord.current.values.text, "Corrected canonical content"); assert.equal(item.savedRecord.current.version, written.resolution.recordVersion + 1);
  assert.equal(item.proposedValues.text, written.proposedValues.text);
});

test("The gate is capped at ten ten-item pages without auto-processing older pending items", () => {
  const base = fixtures.createCareCaptureFixtures(child.id).find(item => item.reviewState === "pending" && item.writeState === "not_saved");
  const all = Array.from({ length: 125 }, (_, index) => ({ ...base, id: `test-${index}`, reviewState: index % 3 === 0 ? "confirmed" : "pending" }));
  const window = values.careReviewWindow(all); assert.equal(window.recent.length, 100); assert.equal(window.older.length, 25);
  assert.equal(window.olderPendingCount, all.slice(100).filter(item => item.reviewState === "pending").length);
  const first = values.careReviewPage(window.recent, 0), next = values.careReviewPage(window.recent, 1), end = values.careReviewPage(window.recent, 99);
  assert.equal(first.items.length, 10); assert.equal(next.items.length, 10); assert.equal(first.items.some(item => next.items.some(other => other.id === item.id)), false);
  assert.equal(end.page, 9); assert.equal(end.hasNext, false); assert.equal(window.older[0].reviewState, all[100].reviewState);
});

test("Stored record pagination replaces the page, supports previous and retains applied filters", () => {
  const h = owner(); let api;
  for (let i = 0; i < 5; i++) api = createManual(h, `Pagination test ${i}`);
  api.actions.closePanel(); api = h.render(); api.actions.search("", "all"); api = h.flush();
  const firstIds = api.model.list.records.map(record => record.id); assert.equal(firstIds.length, 10); assert.equal(api.model.list.hasMore, true);
  api.actions.loadMore(); api = h.flush(); assert.equal(api.model.list.page, 2); assert.equal(api.model.list.records.length, 1);
  assert.equal(api.model.list.records.some(record => firstIds.includes(record.id)), false); assert.equal(api.model.list.activeKind, "all");
  api.actions.previousPage(); api = h.render(); assert.equal(api.model.list.page, 1); assert.deepEqual(api.model.list.records.map(record => record.id), firstIds);
});

const important = api => api.model.review.items.find(item => item.reviewRequirement === "required");
const confirmImportant = (api, item, overrides = {}) => api.actions.confirmImportantRecord(item.id, overrides.version ?? item.version, overrides.sourceVersion ?? item.sourceVersion, overrides.recordId ?? item.savedRecord.id, overrides.recordVersion ?? item.savedRecord.current.version, overrides.scopeKey ?? api.model.scopeKey);

test("Storage success is independent of important human confirmation and ordinary records need no acknowledgement", () => {
  const h = owner(); let api = h.render(); const required = important(api);
  assert.equal(required.writeState, "saved"); assert.equal(required.reviewState, "pending");
  const ordinary = api.model.review.items.find(item => item.reviewRequirement === "optional");
  assert.equal(ordinary.writeState, "saved"); assert.equal(ordinary.reviewState, "not_required");
  const forged = values.projectCareCaptures([{ ...required, reviewState: "confirmed", confirmation: undefined }], api.model.list.records, child.id, api.model.scopeKey)[0];
  assert.equal(forged.reviewState, "pending");
  api.actions.closePanel(); api = h.entry("chat"); assert.equal(important(api).reviewState, "pending");
  assert.equal(important(owner().render()).reviewState, "pending");
});

test("Explicit important confirmation binds current content and does not rewrite canonical records", () => {
  const h = owner(); let api = h.render(); const item = important(api), before = recordSnapshot(api);
  confirmImportant(api, item); api = h.render(); assert.equal(important(api).reviewState, "pending"); assert.equal(api.model.operation.state, "saving");
  api = h.flush(); assert.equal(important(api).reviewState, "confirmed"); assert.equal(recordSnapshot(api), before);
  assert.equal(important(api).confirmation.recordVersion, item.savedRecord.current.version); assert.equal(important(api).confirmation.scopeKey, api.model.scopeKey);
  api = h.entry("review-history"); assert.equal(important(api).reviewState, "confirmed");
});

test("An unknown important acknowledgement keeps its yellow state until the original receipt is known", () => {
  const h = owner(); let api = h.render(); api.setOutcome("unknown"); api = h.render(); const item = important(api), before = recordSnapshot(api);
  confirmImportant(api, item); api = h.flush(); const reference = api.model.operation.reference;
  assert.equal(important(api).reviewState, "pending"); assert.equal(api.model.operation.kind, "review");
  api.actions.skipCapture(item.id, item.version); confirmImportant(api, item); api.actions.closePanel(); api = h.render();
  assert.equal(important(api).reviewState, "pending"); assert.equal(api.model.operation.reference, reference); assert.equal(recordSnapshot(api), before);
  api.setLookupOutcome("saved"); api = h.render(); api.actions.checkOriginalOperation(); api = h.flush();
  assert.equal(important(api).reviewState, "confirmed"); assert.equal(api.model.operation.reference, reference); assert.equal(recordSnapshot(api), before);
});

test("Changing an important record preserves yellow and rejects a confirmation for the old version", () => {
  const h = owner(); let api = h.render(); const item = important(api);
  api.actions.startCorrection(item.savedRecord.id); api = h.render();
  api.actions.reviewDraft({ ...api.model.draft.initialValues, text: "Correct important interpretation", reason: "Misunderstood the arrangement" }); api = h.render(); api.actions.submitReviewed(); api = h.flush();
  assert.equal(important(api).reviewState, "pending"); assert.equal(important(api).savedRecord.current.version, item.savedRecord.current.version + 1);
  api.actions.closePanel(); api = h.render(); confirmImportant(api, item); api = h.flush(); assert.equal(important(api).reviewState, "pending");
  confirmImportant(api, important(api)); api = h.flush(); assert.equal(important(api).reviewState, "confirmed");
  api.actions.startCorrection(item.savedRecord.id); api = h.render(); api.actions.reviewDraft({ ...api.model.draft.initialValues, text: "Another later change", reason: "Changed arrangement" }); api = h.render(); api.actions.submitReviewed(); api = h.flush();
  assert.equal(important(api).reviewState, "pending");
});

test("Important confirmation rejects stale source, proposal, target or scope and cannot be skipped", () => {
  for (const overrides of [{ scopeKey: "another-user" }, { recordVersion: 99 }, { recordId: "another-record" }, { sourceVersion: "old-source" }, { version: 99 }]) {
    const h = owner(); let api = h.render(); const item = important(api), before = recordSnapshot(api);
    confirmImportant(api, item, overrides); api.actions.skipCapture(item.id, item.version); api = h.flush();
    assert.equal(important(api).reviewState, "pending"); assert.equal(recordSnapshot(api), before);
  }
  const h = owner(); let api = h.render(); api.changeCondition("source_changed"); api = h.render(); confirmImportant(api, important(api)); api = h.flush(); assert.equal(important(api).reviewState, "pending");
});

test("Automatic chat prompts require an explicit matching conversation/source/version event", () => {
  const api = owner().render(), item = { ...important(api), conversationId: "authorized-conversation" };
  const event = { scopeKey: api.model.scopeKey, conversationId: item.conversationId, sourceId: item.sourceId, sourceVersion: item.sourceVersion, proposalId: item.id, proposalVersion: item.version, recordId: item.savedRecord.id, recordVersion: item.savedRecord.current.version };
  assert.equal(values.careImportantEventMatches(item, event, api.model.scopeKey, item.conversationId), true);
  assert.equal(values.careImportantEventMatches(item, event, api.model.scopeKey, undefined), false);
  assert.equal(values.careImportantEventMatches(item, event, api.model.scopeKey, "other-conversation"), false);
  assert.equal(values.careImportantEventMatches(item, { ...event, recordVersion: 99 }, api.model.scopeKey, item.conversationId), false);
  assert.equal(values.careImportantEventMatches(item, { ...event, sourceId: "unrelated-source" }, api.model.scopeKey, item.conversationId), false);
  assert.equal(values.careImportantEventMatches({ ...item, conversationId: undefined }, event, api.model.scopeKey, item.conversationId), false);
});


test("Multi-chat viewing and returning keeps accumulated changes without dispatching writes", () => {
  const h = owner(); let api = h.render(); const before = recordSnapshot(api);
  const grouped = values.careReviewSourceGroups(api.model.review.items);
  assert.equal(grouped.length, 5); assert.equal(api.model.review.items.length, 6);
  assert.ok(api.model.review.items.every(item => item.sourceContext.messageId && item.sourceContext.runId && Number.isFinite(Date.parse(item.sourceContext.occurredAt))));
  api = h.entry("chat"); api = h.entry("care"); api = h.entry("review-history"); api = h.entry("care");
  assert.equal(h.timers.size, 0); assert.equal(api.model.operation.state, "none"); assert.equal(recordSnapshot(api), before);
  assert.equal(api.model.review.items.filter(item => item.reviewState === "pending").length, 4);
  const ordered = values.careReviewPrioritize(api.model.review.items);
  assert.ok(ordered.slice(0, 2).every(values.careReviewIsImportantPending));
  assert.ok(ordered.slice(2).every(item => !values.careReviewIsImportantPending(item)));
  assert.ok(values.careReviewMatchesQuery(ordered.find(item => item.id.endsWith("sleep-written")), "補充夜間醒來"));
});

test("Multi-chat expired operation remains important and unresolved without stale submission", () => {
  const h = owner(); let api = h.render(); const before = recordSnapshot(api);
  const item = api.model.review.items.find(item => item.operationValidity?.state === "expired");
  confirm(api, item); api.actions.reviewCapture(item.id, item.version, item.sourceVersion); api.actions.skipCapture(item.id, item.version); api = h.flush();
  assert.equal(api.model.operation.state, "none"); assert.equal(api.model.draft, null); assert.equal(recordSnapshot(api), before);
  api = h.entry("review-history"); assert.equal(api.model.review.items.find(other => other.id === item.id).reviewState, "pending");
  assert.equal(values.careReviewWindow(api.model.review.items).importantPendingCount, 2);
  api = h.scope({ ...child, id: "preview-child-2" }, "another-child");
  assert.equal(api.model.review.items.some(other => other.id === item.id), false);
});

test("Multi-chat saved update retains its before value and ordinary correction uses the canonical owner", () => {
  const h = owner(); let api = h.render(); const item = api.model.review.items.find(item => item.id.endsWith("sleep-written"));
  const before = item.basis.history.find(revision => revision.version === item.target.expectedVersion).values.text;
  assert.equal(item.reviewState, "not_required"); assert.equal(item.savedRecord.current.version, 3);
  api.actions.startCorrection(item.savedRecord.id); api = h.render();
  api.actions.reviewDraft({ ...api.model.draft.initialValues, text: "Corrected from the earlier conversation", reason: "Correction" }); api = h.render(); api.actions.submitReviewed(); api = h.flush();
  const updated = api.model.review.items.find(other => other.id === item.id);
  assert.equal(updated.reviewState, "not_required"); assert.equal(updated.savedRecord.current.version, 4);
  assert.equal(updated.basis.history.find(revision => revision.version === item.target.expectedVersion).values.text, before);
  assert.equal(updated.originalText, item.originalText); assert.equal(updated.proposedValues.text, item.proposedValues.text);
});


test("Normal fixtures auto-save ordinary writes while retaining explicit prior-consent scenarios", () => {
  const h = owner("normal"); const api = h.render();
  const ordinary = api.model.review.items.filter(item => item.reviewRequirement === "optional");
  assert.equal(ordinary.length, 4);
  assert.ok(ordinary.every(item => item.writeState === "saved" && item.reviewState === "not_required" && item.savedRecord));
  assert.equal(api.model.review.items.filter(values.careReviewNeedsConfirmation).length, 2);
  const updated = ordinary.find(item => item.id.endsWith("sleep-update"));
  assert.equal(updated.savedRecord.current.version, 4);
  assert.equal(updated.savedRecord.current.values.text, updated.proposedValues.text);
  assert.equal(updated.basis.history.find(item => item.version === updated.target.expectedVersion).version, 3);
  api.changeCondition("prior_consent"); const prior = h.render();
  assert.equal(prior.model.review.items.filter(item => item.reviewRequirement === "prewrite" && item.writeState === "not_saved").length, 2);
  prior.changeCondition("source_changed"); const changed = h.render();
  assert.equal(changed.model.review.items.filter(item => item.reviewRequirement === "prewrite").length, 2);
  assert.ok(changed.model.review.items.every(item => item.sourceState === "changed"));
});
