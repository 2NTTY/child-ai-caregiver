import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramGateway } from "../server/telegram-gateway.ts";
import type { TelegramConfig } from "../server/telegram-types.ts";

const config: TelegramConfig = {
  token: "123456:" + "x".repeat(32), botId: "123456", botUsername: "synthetic_bot", webhookSecret: "s".repeat(32),
};

test("an uncertain Telegram transport attempt is never retried or reported as rejected", async () => {
  for (const notice of [
    { kind: undefined, text: "育有方渠道測試：這是你剛才確認發送的一般測試，沒有孩子資料。按下『收到測試』只記錄收到，不代表照護事項完成。", button: "收到測試", prefix: "ack:" },
    { kind: "care", text: "育有方有新的提示。請開啟育有方查看實際事項。按下『收到提示』只記錄收到，不代表照護事項完成。", button: "收到提示", prefix: "contact:" },
  ] as const) {
    let attempts = 0;
    let requestBody: string | undefined;
    const gateway = createTelegramGateway(config, async ({ body }) => {
      attempts++;
      requestBody = body;
      throw new Error("synthetic-private-transport-detail");
    });
    const result = await gateway.send({ chatId: 123, callbackToken: "c".repeat(32), kind: notice.kind }, new AbortController().signal, async () => true);
    assert.deepEqual(result, { status: "unknown", reason: "transport_unknown", providerStatus: null, messageId: null });
    assert.equal(attempts, 1);
    assert.ok(requestBody);
    const payload = JSON.parse(requestBody);
    assert.equal(payload.chat_id, 123);
    assert.equal(payload.text, notice.text);
    assert.deepEqual(payload.reply_markup.inline_keyboard, [[{ text: notice.button, callback_data: notice.prefix + "c".repeat(32) }]]);
    assert.deepEqual(payload.link_preview_options, { is_disabled: true });
    assert.equal(payload.protect_content, true);
    assert.equal(payload.parse_mode, undefined);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-transport-detail/);
  }
});

test('Telegram history captures the exact accepted text without authentication or callback secrets', async () => {
  for (const kind of ['test', 'care'] as const) {
    let sent: any;
    const gateway = createTelegramGateway(config, async ({ body }) => {
      sent = JSON.parse(body);
      return Response.json({ ok: true, result: { message_id: 42, chat: { id: 123, type: 'private' }, text: sent.text } });
    });
    const result = await gateway.send({ chatId: 123, callbackToken: 'c'.repeat(32), kind }, new AbortController().signal, async () => true);
    assert.equal(result.status, 'accepted'); assert.ok(result.message);
    assert.equal(result.message.body, sent.text); assert.equal(result.message.title, null);
    assert.equal(result.message.contentVersion, 'telegram-generic-v1'); assert.ok(Date.parse(result.message.sentAt));
    assert.doesNotMatch(JSON.stringify(result.message), /callback|chatId|123456|cccccccc/u);
  }
});
