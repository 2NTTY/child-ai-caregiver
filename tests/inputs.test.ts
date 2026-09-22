import assert from "node:assert/strict";
import test from "node:test";
import { validateCreateChild, validateCreateTextRecord } from "../src/shared/inputs.ts";

test("child input accepts a display name and discards client ownership claims", () => {
  assert.deepEqual(validateCreateChild({ displayName: "  小晴  ", workspaceId: "other", id: "chosen" }), {
    ok: true, value: { displayName: "小晴" },
  });
});

test("child input rejects missing, blank, non-string and overlong names", () => {
  for (const value of [null, [], "name", {}, { displayName: 12 }, { displayName: " \n" }, { displayName: "晴".repeat(81) }]) {
    assert.equal(validateCreateChild(value).ok, false);
  }
  assert.equal(validateCreateChild({ displayName: "𠮷".repeat(80) }).ok, true);
});

test("text records preserve the original text and discard untrusted metadata", () => {
  const text = "  昨晚大約八點，飲咗約 120 ml 奶。\n今日精神幾好。  ";
  assert.deepEqual(validateCreateTextRecord({ childId: "child-1", text, workspaceId: "other", authorId: "other", confirmed: true }), {
    ok: true, value: { childId: "child-1", text },
  });
});

test("text records reject malformed identifiers and invalid text at the public boundary", () => {
  for (const childId of [undefined, 42, "", " ", "../other", "x".repeat(129)]) {
    assert.equal(validateCreateTextRecord({ childId, text: "記錄" }).ok, false);
  }
  for (const text of [null, 0, "", " \r\n", "字".repeat(10001)]) {
    assert.equal(validateCreateTextRecord({ childId: "child-1", text }).ok, false);
  }
  assert.equal(validateCreateTextRecord({ childId: "child-1", text: "字".repeat(10000) }).ok, true);
  assert.equal(validateCreateTextRecord([]).ok, false);
});

test("validation errors identify fields without echoing rejected private input", () => {
  const result = validateCreateTextRecord({ childId: "invalid/private", text: "private".repeat(2000) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.issues.map(issue => issue.field), ["childId", "text"]);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
