import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectId, host, connections, blocked } from './firestore-session-emulator-guard.mjs';

// Import SDKs after the exact-loopback-only socket/DNS/TLS guard is installed.
const { Firestore } = await import('@google-cloud/firestore');
const { BaseSessionService, BaseLlm, LlmAgent, NodeTool, RequestInput, Runner, Workflow, node, setLogger, createEvent, State } = await import('@google/adk');
const { z } = await import('zod');
const { FirestoreSessionService } = await import('../server/firestore-session-service.ts');
const { canonical, createCodec, encodeId, persistentEvent } = await import('../server/firestore-session-codec.ts');
const { createStorageCipher } = await import('../server/storage-crypto.ts');
process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = 'false';
setLogger(null);
const BASE = path.dirname(fileURLToPath(import.meta.url));
const stage = process.argv[3], OUT = process.argv[4];
assert.ok(['pause', 'resume'].includes(stage)); assert.ok(OUT);
const database = new Firestore({ projectId, host, ssl: false, preferRest: false });
const namespace = 'adk_workflow_fixture', metaNamespace = 'workflow_domain_fixture';
const cipher = createStorageCipher(Buffer.alloc(32, 23));
const codec = createCodec(cipher, projectId, namespace);
const APP = 'synthetic_yuban_resume', OWNER = 'synthetic-owner';
const tuple = id => ({ appName: APP, userId: OWNER, sessionId: id });
const paths = id => {
  const app = database.collection(namespace).doc(encodeId(APP));
  const user = app.collection('users').doc(encodeId(OWNER));
  const session = user.collection('sessions').doc(encodeId(id));
  return { app, user, session, events: session.collection('events') };
};
const bindingRef = id => database.collection(metaNamespace).doc('bindings').collection('items').doc(encodeId(id));
const receiptRef = id => database.collection(metaNamespace).doc('receipts').collection('items').doc(encodeId(`op-${id}`));
const binding = async id => (await bindingRef(id).get()).data();
const eventCount = async id => (await paths(id).events.get()).size;
const receiptCount = async id => Number((await receiptRef(id).get()).exists);
const report = { stage, pid: process.pid, startedAt: new Date().toISOString(), status: 'running', realModelCalls: 0,
  cloudRequests: 0, results: [], events: {}, observations: [], persistedSessions: {}, appendSnapshots: [], connections, blocked,
  versions: { adk: '2.1.0', genai: '2.24.0', firestore: '9.3.1' } };
let currentCase = null;
const record = (caseLabel, data = {}) => { report.results.push({ caseLabel, status: 'passed', ...data }); console.log(`PASS ${caseLabel}`); };
class GateError extends Error { constructor(code) { super(code); this.name = 'GateError'; this.code = code; } }
class SyntheticStorageError extends Error { constructor(mode) { super(`Synthetic ${mode} storage failure`); this.name = 'SyntheticStorageError'; this.code = mode; } }
function requireAuthority(row) {
  if (!row || row.cancelled) throw new GateError('cancelled');
  if (!row.authorized) throw new GateError('revoked');
  if (row.status === 'stopped') throw new GateError('stopped');
  if (!['pending', 'resuming'].includes(row.status)) throw new GateError('not_pending');
  return row;
}
const authority = async id => requireAuthority(await binding(id));
async function patchBinding(id, patch) {
  await database.runTransaction(async tx => {
    const snapshot = await tx.get(bindingRef(id)); assert.ok(snapshot.exists);
    tx.update(bindingRef(id), patch);
  });
}
async function createBinding(id, budget) {
  await bindingRef(id).create({ id, owner_id: OWNER, child_id: 'synthetic-child', source_message_id: `message-${id}`, version: 1,
    interrupt_id: `question-${id}`, original_call_id: `call-${id}`, op_id: `op-${id}`, status: 'pending', authorized: true,
    cancelled: false, remaining: budget, model_calls: 0, answer_message_id: null });
}

