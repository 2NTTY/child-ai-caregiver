import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { handleProductAgentRequest } from '../server/product-agent-api.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { summaryManifestHash, summaryRevisionId } from '../server/private-summary-work.ts';

const former = '疫苗接種時帶綠色手巾。', corrected = '疫苗接種時改帶藍色布兔。', siblingText = '疫苗接種時帶黃色小熊。';
const question = '下次去打針要帶邊樣安撫物？請引返我最後確認嘅原句。';
const blocked = async () => { throw new Error('external_transport_disabled'); };

// Callers supplying a live provider retain the existing account, policy, daily ledger and spending ceiling.
export async function verifyPrivateFactRecall({ options, user, config, liveProviders, beforeReply, cases = ['recent', 'cold'] }) {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d{1,5}$/u);
  assert.match(options.projectId, /^demo-/u);
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options);
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  async function createFixture(text, summarize = false) {
    const { child } = await authority.createChild({ userId: user, displayName: '合成測試孩子', operationId: randomUUID() });
    const origin = await chat.createUserMessageForUser(user, child.id, text);
    if (summarize) {
      const input = await memory.prepareSummary(user, child.id);
      await memory.saveSummary(user, child.id, { previousVersion: input.previousVersion, basis: input.basis, text,
        coveredMessageIds: [origin.id] });
    }
    const values = { key: '接種日安排', content: text, validUntil: null, source: { kind: 'private_chat', messageId: origin.id, description: '家長原話' } };
    const candidate = await memory.createFact(user, child.id, { values, intendedVisibility: 'private' });
    const fact = await memory.confirmFact(user, child.id, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false });
    return { child, fact, values };
  }
  const { child, fact, values } = await createFixture(former, true);
  await createFixture(siblingText);
  const correction = await chat.createUserMessageForUser(user, child.id, corrected);
  const current = await memory.reviseFact(user, child.id, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false, reason: '家長更正',
    values: { ...values, content: corrected, source: { ...values.source, messageId: correction.id } } });
  assert.equal(await memory.initialConversationSummary(user, child.id), null);
  const revision = await authority.runTransaction(user, child.id, async b => {
    const selected = await memory.selectSource(b, { kind: 'next_fresh' }), workId = randomUUID();
    assert.equal(selected.kind, 'eligible');
    assert.deepEqual(selected.manifest.coveredMessageIds, [correction.id]);
    return { format: 'private-summary-source-revision/v1', id: summaryRevisionId(workId, 1), workId, sourceRevision: 1,
      scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, manifest: selected.manifest,
      manifestHash: summaryManifestHash(selected.manifest), createdAt: new Date().toISOString() };
  });
  const receipts = [];
  let cold, delayed;
  for (const scenario of cases) {
    assert.ok(['cold', 'recent'].includes(scenario));
    if (scenario === 'cold') for (let i = 0; i < 6; i++) await chat.createUserMessageForUser(user, child.id, '另一段獨立話題 ' + i);
    const reference = correction;
    const message = await chat.createUserMessageForUser(user, child.id, scenario === 'cold' ? question : '請引返我上一句講嘅安排。');
    let contextReads = 0, modelCalls = 0, reviewerCalls = 0, hasSearched = false;
    const scripted = { async generate(request) {
      modelCalls++;
      assert.ok(!JSON.stringify(request.contents).includes(siblingText));
      assert.ok(!JSON.stringify(request.contents).includes(former));
      const parts = request.contents.flatMap(entry => entry.parts ?? []);
      const review = parts.flatMap(part => {
        if (!part.text?.startsWith('Server evidence payload for chat-delivery-review.')) return [];
        return [JSON.parse(part.text.slice(part.text.indexOf('\n') + 1))];
      })[0];
      let part;
      if (review) {
        reviewerCalls++;
        assert.ok(review.paragraphs.some(item => item.text.includes(corrected)));
        assert.ok(review.sources.some(item => item.citationId.startsWith('chat:' + reference.id + ':') && JSON.parse(item.excerpt).text === corrected));
        part = { text: JSON.stringify({ draftHash: review.draftHash, decision: 'pass', issues: [] }) };
      } else {
        let name, args;
        if (scenario === 'cold' && !hasSearched) {
          if (!request.toolsDict.search_history) { name = 'load_capabilities'; args = { capabilities: ['history'] }; }
          else { name = 'search_history'; args = { kind: 'memory_fact', query: '打針' }; hasSearched = true; }
        } else {
          name = 'present_answer';
          // A scripted speaker selects the evidence returned by the Server. It may not invent an H handle or inject answer text.
          const wire = JSON.stringify(request.contents);
          const matches = [...wire.replaceAll('\\"', '"').matchAll(/"quoteHistory":"([HR]\d+)"/gu)];
          assert.ok(matches.length);
          const handle = matches.at(-1)[1];
          args = { kind: 'private_reference', paragraphs: [{ quoteHistory: handle }] };
        }
        part = { functionCall: { id: randomUUID(), name, args } };
      }
      return { content: { role: 'model', parts: [part] }, finishReason: 'STOP', usageMetadata: { promptTokenCount: 20, totalTokenCount: 28 } };
    } };
    const product = await createFirestoreProductAgent({ ...options, config, online, chat, care, memory: { ...memory,
      context: async (...args) => { contextReads++; return memory.context(...args); } },
      platformProviders: liveProviders ?? (() => ({ agent: scripted, model: { generate: blocked }, embedding: { embed: blocked } })) });
    if (!liveProviders) {
      assert.equal(await product.agent.reply(user, child.id, randomUUID(), async () => true), null);
      assert.equal(modelCalls, 0);
    }
    await beforeReply?.({ scenario, childId: child.id, messageId: message.id });
    const result = await product.agent.reply(user, child.id, message.id, async () => true);
    const sources = result?.deliveryReview?.sourceVersions ?? [];
    const receipt = { scenario, provider: liveProviders ? 'live' : 'scripted', runId: result?.runId, status: result?.status,
      stopReason: result?.stopReason, counts: result?.counts, tools: result?.tools.map(t => t.name), contextReads,
      review: result?.deliveryReview?.decision, exactQuote: result?.text.includes(corrected) ?? false,
      originalBound: sources.some(source => source.citationId.startsWith('chat:' + reference.id + ':') && source.version === '1'),
      factVersionBound: sources.some(source => source.citationId === 'memory-fact:' + fact.id && source.version === String(current.version)),
      unrelatedOrFormerValue: !!result && [former, siblingText].some(value => result.text.includes(value)) };
    console.log(JSON.stringify(receipt));
    assert.equal(result?.status, 'completed');
    assert.ok(receipt.exactQuote && receipt.originalBound && !receipt.unrelatedOrFormerValue);
    assert.equal(receipt.review, 'pass');
    if (scenario === 'cold') assert.equal(receipt.factVersionBound, true);
    else { assert.deepEqual(receipt.tools, ['present_answer']); assert.equal(contextReads, 0); assert.equal(result.counts.modelCalls, 2); }
    if (!liveProviders) { assert.equal(reviewerCalls, 1); assert.equal(modelCalls, result.counts.modelCalls); }
    if (scenario === 'cold') {
      const publish = () => handleProductAgentRequest(new Request('http://localhost/api/children/' + child.id + '/messages/' + message.id + '/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-expected-user-id': user }, body: '{}',
      }), user, { agent: product.agent, store: product.store, chat, isCurrentUser: async () => true });
      const response = await publish();
      assert.equal(response.status, 200);
      const { message: reply } = await response.json();
      assert.equal(reply.agentRunId, result.runId);
      assert.ok(reply && !('memorySources' in reply));
      cold = { reply, publish, replay: () => product.agent.reply(user, child.id, message.id, async () => true), calls: () => modelCalls };
    } else {
      delayed = () => chat.createModelMessageForUser(user, child.id, message.id, result.text);
    }
    receipts.push(receipt);
  }
  const input = await memory.prepareSummary(user, child.id);
  const saved = await memory.saveSummary(user, child.id, { previousVersion: input.previousVersion, basis: input.basis,
    text: corrected, coveredMessageIds: [correction.id] });
  let copyBatch;
  if (cold) {
    const input = await memory.prepareSummary(user, child.id);
    const coveredMessageIds = input.messages.map(item => item.id);
    assert.ok(coveredMessageIds.includes(cold.reply.id) && !coveredMessageIds.includes(correction.id));
    copyBatch = await memory.saveSummary(user, child.id, { previousVersion: input.previousVersion, basis: input.basis, text: corrected, coveredMessageIds });
  }
  await memory.delete(user, child.id, 'facts', fact.id, current.version);
  const reopened = createFirestoreMemoryStore({ ...options, chat: createFirestoreChatStore(options), care: createFirestoreCareStore(options) });
  assert.equal(await reopened.getFact(user, child.id, fact.id), null);
  assert.equal(await reopened.initialConversationSummary(user, child.id), null);
  const retirement = await authority.runTransaction(user, child.id, async b => ({
    lateResult: (await reopened.revalidateSource(b, revision)).kind,
    rebuiltSource: (await reopened.rebuildSummarySource(b, revision)).kind,
    repair: (await reopened.selectSource(b, { kind: 'repair_batch', summaryId: saved.id })).kind,
  }));
  assert.deepEqual(retirement, { lateResult: 'suppressed', rebuiltSource: 'suppressed', repair: 'suppressed' });
  if (cold) {
    await authority.runTransaction(user, child.id, async b => {
      assert.equal(await chat.readMessage(b, child.id, cold.reply.id, 'memory'), null);
      assert.equal((await reopened.selectSource(b, { kind: 'repair_batch', summaryId: copyBatch.id })).kind, 'suppressed');
    });
    assert.equal((await chat.getOriginalMessageForUser(user, child.id, cold.reply.id)).text, cold.reply.text);
    assert.ok(Date.parse((await chat.listForUser(user, child.id, null, 'agent')).sourceDeadlines[cold.reply.id]) <= Date.now());
    const calls = cold.calls(), replay = await cold.replay();
    assert.ok(replay.status === 'stopped' && !replay.text.includes(corrected));
    const replayResponse = await cold.publish();
    assert.equal(replayResponse.status, 409);
    assert.equal((await replayResponse.json()).error.code, 'source_changed');
    assert.equal(cold.calls(), calls);
    retirement.savedCopy = 'excluded_from_memory';
    retirement.replayedRun = 'withheld';
    retirement.replayedHttpReply = 409;
  }
  if (delayed) {
    await assert.rejects(delayed, { code: 'source_changed' });
    retirement.lateDelivery = 'source_changed';
  }
  console.log(JSON.stringify({ sameFactId: true, deletedVersion: current.version, reopenedSummary: null, ...retirement }));
  return { receipts, retirement };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectId = process.env.GCLOUD_PROJECT;
  assert.match(projectId ?? '', /^demo-/u);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d{1,5}$/u);
  const database = new Firestore({ projectId });
  try {
    const options = { projectId, database, cipher: createStorageCipher(randomBytes(32)), namespace: 'req007_' + randomBytes(12).toString('hex') };
    const authority = createFirestoreAuthority(options), user = 'synthetic-recall', email = 'recall@example.test';
    await authority.initializeControl({ generation: randomUUID(), enabled: true });
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId: user, email, emailVerified: true });
    await authority.acknowledge({ userId: user, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    await verifyPrivateFactRecall({ options, user, config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: projectId }) });
  } finally { await database.terminate(); }
}
