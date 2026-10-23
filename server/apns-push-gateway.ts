import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { connect, constants, type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2';
import { apnsPushTokenSchema, nativePushContent, nativePushReferenceSchema } from '../src/shared/native-push.ts';
import { apnsBindingSchema, type ApnsBinding, type NativeApnsGateway } from './native-push-gateway.ts';
import type { PushSendResult } from './web-push-types.ts';

export interface ApnsPushConfig extends ApnsBinding { teamId: string; keyId: string; privateKey: KeyObject; }
const identifier = /^[A-Z0-9]{10}$/u;
export async function readApnsPushConfig(env: Record<string, string | undefined>): Promise<ApnsPushConfig | null> {
  if (env.IOS_PUSH_ENABLED === undefined || env.IOS_PUSH_ENABLED === 'false') return null;
  try {
    if (env.IOS_PUSH_ENABLED !== 'true' || !identifier.test(env.APNS_TEAM_ID ?? '') || !identifier.test(env.APNS_KEY_ID ?? '')
      || !env.APNS_PRIVATE_KEY_FILE || !isAbsolute(env.APNS_PRIVATE_KEY_FILE)) throw Error();
    const binding = apnsBindingSchema.parse({ topic: env.APNS_BUNDLE_ID, environment: env.APNS_ENVIRONMENT });
    const file = await open(env.APNS_PRIVATE_KEY_FILE, 'r');
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > 8192 || process.platform !== 'win32' && (info.mode & 0o077)) throw Error();
      const buffer = Buffer.alloc(8193), read = await file.read(buffer, 0, buffer.length, 0);
      if (read.bytesRead > 8192 || read.bytesRead !== info.size) { buffer.fill(0); throw Error(); }
      bytes = buffer.subarray(0, read.bytesRead);
    } finally { await file.close(); }
    let privateKey: KeyObject;
    try { privateKey = createPrivateKey(bytes); } finally { bytes.fill(0); }
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
    return { ...binding, teamId: env.APNS_TEAM_ID!, keyId: env.APNS_KEY_ID!, privateKey };
  } catch { throw new Error('apns_push_config_invalid'); }
}

const stopped = (reason: PushSendResult['reason']): PushSendResult => ({ status: 'stopped', reason, providerStatus: null });
const unknown = (): PushSendResult => ({ status: 'unknown', reason: 'transport_unknown', providerStatus: null });

