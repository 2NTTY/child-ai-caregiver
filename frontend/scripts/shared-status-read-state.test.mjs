import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const jsx = (type, props, key) => ({ type, props, key });

// Executes the shipped hooks and view functions with synthetic transport and host primitives.
// This checks state transitions and accessibility props, not a browser or live service.
function harness(entry, symbol, args = [], overrides = {}) {
  let cursor = 0, changed = false;
  const slots = [], effects = [], cache = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; changed = true; } }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(factory, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { value: factory(), dependencies };
      return slots[index].value;
    },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.dependencies, dependencies)) {
        const current = { dependencies, cleanup: previous?.cleanup }; slots[index] = current;
        effects.push(() => { current.cleanup?.(); current.cleanup = callback(); });
      }
    },
    useId() { return "synthetic-id"; },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} }; cache.set(filename, module.exports);
    const resolve = name => {
      if (name in overrides) return overrides[name];
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react-native") return { View: "View", Pressable: "Pressable", StyleSheet: { create: value => value } };
      if (name === "react-native-paper") return { Text: "Text", ActivityIndicator: "ActivityIndicator" };
      if (name.endsWith("/theme")) return { colors: {}, radius: {}, readingType: {}, workspaceType: {}, spacing: {}, typeScale: {} };
      if (name.endsWith("/ui")) return Object.fromEntries(["AppButton", "SectionHeader", "SectionCard", "TextLink"].map(value => [value, value]));
      if (name.endsWith("/AppStatusBadge")) return { AppStatusBadge: "AppStatusBadge" };
      if (name.endsWith("/AppIcon")) return { AppIcon: "AppIcon" };
      if (name.endsWith("/HomeOverviewItems")) return { HomeOverviewItems: "HomeOverviewItems" };
      if (!name.startsWith(".")) return require(name);
      const file = path.resolve(path.dirname(filename), name);
      return load(existsSync(file) ? file : existsSync(`${file}.ts`) ? `${file}.ts` : `${file}.tsx`);
    };
    new Function("require", "module", "exports", output)(resolve, module, module.exports);
    return module.exports;
  }
  const renderFunction = load(path.join(root, entry))[symbol];
  return { render(nextArgs = args) {
    args = nextArgs; let result, rounds = 0;
    do {
      assert.ok(++rounds < 12, "Synthetic hook state must settle"); cursor = 0; changed = false;
      result = renderFunction(...args); while (effects.length) effects.shift()();
    } while (changed);
    return result;
  }, async settle() { await new Promise(setImmediate); return this.render(); },
  unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children)];
const byType = (tree, name) => nodes(tree).filter(node => node.type === name || node.type?.name === name);
const visibleText = tree => byType(tree, "Text").map(node => node.props.children).filter(value => typeof value === "string");
const task = { id: "8c0614da-d04f-454e-837a-b0d0f1649034", childId: "child", version: 1, title: "Synthetic task", details: "",
  kind: "ordinary", assigneeUserId: "user", createdBy: "user", createdAt: "2026-10-06T01:00:00Z", updatedAt: "2026-10-06T01:00:00Z",
  occurrence: { id: "occurrence", dueAt: "2026-10-06T02:00:00Z", timeZone: "Asia/Hong_Kong", state: "scheduled", terminalBasisVersion: null } };
class ApiError extends Error { constructor(status) { super("Synthetic transport error"); this.status = status; } }
function taskOwner() {
  const state = { readFailure: null, pending: false, receipt: null, writeInputs: [], reads: 0, historyReads: 0, checks: 0, invalidations: 0, active: true };
  const api = { async getSession() { return "user"; },
    async tasks() { state.reads++; if (state.readFailure) throw state.readFailure;
      return { items: [task], eligibleAssignees: [{ userId: "user", name: "Synthetic caregiver" }], nextAfterId: null }; },
    async changeTask(child, id, input) { state.pending = true; state.writeInputs.push(input); throw new ApiError(0); },
    async history() { state.historyReads++; return { revisions: [], nextBeforeVersion: null }; },
    async reconcilePending() { state.checks++; return state.receipt; },
    hasPendingOnline() { return state.pending; }, resetOnline() { state.pending = false; } };
  const env = { apiBaseUrl: "https://synthetic.invalid", userId: "user", childId: "child", childName: "Synthetic child", role: "owner", scopeKey: "scope", online: true,
    current: () => state.active, canStartWrite: () => true, accessError() {}, invalidate() { state.invalidations++; },
    queryClient: { setQueryDefaults() {}, cancelQueries() {}, removeQueries() {}, fetchQuery({ queryFn }) { return queryFn({ signal: new AbortController().signal }); } } };
  const owner = harness("src/production/task-knowledge-tasks.ts", "useTaskKnowledgeTasks", [env], {
    "../../../src/client/task-api": { createTaskApi: () => api, TaskApiError: ApiError },
    "./useDomainEnvironment": { useDomainWriteGuard() {} },
  });
  return { owner, state, env };
}

