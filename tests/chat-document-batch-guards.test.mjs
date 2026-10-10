import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { denyOfflineNetwork, newOfflineLedger, openLedger, validateLedger, sha256 } from '../scripts/lib/chat-intent-probe-guards.mjs';
import { DOCUMENT_BATCH, requireControlledLiveReadiness, prepareDocumentBatchPayload,
  openOfflineDocumentBatch, offlineLegacyFingerprint } from '../scripts/lib/chat-document-batch-guards.mjs';

denyOfflineNetwork();
const settings = { project: DOCUMENT_BATCH.project, location: 'global', model: DOCUMENT_BATCH.model,
  thinkingLevel: 'MEDIUM', candidateCount: 1, maxOutputTokens: 1024, attempts: 1 };
const request = text => ({ contents: [{ role: 'user', parts: [{ text }] }], config: {
  systemInstruction: 'Synthetic system instruction', tools: [{ functionDeclarations: [{ name: 'read_work',
    description: 'Synthetic work reader', parameters: { type: 'OBJECT', properties: { workId: { type: 'STRING' } } } }] }],
} });
const prepared = text => prepareDocumentBatchPayload(request(text), settings);
const opened = new Map();
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'document-batch-test-'));
  t.after(() => { opened.get(path.join(dir, 'synthetic-ledger.json'))?.close(); fs.rmSync(dir, { force: true, recursive: true }); });
  const filename = path.join(dir, 'synthetic-ledger.json');
  fs.writeFileSync(filename, JSON.stringify({ ...newOfflineLedger(), offlineSimulationOnly: true }) + '\n');
  for (const runId of ['historical_b_0001', 'historical_c_0001']) {
    const old = openLedger(filename, { offline: true, runId, caseId: 'B' });
    for (let index = 0; index < 4; index++) { old.reserve(); old.response({ promptTokenCount: 10, totalTokenCount: 20 }); }
    old.finish('completed'); old.close();
  }
  const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.equal(validateLedger(document).calls, 20);
  return { filename, document, expectedLegacySha256: offlineLegacyFingerprint(document), batchId: 'synthetic_batch_01',
    provenance: { testedSha: '5b832f68aa5c6f50321b73e824bb0773890420fc', legacyHarnessSha: 'f93dfb8f200c427867c4a02b803f4453681b0c75',
      candidateSha256: sha256(fs.readFileSync(new URL('../scripts/lib/chat-document-batch-guards.mjs', import.meta.url))) } };
}
function open(f) { const batch = openOfflineDocumentBatch(f.filename, f); opened.set(f.filename, batch); return batch; }
function synthetic(tokens = 7, inspect = () => {}) {
  return { countSynthetic: async (payload, scope) => { inspect('count', payload, scope); return tokens; },
    sendSynthetic: async (payload, scope) => { inspect('send', payload, scope); return {
      finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Synthetic reply' }] },
      usageMetadata: { promptTokenCount: tokens, totalTokenCount: tokens + 10 },
    }; } };
}

test('full frozen payload reaches the same counter and transport after durable reservation', async t => {
  const f = fixture(t), batch = open(f);
  batch.startRoot(DOCUMENT_BATCH.roots[0]);
  const original = request('original synthetic input');
  original.contents.push({ role: 'model', parts: [{ text: 'private synthetic reasoning', thought: true, thoughtSignature: 'opaque-signature' }] });
  original.contents.push({ role: 'user', parts: [{ functionResponse: { name: 'read_work', response: { status: 'succeeded', result: 'synthetic work body' } } }] });
  original.contents.push({ role: 'user', parts: [{ text: 'synthetic initial summary' }] });
  const handle = prepareDocumentBatchPayload(original, settings);
  original.contents[0].parts[0].text = 'caller mutation';
  original.config.tools[0].functionDeclarations[0].description = 'caller mutation';
  let counted, sent = 0;
  await batch.simulateGeneration(handle, synthetic(32768, (phase, payload, scope) => {
    const persisted = JSON.parse(fs.readFileSync(f.filename, 'utf8'));
    assert.equal(persisted.offlineBatchJournal.events[0].type, 'batch_reserved');
    assert.equal(persisted.offlineBatchJournal.events.filter(e => e.type === 'call_reserved').length, 1);
    assert.equal(scope.sdkVersion, '2.24.0');
    assert.equal(payload.config.candidateCount, 1); assert.equal(payload.config.maxOutputTokens, 1024);
    assert.equal(Object.isFrozen(payload.contents[0].parts[0]), true);
    assert.equal(payload.contents[0].parts[0].text, 'original synthetic input');
    assert.equal(payload.contents[1].parts[0].thoughtSignature, 'opaque-signature');
    assert.equal(payload.contents[2].parts[0].functionResponse.response.result, 'synthetic work body');
    assert.equal(payload.contents[3].parts[0].text, 'synthetic initial summary');
    assert.equal(payload.config.tools[0].functionDeclarations[0].description, 'Synthetic work reader');
    if (phase === 'count') counted = payload;
    else { sent++; assert.equal(payload, counted); }
  }));
  assert.equal(sent, 1); assert.equal(batch.snapshot().historicalGenerationCalls, 20);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.filename, 'utf8')).events, f.document.events);
  batch.passRoot();
});

