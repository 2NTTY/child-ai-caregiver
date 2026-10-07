import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as viewModel from "../src/task-view-model.ts";
import * as fixtures from "../src/preview/task-fixture.ts";
import * as forms from "../src/components/tasks/task-form.ts";
import * as pagination from "../src/preview/task-pagination.ts";

// Deterministic hook harness for the actual preview controllers. No DOM/browser claims.
function workspace() {
  const slots = [], timers = new Map();
  let cursor = 0, dirty = false, effects = [], timerId = 0, value;
  let props = [{ id: "child-a", displayName: "Child A", accessRole: "owner" }, true, false, "account-a:child-a:owner", "tasks"];
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
  const { useTasksPreview } = load("../src/preview/useTasksPreview.ts", { "../task-view-model": viewModel, "../components/tasks/task-form": forms,
    "./task-fixture": fixtures, "./task-pagination": pagination, "./usePreviewOperation": operation });
  function render() {
    let rounds = 0;
    do { assert.ok(rounds++ < 20, "hook renders settle"); dirty = false; cursor = 0; effects = []; guards.length = 0;
      value = useTasksPreview(...props); for (const effect of effects) effect();
    } while (dirty);
    return value;
  }
  render();
  return {
    get value() { return value; }, get guards() { return guards; },
    act(fn) { fn(value); return render(); },
    entry(entry) { props[4] = entry; return render(); },
    state({ child, scope, online, reading } = {}) { if (child) props[0] = child; if (scope) props[3] = scope; if (online !== undefined) props[1] = online; if (reading !== undefined) props[2] = reading; return render(); },
    flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); return render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function completeFirst(w) {
  const task = w.value.model.items.find(item => item.occurrence.state === "scheduled");
  w.act(p => p.actions.startChange(task.id, "complete"));
  w.act(p => p.actions.reviewDraft({ ...p.model.draft.initialValues, note: "Confirmed in preview" }));
  w.act(p => p.actions.submitReviewed());
  return task.id;
}

test("one task owner keeps confirmed updates across Tasks and History entry changes", () => {
  const w = workspace(), id = completeFirst(w);
  w.flushTimers();
  assert.equal(w.value.model.items.find(item => item.id === id).occurrence.state, "completed");
  assert.equal(w.value.model.items.find(item => item.id === id).completedAt, fixtures.taskPreviewClock.asOf);
  w.entry("task-history");
  assert.equal(w.value.model.selected, null);
  assert.ok(viewModel.searchTaskHistory(w.value.model.items, "到診資料", "all", w.value.model.eligibleAssignees).some(item => item.id === id));
  w.entry("tasks");
  assert.ok(viewModel.recentCompletedTasks(w.value.model.items).some(item => item.id === id));
  assert.equal(viewModel.pendingTasks(w.value.model.items).some(item => item.id === id), false);
  w.unmount();
});

test("selected rows toggle closed, other rows switch, and drafts prevent either", () => {
  const w = workspace(), [first, second] = w.value.model.items;
  w.act(p => p.actions.selectTask(first.id, "toggle")); assert.equal(w.value.model.selected.id, first.id);
  w.act(p => p.actions.selectTask(first.id, "toggle")); assert.equal(w.value.model.selected, null);
  w.act(p => p.actions.selectTask(first.id, "toggle")); w.act(p => p.actions.selectTask(second.id, "toggle")); assert.equal(w.value.model.selected.id, second.id);
  w.act(p => p.actions.startChange(second.id, "complete"));
  w.act(p => p.actions.selectTask(first.id, "toggle")); assert.equal(w.value.model.selected.id, second.id);
  w.unmount();
});

test("unknown original operation stays locked with original reference across attempted departure", () => {
  const w = workspace(); w.act(p => p.controller.setOutcome("unknown")); completeFirst(w); w.flushTimers();
  const reference = w.value.controller.operation.reference, draft = w.value.model.draft;
  assert.equal(w.value.controller.operation.state, "unknown"); assert.ok(w.guards.some(guard => guard.pending));
  w.entry("task-history");
  assert.equal(w.value.controller.operation.reference, reference); assert.equal(w.value.model.draft, draft);
  w.act(p => p.changeCondition("normal")); assert.equal(w.value.controller.operation.reference, reference);
  w.act(p => p.controller.setCheckOutcome("saved")); w.act(p => p.controller.check()); w.flushTimers();
  assert.equal(w.value.controller.operation.state, "saved"); assert.equal(w.value.controller.operation.reference, reference);
  w.unmount();
});

test("scope and access revocation clear old tasks, drafts and pending callbacks", () => {
  const w = workspace(); completeFirst(w);
  w.state({ child: { id: "child-b", displayName: "Child B", accessRole: "viewer" }, scope: "account-b:child-b:viewer" });
  w.flushTimers();
  assert.equal(w.value.model.access, "read_only"); assert.equal(w.value.model.draft, null);
  assert.ok(w.value.model.items.every(task => task.childId === "child-b"));
  w.act(p => p.actions.startCreate()); assert.equal(w.value.model.draft, null);
  w.act(p => p.changeCondition("access_lost"));
  assert.equal(w.value.model.items.length, 0); assert.equal(w.value.model.selected, null); assert.equal(w.value.model.history.length, 0);
  assert.equal(w.value.model.work.length, 0); assert.equal(w.value.model.reminders.length, 0);
  w.unmount();
});

test("callbacks captured in an old scope cannot open or write a new child workspace", () => {
  const w = workspace(), oldActions = w.value.actions, oldId = w.value.model.items[0].id;
  w.state({ child: { id: "child-b", displayName: "Child B", accessRole: "owner" }, scope: "account-a:child-b:owner" });
  w.act(() => oldActions.startCreate()); assert.equal(w.value.model.draft, null);
  w.act(() => oldActions.startChange(oldId, "complete")); assert.equal(w.value.model.draft, null);
  w.act(() => oldActions.selectTask(oldId)); assert.equal(w.value.model.selected, null);
  const beforeLoss = w.value.actions; w.act(p => p.changeCondition("access_lost"));
  w.act(() => beforeLoss.startCreate()); assert.equal(w.value.model.draft, null);
  w.unmount();
});

test("shared pagination extends history and access loss cancels late pages", () => {
  const w = workspace(); w.act(p => p.changeCondition("many_items"));
  w.entry("task-history"); assert.equal(viewModel.searchTaskHistory(w.value.model.items, "", "all", []).length, 0);
  w.act(p => p.actions.loadMoreTasks()); w.flushTimers();
  assert.equal(viewModel.searchTaskHistory(w.value.model.items, "", "all", []).length, 1);
  w.entry("tasks"); assert.equal(w.value.model.items.length, 51);
  w.act(p => p.changeCondition("many_items")); w.act(p => p.actions.loadMoreTasks()); w.act(p => p.changeCondition("access_lost")); w.flushTimers();
  assert.equal(w.value.model.items.length, 0); assert.equal(w.value.model.loadingMoreTasks, false);
  w.unmount();
});

test("offline prevents reviewed submission while loading hides stale task data and keeps draft", () => {
  const w = workspace(), first = w.value.model.items[0];
  w.act(p => p.actions.startChange(first.id, "complete")); w.act(p => p.actions.reviewDraft(p.model.draft.initialValues));
  w.state({ online: false }); w.act(p => p.actions.submitReviewed());
  assert.equal(w.value.model.operation.state, "needs_confirmation");
  const draft = w.value.model.draft; w.state({ reading: true });
  assert.equal(w.value.model.items.length, 0); assert.equal(w.value.model.draft, draft);
  w.state({ reading: false, online: true }); assert.equal(w.value.model.draft, draft);
  w.unmount();
});

test("dashboard mounts one task owner and screens consume it without duplicate fixtures", () => {
  const read = name => fs.readFileSync(new URL(name, import.meta.url), "utf8");
  const layout = read("../app/(dashboard)/_layout.tsx");
  assert.equal(layout.match(/<TasksWorkspaceProvider>/g)?.length, 1);
  assert.ok(!read("../src/screens/tasksScreen.tsx").includes("useTasksPreview("));
  assert.ok(!read("../src/components/tasks/TaskHistoryView.tsx").includes("useTasksPreview("));
  assert.ok(read("../src/screens/tasksScreen.tsx").includes("/history?category=tasks"));
  assert.ok(!read("../src/screens/careScreen.tsx").includes("task-history"));
});


test("preview task navigation is idempotent while row selection explicitly toggles", () => {
  const w = workspace(), [first, second] = w.value.model.items;
  w.act(p => p.actions.selectTask(first.id)); w.act(p => p.actions.selectTask(first.id)); assert.equal(w.value.model.selected.id, first.id);
  w.act(p => p.actions.selectTask(second.id)); assert.equal(w.value.model.selected.id, second.id);
  w.act(p => p.actions.selectTask(second.id, "toggle")); assert.equal(w.value.model.selected, null); w.unmount();
});
