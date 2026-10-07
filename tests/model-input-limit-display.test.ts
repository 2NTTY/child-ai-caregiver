import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { Pool } from "pg";
import { readAiConfig } from "../server/ai-config.ts";
import { createModelRouting } from "../server/model-routing.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createModelSettingsApi, ModelSettingsApiError } from "../src/client/model-settings-api.ts";
import type { ModelSettingsSnapshot } from "../frontend/src/model-settings-view-model.ts";

const root = path.resolve(import.meta.dirname, ".."), require = createRequire(import.meta.url);
const usage = { day: "2026-10-07", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 };
const legacy = { settings: { version: 1, mode: "platform", provider: "gemini", model: "gemini-3.1-flash-lite", keyConfigured: false,
  backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null },
  enabled: true, platformAvailable: true, personalAvailable: true, personalGlobalLimit: 1000, usage: { platform: usage, personal: usage } };
const signal = () => new AbortController().signal;
function client(value: unknown) { return createModelSettingsApi("/api", (async () => Response.json(value)) as typeof fetch); }
function load(entry: string, overrides: Record<string, any>, cache = new Map<string, any>()): any {
  const file = path.resolve(root, entry);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith(".")) return require(name);
    let target = path.resolve(path.dirname(file), name);
    if (!existsSync(target)) target += ".ts";
    return load(target, overrides, cache);
  }, module, module.exports);
  return module.exports;
}
function visibleText(snapshot: ModelSettingsSnapshot) {
  const placeholder = new Proxy({}, { get: (_target, key) => String(key) });
  const node = (type: unknown, props: unknown) => ({ type, props });
  const overrides: Record<string, any> = {
    react: { useEffect() {}, useState: (value: unknown) => [value, () => {}], useRef: () => ({ current: 0 }), useId: () => "synthetic" },
    "react/jsx-runtime": { jsx: node, jsxs: node }, "react-native": { StyleSheet: { create: (value: unknown) => value }, View: "View" },
    "react-native-paper": { Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "react-hook-form": { Controller: "Controller", useForm: ({ defaultValues }: { defaultValues: Record<string, unknown> }) => ({
      control: {}, reset() {}, setValue() {}, setFocus() {}, watch: (name: string) => defaultValues[name], handleSubmit: () => () => {}, formState: { errors: {}, isDirty: false },
    }) }, "@hookform/resolvers/zod": { zodResolver: () => ({}) },
    "../useContainerWidth": { useContainerWidth: () => ({ width: 1024, ref: null, onLayout() {} }) },
    "../../preview/PreviewNavigationGuard": { usePreviewLeaveGuard() {} }, "../../branding": { brand: { platformServiceLabel: "平台" } },
    "../../theme": { chineseFont: "synthetic", colors: placeholder, readingType: placeholder, spacing: placeholder, workspaceType: placeholder },
  };
  for (const name of ["../AppStatusBadge", "../settings/SettingsSection", "../AppCheckbox", "../AppDialog", "../ui", "../FormErrorSummary", "../ReadStateNotice", "../StatusAnnouncement", "../../motion"]) overrides[name] = placeholder;
  const { ModelSettingsView } = load("frontend/src/components/model-settings/ModelSettingsView.tsx", overrides);
  const tree = ModelSettingsView({ model: { scopeKey: "synthetic", accountName: "Synthetic", serverLabel: "/api", snapshot,
    online: true, authorized: true, busy: null, operation: "none", notice: "", needsRead: false, formRevision: 0, secretRevision: 0, keyCheck: null },
    actions: { refresh() {}, save() {}, check() {} } });
  const text = (value: any): string => typeof value === "string" ? value : Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" ? text(value.props?.children) : "";
  return text(tree);
}

test("settings server reports the resolved interactive default and configured rollback without generation", async () => {
  const pool = { async query(sql: string) {
    if (sql.includes("FROM model_settings")) return { rows: [] };
    if (sql.includes("FROM ai_attempts")) return { rows: [{ day: "2026-10-07", attempts: 0, input_tokens: "0", output_tokens: "0", cached_tokens: "0", known: "0" }] };
    throw new Error("Unexpected storage access");
  } } as unknown as Pool;
  for (const configured of [undefined, "32000", "64000"]) {
    const config = readAiConfig({ AI_AGENT_MAX_INPUT_CHARACTERS: configured });
    const routing = createModelRouting(pool, createStorageCipher(Buffer.alloc(32, 57)), config);
    const view = await routing.view("synthetic-user");
    assert.equal(view.agentInputCharacters, configured ? Number(configured) : 64000);
    const decoded: ModelSettingsSnapshot = await client(view).read(signal(), "synthetic-user");
    assert.equal(decoded.agentInputCharacters, view.agentInputCharacters);
    assert.ok(visibleText(decoded).includes(`互動上下文上限：${view.agentInputCharacters} 字元`));
  }
});

test("old settings payload remains readable and actual view reports unknown rather than a guessed ceiling", async () => {
  const decoded: ModelSettingsSnapshot = await client(legacy).read(signal(), "synthetic-user");
  assert.equal(decoded.agentInputCharacters, undefined);
  const text = visibleText(decoded);
  assert.ok(text.includes("互動上下文上限未提供"));
  assert.ok(!text.includes("上下文 32000")); assert.ok(!text.includes("上下文上限：64000"));
});

test("settings client accepts only bounded integer input metadata and preserves strict parsing", async () => {
  for (const value of [null, "64000", 31999, 64001, 32000.5, {}, []])
    await assert.rejects(client({ ...legacy, agentInputCharacters: value }).read(signal(), "synthetic-user"), ModelSettingsApiError);
  await assert.rejects(client({ ...legacy, agentInputCharacters: 64000, privateConfiguration: "forbidden" }).read(signal(), "synthetic-user"), ModelSettingsApiError);
});
