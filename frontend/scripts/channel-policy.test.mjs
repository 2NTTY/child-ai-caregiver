import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksAnotherTelegramTest, pushDeliveryNeedsReview, pushTestAllowed, telegramBeginAllowed,
} from "../src/channel-view-model.ts";

const pushBinding = { id: "push-1", version: 2, label: "Browser", status: "active", providerLabel: "Mozilla", expiresAt: null };
const pushStatus = { available: true, workerEnabled: true, testsRemaining: 2, nextTestAt: null };
const pushDelivery = status => ({ id: `push-${status}`, bindingId: "push-1", label: "Browser", status, reasonLabel: null, createdAt: "2026-10-02T00:00:00.000Z" });
const telegramDelivery = (status, acknowledgedAt = null) => ({ ...pushDelivery(status), id: `telegram-${status}`, acknowledgedAt });

test("Push delivery state warns about the original delivery without gating a distinct explicit test", () => {
  for (const status of ["queued", "sending", "unknown"]) {
    assert.equal(pushDeliveryNeedsReview([pushDelivery(status)], "push-1"), true);
    assert.equal(pushTestAllowed(pushStatus, pushBinding), true);
  }
  assert.equal(pushDeliveryNeedsReview([pushDelivery("unknown")], "another-binding"), false);
});

test("Push test follows server availability, worker, binding, rolling quota and 60-second snapshot", () => {
  const now = Date.parse("2026-10-02T00:00:00.000Z");
  assert.equal(pushTestAllowed(pushStatus, pushBinding, now), true);
  assert.equal(pushTestAllowed({ ...pushStatus, available: false }, pushBinding, now), false);
  assert.equal(pushTestAllowed({ ...pushStatus, workerEnabled: false }, pushBinding, now), false);
  assert.equal(pushTestAllowed({ ...pushStatus, testsRemaining: 0 }, pushBinding, now), false);
  assert.equal(pushTestAllowed({ ...pushStatus, nextTestAt: new Date(now + 1000).toISOString() }, pushBinding, now), false);
  assert.equal(pushTestAllowed({ ...pushStatus, nextTestAt: new Date(now).toISOString() }, pushBinding, now), true);
  assert.equal(pushTestAllowed(pushStatus, { ...pushBinding, status: "expired" }, now), false);
});

test("Telegram keeps queued, sending and unacknowledged unknown tests blocked", () => {
  for (const status of ["queued", "sending", "unknown"]) {
    assert.equal(blocksAnotherTelegramTest([telegramDelivery(status)], "push-1"), true);
  }
  assert.equal(blocksAnotherTelegramTest([telegramDelivery("unknown", "2026-10-02T00:01:00.000Z")], "push-1"), false);
  assert.equal(blocksAnotherTelegramTest([telegramDelivery("unknown")], "another-binding"), false);
});

test("Telegram begin can explicitly replace waiting or seen challenges while binding limits remain", () => {
  const base = { configured: true, binding: null, challenge: null };
  for (const state of ["waiting", "seen"]) {
    assert.equal(telegramBeginAllowed({ ...base, challenge: { id: "challenge-1", version: 1, state, candidate: state === "seen" ? { label: "Me", chatIdHint: "•••1234" } : null, expiresAt: "2026-10-02T00:10:00.000Z" } }), true);
  }
  assert.equal(telegramBeginAllowed({ ...base, configured: false }), false);
  assert.equal(telegramBeginAllowed({ ...base, binding: { id: "binding-1", status: "active" } }), false);
  assert.equal(telegramBeginAllowed({ ...base, binding: { id: "binding-1", status: "blocked" } }), false);
  assert.equal(telegramBeginAllowed({ ...base, binding: { id: "binding-1", status: "revoked" } }), true);
});