test("initial task read failure becomes error without creating a mutation; one retry becomes ready", async () => {
  const { owner, state } = taskOwner(); state.readFailure = new ApiError(503);
  let value = owner.render(); assert.equal(value.model.readState, "loading"); assert.equal(value.model.reading, true);
  value = await owner.settle();
  assert.equal(value.model.readState, "error"); assert.equal(value.model.reading, false);
  assert.deepEqual(value.model.operation, { state: "none", message: "", reference: null });
  assert.equal(state.reads, 1);
  state.readFailure = null; value.recovery.reloadCurrent(); value.recovery.reloadCurrent();
  assert.equal(owner.render().model.readState, "loading"); value = await owner.settle();
  assert.equal(value.model.readState, "ready"); assert.equal(value.model.reading, false);
  assert.equal(value.model.items[0].id, task.id); assert.equal(state.reads, 2);
  assert.equal(state.writeInputs.length, 0); assert.equal(state.invalidations, 0); owner.unmount();
});

test("failed refresh retains stale tasks, and revoked access exposes no old items", async () => {
  const { owner, state } = taskOwner(); owner.render(); let value = await owner.settle();
  state.readFailure = new ApiError(503); value.recovery.reloadCurrent(); value = await owner.settle();
  assert.equal(value.model.readState, "stale"); assert.equal(value.model.items[0].id, task.id);
  assert.equal(value.model.operation.state, "none");
  state.readFailure = new ApiError(403); value.recovery.reloadCurrent(); value = await owner.settle();
  assert.equal(value.model.access, "lost"); assert.equal(value.model.readState, "error"); assert.deepEqual(value.model.items, []);
  value.recovery.reloadCurrent(); await owner.settle(); assert.equal(state.reads, 3); owner.unmount();
});

test("task read recovery cannot bypass unknown original-request checks or resubmit implicitly", async () => {
  const { owner, state } = taskOwner(); owner.render(); let value = await owner.settle();
  value.actions.startChange(task.id, "complete"); value = owner.render();
  value.actions.reviewDraft(value.model.draft.initialValues); value = owner.render();
  value.actions.submitReviewed(); value = await owner.settle();
  assert.equal(value.model.operation.state, "unknown"); assert.equal(state.writeInputs.length, 1);
  const original = state.writeInputs[0], draftKey = value.model.draft.key;
  value.recovery.retryOriginalOperation(); await owner.settle(); assert.equal(state.writeInputs.length, 1);
  state.readFailure = new ApiError(503); value.recovery.reloadCurrent(); value = await owner.settle();
  assert.equal(value.model.readState, "stale"); assert.equal(value.model.operation.state, "unknown");
  assert.equal(value.model.operation.recovery, "check"); assert.equal(value.model.draft.key, draftKey);
  value.recovery.retryOriginalOperation(); await owner.settle(); assert.equal(state.writeInputs.length, 1);
  state.readFailure = null; value.recovery.checkOriginalOperation(); value = await owner.settle();
  assert.equal(value.model.readState, "ready"); assert.equal(value.model.operation.state, "unknown");
  assert.equal(value.model.operation.recovery, "retry"); assert.equal(state.writeInputs.length, 1);
  value.recovery.retryOriginalOperation(); value = await owner.settle();
  assert.equal(state.writeInputs.length, 2); assert.deepEqual(state.writeInputs[1], original);
  state.receipt = { state: "confirmed", operation: { opId: "synthetic-original" } }; state.readFailure = new ApiError(503);
  value.recovery.checkOriginalOperation(); value = await owner.settle();
  assert.equal(value.model.operation.state, "saved"); assert.equal(value.model.operation.recovery, "reload");
  assert.equal(value.model.readState, "stale"); assert.equal(value.model.draft, null);
  value.recovery.retryOriginalOperation(); await owner.settle(); assert.equal(state.writeInputs.length, 2); owner.unmount();
});

