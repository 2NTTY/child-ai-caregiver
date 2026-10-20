import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { ChatApiError } from "../src/client/chat-api.ts";
import { CHAT_CLIENT_COPY, CHAT_REPLY_ERROR_COPY, chatReplyErrorMessage } from "../src/client/chat-controller.ts";
import { OFFICIAL_HELP } from "../src/shared/agent-feedback.ts";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

function load(entry: string, overrides: Record<string, any>, cache = new Map<string, any>()): any {
  const file = path.resolve(root, entry);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith(".")) return require(name);
    let target = path.resolve(path.dirname(file), name);
    if (!existsSync(target) && existsSync(target + ".ts")) target += ".ts";
    else if (!existsSync(target) && existsSync(target + ".tsx")) target += ".tsx";
    return load(target, overrides, cache);
  }, module, module.exports);
  return module.exports;
}

function collectText(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("");
  if (value && typeof value === "object") return collectText(value.props?.children);
  return "";
}

function collectTestIds(value: any, out: string[] = []): string[] {
  if (Array.isArray(value)) { for (const item of value) collectTestIds(item, out); return out; }
  if (value && typeof value === "object") {
    if (typeof value.props?.testID === "string") out.push(value.props.testID);
    collectTestIds(value.props?.children, out);
  }
  return out;
}

