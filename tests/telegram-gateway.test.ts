import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramGateway } from "../server/telegram-gateway.ts";
import type { TelegramConfig } from "../server/telegram-types.ts";

const config: TelegramConfig = {
  token: "123456:" + "x".repeat(32), botId: "123456", botUsername: "synthetic_bot", webhookSecret: "s".repeat(32),
};

test("an uncertain Telegram transport attempt is never retried or reported as rejected", async () => {
  let attempts = 0;
  let requestBody: string | undefined;
  const gateway = createTelegramGateway(config, async ({ body }) => {
    attempts++;
    requestBody = body;
    throw new Error("synthetic-private-transport-detail");
  });
  const result = await gateway.send({ chatId: 123, callbackToken: "c".repeat(32) }, new AbortController().signal, async () => true);
  assert.deepEqual(result, { status: "unknown", reason: "transport_unknown", providerStatus: null, messageId: null });
  assert.equal(attempts, 1);
  assert.ok(requestBody);
  const payload = JSON.parse(requestBody);
  assert.equal(payload.chat_id, 123);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].callback_data, "ack:" + "c".repeat(32));
  assert.equal(payload.parse_mode, undefined);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-transport-detail/);
});
