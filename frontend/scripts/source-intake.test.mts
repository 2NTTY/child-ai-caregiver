import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createSourceIntake, confirmSourceIntake, proposeSourceIntake, sourceIntakeIsUnresolved, sourceIntakeReadResult, validSourceIntakeProposal, validSourceIntakeText } from "../src/source-intake.ts";

test("supplied intentions stay verbatim and do not assert that a source was read or verified", () => {
  const value = createSourceIntake("  官方資料，先看看適不適合  ");
  assert.equal(value.intention, "  官方資料，先看看適不適合  ");
  assert.equal(value.stage, "awaiting_read");
  assert.equal(value.proposal, null);
  assert.equal(proposeSourceIntake(value), value);
});

test("unavailable and unknown reads cannot become proposals or connected results", () => {
  const value = { ...createSourceIntake("參考"), stage: "reading" as const };
  const unknown = sourceIntakeReadResult(value, "unknown");
  assert.equal(unknown.stage, "read_unknown");
  assert.equal(sourceIntakeIsUnresolved(unknown), true);
  assert.equal(proposeSourceIntake(unknown), unknown);
  assert.equal(confirmSourceIntake(unknown, "not_connected"), unknown);
  const unavailable = sourceIntakeReadResult(value, "unavailable");
  assert.equal(unavailable.stage, "unavailable");
  assert.equal(unavailable.proposal, null);
  assert.equal(proposeSourceIntake(unavailable), unavailable);
  assert.equal(sourceIntakeReadResult(createSourceIntake(""), "ready").stage, "awaiting_read");
});

test("manual and assisted entry use the same proposal validation and confirmation boundary", () => {
  for (const proposalOrigin of ["manual", "assisted"] as const) {
    const draft = proposeSourceIntake({ ...createSourceIntake("回答時參考"), proposalOrigin, stage: "clarifying" });
    assert.equal(draft.stage, "review");
    assert.equal(draft.proposal?.nature, "unspecified");
    assert.equal(draft.proposal?.timeScope, "unspecified");
    assert.equal(validSourceIntakeProposal(draft.proposal), true);
    const confirmed = confirmSourceIntake(draft, "not_connected");
    assert.equal(confirmed.stage, "confirmed_pending_connection");
    assert.equal(confirmSourceIntake(confirmed, "unknown"), confirmed);
    assert.equal("confirmShared" in confirmed, false);
    assert.equal("recordId" in confirmed, false);
  }
});

test("specific validity stays raw and must be provided before confirming", () => {
  const draft = proposeSourceIntake({ ...createSourceIntake(""), stage: "clarifying" });
  const missing = { ...draft, proposal: { ...draft.proposal!, timeScope: "specific_period" as const, validityText: "  " } };
  assert.equal(validSourceIntakeProposal(missing.proposal), false);
  assert.equal(confirmSourceIntake(missing, "not_connected"), missing);
  const raw = "  下次覆診前，由家長重新核對  ";
  const valid = { ...missing, proposal: { ...missing.proposal, validityText: raw, nature: "claimed_official" as const } };
  assert.equal(confirmSourceIntake(valid, "not_connected").proposal?.validityText, raw);
  assert.equal("verified" in valid.proposal, false);
  assert.equal("expiresAt" in valid.proposal, false);
  assert.equal(validSourceIntakeProposal({ ...valid.proposal, timeScope: "unspecified", validityText: "a".repeat(301) }), true);
});

test("unknown connection freezes the confirmed intent and never reports connected", () => {
  const draft = proposeSourceIntake({ ...createSourceIntake("待核對記錄"), stage: "clarifying" });
  const unknown = confirmSourceIntake(draft, "unknown");
  assert.equal(unknown.stage, "connection_unknown");
  assert.equal(sourceIntakeIsUnresolved(unknown), true);
  assert.equal(confirmSourceIntake(unknown, "not_connected"), unknown);
  assert.equal(proposeSourceIntake(unknown), unknown);
});

test("draft limits reject rather than truncate; the formal create projection stays separate", () => {
  assert.equal(validSourceIntakeText("a".repeat(1000)), true);
  assert.equal(validSourceIntakeText("a".repeat(1001)), false);
  assert.equal(validSourceIntakeText("bad\u0000text"), false);
  const form = readFileSync(new URL("../src/components/shared-inputs/source-form.ts", import.meta.url), "utf8");
  const projection = form.split("export function sourceCreateProjection")[1].split("export function sourceRecordSchema")[0];
  assert.doesNotMatch(projection, /intake|intention|proposal|purpose|validity|nature/);
  assert.match(projection, /return \{ kind: draft\.kind, sourceId: draft\.sourceId \}/);
});