// Public Firestore-method delegation only. It can fail one adapter transaction;
// no SDK object/prototype/private field is modified.
function faultClient(db, fault) {
  return { collection: (...args) => db.collection(...args), batch: () => db.batch(),
    async runTransaction(callback, options) {
      const result = await db.runTransaction(async tx => {
        const value = await callback(tx);
        if (!options?.readOnly && fault.armed === 'precommit') {
          fault.armed = null; fault.fired++; throw new SyntheticStorageError('precommit');
        }
        return value;
      }, options);
      if (!options?.readOnly && fault.armed === 'response_lost') {
        fault.armed = null; fault.fired++; throw new SyntheticStorageError('response_lost');
      }
      return result;
    },
  };
}
const native = new FirestoreSessionService({ database, cipher, projectId, namespace });

// Observation is a public BaseSessionService delegate. Original Session/Event
// objects pass through unchanged; evidence copies are never passed to the SDK.
class ObservedSessions extends BaseSessionService {
  constructor(delegate, fault) { super(); this.delegate = delegate; this.fault = fault; this.lastSession = undefined; this.attempts = []; }
  createSession(params) { return this.delegate.createSession(params); }
  async getSession(params) { this.lastSession = await this.delegate.getSession(params); return this.lastSession; }
  listSessions(params) { return this.delegate.listSessions(params); }
  deleteSession(params) { return this.delegate.deleteSession(params); }
  async appendEvent(params) {
    const entry = { index: report.appendSnapshots.length, caseId: params.session.id, pid: process.pid,
      event: persistentEvent(params.event, State.TEMP_PREFIX), localStateBefore: JSON.parse(canonical(params.session.state)), status: 'pending' };
    this.attempts.push(entry); report.appendSnapshots.push(entry);
    if (this.fault && !this.fault.fired && (this.fault.matches ? this.fault.matches(params.event) : params.event.content?.parts?.some(part => part.functionCall?.name === 'clarify_then_record'))) this.fault.armed = this.fault.mode;
    try {
      const accepted = await this.delegate.appendEvent(params);
      assert.equal(accepted, params.event);
      entry.status = 'accepted'; entry.accepted = JSON.parse(canonical(accepted));
      return accepted;
    } catch (error) { entry.status = 'rejected'; entry.error = { name: error.name, code: error.code ?? null }; throw error; }
  }
}
const sessions = new ObservedSessions(native);
const fullSession = id => native.getSession(tuple(id));
class ScriptedModel extends BaseLlm {
  constructor(id) { super({ model: 'synthetic-scripted-no-network' }); this.id = id; }
  async connect() { throw new Error('Live connection forbidden'); }
  async *generateContentAsync(request, _stream, signal) {
    signal?.throwIfAborted();
    const reserved = await database.runTransaction(async tx => {
      const snapshot = await tx.get(bindingRef(this.id)), row = requireAuthority(snapshot.data());
      if (row.remaining < 1) throw new GateError('root_budget_exhausted');
      tx.update(bindingRef(this.id), { remaining: row.remaining - 1, model_calls: row.model_calls + 1 });
      return { remaining: row.remaining - 1, modelCalls: row.model_calls + 1 };
    });
    const resumedResponse = request.contents.flatMap(content => content.parts ?? []).map(part => part.functionResponse)
      .find(response => response?.name === 'clarify_then_record' && response.id === `call-${this.id}`);
    report.observations.push({ kind: 'scripted-model', caseId: this.id, pid: process.pid, ...reserved,
      caller: resumedResponse ? 'root-final-after-original-tool-response' : 'root-initial-tool-call' });
    if (resumedResponse) {
      assert.deepEqual(resumedResponse.response, { receiptId: `op-${this.id}`, choice: 'left' });
      assert.equal(await receiptCount(this.id), 1);
      yield { content: { role: 'model', parts: [{ text: `Completed synthetic ${this.id}` }] }, finishReason: 'STOP' };
    } else {
      yield { content: { role: 'model', parts: [{ functionCall: { id: `call-${this.id}`, name: 'clarify_then_record', args: { task: 'synthetic-only' } },
        thoughtSignature: 'PRIVATE_SYNTHETIC_SIGNATURE' }] }, finishReason: 'STOP' };
    }
  }
}
async function performMutation(id, ctx, input) {
    // The complete synthetic effect + receipt is this single transaction.
    const result = await database.runTransaction(async tx => {
      const [bindingSnapshot, existing] = await tx.getAll(bindingRef(id), receiptRef(id));
      const row = requireAuthority(bindingSnapshot.data()); assert.equal(row.status, 'resuming');
      if (existing.exists) return { receipt: existing.data(), inserted: false };
      const receipt = { op_id: row.op_id, case_id: id, source_message_id: row.source_message_id, choice: input.choice, node_run_id: ctx.runId };
      tx.create(receiptRef(id), receipt); return { receipt, inserted: true };
    });
    const row = await binding(id);
    report.observations.push({ kind: 'synthetic-mutation', caseId: id, nodePath: ctx.nodePath, nodeRunId: ctx.runId,
      originalCallId: row.original_call_id, inserted: result.inserted, pid: process.pid });
    return { receiptId: result.receipt.op_id, choice: result.receipt.choice };
}
function makeRunner(id, service, options = {}) {
  const ask = node(async function* (ctx, input) {
    assert.deepEqual(input, { task: 'synthetic-only' });
    report.observations.push({ kind: 'question-node-executed', caseId: id, nodePath: ctx.nodePath, nodeRunId: ctx.runId, pid: process.pid });
    yield new RequestInput({ interruptId: `question-${id}`, message: 'Choose the synthetic left or right value.', responseSchema: z.object({ choice: z.enum(['left', 'right']) }).strict() });
  }, { name: 'ask_choice' });
  const mutate = node(async (ctx, input) => {
    ctx.invocationContext.abortSignal?.throwIfAborted(); assert.deepEqual(input, { choice: 'left' });
    return performMutation(id, ctx, input);
  }, { name: 'record_choice', inputSchema: z.object({ choice: z.enum(['left', 'right']) }).strict() });
  const direct = node(async (ctx, input) => { assert.deepEqual(input, { task: 'synthetic-only' }); return performMutation(id, ctx, { choice: 'left' }); }, { name: 'direct_record' });
  const workflow = new Workflow({ name: 'clarify_then_record', inputSchema: z.object({ task: z.literal('synthetic-only') }).strict(), edges: options.withoutQuestion ? [['START', direct]] : [['START', ask, mutate]] });
  const agent = new LlmAgent({ name: 'synthetic_chat_agent', model: new ScriptedModel(id), tools: [new NodeTool(workflow)],
    beforeToolCallback: async ({ context }) => {
      await authority(id); context.abortSignal?.throwIfAborted(); assert.equal(context.functionCallId, `call-${id}`);
      report.observations.push({ kind: 'before-tool', caseId: id, callId: context.functionCallId, resumeInputs: context.resumeInputs,
        hasConfirmation: context.toolConfirmation !== undefined, pid: process.pid });
      return undefined;
    } });
  return new Runner({ appName: APP, agent, sessionService: service });
}
async function invoke(id, newMessage, maxLlmCalls, service = sessions, options = {}) {
  const events = [], abort = options.abort ?? new AbortController(); report.events[id] = events;
  report.observations.push({ kind: 'native-invocation', caseId: id, pid: process.pid, maxLlmCalls });
  for await (const event of (options.runner ?? makeRunner(id, service, options)).runAsync({ userId: OWNER, sessionId: id, newMessage, abortSignal: abort.signal,
    runConfig: { maxLlmCalls, saveInputBlobsAsArtifacts: false }, customMetadata: { syntheticCaseId: id } })) {
    events.push(JSON.parse(canonical(event)));
    if (event.errorCode) throw new GateError('native_event_error');
  }
  return events;
}
const initialMessage = () => ({ role: 'user', parts: [{ text: 'PRIVATE_SYNTHETIC_INPUT Perform one synthetic action after asking which choice.' }] });
function answerEnvelope(id) { return { owner: OWNER, child: 'synthetic-child', version: 1, sourceMessageId: `message-${id}`, interruptId: `question-${id}`, answerMessageId: `answer-${id}`, answer: { choice: 'left' } }; }
async function submitAnswer(id, envelope) {
  const validated = z.object({ choice: z.enum(['left', 'right']) }).strict().parse(envelope.answer);
  const claimed = await database.runTransaction(async tx => {
    const [snapshot, receipt] = await tx.getAll(bindingRef(id), receiptRef(id)), row = snapshot.data(); assert.ok(row);
    for (const [field, stored, code] of [['owner', 'owner_id', 'wrong_owner'], ['child', 'child_id', 'wrong_child'], ['version', 'version', 'wrong_version'],
      ['sourceMessageId', 'source_message_id', 'wrong_source'], ['interruptId', 'interrupt_id', 'wrong_interrupt']]) {
      if (envelope[field] !== row[stored]) throw new GateError(code);
    }
    if (row.cancelled) throw new GateError('cancelled'); if (!row.authorized) throw new GateError('revoked');
    if (row.status === 'completed') { assert.equal(row.answer_message_id, envelope.answerMessageId); assert.ok(receipt.exists); return { status: 'replayed', receipt: receipt.data() }; }
    if (row.remaining < 1) throw new GateError('root_budget_exhausted');
    if (row.status !== 'pending') throw new GateError('already_claimed');
    tx.update(bindingRef(id), { status: 'resuming', answer_message_id: envelope.answerMessageId });
    return { status: 'claimed', remaining: row.remaining };
  });
  if (claimed.status === 'replayed') return claimed;
  const events = await invoke(id, { role: 'user', parts: [{ functionResponse: { name: 'adk_request_input', id: envelope.interruptId, response: validated } }] }, claimed.remaining);
  assert.equal(await receiptCount(id), 1);
  await patchBinding(id, { status: 'completed' });
  return { status: 'completed', events };
}
async function snapshot(id) { const row = await binding(id); return { events: await eventCount(id), receipts: await receiptCount(id), modelCalls: row.model_calls, remaining: row.remaining }; }
async function rejected(caseLabel, id, patch, code) {
  currentCase = caseLabel; const before = await snapshot(id);
  await assert.rejects(() => submitAnswer(id, { ...answerEnvelope(id), ...patch }), error => error instanceof GateError && error.code === code);
  assert.deepEqual(await snapshot(id), before); record(caseLabel, { code, unchanged: before });
}
async function verifyFullEvents(id, sourceSnapshots = report.appendSnapshots) {
  const saved = await fullSession(id), latest = new Map();
  for (const entry of sourceSnapshots.filter(entry => entry.caseId === id && entry.status === 'accepted' && !entry.event.partial)) latest.set(entry.event.id, entry.accepted);
  assert.equal(saved.events.length, latest.size);
  for (const event of saved.events) assert.equal(canonical(event), canonical(latest.get(event.id)));
  return saved;
}
async function rawProof(ids) {
  const evidence = [];
  for (const id of ids) {
    const refs = paths(id), states = await database.getAll(refs.app, refs.user, refs.session), events = await refs.events.get();
    const rows = [...states, ...events.docs];
    for (const row of rows) {
      assert.ok(row.exists); const raw = row.data();
      assert.doesNotMatch(JSON.stringify(raw), /PRIVATE_|Perform one synthetic|Choose the synthetic|Completed synthetic|clarify_then_record|ask_choice|record_choice/);
      evidence.push({ path: row.ref.path, data: raw });
    }
    assert.deepEqual(codec.open('app', tuple(id), states[0].get('state')), {});
    assert.deepEqual(codec.open('user', tuple(id), states[1].get('state')), {});
  }
  await fs.writeFile(path.join(OUT, `${stage}-raw-documents.json`), JSON.stringify(evidence, null, 2) + '\n');
  return evidence.length;
}