test("read notices have one normal loading line and nonempty live status without body copy", () => {
  const notice = harness("src/components/ReadStateNotice.tsx", "ReadStateNotice", [{ state: "loading", message: "" }]);
  let tree = notice.render(); assert.deepEqual(visibleText(tree), ["正在讀取…"]);
  assert.equal(byType(tree, "AppStatusBadge").length, 0);
  let announcement = byType(tree, "StatusAnnouncement")[0]; assert.equal(announcement.props.message, "正在讀取…");
  tree = notice.render([{ state: "error", message: "" }]); announcement = byType(tree, "StatusAnnouncement")[0];
  assert.equal(announcement.props.urgent, true); assert.ok(announcement.props.message);
  const live = harness("src/components/StatusAnnouncement.tsx", "StatusAnnouncement", [{ eventKey: "loading", message: "正在讀取…" }]);
  live.render(); tree = live.render([{ eventKey: "error", message: "暫時無法讀取", urgent: true }]);
  assert.equal(tree.props.accessibilityLiveRegion, "assertive"); assert.equal(tree.props.accessibilityRole, "alert");
  assert.equal(tree.props.children, "狀態：暫時無法讀取");
});

const home = { children: [{ id: "child", displayName: "Synthetic child" }], selectedChildId: "child", connection: "online",
  records: [], recordsLoad: "ready", operation: { state: "none", title: "", detail: "" },
  overview: { childId: "child", attention: { state: "ready", items: [] }, ongoing: { state: "ready", items: [] } } };
const homeItem = { id: "task", title: "Synthetic task", detail: "", statusLabel: "待處理", action: { label: "查看事項", destination: "tasks" } };
test("partial and stale Home tasks stay explicit, and unavailable assistant reminders only navigate", () => {
  const actions = { refresh() {}, open() {} };
  const partial = { ...home, overview: { ...home.overview, attention: { state: "ready", items: [homeItem], detail: "尚有未載入的事項" } } };
  const view = harness("src/components/HomeFocus.tsx", "HomeActionSummary", [{ model: partial, actions }]);
  let tree = view.render(); assert.equal(byType(tree, "HomeOverviewItems")[0].props.items.length, 1);
  assert.equal(byType(tree, "Text").find(node => node.props.children === "尚有未載入的事項").props.accessibilityLiveRegion, "polite");
  const stale = { ...partial, overview: { ...partial.overview, attention: { ...partial.overview.attention, state: "stale", detail: "顯示較早的待辦" } } };
  tree = view.render([{ model: stale, actions }]); assert.equal(byType(tree, "ReadStateNotice")[0].props.state, "stale");
  assert.equal(byType(tree, "HomeOverviewItems")[0].props.items.length, 1);
  assert.equal(byType(tree, "AppButton")[0].props.onPress, actions.refresh);
  const assistant = harness("src/components/HomeAgentImportant.tsx", "HomeAgentImportant", [{ model: home, actions }]).render();
  const unavailable = byType(assistant, "ReadStateNotice")[0];
  assert.equal(unavailable.props.message, "暫時無法顯示助手提醒");
  assert.equal(byType(unavailable, "AppButton").length, 0); assert.equal(byType(unavailable, "TextLink")[0].props.label, "前往助手");
});

test("operation notices deduplicate matching headings without hiding unknown or conflicting results", () => {
  const view = harness("src/components/OperationNotice.tsx", "OperationNotice", [{ state: "saving", title: "處理中", message: "" }]);
  let tree = view.render(); assert.equal(byType(tree, "AppStatusBadge")[0].props.label, "處理中"); assert.deepEqual(visibleText(tree), []);
  assert.equal(byType(tree, "StatusAnnouncement")[0].props.message, "處理中");
  tree = view.render([{ state: "unknown", title: "尚未確認操作結果", message: "請查核原操作", referenceLabel: "original-request" }]);
  assert.equal(byType(tree, "AppStatusBadge")[0].props.label, "結果未知"); assert.ok(visibleText(tree).includes("original-request"));
  const recovery = harness("src/components/WriteRecoveryNotice.tsx", "WriteRecoveryNotice", [{ operation: { state: "conflict", message: "保留草稿", reference: null, recovery: "reload" } }]);
  assert.equal(byType(recovery.render(), "OperationNotice")[0].props.title, "版本衝突 · 尚未保存");
  assert.equal(byType(recovery.render([{ operation: { state: "unknown", message: "", reference: null, recovery: "reload" } }]), "OperationNotice")[0].props.title, "已提交，待更新結果");
});

