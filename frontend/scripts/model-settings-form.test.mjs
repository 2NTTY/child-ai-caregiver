import assert from "node:assert/strict";
import test from "node:test";
import { modelSettingsDraft, modelSettingsSchema, modelCommandFromDraft, removeModelKeyCommand } from "../src/components/model-settings/model-settings-form.ts";
const settings = { version: 7, mode: "personal", provider: "gemini", model: "gemini-3.1-flash-lite", keyConfigured: true, backgroundEnabled: true,
  dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null };
test("personal settings require consent and valid integer budgets before any direct request", () => {
  const draft = { ...modelSettingsDraft(settings), consent: true };
  assert.equal(modelSettingsSchema(true).safeParse(draft).success, true);
  assert.equal(modelSettingsSchema(true).safeParse({ ...draft, consent: false }).success, false);
  for (const [field, value] of [["dailyText", "1001"], ["modelCallsText", "13"], ["queryEmbeddingsText", "1.5"]]) {
    assert.equal(modelSettingsSchema(true).safeParse({ ...draft, [field]: value }).success, false);
  }
  assert.equal(modelSettingsSchema(false).safeParse(draft).success, false);
});
test("new and replacement keys match the server boundary without changing the typed value", () => {
  const draft = { ...modelSettingsDraft(settings), consent: true };
  for (const keyConfigured of [false, true]) {
    const schema = modelSettingsSchema(keyConfigured);
    assert.equal(schema.safeParse({ ...draft, keyText: "k".repeat(20) }).success, true);
    assert.equal(schema.safeParse({ ...draft, keyText: "k".repeat(512) }).success, true);
    assert.equal(schema.safeParse({ ...draft, keyText: "!" + "~".repeat(19) }).success, true);
    for (const keyText of ["k".repeat(19), "k".repeat(513), " " + "k".repeat(20), "k".repeat(20) + " ", "k".repeat(10) + " " + "k".repeat(10), "k".repeat(19) + "中", "k".repeat(19) + "\n", "k".repeat(19) + "\x7f"]) {
      assert.equal(schema.safeParse({ ...draft, keyText }).success, false);
    }
  }
  assert.equal(modelSettingsSchema(true).safeParse(draft).success, true);
  assert.equal(modelSettingsSchema(true).safeParse({ ...draft, keyText: "   " }).success, true);
  assert.equal(modelSettingsSchema(false).safeParse(draft).success, false);
  const entered = "!" + "k".repeat(19);
  const replacement = { ...draft, keyText: entered };
  assert.equal(modelCommandFromDraft(replacement, settings).apiKey, entered);
  assert.equal(replacement.keyText, entered);
  assert.equal("apiKey" in modelCommandFromDraft(draft, settings), false);
  assert.equal("apiKey" in modelCommandFromDraft({ ...draft, keyText: "   " }, settings), false);
});
test("nonpersonal mode omits entered keys and retains saved limits instead of invalid hidden draft values", () => {
  const command = modelCommandFromDraft({ ...modelSettingsDraft(settings), mode: "platform", keyText: "synthetic-key-not-for-network", consent: true,
    dailyText: "invalid", modelCallsText: "invalid", queryEmbeddingsText: "invalid" }, settings);
  assert.equal("apiKey" in command, false); assert.equal("opId" in command, false);
  assert.equal(command.expectedVersion, 7); assert.equal(command.backgroundEnabled, false); assert.equal(command.consent, false);
  assert.deepEqual([command.dailyLimit, command.maxModelCalls, command.maxQueryEmbeddings], [100, 4, 2]);
});
test("removal always disables AI without a key body or implicit platform fallback", () => {
  const command = removeModelKeyCommand(settings);
  assert.equal(command.mode, "disabled"); assert.equal(command.removeKey, true); assert.equal(command.backgroundEnabled, false);
  assert.equal(command.consent, false); assert.equal("apiKey" in command, false); assert.equal("opId" in command, false); assert.equal(command.expectedVersion, 7);
});