async function storageFailure(mode) {
  const id = `fault-${mode}`; currentCase = `runner-stops-on-${mode}-append`;
  await createBinding(id, 2); await native.createSession({ ...tuple(id), state: { privateProbe: 'PRIVATE_WORKFLOW_SESSION' } });
  const fault = { mode, armed: null, fired: 0 };
  const delegate = new FirestoreSessionService({ database: faultClient(database, fault), cipher, projectId, namespace });
  const observed = new ObservedSessions(delegate, fault);
  await assert.rejects(() => invoke(id, initialMessage(), 1, observed), error => error instanceof SyntheticStorageError && error.code === mode);
  assert.equal(fault.fired, 1);
  assert.equal(observed.attempts.length, 2, 'Input append then one failed model functionCall append; Runner must stop');
  assert.deepEqual(observed.attempts.map(entry => entry.status), ['accepted', 'rejected']);
  assert.equal(report.observations.filter(item => item.caseId === id && item.kind === 'scripted-model').length, 1);
  assert.equal(report.observations.filter(item => item.caseId === id && ['before-tool', 'question-node-executed', 'synthetic-mutation'].includes(item.kind)).length, 0);
  assert.equal(await receiptCount(id), 0); assert.equal((await binding(id)).remaining, 1);
  const broken = observed.lastSession, saved = await fullSession(id);
  assert.equal(broken.events.length, 2, 'Native super mutation is retained in discarded local Session');
  assert.equal(saved.events.length, mode === 'precommit' ? 1 : 2);
  const expected = observed.attempts.filter(entry => entry.status === 'accepted' || mode === 'response_lost').map(entry => entry.event);
  for (const event of saved.events) assert.equal(canonical(event), canonical(expected.find(item => item.id === event.id)));
  const before = await snapshot(id);
  await assert.rejects(() => delegate.appendEvent({ session: broken, event: createEvent({ author: 'synthetic-rejected-reuse', invocationId: 'must-not-continue', content: { parts: [{ text: 'PRIVATE_MUST_NOT_PERSIST' }] } }) }), error => error.code === 'session_requires_reload');
  assert.deepEqual(await snapshot(id), before);
  report.persistedSessions[id] = JSON.parse(canonical(saved));
  record(currentCase, { ...before, discardedLocalEventCount: broken.events.length, appendAttempts: observed.attempts.length,
    providerCalls: 1, toolCalls: 0, faultCommitted: mode === 'response_lost' });
}