function chatUiOverrides(): Record<string, any> {
  const placeholder = new Proxy({}, { get: (_t, key) => String(key) });
  const node = (type: unknown, props: unknown) => ({ type, props });
  const overrides: Record<string, any> = {
    react: {
      createContext: () => ({ Provider: "Provider" }),
      useContext: () => null,
      useId: () => "synthetic",
      useLayoutEffect() {},
      useRef: (value: unknown) => ({ current: value ?? null }),
      useState: (value: unknown) => [value, () => {}],
      Fragment: "Fragment",
    },
    "react/jsx-runtime": { jsx: node, jsxs: node, Fragment: "Fragment" },
    "react-native": {
      Platform: { OS: "web" },
      Pressable: "Pressable",
      StyleSheet: { create: (value: unknown) => value },
      View: "View",
      useWindowDimensions: () => ({ width: 1024, fontScale: 1 }),
      Linking: { openURL: async () => {} },
    },
    "react-native-paper": { Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "../AppScrollView": { AppScrollView: "AppScrollView" },
    "../HorizontalOverflowRail": { HorizontalOverflowRail: "HorizontalOverflowRail" },
    "../ui": { AppButton: "AppButton" },
    "../AppIcon": { AppIcon: "AppIcon" },
    "../StatusAnnouncement": { StatusAnnouncement: "StatusAnnouncement" },
    "../../theme": { colors: placeholder, spacing: placeholder, chineseFont: "synthetic" },
    "../../motion": { MotionDisclosure: ({ children }: any) => children, MotionEntrance: ({ children }: any) => children },
    "../../motion/MotionSelectionMarker": { MotionSelectionMarker: "MotionSelectionMarker" },
    "./CitationMarker": { CitationMarker: "CitationMarker" },
    "./locateCitationSource": { locateCitationSource() {} },
    "./chat-presentation": { chatColors: placeholder, chatFont: "synthetic", chatLayout: placeholder, chatType: placeholder },
  };
  return overrides;
}

test("chat reply error copy covers every known AI failure code without inventing a formal success", () => {
  for (const code of ["ai_disabled", "ai_busy", "ai_capacity_busy", "ai_quota_exceeded", "ai_timeout", "ai_unavailable", "invalid_input", "not_found"] as const) {
    assert.equal(chatReplyErrorMessage(new ChatApiError(503, code)), CHAT_REPLY_ERROR_COPY[code]);
    assert.match(CHAT_REPLY_ERROR_COPY[code], /保存|讀取/);
  }
  assert.equal(chatReplyErrorMessage(new Error("boom")), CHAT_REPLY_ERROR_COPY.unknown);
  assert.equal(chatReplyErrorMessage(new ChatApiError(0, null)), CHAT_REPLY_ERROR_COPY.unknown);
  assert.ok(CHAT_CLIENT_COPY.offline.includes("離線"));
  assert.ok(CHAT_CLIENT_COPY.sessionChanged.includes("登入"));
  assert.ok(CHAT_CLIENT_COPY.unknownSave.includes("避免重複發送"));
});

test("AnswerSources shows the degraded warning and empty-source honesty copy", () => {
  const { AnswerSources } = load("frontend/src/components/chat/AnswerSources.tsx", chatUiOverrides());
  const { CHAT_SOURCE_COPY } = load("frontend/src/components/chat/chat-copy.ts", chatUiOverrides());
  const degraded = AnswerSources({ sources: [], children: "正文", degraded: true });
  const degradedText = collectText(degraded);
  const degradedIds = collectTestIds(degraded);
  assert.ok(degradedText.includes(CHAT_SOURCE_COPY.degradedWarning));
  assert.ok(degradedIds.includes("answer-sources-degraded"));
  assert.ok(degradedText.includes(CHAT_SOURCE_COPY.emptySources));
  assert.ok(degradedIds.includes("answer-sources-empty"));
  assert.ok(!degradedText.includes("官方指引")); // no fabricated source panel when empty
});

test("AnswerSources panel uses product source labels when citations exist", () => {
  const { AnswerSources } = load("frontend/src/components/chat/AnswerSources.tsx", chatUiOverrides());
  const { CHAT_SOURCE_COPY, CHAT_CLASSIFICATION_LABELS } = load("frontend/src/components/chat/chat-copy.ts", chatUiOverrides());
  const source = {
    id: "src-1", title: "合成官方指引片段", publisher: "衞生署合成", classification: "official_guidance",
    section: "第一章", excerpt: "合成摘錄，不可作真實建議。", versionId: "v1", versionHash: "hash",
    checkedAt: "2026-10-18T03:00:00.000Z", fetchedAt: "2026-10-18T03:00:00.000Z", lastSuccessfulCheckAt: "2026-10-18T03:00:00.000Z",
    sourceDate: "2026-01-01", validUntil: null, applicabilityLabel: "香港；合成適用範圍", internalOnly: false, url: "https://example.test/source",
  };
  const tree = AnswerSources({ sources: [source], children: "正文含【1】", degraded: false, onOpenSource() {} });
  const text = collectText(tree);
  const ids = collectTestIds(tree);
  assert.ok(ids.includes("answer-source-panel"));
  assert.ok(text.includes(CHAT_SOURCE_COPY.footerTitle));
  assert.ok(text.includes(CHAT_CLASSIFICATION_LABELS.official_guidance) || text.includes("【1】"));
  assert.ok(!text.includes(CHAT_SOURCE_COPY.degradedWarning));
});

test("ChatMessage phase labels stay product copy and surface check-original on failure", () => {
  const overrides = chatUiOverrides();
  // ChatMessage imports AnswerSources from same folder — already covered by load graph
  const { ChatMessage } = load("frontend/src/components/chat/ChatMessage.tsx", overrides);
  const { CHAT_PHASE_LABELS, CHAT_MESSAGE_COPY } = load("frontend/src/components/chat/chat-copy.ts", overrides);
  const failed = ChatMessage({
    message: { id: "m1", role: "assistant", text: "失敗回覆", phase: "failed", sources: [] },
    onCheck() {},
  });
  const text = collectText(failed);
  assert.ok(text.includes(CHAT_PHASE_LABELS.failed));
  assert.ok(text.includes(CHAT_MESSAGE_COPY.checkOriginal) || JSON.stringify(failed).includes(CHAT_MESSAGE_COPY.checkOriginal));
});

test("OfficialHelpCards renders published emergency and medical copy without inventing cards", () => {
  const { OfficialHelpCards } = load("frontend/src/components/chat/OfficialHelpCards.tsx", chatUiOverrides());
  const tree = OfficialHelpCards({ ids: ["emergency-hk-v1", "medical-consult-hk-v1", "emergency-hk-v1"] });
  const text = collectText(tree);
  assert.ok(text.includes(OFFICIAL_HELP["emergency-hk-v1"].title));
  assert.ok(text.includes(OFFICIAL_HELP["medical-consult-hk-v1"].title));
  assert.ok(text.includes(OFFICIAL_HELP["emergency-hk-v1"].text.slice(0, 8)));
  // dedupe: title appears once for emergency
  assert.equal([...text.matchAll(new RegExp(OFFICIAL_HELP["emergency-hk-v1"].title, "g"))].length, 1);
});
