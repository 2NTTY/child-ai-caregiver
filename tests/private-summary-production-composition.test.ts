import test from 'node:test';
import assert from 'node:assert/strict';
import { privateSummaryFixture } from './helpers/private-summary-work.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';

async function fixture() {
  const f = await privateSummaryFixture();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic private source');
  let calls = 0;
  const product = await createFirestoreProductAgent({ ...f.options, chat: f.chat, care: f.care, memory: f.memory,
    online: createFirestoreOnlineStore(f.options), config: readAiConfig({ AI_ENABLED: 'false' }),
    platformProvider: { async generate() { calls++; throw new Error('No provider call is authorized'); } } });
  return { ...f, product, calls: () => calls };
}

test('the production composer provides the original durable work service without inventing a work policy', async () => {
  const f = await fixture();
  const product = f.product as unknown as { summaryWork?: { start(...args: unknown[]): Promise<unknown> } };
  assert.equal(typeof product.summaryWork?.start, 'function');
  assert.deepEqual(await product.summaryWork!.start('owner', f.childId, { kind: 'next_fresh' }),
    { kind: 'blocked', reason: 'policy_missing' });
  assert.equal(f.calls(), 0);
  assert.ok(![...f.fake.records.keys()].some(path => path.includes('_private_summary_')));
});

test('the production composer exposes only the journaled native erasure primitive to maintenance', async () => {
  const f = await fixture();
  const port = (f.product as unknown as { summarySessions?: Record<string, unknown> }).summarySessions;
  assert.ok(port);
  assert.deepEqual(Object.keys(port), ['prepareContentErasure']);
  assert.equal(typeof port.prepareContentErasure, 'function');
  assert.equal(f.calls(), 0);
});

test('a constructor grant resolver cannot replace the production persistent cutover reader', async () => {
  const f = await privateSummaryPolicyFixture(); await f.barrier();
  let calls = 0;
  const product = await createFirestoreProductAgent({ ...f.options, chat: f.chat, care: f.care, memory: f.memory,
    online: createFirestoreOnlineStore(f.options), config: readAiConfig({ AI_ENABLED: 'false' }), summaryWorkPolicy: f.policy,
    platformProvider: { async generate() { calls++; throw new Error('No provider call is authorized'); } } });
  assert.deepEqual(await product.summaryWork.start('owner', f.childId, { kind: 'next_fresh' }),
    { kind: 'blocked', reason: 'legacy_missing' });
  assert.equal(f.resolutions(), 0); assert.equal(calls, 0);
  assert.ok(![...f.fake.records.keys()].some(path => path.includes('_private_summary_')));
});
