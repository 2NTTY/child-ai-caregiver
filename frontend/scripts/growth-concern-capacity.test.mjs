import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, "..");
const jsx = (type, props) => ({ type, props });
function harness(component, initialProps, workspace = null) {
  let cursor = 0, changed = false, props = initialProps;
  const slots = [], effects = [], cache = new Map();
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
      return [slots[index], next => { const value = typeof next === "function" ? next(slots[index]) : next; changed ||= !Object.is(value, slots[index]); slots[index] = value; }]; },
    useEffect(callback, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
      const next = { deps, cleanup: old?.cleanup }; slots[index] = next; effects.push(() => { next.cleanup?.(); next.cleanup = callback(); });
    } },
  };
  const AppDialog = Object.assign(function AppDialog() {}, { Title: "Dialog.Title", Content: "Dialog.Content", Actions: "Dialog.Actions" });
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = { exports: {} };
    const resolve = name => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react-native") return { View: "View", Pressable: "Pressable", StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390 }) };
      if (name === "react-native-paper") return { Text: "Text", Button: "Button" };
      if (name.endsWith("/FormDialog")) return { FormDialog: "FormDialog" };
      if (name.endsWith("/HistoryCards")) return { HistoryCardGrid: "HistoryCardGrid" };
      if (name.endsWith("/growth-styles")) return { growthStyles: {} };
      if (name.endsWith("/theme")) return { chineseFont: "", colors: {}, mobileLayout: { breakpoint: 650, touchTarget: 44 }, radius: {}, spacing: {}, readingType: {} };
      if (name.endsWith("/AppDialog")) return { AppDialog };
      if (name.endsWith("/BackgroundSurface")) return { BackgroundSurface: "BackgroundSurface" };
      if (name.endsWith("/ui")) return { AppButton: "AppButton" };
      if (name.endsWith("/GrowthWorkspace")) return { useGrowthWorkspace: () => workspace };
      if (name.endsWith("/useInteractionDensity")) return { useInteractionDensity: () => false };
      for (const leaf of ["AppIcon", "GrowthConcernTimeline", "GrowthOperationRecovery", "StatusAnnouncement", "ReadStateNotice", "EmptyListCard"])
        if (name.endsWith("/" + leaf)) return { [leaf]: leaf };
      if (!name.startsWith(".")) return require(name);
      const location = path.resolve(path.dirname(filename), name);
      return load(existsSync(location) ? location : existsSync(location + ".ts") ? location + ".ts" : location + ".tsx");
    };
    new Function("require", "module", "exports", compiled.outputText)(resolve, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  const view = load(path.join(root, "src/growth-view-model.ts"));
  const renderFunction = load(path.join(root, "src/components/growth/" + component + ".tsx"))[component];
  return { view, render(nextProps = props) { props = nextProps; let tree, rounds = 0;
    do { assert.ok(++rounds < 10); cursor = 0; changed = false; tree = renderFunction(props); while (effects.length) effects.shift()(); } while (changed);
    return tree;
  } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object" || tree.props?.visible === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const text = tree => nodes(tree).filter(node => node.type === "Text").flatMap(node => node.props.children).join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "AppButton" && node.props.label === label);
const concern = (count, status = "following") => ({ id: "synthetic-concern", childId: "synthetic-child", title: "合成關注", reason: "合成原因",
  version: 10, status, archivedAt: status === "closed" ? "2026-10-01T00:00:00Z" : null, statusBeforeArchive: "following",
  attentionIds: [], historyComplete: true, followUp: null, events: Array.from({ length: count }, (_, index) => ({
    id: "event-" + index, at: "2026-10-01T00:00:00Z", kind: "observation", title: "合成觀察", text: "合成", sourceLabel: "合成",
  })) });
const model = item => ({ scopeKey: "synthetic-scope", childId: item.childId, access: "editable", load: "ready", online: true,
  locked: false, dirty: false, busy: false, pending: null, operation: "saved", notice: "",
  page: { authorityVersion: "synthetic-authority", canManage: true, items: [], concerns: { state: "ready", items: [item] } },
  lastConcernChange: { action: "archive", scopeKey: "synthetic-scope", authorityVersion: "synthetic-authority", id: item.id, version: item.version } });

test("archive confirmation uses one normal explanation at 198 and preserves capacity warnings at 199 and 200", () => {
  for (const count of [198, 199, 200]) {
    let writes = 0;
    const props = { concern: concern(count), scopeKey: "synthetic-scope", authorityVersion: "synthetic-authority", disabled: false, onConfirm: () => writes++ };
    const h = harness("GrowthArchiveConcernButton", props); let tree = h.render();
    button(tree, "結束關注").props.onPress(); tree = h.render();
    assert.equal(writes, 0);
    assert.equal(text(tree).includes("此關注結束後將無法恢復繼續記錄，完整歷史仍會保留。"), count >= 199);
    assert.equal(text(tree).includes("內容會保留在歷史，可撤銷或恢復；不影響已連結的任務。"), count === 198);
    assert.equal(text(tree).includes("不會刪除記錄，也不會完成或取消已連結的任務。"), count >= 199);
    assert.equal(text(tree).includes("誤按後可以撤銷"), false);
    assert.equal(text(tree).includes("也可稍後在歷史恢復關注"), false);
    assert.equal(nodes(tree).find(node => node.type === "Dialog.Title").props.children, "結束這條關注？");
    assert.equal(nodes(tree).find(node => node.type === "Dialog.Title").props.danger, true);
    assert.equal(button(tree, "確認結束關注").props.variant, "danger");
    assert.equal(text(tree).includes(props.concern.title), true);
    button(tree, "取消").props.onPress(); h.render(); assert.equal(writes, 0);
  }
});

test("post-archive 199 remains restorable while 200, 201 and 202 have an honest disabled undo", () => {
  for (const count of [199, 200, 201, 202]) {
    const item = concern(count, "closed"), props = { model: model(item), actions: { restoreConcern() {} } };
    const h = harness("GrowthConcernChangeNotice", props), tree = h.render();
    assert.equal(h.view.growthConcernCanRestore(item), count < 200);
    assert.equal(button(tree, "撤銷結束關注").props.disabled, count >= 200);
    assert.equal(text(tree).includes("已達歷史容量限制"), count >= 200);
  }
});

test("history list and detail retain reading but explain capacity-blocked restore", () => {
  for (const count of [199, 200, 201, 202]) {
    const item = concern(count, "closed"), workspace = { model: model(item), actions: { restoreConcern() {} }, scopeKey: "synthetic-scope" };
    const h = harness("GrowthHistoryView", { searchText: "", dateRange: { from: null, to: null }, onTask() {} }, workspace);
    let tree = h.render();
    const restore = tree => nodes(tree).find(node => node.type === "Button" && node.props.accessibilityLabel === "恢復關注：合成關注");
    assert.equal(restore(tree), undefined, "Restore is not a nested card action");
    assert.equal(text(tree).includes("未取得原狀態"), false);
    nodes(tree).find(node => node.type === "Pressable" && node.props.accessibilityLabel === "查看已結束關注：合成關注").props.onPress();
    tree = h.render();
    assert.ok(nodes(tree).some(node => node.type === "GrowthConcernTimeline"));
    assert.equal(restore(tree).props.disabled, count >= 200);
    assert.equal(text(tree).includes("已達歷史容量限制"), count >= 200);
  }
});
