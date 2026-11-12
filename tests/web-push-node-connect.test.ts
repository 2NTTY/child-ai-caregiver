import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import type { LookupOptions } from 'node:dns';
import { request as nodeRequest, type RequestOptions } from 'node:https';
import { createServer } from 'node:net';
import type { AddressInfo, LookupFunction } from 'node:net';
import test from 'node:test';

test('Node HTTPS connects locally using the gateway IPv4 pinned lookup callback contract', { timeout: 5000 }, async context => {
  let connected = 0;
  const local = createServer(socket => { connected++; socket.destroy(); });
  await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => local.close(error => error ? reject(error) : resolve())));
  const port = (local.address() as AddressInfo).port, actualLookupOptions: LookupOptions[] = [];
  const dnsModuleOptions = { cache: false, exports: {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
  } };
  context.mock.module('node:dns/promises', dnsModuleOptions);
  const httpsModuleOptions = { cache: false, exports: {
    request: (url: URL, options: RequestOptions, response: Parameters<typeof nodeRequest>[2]) => {
      // Only the test router changes the port/address. Real HTTPS/TLS/net consume the gateway options.
      const routed = new URL(url); routed.port = String(port);
      return nodeRequest(routed, { ...options, lookup: ((host, lookupOptions, callback) => {
        actualLookupOptions.push({ ...lookupOptions });
        options.lookup!(host, lookupOptions, (error, address, family) => {
          assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
          callback(error, '127.0.0.1', family);
        });
      }) as LookupFunction }, response);
    },
  } };
  context.mock.module('node:https', httpsModuleOptions);
  const { createWebPushGateway } = await import('../server/web-push-gateway.ts');
  const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.alloc(32, 2));
  const gateway = createWebPushGateway({ publicKey: key.getPublicKey().toString('base64url'),
    privateKey: key.getPrivateKey().toString('base64url'), subject: 'mailto:push@example.test' });
  const result = await gateway.send({ endpoint: 'https://web.push.apple.com/synthetic-token', expirationTime: null,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 3).toString('base64url') } },
  { v: 2, kind: 'chat', bindingId: randomUUID(), bindingVersion: 1, deliveryId: randomUUID() },
  new AbortController().signal, async () => true);
  assert.equal(connected, 1);
  assert.equal(actualLookupOptions.length, 1);
  assert.equal(actualLookupOptions[0]!.family, 4);
  assert.notEqual(actualLookupOptions[0]!.all, true);
  // A loopback TCP peer deliberately closes before TLS; no provider request can be accepted.
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'transport_unknown');
});