function deferred() { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; }
async function queuedToolFailure() {
  const id = 'fault-inflight-queue'; currentCase = 'inflight-NodeTool-queue-failure-domain-stop';
  await createBinding(id, 2); await patchBinding(id, { status: 'resuming' });
  async function assertOperationCurrentlyAuthorized(expectedRemaining) {
    const row = requireAuthority(await binding(id));
    assert.equal(row.status, 'resuming'); assert.equal(row.authorized, true); assert.equal(row.cancelled, false);
    assert.equal(row.remaining, expectedRemaining); assert.ok(row.remaining > 0);
    for (const [field, expected] of Object.entries({ owner_id: OWNER, child_id: 'synthetic-child', version: 1,
      source_message_id: `message-${id}`, interrupt_id: `question-${id}`, original_call_id: `call-${id}`, op_id: `op-${id}` })) assert.equal(row[field], expected);
    assert.equal(await receiptCount(id), 0);
    report.observations.push({ kind: 'pre-stop-operation-authorized', caseId: id, pid: process.pid, remaining: row.remaining, status: row.status });
  }
  await assertOperationCurrentlyAuthorized(2);
  await native.createSession({ ...tuple(id), state: { privateProbe: 'PRIVATE_WORKFLOW_SESSION' } });
  const fault = { mode: 'precommit', armed: null, fired: 0, matches: event => event.id === 'controlled-queue-event' };
  const delegate = new FirestoreSessionService({ database: faultClient(database, fault), cipher, projectId, namespace });
  const observed = new ObservedSessions(delegate, fault), released = deferred(), settled = deferred(), abort = new AbortController();
  let started = false, continuedAfterAbort = false, rejectedCode = null;
  const controlled = node(async (ctx, input) => {
    assert.deepEqual(input, { task: 'synthetic-only' }); started = true;
    await assertOperationCurrentlyAuthorized(1);
    ctx.emit(createEvent({ id: 'controlled-queue-event', author: 'controlled-node', content: { role: 'model', parts: [{ text: 'PRIVATE_CONTROLLED_QUEUE_EVENT' }] } }));
    await released.promise;
    continuedAfterAbort = true;
    assert.equal(ctx.invocationContext.abortSignal.aborted, true);
    report.observations.push({ kind: 'background-tool-reached-domain-boundary', caseId: id, pid: process.pid, signalAborted: ctx.invocationContext.abortSignal.aborted });
    try { await performMutation(id, ctx, { choice: 'left' }); }
    catch (error) { rejectedCode = error.code; }
    finally { settled.resolve(); }
    return { stopped: true };
  }, { name: 'clarify_then_record', inputSchema: z.object({ task: z.literal('synthetic-only') }).strict() });
  const runner = new Runner({ appName: APP, sessionService: observed,
    agent: new LlmAgent({ name: 'synthetic_chat_agent', model: new ScriptedModel(id), tools: [new NodeTool(controlled)] }) });
  await assert.rejects(async () => {
    try { await invoke(id, initialMessage(), 1, observed, { abort, runner }); }
    catch (error) {
      assert.equal(started, true); assert.equal(continuedAfterAbort, false);
      abort.abort(new Error('Synthetic invocation persistence failure'));
      await patchBinding(id, { status: 'stopped', cancelled: true });
      report.observations.push({ kind: 'outer-storage-error-stopped-root', caseId: id, pid: process.pid });
      released.resolve(); await settled.promise; throw error;
    }
  }, error => error instanceof SyntheticStorageError && error.code === 'precommit');
  assert.equal(continuedAfterAbort, true, 'Background function can continue; do not claim it was killed');
  assert.equal(rejectedCode, 'cancelled'); assert.equal((await binding(id)).status, 'stopped');
  assert.equal(await receiptCount(id), 0); assert.equal((await binding(id)).model_calls, 1);
  assert.equal(observed.attempts.length, 3); assert.equal(observed.attempts.at(-1).status, 'rejected');
  const saved = await fullSession(id); assert.equal(saved.events.length, 2);
  assert.equal(saved.events.some(event => event.id === 'controlled-queue-event'), false);
  await assert.rejects(() => delegate.appendEvent({ session: observed.lastSession, event: createEvent({ author: 'must-not-continue' }) }), error => error.code === 'session_requires_reload');
  record(currentCase, { ...await snapshot(id), backgroundContinued: true, sameSignalAborted: abort.signal.aborted,
    rootStatus: 'stopped', mutationRejectedBy: rejectedCode, appendAttempts: observed.attempts.length });
}
async function responseFailure(mode) {
  const id = `fault-response-${mode}`; currentCase = `completed-mutation-response-${mode}-failure`;
  await createBinding(id, 2); await patchBinding(id, { status: 'resuming' });
  await native.createSession({ ...tuple(id), state: { privateProbe: 'PRIVATE_WORKFLOW_SESSION' } });
  const fault = { mode, armed: null, fired: 0, matches: event => event.content?.parts?.some(part => part.functionResponse?.id === `call-${id}`) };
  const delegate = new FirestoreSessionService({ database: faultClient(database, fault), cipher, projectId, namespace });
  const observed = new ObservedSessions(delegate, fault);
  await assert.rejects(() => invoke(id, initialMessage(), 1, observed, { withoutQuestion: true }), error => error instanceof SyntheticStorageError && error.code === mode);
  assert.equal(fault.fired, 1); assert.equal(await receiptCount(id), 1); assert.equal((await binding(id)).model_calls, 1);
  const effects = report.observations.filter(item => item.caseId === id && item.kind === 'synthetic-mutation');
  assert.equal(effects.length, 1); assert.equal(effects[0].inserted, true);
  const receiptBefore = await receiptRef(id).get(), saved = await fullSession(id);
  const response = observed.attempts.at(-1); assert.equal(response.status, 'rejected');
  assert.equal(saved.events.some(event => event.id === response.event.id), mode === 'response_lost');
  const expected = observed.attempts.filter(entry => entry.status === 'accepted' || mode === 'response_lost');
  assert.equal(saved.events.length, expected.length);
  for (const event of saved.events) assert.equal(canonical(event), canonical(expected.find(entry => entry.event.id === event.id).event));
  await assert.rejects(() => delegate.appendEvent({ session: observed.lastSession, event: createEvent({ author: 'must-not-continue' }) }), error => error.code === 'session_requires_reload');
  const before = await snapshot(id);
  // Retry enters the same complete atomic synthetic operation API. Existing opId
  // receipt returns before tx.create; no Runner/model/workflow is re-executed.
  const replay = await performMutation(id, { nodePath: 'synthetic-retry-boundary', runId: receiptBefore.get('node_run_id') }, { choice: 'left' });
  assert.deepEqual(replay, { receiptId: `op-${id}`, choice: 'left' });
  assert.deepEqual(await snapshot(id), before);
  const receiptAfter = await receiptRef(id).get(); assert.ok(receiptBefore.updateTime.isEqual(receiptAfter.updateTime));
  assert.equal(report.observations.filter(item => item.caseId === id && item.kind === 'synthetic-mutation' && item.inserted).length, 1);
  record(currentCase, { ...before, persistedFunctionResponse: mode === 'response_lost', replayInserted: false,
    discardedLocalEventCount: observed.lastSession.events.length });
}

