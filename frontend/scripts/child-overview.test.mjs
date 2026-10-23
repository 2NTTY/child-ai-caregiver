import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as viewModel from "../src/profile-view-model.ts";
import * as fixtures from "../src/preview/profile-fixture.ts";

// Deterministic hook harness for the actual preview controllers. No DOM/browser claims.
function workspace() {
  const slots = [], timers = new Map();
  let cursor = 0, dirty = false, effects = [], timerId = 0, value;
  let props = [{ id: "preview-child-1", displayName: "Child A", accessRole: "owner" }, true, false, "account-a:preview-child-1:owner", "profile"];
  const guards = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === "function" ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || !deps || deps.some((dep, index) => !Object.is(dep, old.deps?.[index]))) {
        slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const sandbox = { setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  function load(file, dependencies) {
    const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(code, { ...sandbox, exports, require: name => { if (name === "react") return react; if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import: ${name}`); } });
    return exports;
  }
  const operation = load("../src/preview/usePreviewOperation.ts", { "./PreviewNavigationGuard": { usePreviewLeaveGuard: (dirty, pending) => guards.push({ dirty, pending }) } });
  const { useProfilePreview } = load("../src/preview/useProfilePreview.ts", { "../profile-view-model": viewModel,
    "./profile-fixture": fixtures, "./usePreviewOperation": operation });
  function render() {
    let rounds = 0;
    do { assert.ok(rounds++ < 20, "hook renders settle"); dirty = false; cursor = 0; effects = []; guards.length = 0;
      value = useProfilePreview(...props); for (const effect of effects) effect();
    } while (dirty);
    return value;
  }
  render();
  return {
    get value() { return value; }, get guards() { return guards; },
    act(fn) { fn(value); return render(); },
    entry(entry) { props[4] = entry; return render(); },
    state({ child, scope, online, reading, entry } = {}) { if (entry !== undefined) props[4] = entry; if (child) props[0] = child; if (scope) props[3] = scope; if (online !== undefined) props[1] = online; if (reading !== undefined) props[2] = reading; return render(); },
    flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); return render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const overviewExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/child-overview-view-model.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: overviewExports, require: name => { assert.equal(name, "./profile-view-model"); return viewModel; } });
const { readChildProfile, childProfileAgeLabel, authorizedChildMeasurements } = overviewExports;
const scope = "account-a:preview-child-1:owner";
const read = w => readChildProfile(w.value.model, scope, "2026-10-05");
function savePreference(w, preferences = "午睡前由孩子選一本繪本") {
  w.act(p => p.actions.reviewDraft({ ...p.model.initialValues, preferences, reason: "Confirmed update" }));
  w.act(p => p.actions.submitReviewed());
}

test("confirmed profile edits and deletion have one owner across profile and overview", () => {
  const w = workspace(); savePreference(w); w.flushTimers();
  const revision = w.value.model.current;
  w.entry("overview");
  assert.equal(read(w).data.preferences, "午睡前由孩子選一本繪本");
  assert.equal(w.value.model.current, revision);
  w.entry("profile");
  assert.equal(w.value.model.initialValues.preferences, revision.data.preferences);
  w.act(p => p.actions.reviewDeletion()); w.act(p => p.actions.submitReviewed()); w.flushTimers();
  w.entry("overview"); assert.equal(read(w).state, "missing");
  w.act(p => p.actions.showHistory()); assert.equal(w.value.model.history.length, 0);
  w.unmount();
});

test("approved departure clears transient review but preserves confirmed source and history entry", () => {
  const w = workspace(); const original = w.value.model.current;
  w.act(p => p.actions.reviewDraft({ ...p.model.initialValues, preferences: "Unsaved" }));
  w.entry("overview");
  assert.equal(w.value.model.reviewedValues, null); assert.equal(w.value.model.operation.state, "none");
  assert.equal(w.value.model.current, original);
  w.act(p => p.actions.showHistory()); w.entry("profile");
  assert.equal(w.value.model.historyOpen, true); assert.ok(w.value.model.history.length > 0);
  w.unmount();
});

test("unknown retains its original operation and reviewed values across attempted departure", () => {
  const w = workspace(); w.act(p => p.controller.setOutcome("unknown")); savePreference(w); w.flushTimers();
  const reference = w.value.controller.operation.reference, reviewed = w.value.model.reviewedValues;
  assert.equal(w.value.model.operation.state, "unknown"); assert.ok(w.guards.some(guard => guard.pending));
  w.entry("overview");
  assert.equal(w.value.model.operation.reference, reference); assert.equal(w.value.model.reviewedValues, reviewed);
  w.act(p => p.changeCondition("normal")); assert.equal(w.value.model.operation.reference, reference);
  w.act(p => p.controller.setCheckOutcome("saved")); w.act(p => p.controller.check()); w.flushTimers();
  assert.equal(w.value.model.current.data.preferences, reviewed.preferences);
  assert.equal(w.value.model.operation.reference, reference);
  w.unmount();
});

test("scope changes and revocation reject late saves and callbacks captured by the prior child", () => {
  const w = workspace(), oldActions = w.value.actions;
  savePreference(w, "Must not reach Child B");
  w.state({ child: { id: "child-b", displayName: "Child B", accessRole: "viewer" }, scope: "account-b:child-b:viewer", entry: "overview" });
  w.flushTimers();
  assert.equal(w.value.model.access, "read_only"); assert.equal(w.value.model.current.data, null);
  assert.equal(w.value.model.initialValues.preferences, ""); assert.equal(w.value.model.basis.data, null);
  w.act(() => oldActions.reviewDraft({ ...viewModel.emptyProfileForm(), preferences: "Old callback" }));
  assert.equal(w.value.model.reviewedValues, null);
  w.act(p => p.changeCondition("access_lost"));
  assert.equal(read(w).state, "access_lost"); assert.equal(w.value.model.current, null); assert.equal(w.value.model.history.length, 0);
  w.unmount();
});

test("last confirmed values preserve unknowns and raw age while missing and expired profiles stay explicit", () => {
  const w = workspace(), model = w.value.model;
  assert.equal(read(w).state, "confirmed"); assert.equal(read(w).data.allergies, null);
  assert.equal(childProfileAgeLabel(read(w).data), "約 38 個月（截至 2026-09-01）");
  assert.equal(readChildProfile(model, scope, "2026-12-31").state, "confirmed");
  const expired = readChildProfile(model, scope, "2027-01-01");
  assert.equal(expired.state, "expired"); assert.equal(expired.data, model.current.data);
  assert.equal(readChildProfile({ ...model, current: { ...model.current, data: { ...model.current.data, validUntil: "2026-02-30" } } }, scope, "2026-10-05").state, "validity_unknown");
  const invalid = readChildProfile(model, scope, "2026-10-05", { scopeKey: scope, childId: model.child.id, state: "invalidated" });
  assert.equal(invalid.state, "source_invalidated"); assert.equal(invalid.data, null);
  assert.equal(readChildProfile(model, scope, "2026-10-05", { scopeKey: "another-scope", childId: model.child.id, state: "available" }).data, null);
  assert.equal(readChildProfile({ ...model, operation: { ...model.operation, resultUnavailable: true } }, scope, "2026-10-05").state, "source_unavailable");
  w.act(p => p.changeCondition("no_profile")); assert.equal(read(w).state, "missing");
  w.unmount();
});

test("measurements require same-scope canonical read projection and never reuse unavailable payloads", () => {
  const w = workspace(), model = w.value.model;
  const height = { valueLabel: "101 cm", measuredAtLabel: "2026-10-01", sourceLabel: "Synthetic canonical measurement", recordId: "height-record", recordVersion: 7, state: "current" };
  const projection = { scopeKey: scope, childId: model.child.id, state: "ready", height, weight: null };
  assert.equal(authorizedChildMeasurements(undefined, scope, model), null);
  assert.equal(authorizedChildMeasurements(projection, "new-account", model), null);
  assert.equal(authorizedChildMeasurements({ ...projection, childId: "other-child" }, scope, model), null);
  assert.equal(authorizedChildMeasurements(projection, scope, { ...model, access: "lost" }), null);
  assert.equal(authorizedChildMeasurements({ ...projection, state: "error" }, scope, model).height, null);
  assert.equal(authorizedChildMeasurements(projection, scope, model).height.valueLabel, "101 cm");
  assert.equal(authorizedChildMeasurements(projection, scope, model).weight, null);
  for (const recordVersion of [undefined, 0, -1, 1.5]) {
    assert.equal(authorizedChildMeasurements({ ...projection, height: { ...height, recordVersion } }, scope, model).height, null);
  }
  assert.equal(authorizedChildMeasurements(projection, scope, model).height.recordVersion, 7);
  assert.equal(authorizedChildMeasurements({ ...projection, height: { ...height, state: "expired" } }, scope, model).height.state, "expired");
  assert.equal(authorizedChildMeasurements({ ...projection, height: { ...height, state: "source_invalidated" } }, scope, model).height.valueLabel, "");
  w.unmount();
});

test("original profile and current child content consume shared owner without copying care fixtures", () => {
  const readFile = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const profile = readFile("../src/screens/profileScreen.tsx"), content = readFile("../src/components/child-overview/ChildOverviewContent.tsx");
  assert.ok(profile.includes("useProfileWorkspace()")); assert.ok(!profile.includes("useProfilePreview("));
  assert.ok(content.includes("useProfileWorkspace()")); assert.ok(!content.includes("createCareFixtures"));
  assert.ok(!content.includes("useSummaryPreview")); assert.ok(content.includes("AppStatusBadge")); assert.ok(content.includes("AppButton"));
});

test("birth dates derive display-only calendar age while unknown and approximate stay raw", () => {
  const age = (date, today) => childProfileAgeLabel({ age: { kind: "birth_date", date } }, today);
  assert.equal(age("2023-06-08", "2026-10-23"), "3 歲 4 個月");
  assert.equal(age("2023-06-24", "2026-10-23"), "3 歲 3 個月");
  assert.equal(age("2026-10-23", "2026-10-23"), "0 日");
  assert.equal(age("2026-10-01", "2026-10-23"), "22 日");
  assert.equal(age("2026-01-31", "2026-02-28"), "1 個月");
  assert.equal(age("2024-02-29", "2025-02-28"), "1 歲");
  assert.equal(age("2026-02-30", "2026-10-23"), "出生日期待核對");
  assert.equal(age("2026-10-24", "2026-10-23"), "出生日期待核對");
  assert.equal(age("2023-06-08", undefined), "出生日期 2023-06-08");
  assert.equal(childProfileAgeLabel(null, "2026-10-23"), "年齡未知");
  assert.equal(childProfileAgeLabel({ age: { kind: "unknown" } }, "2026-10-23"), "年齡未知");
  assert.equal(childProfileAgeLabel({ age: { kind: "approximate", rawValue: "約三", unit: "years", asOf: "2026-01-01" } }, "2026-10-23"), "約 約三 歲（截至 2026-01-01）");
});