test('input rejection is sticky and preserves the whole reservation without transport', async t => {
  const f = fixture(t), batch = open(f); batch.startRoot(DOCUMENT_BATCH.roots[0]);
  let sends = 0;
  await assert.rejects(batch.simulateGeneration(prepared('oversize'), synthetic(32769, phase => { if (phase === 'send') sends++; })));
  assert.equal(sends, 0);
  assert.equal(batch.snapshot().state, 'failed');
  assert.equal(batch.snapshot().generationCallsReserved, 1);
  assert.equal(batch.snapshot().reservedMicroUsd, 250000); assert.equal(batch.snapshot().refundedMicroUsd, 0);
  assert.throws(() => batch.startRoot(DOCUMENT_BATCH.roots[1]));
});

test('three roots share 4/5/3 and 12 calls while the old 20 cap still rejects a new run', async t => {
  const f = fixture(t), batch = open(f);
  for (let root = 0; root < 3; root++) {
    batch.startRoot(DOCUMENT_BATCH.roots[root]);
    for (let call = 0; call < DOCUMENT_BATCH.rootCaps[root]; call++)
      await batch.simulateGeneration(prepared(`root ${root} call ${call}`), synthetic());
    batch.passRoot();
  }
  assert.deepEqual(batch.snapshot().rootCalls, [4, 5, 3]);
  assert.equal(batch.snapshot().generationCallsReserved, 12); assert.equal(batch.snapshot().state, 'completed');
  await assert.rejects(batch.simulateGeneration(prepared('thirteenth'), synthetic()));
  batch.close();
  assert.throws(() => openOfflineDocumentBatch(f.filename, { ...f, batchId: 'different_batch_02' }), /batch_restart_or_new_id_denied/);
  assert.throws(() => openLedger(f.filename, { offline: true, runId: 'new_legacy_0003', caseId: 'B' }), /ledger_cap_exceeded/);
  assert.equal(validateLedger(JSON.parse(fs.readFileSync(f.filename, 'utf8'))).calls, 20);
});

test('root cap, duplicate payload, and any failed response stop all following roots', async t => {
  for (const kind of ['cap', 'duplicate', 'counter', 'usage', 'timeout', 'invalid-response']) {
    const f = fixture(t), batch = open(f); batch.startRoot(DOCUMENT_BATCH.roots[0]);
    const first = prepared(kind + ' first');
    if (kind === 'cap') for (let i = 0; i < 4; i++) await batch.simulateGeneration(prepared(`cap ${i}`), synthetic());
    if (kind === 'duplicate') await batch.simulateGeneration(first, synthetic());
    let sends = 0;
    const hooks = synthetic(7, phase => { if (phase === 'send') sends++; });
    if (kind === 'counter') hooks.countSynthetic = async () => { throw new Error('synthetic count failure'); };
    if (['usage', 'timeout', 'invalid-response'].includes(kind)) hooks.sendSynthetic = async () => {
      sends++;
      if (kind === 'timeout') throw new Error('synthetic lost response');
      if (kind === 'usage') return { finishReason: 'STOP', usageMetadata: { promptTokenCount: 8, totalTokenCount: 20 } };
      return { finishReason: 'MAX_TOKENS', usageMetadata: { promptTokenCount: 7, totalTokenCount: 17 } };
    };
    await assert.rejects(batch.simulateGeneration(first, hooks));
    assert.equal(batch.snapshot().state, 'failed', kind);
    assert.equal(sends, ['usage', 'timeout', 'invalid-response'].includes(kind) ? 1 : 0, kind);
    assert.throws(() => batch.startRoot(DOCUMENT_BATCH.roots[1]));
    assert.equal(batch.snapshot().refundedMicroUsd, 0);
    batch.close();
  }
});