try {
  if (stage === 'pause') {
    // Fail-fast storage lifecycle gates run before any cross-process workflow.
    await storageFailure('precommit'); await storageFailure('response_lost');
    await queuedToolFailure(); await responseFailure('precommit'); await responseFailure('response_lost');
    for (const [id, budget] of [['positive', 2], ['boundaries', 2], ['budget', 1]]) {
      currentCase = `pause-${id}`;
      await createBinding(id, budget); await native.createSession({ ...tuple(id), state: { privateProbe: 'PRIVATE_WORKFLOW_SESSION' } });
      const events = await invoke(id, initialMessage(), 1), stored = await verifyFullEvents(id);
      const calls = stored.events.flatMap(event => event.content?.parts ?? []).map(part => part.functionCall).filter(Boolean);
      assert.equal(calls.filter(call => call.name === 'adk_request_input' && call.id === `question-${id}`).length, 1);
      assert.equal(calls.filter(call => call.name === 'clarify_then_record' && call.id === `call-${id}`).length, 1);
      assert.equal(await receiptCount(id), 0); assert.equal((await binding(id)).model_calls, 1); assert.equal((await binding(id)).remaining, budget - 1);
      assert.equal(events.some(event => event.errorCode), false);
      assert.ok(stored.events.some(event => event.content?.parts?.some(part => part.thoughtSignature === 'PRIVATE_SYNTHETIC_SIGNATURE')));
      assert.ok(stored.events.some(event => event.nodeInfo || event.actions?.agentState || event.output !== undefined), 'Native workflow metadata must be exercised');
      report.persistedSessions[id] = JSON.parse(canonical(stored));
      record(`native-interrupt-persisted-${id}`, { eventCount: stored.events.length, originalCallId: `call-${id}`, interruptId: `question-${id}`,
        invocations: [...new Set(stored.events.map(event => event.invocationId).filter(Boolean))] });
    }
    currentCase = 'no-child-data-in-shared-app-or-user-state';
    const rawDocuments = await rawProof(['fault-precommit', 'fault-response_lost', 'fault-inflight-queue', 'fault-response-precommit', 'fault-response-response_lost', 'positive', 'boundaries', 'budget']);
    record(currentCase, { rawDocuments, allNativeJsonEncrypted: true });
  } else {
    const prior = JSON.parse(await fs.readFile(path.join(OUT, 'pause.json'), 'utf8'));
    assert.equal(prior.status, 'passed'); assert.notEqual(prior.pid, process.pid);
    currentCase = 'new-process-loaded-native-pending-events';
    const before = await fullSession('positive');
    assert.equal(canonical(before), canonical(prior.persistedSessions.positive));
    assert.ok(before.events.some(event => event.content?.parts?.some(part => part.functionCall?.id === 'question-positive')));
    record(currentCase, { pausePid: prior.pid, resumePid: process.pid, eventCount: before.events.length });
    currentCase = 'positive-native-resume';
    const result = await submitAnswer('positive', answerEnvelope('positive')); assert.equal(result.status, 'completed');
    const after = await verifyFullEvents('positive', [...prior.appendSnapshots, ...report.appendSnapshots]);
    const resumedCalls = report.observations.filter(item => item.kind === 'before-tool' && item.caseId === 'positive');
    assert.equal(resumedCalls.length, 1); assert.equal(resumedCalls[0].callId, 'call-positive');
    assert.deepEqual(resumedCalls[0].resumeInputs, { 'question-positive': { choice: 'left' } }); assert.equal(resumedCalls[0].hasConfirmation, false);
    assert.equal(report.observations.filter(item => item.kind === 'question-node-executed' && item.caseId === 'positive').length, 0);
    assert.equal(report.observations.filter(item => item.kind === 'synthetic-mutation' && item.caseId === 'positive').length, 1);
    assert.ok(after.events.some(event => event.content?.parts?.some(part => part.functionResponse?.id === 'call-positive')));
    assert.equal((await binding('positive')).remaining, 0); assert.equal((await binding('positive')).model_calls, 2);
    assert.equal(new Set(after.events.map(event => event.invocationId).filter(Boolean)).size, 2);
    record('native-resume-original-call-single-mutation', { ...await snapshot('positive'), resumeInputs: resumedCalls[0].resumeInputs });
    const duplicateBefore = await snapshot('positive'), replay = await submitAnswer('positive', answerEnvelope('positive'));
    assert.equal(replay.status, 'replayed'); assert.deepEqual(await snapshot('positive'), duplicateBefore);
    record('duplicate-answer-domain-receipt-no-native-replay', duplicateBefore);
    for (const [name, patch, code] of [
      ['wrong-interrupt', { interruptId: 'question-somewhere-else' }, 'wrong_interrupt'], ['wrong-owner', { owner: 'synthetic-other-owner' }, 'wrong_owner'],
      ['wrong-child', { child: 'synthetic-other-child' }, 'wrong_child'], ['wrong-version', { version: 2 }, 'wrong_version'],
      ['wrong-original-message', { sourceMessageId: 'message-somewhere-else' }, 'wrong_source'],
    ]) await rejected(name, 'boundaries', patch, code);
    currentCase = 'native-session-owner-isolation';
    assert.equal(await native.getSession({ ...tuple('boundaries'), userId: 'synthetic-other-owner' }), undefined); record(currentCase);
    currentCase = 'unrelated-message-not-auto-resumed';
    const unrelatedBefore = await snapshot('boundaries'), inbound = { text: 'An unrelated synthetic message', answerTo: null };
    assert.equal(inbound.answerTo ? 'submit-answer' : 'ordinary-message-outside-paused-work', 'ordinary-message-outside-paused-work');
    assert.deepEqual(await snapshot('boundaries'), unrelatedBefore); record('unrelated-message-domain-routing-no-native-resume', unrelatedBefore);
    await patchBinding('boundaries', { cancelled: true }); await rejected('cancelled-pending-work', 'boundaries', {}, 'cancelled');
    await patchBinding('boundaries', { cancelled: false, authorized: false }); await rejected('revoked-pending-work', 'boundaries', {}, 'revoked');
    await rejected('cross-invocation-root-budget-exhaustion', 'budget', {}, 'root_budget_exhausted');
    assert.equal((await binding('budget')).model_calls, 1); assert.equal(await receiptCount('budget'), 0);
    record('root-budget-not-reset-by-new-runner', { positive: await snapshot('positive'), exhausted: await snapshot('budget') });
    currentCase = 'resumed-native-json-encrypted-and-complete';
    const rawDocuments = await rawProof(['positive', 'boundaries', 'budget']);
    report.persistedSessions.positive = JSON.parse(canonical(after));
    record(currentCase, { rawDocuments, completeNativeEventDeepEqual: true });
  }
  assert.equal(blocked.length, 0); assert.ok(connections.length > 0);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failedCase = currentCase;
  report.error = { name: error.name, code: error.code ?? null, message: error.message, stack: error.stack };
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(OUT, `${stage}.json`), JSON.stringify(report, null, 2) + '\n');
  await database.terminate();
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