test("Home refresh reaches the scoped task reader once and never reuses another scope", () => {
  const counts = { production: 0, tasks: 0, growth: 0 };
  const workspace = { scopeKey: "scope", model: { readState: "error", reading: false, online: true, access: "editable", items: [], operation: { state: "none" } }, recovery: { reloadCurrent() { counts.tasks++; } } };
  const overrides = {
    "./ProductionProvider": { useProduction: () => ({ scopeKey: "scope", model: home, actions: { refresh() { counts.production++; } } }) },
    "../workspaces/CareWorkspace": { useCareWorkspace: () => null }, "../workspaces/ProfileWorkspace": { useProfileWorkspace: () => null },
    "../workspaces/TasksWorkspace": { useTasksWorkspace: () => workspace },
    "../workspaces/GrowthWorkspace": { useGrowthWorkspace: () => ({ scopeKey: "scope", model: { access: "read_only", load: "error", online: true, page: null }, actions: { refresh() { counts.growth++; } } }) },
    "../child-overview-view-model": { childProfileAgeLabel() {} }, "../care-view-model": { careKindOptions: [] },
  };
  const view = harness("src/production/useProductionHome.ts", "useProductionHome", [], overrides);
  let value = view.render(); assert.equal(value.model.overview.attention.state, "error"); value.actions.refresh();
  assert.deepEqual(counts, { production: 1, tasks: 1, growth: 1 });
  workspace.model = { ...workspace.model, readState: "stale", items: [task] }; value = view.render();
  assert.equal(value.model.overview.attention.state, "stale"); assert.equal(value.model.overview.attention.items.length, 1);
  workspace.scopeKey = "old-scope"; value = view.render();
  assert.equal(value.model.overview.attention.state, "unavailable"); assert.deepEqual(value.model.overview.attention.items, []);
  value.actions.refresh(); assert.equal(counts.tasks, 1);
});


test("production task rows toggle closed and history collapse is local without another request", async () => {
  const { owner, state, env } = taskOwner(); owner.render(); let value = await owner.settle();
  value.actions.selectTask(task.id); value = owner.render(); assert.equal(value.model.selected.id, task.id);
  value.actions.selectTask(task.id); value = owner.render(); assert.equal(value.model.selected, null);
  value.actions.selectTask(task.id); value = owner.render();
  value.actions.showHistory(); value = await owner.settle(); assert.equal(value.model.historyOpen, true); assert.equal(state.historyReads, 1);
  env.online = false; value = owner.render(); value.actions.showHistory(); value = owner.render();
  assert.equal(value.model.historyOpen, false); assert.equal(state.historyReads, 1);
  env.online = true; owner.render(); value = await owner.settle(); value.actions.showHistory(); value = await owner.settle();
  assert.equal(value.model.historyOpen, true); assert.equal(state.historyReads, 2);
  value.actions.selectTask(task.id); value = owner.render(); assert.equal(value.model.selected, null); assert.equal(value.model.historyOpen, false);
  assert.equal(state.writeInputs.length, 0); owner.unmount();
});

test("task disclosure callbacks preserve drafts and unknown-operation guards", async () => {
  const { owner, state } = taskOwner(); owner.render(); let value = await owner.settle();
  value.actions.selectTask(task.id); value = owner.render(); value.actions.startChange(task.id, "complete"); value = owner.render();
  const key = value.model.draft.key;
  value.actions.selectTask(task.id); value.actions.showHistory(); value = owner.render();
  assert.equal(value.model.selected.id, task.id); assert.equal(value.model.draft.key, key); assert.equal(state.historyReads, 0);
  value.actions.reviewDraft(value.model.draft.initialValues); value = owner.render(); value.actions.submitReviewed(); value = await owner.settle();
  assert.equal(value.model.operation.state, "unknown");
  value.actions.selectTask(task.id); value.actions.showHistory(); value = owner.render();
  assert.equal(value.model.selected.id, task.id); assert.equal(value.model.draft.key, key);
  assert.equal(state.historyReads, 0); assert.equal(state.writeInputs.length, 1); owner.unmount();
});
