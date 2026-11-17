import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {serialFirestoreFixture} from '../tests/helpers/firestore-session-memory.ts';
import {createStorageCipher} from '../server/storage-crypto.ts';
import {createFirestoreAuthority} from '../server/firestore-authority.ts';
import {createFirestoreCareStore} from '../server/firestore-care.ts';
import {createFirestoreChatStore} from '../server/firestore-chat.ts';
import {createFirestoreMemoryStore} from '../server/firestore-memory.ts';
import {createFirestoreOnlineStore} from '../server/firestore-online.ts';
import {createFirestoreProductAgent} from '../server/firestore-product-agent.ts';
import {createFirebaseRequestHandler} from '../server/firebase-app.ts';
import {createVertexAgentProvider} from '../server/agent-model-gateway.ts';
import {readAiConfig} from '../server/ai-config.ts';
import {SERVICE_POLICY_VERSION} from '../src/shared/account-service.ts';

if (!process.argv.includes('--live') || !process.env.P4_VERTEX_PROJECT) {
  throw new Error('Set P4_VERTEX_PROJECT and pass --live to use your ADC for a billable Vertex run.');
}
const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: process.env.P4_VERTEX_PROJECT, VERTEX_LOCATION: 'global' });
const origin = 'https://acceptance.example.test';
const uid = 'parent', email = 'p4-acceptance@example.test';
const { database } = serialFirestoreFixture();
const options = { database, projectId: 'demo-mixed-materials', namespace: 'p4_material_smoke',
  cipher: createStorageCipher(Buffer.alloc(32, 84)) };
const authority = createFirestoreAuthority(options);
const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
const memory = createFirestoreMemoryStore({ ...options, chat, care });
const online = createFirestoreOnlineStore(options);

await authority.initializeControl({ enabled: true, generation: randomUUID() });
await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 86400000).toISOString(), operationId: randomUUID() });
await authority.admitIdentity({ userId: uid, email, emailVerified: true });
await authority.acknowledge({ userId: uid, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
const selected = new Map();
for (const [name, pattern] of [['小松', '月亮'], ['小禾', '星星'], ['小樹', '火箭']]) {
  const { child } = await authority.createChild({ userId: uid, operationId: randomUUID(), displayName: name });
  const fact = await memory.createFact(uid, child.id, {
    values: { key: '水樽', content: name + '的水樽貼了' + pattern + '貼紙。', source: { kind: 'manual', description: '家長確認' }, validUntil: null },
    intendedVisibility: 'private',
  });
  const original = await memory.confirmFact(uid, child.id, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false });
  if (name !== '小樹') selected.set(child.id, { id: original.id, version: original.version, name, pattern });
}

const vertex = createVertexAgentProvider(config);
const usage = { requests: 0, promptTokens: 0, candidateTokens: 0 };
const provider = {
  async generate(request, signal) {
    usage.requests++;
    const response = await vertex.generate(request, signal);
    usage.promptTokens += response.usageMetadata?.promptTokenCount ?? 0;
    usage.candidateTokens += response.usageMetadata?.candidatesTokenCount ?? 0;
    return response;
  },
};
const product = await createFirestoreProductAgent({ ...options, chat, care, memory, online, config, platformProvider: provider });
const handle = createFirebaseRequestHandler({ authority, product, chat, care, publicOrigin: origin, mailConfigured: true,
  auth: { getSession: async () => ({ user: { id: uid } }), handler: async () => new Response(null, { status: 404 }) } });

async function request(path, body) {
  const response = await handle(new Request(origin + '/api/account/mixed-chats' + path, {
    method: body ? 'POST' : 'GET',
    headers: { origin, 'content-type': 'application/json', 'x-expected-user-id': uid },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  assert.ok(response.ok, 'HTTP ' + response.status);
  return response.json();
}
const { room } = await request('', { scope: { kind: 'personal' }, childIds: [...selected.keys()], operationId: randomUUID() });
const { message } = await request('/' + room.id + '/messages', { expectedVersion: room.version, operationId: randomUUID(),
  text: '聽日去旅行，怕執錯水樽。幫我睇返記低咗小松同小禾嘅水樽各自貼咗咩圖案？' });
const base = '/' + room.id + '/messages/' + message.id;
const { result } = await request(base + '/reply', {});
console.log(JSON.stringify({ model: config.model, recipe: result.provenance?.recipeId, state: result.status, stop: result.stopReason,
  review: result.deliveryReview?.decision, ...usage }));
assert.equal(result.status, 'completed');
assert.equal(result.deliveryReview?.decision, 'pass');
assert.doesNotMatch(result.text, /火箭|小樹/u);
const checked = new Set();
for (const [, ordinal] of result.text.matchAll(/\[孩子資料\s*(\d+)\]/gu)) {
  const { citation } = await request(base + '/material-citations/' + ordinal);
  const expected = selected.get(citation.childId);
  assert.ok(expected);
  assert.equal(citation.kind, 'memory');
  assert.equal(citation.id, expected.id);
  assert.equal(citation.version, expected.version);
  assert.ok(citation.text.includes(expected.pattern));
  assert.ok(result.text.includes(expected.name) && result.text.includes(expected.pattern));
  checked.add(citation.childId);
}
assert.equal(checked.size, selected.size);
assert.equal((await request(base + '/reply')).result.runId, result.runId);
console.log('Both selected originals and the saved run verified.');
