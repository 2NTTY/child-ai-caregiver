import { createECDH, createHmac } from 'node:crypto';
import { z } from 'zod';
import { apnsPushTokenSchema, nativePushReferenceSchema, nativePushTokenSchema } from '../src/shared/native-push.ts';
import { assertLocalAgentEnvironment } from './local-agent-config.ts';
import { checkedSubscription } from './web-push-gateway.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { NativePushGateway } from './native-push-gateway.ts';
import type { WebPushGateway } from './web-push-types.ts';
import type { TelegramConfig, TelegramGateway } from './telegram-types.ts';

export interface LocalDeliveryAdapters {
  pushGateway: WebPushGateway;
  nativePushGateway: NativePushGateway;
  telegramGateway: TelegramGateway;
  telegramConfig: TelegramConfig;
  telegramStartUrl(token: string): string;
}
const messageSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u), createdAt: z.iso.datetime(),
  channel: z.enum(['web_push', 'native_push', 'telegram']), kind: z.enum(['test', 'care']),
  delivery: z.literal('local-only-not-sent'), targetTag: z.string().regex(/^[a-f0-9]{64}$/u),
  reference: nativePushReferenceSchema.nullable(),
});
type Message = z.infer<typeof messageSchema>;
type LocalStopReason = 'local_preview_not_sent' | 'revoked' | 'worker_interrupted' | 'request_invalid';
const stopped = <T extends LocalStopReason>(reason: T) => ({ status: 'stopped' as const, reason, providerStatus: null });

/** Loopback transport replacement only. Domain authorization and receipts stay unchanged. */
export function createLocalAgentDelivery(options: FirestoreDomainOptions, env: Record<string, string | undefined>) {
  const config = assertLocalAgentEnvironment(env);
  if (options.projectId !== config.projectId || options.namespace !== config.namespace) throw Error('Local inbox scope mismatch');
  const secret = Buffer.from(env.YUBAN_FIREBASE_STORAGE_KEY!, 'base64');
  const digest = (value: unknown) => createHmac('sha256', secret).update(JSON.stringify(['local-delivery/1', value])).digest('hex');
  const keys = createECDH('prime256v1');
  keys.setPrivateKey(Buffer.from(digest('public-subscription-key'), 'hex'));
  const publicKey = keys.getPublicKey().toString('base64url');
  const rows = options.database.collection(config.namespace + '_local_delivery_inbox');
  const context = (id: string) => JSON.stringify(['local-inbox/1', config.projectId, config.namespace, id]);
  async function capture(channel: Message['channel'], kind: Message['kind'], target: string,
    identity: string, reference: Message['reference'], signal: AbortSignal, authorized: () => Promise<boolean>) {
    if (signal.aborted) return stopped('worker_interrupted');
    if (!await authorized()) return stopped('revoked');
    if (signal.aborted) return stopped('worker_interrupted');
    const id = digest([channel, identity]), targetTag = digest([channel, target]), ref = rows.doc(id);
    await options.database.runTransaction(async tx => {
      const old = await tx.get(ref);
      if (old.exists) {
        const saved = messageSchema.parse(JSON.parse(options.cipher.decrypt(old.get('ciphertext'), context(id))));
        if (saved.id !== id || saved.channel !== channel || saved.targetTag !== targetTag || saved.kind !== kind
          || JSON.stringify(saved.reference) !== JSON.stringify(reference)) throw Error('Local inbox operation mismatch');
        return;
      }
      const value = messageSchema.parse({ id, createdAt: new Date().toISOString(), channel, kind,
        delivery: 'local-only-not-sent', targetTag, reference });
      tx.create(ref, { createdAt: value.createdAt, channel, ciphertext: options.cipher.encrypt(JSON.stringify(value), context(id)) });
    });
    return stopped('local_preview_not_sent');
  }
  const adapters: LocalDeliveryAdapters = {
    pushGateway: {
      publicKey,
      async send(input, payload, signal, authorized) {
        let subscription: ReturnType<typeof checkedSubscription>;
        let reference: z.infer<typeof nativePushReferenceSchema>;
        try {
          subscription = checkedSubscription(input);
          reference = nativePushReferenceSchema.parse({ ...payload, kind: payload.kind ?? 'test' });
        } catch { return stopped('request_invalid'); }
        return capture('web_push', reference.kind, subscription.endpoint, reference.deliveryId, reference, signal, authorized);
      },
    },
    nativePushGateway: {
      available: true,
      apns: { available: true, binding: { topic: 'org.yuyoufang.app', environment: 'sandbox' },
        async send(rawToken, rawReference, signal, authorized) {
          const token = apnsPushTokenSchema.safeParse(rawToken), reference = nativePushReferenceSchema.safeParse(rawReference);
          if (!token.success || !reference.success) return stopped('request_invalid');
          return capture('native_push', reference.data.kind, 'apns:' + token.data, reference.data.deliveryId, reference.data, signal, authorized);
        },
      },
      async send(rawToken, rawReference, signal, authorized) {
        const token = nativePushTokenSchema.safeParse(rawToken), reference = nativePushReferenceSchema.safeParse(rawReference);
        if (!token.success || !reference.success) return stopped('request_invalid');
        return capture('native_push', reference.data.kind, token.data, reference.data.deliveryId, reference.data, signal, authorized);
      },
    },
    telegramConfig: { token: 'local-only-no-telegram-token', botId: '1',
      botUsername: 'yuyoufang_local_inbox_bot', webhookSecret: 'local-only-no-webhook' },
    telegramStartUrl: token => config.publicOrigin + '/__local/telegram/start?token=' + encodeURIComponent(token),
    telegramGateway: {
      async send(input, signal, authorized) {
        if (!Number.isSafeInteger(input.chatId) || input.chatId <= 0 || !/^[A-Za-z0-9_-]{32}$/u.test(input.callbackToken)
          || input.kind !== undefined && !['test', 'care'].includes(input.kind))
          return { status: 'rejected', reason: 'provider_rejected', providerStatus: null, messageId: null };
        const result = await capture('telegram', input.kind ?? 'test', String(input.chatId), input.callbackToken, null, signal, authorized);
        return { ...result, messageId: null };
      },
      async acknowledge() { /* No provider message exists to acknowledge. */ },
    },
  };
  return {
    adapters,
    syntheticTelegramStart(token: string) {
      if (!/^[A-Za-z0-9_-]{32}$/u.test(token)) throw Error('Invalid local Telegram challenge');
      // Stable synthetic identities only; never ask for a real Telegram account.
      const number = (purpose: string) => Number.parseInt(digest([purpose, token]).slice(0, 12), 16) + 1;
      return { kind: 'start' as const, updateId: number('update'), chatId: number('chat'), senderId: number('sender'),
        token, label: '本地 Telegram 測試帳號（未連接 Telegram）' };
    },
    async list() {
      const page = await rows.orderBy('createdAt', 'desc').limit(21).get();
      const deliveries = page.docs.slice(0, 20).map(row => {
        const saved = messageSchema.parse(JSON.parse(options.cipher.decrypt(row.get('ciphertext'), context(row.id))));
        if (saved.id !== row.id || saved.createdAt !== row.get('createdAt') || saved.channel !== row.get('channel'))
          throw Error('Local inbox binding mismatch');
        return { ...saved, label: '本地預覽，未實際發送',
          purpose: saved.kind === 'test' ? '一般渠道測試' : '照護提示（實際事項須從原資源核對）' };
      });
      return { deliveries, deliveryTruncated: page.size > 20 };
    },
  };
}