test('checkpoint loss, corruption, concurrent open and interruption cannot create new allowance', async t => {
  const f = fixture(t), batch = open(f);
  assert.throws(() => open(f), /batch_locked_or_unavailable/);
  batch.startRoot(DOCUMENT_BATCH.roots[0]);
  await batch.simulateGeneration(prepared('first persisted'), synthetic()); batch.close();
  assert.throws(() => open(f), /batch_restart_or_new_id_denied/);
  const g = fixture(t); fs.unlinkSync(g.filename);
  assert.throws(() => open(g), /batch_checkpoint_missing/);
  const h = fixture(t); fs.writeFileSync(h.filename, '{broken');
  assert.throws(() => open(h), /batch_checkpoint_invalid/);
  const i = fixture(t); const changed = { ...i.document, offlineSimulationOnly: false };
  fs.writeFileSync(i.filename, JSON.stringify(changed));
  assert.throws(() => openOfflineDocumentBatch(i.filename, { ...i, expectedLegacySha256: offlineLegacyFingerprint(changed) }), /synthetic_checkpoint_required/);
});

test('write failure and replaced checkpoint deny sending', async t => {
  for (const kind of ['write', 'replace']) {
    const f = fixture(t), batch = open(f); batch.startRoot(DOCUMENT_BATCH.roots[0]);
    let sends = 0;
    if (kind === 'write') fs.mkdirSync(f.filename + '.next');
    else fs.writeFileSync(f.filename, JSON.stringify(f.document));
    await assert.rejects(batch.simulateGeneration(prepared(kind), synthetic(7, phase => { if (phase === 'send') sends++; })));
    assert.equal(sends, 0);
    assert.throws(() => batch.snapshot(), /batch_closed_or_unavailable/);
  }
});

test('extra paid tools, media and changed model scope are rejected; caller token proofs cannot enable live', () => {
  for (const change of [{ model: 'another-model' }, { location: 'us-central1' }, { candidateCount: 2 },
    { maxOutputTokens: 2048 }, { attempts: 2 }])
    assert.throws(() => prepareDocumentBatchPayload(request('scope'), { ...settings, ...change }), /batch_model_scope_mismatch/);
  for (const tools of [[{ googleSearch: {} }], [{ codeExecution: {} }]])
    assert.throws(() => prepareDocumentBatchPayload({ ...request('tools'), config: { tools } }, settings), /paid_or_unreviewed_tool_denied/);
  assert.throws(() => prepareDocumentBatchPayload({ contents: [{ role: 'user', parts: [{ inlineData: { data: 'AA==' } }] }], config: {} }, settings), /text_only_payload_required/);
  assert.throws(() => prepareDocumentBatchPayload({ ...request('cache'), config: { cachedContent: 'cache-id' } }, settings), /unreviewed_generation_config/);
  const getter = request('getter'); Object.defineProperty(getter.config, 'systemInstruction', { get: () => 'changed', enumerable: true });
  assert.throws(() => prepareDocumentBatchPayload(getter, settings), /payload_not_plain_json/);
  let touched = 0;
  assert.throws(() => requireControlledLiveReadiness({ approved: true, totalCostUsd: 1,
    tokenProof: { source: 'official', exact: true }, countTokens: () => touched++, send: () => touched++ }),
  /live_disabled_pending_cost_counter_output_and_successor_authority/);
  assert.equal(touched, 0);
});

test('invalid counters, absent usage, forged handles and deadlines stay closed without refunds', async t => {
  for (const kind of ['missing-counter', 'fractional', 'negative', 'nan', 'missing-usage', 'output', 'forged', 'deadline']) {
    const f = fixture(t); let time = 1000;
    const batch = openOfflineDocumentBatch(f.filename, { ...f, now: () => time }); opened.set(f.filename, batch);
    batch.startRoot(DOCUMENT_BATCH.roots[0]); let sends = 0;
    const hooks = synthetic(7, phase => { if (phase === 'send') sends++; });
    if (kind === 'missing-counter') hooks.countSynthetic = undefined;
    if (kind === 'fractional') hooks.countSynthetic = async () => 7.5;
    if (kind === 'negative') hooks.countSynthetic = async () => -1;
    if (kind === 'nan') hooks.countSynthetic = async () => NaN;
    if (kind === 'deadline') hooks.countSynthetic = async () => { time += 90000; return 7; };
    if (['missing-usage', 'output'].includes(kind)) hooks.sendSynthetic = async () => {
      sends++; return { finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Synthetic reply' }] },
        ...(kind === 'output' ? { usageMetadata: { promptTokenCount: 7, totalTokenCount: 1032 } } : {}) };
    };
    const handle = prepared(kind);
    await assert.rejects(batch.simulateGeneration(kind === 'forged' ? { ...handle, inputTokens: 7, verified: true } : handle, hooks));
    assert.equal(sends, ['missing-usage', 'output'].includes(kind) ? 1 : 0, kind);
    assert.equal(batch.snapshot().state, 'failed', kind); assert.equal(batch.snapshot().refundedMicroUsd, 0);
    batch.close();
  }
});