/** One HTTP/2 request, with no retry or fallback host. The business ledger owns recovery. */
export function createApnsPushGateway(config: ApnsPushConfig, ports: {
  connect?: typeof connect; deadlineMs?: number;
} = {}): NativeApnsGateway {
  const binding = apnsBindingSchema.parse({ topic: config.topic, environment: config.environment });
  if (!identifier.test(config.teamId) || !identifier.test(config.keyId) || config.privateKey.type !== 'private'
    || config.privateKey.asymmetricKeyType !== 'ec' || config.privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('apns_push_config_invalid');
  const deadlineMs = ports.deadlineMs ?? 15000;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 15000) throw new Error('apns_push_config_invalid');
  const transport = ports.connect ?? connect;
  const host = binding.environment === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  let cached: { issuedAt: number; jwt: string } | undefined;
  function credential() {
    const now = Math.floor(Date.now() / 1000);
    if (cached && now >= cached.issuedAt && now - cached.issuedAt < 3000) return cached.jwt;
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: now })).toString('base64url');
    const input = header + '.' + claims;
    const signature = sign('sha256', Buffer.from(input), { key: config.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    cached = { issuedAt: now, jwt: input + '.' + signature }; return cached.jwt;
  }
  return { available: true, binding,
    async send(rawToken, rawReference, outerSignal, stillAuthorized) {
      const token = apnsPushTokenSchema.safeParse(rawToken), reference = nativePushReferenceSchema.safeParse(rawReference);
      if (!token.success || !reference.success) return stopped('request_invalid');
      const controller = new AbortController(), { signal } = controller;
      const abort = () => controller.abort(); outerSignal.addEventListener('abort', abort, { once: true });
      if (outerSignal.aborted) abort();
      const timer = setTimeout(abort, deadlineMs); timer.unref();
      let client: ClientHttp2Session | undefined, stream: ClientHttp2Stream | undefined, issued = false;
      let status = 0;
      const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
        if (signal.aborted) throw new Error('apns_interrupted');
        let listener = () => {};
        try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
          listener = () => reject(new Error('apns_interrupted'));
          signal.addEventListener('abort', listener, { once: true }); if (signal.aborted) listener();
        })]); } finally { signal.removeEventListener('abort', listener); }
      };
      const rejection = (reason?: string): PushSendResult => ({ status: 'rejected',
        reason: status === 410 && reason === 'Unregistered' ? 'subscription_expired' : status === 429 ? 'rate_limited' : 'provider_rejected', providerStatus: status });
      try {
        if (signal.aborted) return stopped('worker_interrupted');
        const jwt = credential();
        client = transport(host, { settings: { enablePush: false } });
        // Keep an error listener until destruction, including errors after a settled request.
        client.on('error', () => {});
        await bounded(() => new Promise<void>((resolve, reject) => {
          const connected = () => { cleanup(); resolve(); }, failed = () => { cleanup(); reject(new Error('apns_connect_failed')); };
          const cleanup = () => { client!.off('connect', connected); client!.off('error', failed); client!.off('close', failed); };
          client!.once('connect', connected); client!.once('error', failed); client!.once('close', failed);
        }));
        if (!await bounded(stillAuthorized)) return stopped('revoked');
        if (signal.aborted) return stopped('worker_interrupted');
        const r = reference.data, content = r.kind === 'test'
          ? { title: nativePushContent.test.title, body: '這是本人 iOS 通知測試，沒有孩子資料。' } : { ...nativePushContent.care };
        const body = JSON.stringify({ aps: { alert: content, sound: 'default' },
          body: { v: '1', kind: r.kind, bindingId: r.bindingId, bindingVersion: String(r.bindingVersion), deliveryId: r.deliveryId } });
        const sentAt = new Date().toISOString();
        issued = true;
        const response = await bounded(() => new Promise<{ id: unknown; body: string }>((resolve, reject) => {
          let id: unknown, size = 0; const parts: Buffer[] = [];
          stream = client!.request({ ':method': 'POST', ':path': '/3/device/' + token.data,
            authorization: 'bearer ' + jwt, 'apns-topic': binding.topic, 'apns-push-type': 'alert',
            'apns-priority': '5', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 300),
            'apns-id': r.deliveryId, 'apns-collapse-id': r.deliveryId, 'content-type': 'application/json' }, { signal });
          stream.on('response', headers => { status = typeof headers[':status'] === 'number' ? headers[':status'] : 0; id = headers['apns-id']; });
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 8192) { reject(new Error('apns_response_too_large')); stream!.close(constants.NGHTTP2_CANCEL); return; }
            parts.push(chunk);
          });
          stream.on('error', () => reject(new Error('apns_transport_failed')));
          stream.on('aborted', () => reject(new Error('apns_transport_aborted')));
          stream.on('end', () => resolve({ id, body: Buffer.concat(parts).toString('utf8') }));
          stream.on('close', () => reject(new Error('apns_transport_closed')));
          stream.end(body);
        }));
        if (status === 200) return response.id === r.deliveryId && response.body.length === 0
          ? { status: 'accepted', reason: null, providerStatus: 200,
            message: { ...content, channel: 'native_push', contentVersion: 'native-push-generic-v1', sentAt } } : unknown();
        if (status >= 400 && status <= 599) {
          let reason: string | undefined;
          try { const parsed: unknown = JSON.parse(response.body); if (parsed && typeof parsed === 'object' && 'reason' in parsed && typeof parsed.reason === 'string') reason = parsed.reason; } catch {}
          return rejection(reason);
        }
        return unknown();
      } catch {
        if (status >= 400 && status <= 599) return rejection();
        return issued ? unknown() : stopped(signal.aborted ? 'worker_interrupted' : 'configuration_unavailable');
      } finally {
        clearTimeout(timer); outerSignal.removeEventListener('abort', abort);
        if (stream && !stream.destroyed) stream.close(constants.NGHTTP2_CANCEL);
        client?.destroy();
      }
    },
  };
}