test('search schema is counted but any paid or out-of-scenario call is denied before ADK and stops the batch', async t => {
  for (const names of [['search_knowledge'], ['contact_caregiver'], Array(9).fill('read_work')]) {
    const f = fixture(t), batch = open(f); batch.startRoot(DOCUMENT_BATCH.roots[0]);
    const input = request('core search declaration'); input.config.tools[0].functionDeclarations.push({ name: 'search_knowledge' });
    let returnedToAdk = 0;
    await assert.rejects(async () => {
      await batch.simulateGeneration(prepareDocumentBatchPayload(input, settings), {
        countSynthetic: async payload => {
          assert.ok(payload.config.tools[0].functionDeclarations.some(d => d.name === 'search_knowledge')); return 7;
        },
        sendSynthetic: async () => ({ finishReason: 'STOP', usageMetadata: { promptTokenCount: 7, totalTokenCount: 17 },
          content: { role: 'model', parts: names.map(name => ({ functionCall: { name, args: {} } })) } }),
      });
      returnedToAdk++;
    });
    assert.equal(returnedToAdk, 0); assert.equal(batch.snapshot().state, 'failed');
    assert.equal(batch.snapshot().generationCallsReserved, 1);
    assert.throws(() => batch.startRoot(DOCUMENT_BATCH.roots[1])); batch.close();
  }
});

test('nested SDK media and control fields are rejected while opaque business JSON is preserved', async t => {
  const make = functionResponse => ({ contents: [{ role: 'user', parts: [{ functionResponse }] }], config: {} });
  for (const extra of [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] },
    { parts: [{ fileData: { fileUri: 'gs://synthetic-only/image.png', mimeType: 'image/png' } }] },
    { scheduling: 'INTERRUPT' }, { willContinue: true }]) {
    assert.throws(() => prepareDocumentBatchPayload(make({ name: 'read_work', response: {}, ...extra }), settings), /text_only_payload_required/);
  }
  assert.throws(() => prepareDocumentBatchPayload({ contents: [{ role: 'model', parts: [{ functionCall: {
    name: 'read_work', args: {}, partialArgs: [], willContinue: true,
  } }] }], config: {} }, settings), /text_only_payload_required/);
  const f = fixture(t), batch = open(f); batch.startRoot(DOCUMENT_BATCH.roots[0]);
  const body = { status: 'succeeded', parts: [{ fileData: 'ordinary business JSON key' }], scheduling: 'ordinary text' };
  await batch.simulateGeneration(prepareDocumentBatchPayload(make({ id: 'synthetic', name: 'read_work', response: body }), settings),
    synthetic(7, (phase, payload) => { assert.deepEqual(payload.contents[0].parts[0].functionResponse.response, body); }));
  await assert.rejects(batch.simulateGeneration(prepared('invalid returned media'), {
    countSynthetic: async () => 7,
    sendSynthetic: async () => ({ finishReason: 'STOP', usageMetadata: { promptTokenCount: 7, totalTokenCount: 17 },
      content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }),
  }), /text_only_payload_required/);
  assert.equal(batch.snapshot().state, 'failed');
});

test('prior failed or unknown tool results stop persistently before another counter or generation', async t => {
  for (const status of ['failed', 'unknown', 'rejected', 'conflict', null]) {
    const f = fixture(t), batch = open(f); batch.startRoot(DOCUMENT_BATCH.roots[0]);
    const input = request('tool failure');
    input.contents.push({ role: 'user', parts: [{ functionResponse: { name: 'read_work',
      response: status === null ? {} : { status } } }] });
    let calls = 0;
    await assert.rejects(batch.simulateGeneration(prepareDocumentBatchPayload(input, settings), {
      countSynthetic: async () => { calls++; return 7; }, sendSynthetic: async () => { calls++; return {}; },
    }), /batch_prior_tool_failure/);
    assert.equal(calls, 0); assert.equal(batch.snapshot().generationCallsReserved, 0);
    assert.equal(batch.snapshot().state, 'failed'); assert.throws(() => batch.startRoot(DOCUMENT_BATCH.roots[1]));
    batch.close();
  }
});
