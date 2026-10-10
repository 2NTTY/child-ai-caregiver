import fs from 'node:fs';
import path from 'node:path';
import { fail, sha256, validateLedger } from './chat-intent-probe-guards.mjs';

// This guard deliberately has no credential, counter API or live sender.
// A future live consumer must supply reviewed authority, not a caller boolean/proof.
export function requireControlledLiveReadiness() {
  fail('live_disabled_pending_cost_counter_output_and_successor_authority');
}

export const DOCUMENT_BATCH = Object.freeze({
  scenarioId: 'document-clarification-edit-readback-v1',
  model: 'gemini-3.1-flash-lite', project: 'ai-caregivers-for-children', location: 'global',
  serviceTier: 'standard', sdkVersion: '2.24.0',
  roots: Object.freeze(['root-clarify', 'root-select-and-edit', 'root-readback']),
  rootCaps: Object.freeze([4, 5, 3]), modelCalls: 12, toolCallsPerRoot: 8,
  inputTokens: 32768, outputTokens: 1024, candidateCount: 1, attempts: 1,
  queryEmbeddings: 0, reservedMicroUsd: 250000, conditionalEstimateMicroUsd: 116736,
  pricingStatus: 'conditional_not_live_authority',
  rootDeadlineMs: 90000, batchDeadlineMs: 270000,
});
const DOCUMENT_TOOLS = new Set(['read_context', 'read_work', 'load_capabilities', 'save_work',
  'read_family_documents', 'read_family_document_content', 'list_family_document_versions',
  'change_family_document', 'present_answer']);

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
function validProvenance(value) {
  return exactKeys(value, ['testedSha', 'legacyHarnessSha', 'candidateSha256'])
    && commit(value.testedSha) && commit(value.legacyHarnessSha) && hash(value.candidateSha256);
}
const exactKeys = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

// Reject accessors, exotic prototypes, cycles, undefined and non-JSON numbers.
// Nothing counted may disappear or be regenerated when the transport serializes it.
function jsonCopy(value, parents = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || parents.has(value)) fail('payload_not_plain_json');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) fail('payload_not_plain_json');
  const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'));
  if (keys.some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('payload_not_plain_json');
  parents.add(value);
  const result = Array.isArray(value)
    ? Array.from({ length: value.length }, (_, i) => jsonCopy(value[i], parents))
    : Object.fromEntries(keys.sort().map(key => [key, jsonCopy(value[key], parents)]));
  parents.delete(value); return result;
}
const canonical = value => JSON.stringify(jsonCopy(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function textParts(content, roles) {
  if (!content || !exactKeys(content, ['role', 'parts']) || !roles.includes(content.role)
    || !Array.isArray(content.parts) || !content.parts.length) fail('text_only_payload_required');
  for (const part of content.parts) {
    if (!part || Array.isArray(part) || Object.keys(part).some(key =>
      !['text', 'functionCall', 'functionResponse', 'thoughtSignature', 'thought'].includes(key))
      || !['text', 'functionCall', 'functionResponse'].some(key => Object.hasOwn(part, key))) fail('text_only_payload_required');
    if ('text' in part && typeof part.text !== 'string'
      || 'thoughtSignature' in part && typeof part.thoughtSignature !== 'string'
      || 'thought' in part && typeof part.thought !== 'boolean') fail('text_only_payload_required');
    if (['text', 'functionCall', 'functionResponse'].filter(key => Object.hasOwn(part, key)).length !== 1)
      fail('text_only_payload_required');
    for (const [field, dataKey] of [['functionCall', 'args'], ['functionResponse', 'response']]) {
      if (!(field in part)) continue;
      const value = part[field];
      if (!value || Array.isArray(value) || Object.keys(value).some(key => !['name', 'id', dataKey].includes(key))
        || typeof value.name !== 'string' || !value.name
        || 'id' in value && typeof value.id !== 'string'
        || dataKey in value && (!value[dataKey] || Array.isArray(value[dataKey]) || typeof value[dataKey] !== 'object')
        || field === 'functionResponse' && !(dataKey in value)) fail('text_only_payload_required');
      // response is opaque business JSON; SDK media belongs to the disallowed
      // sibling FunctionResponse.parts, never to keys inside response itself.
    }
  }
}

const prepared = new WeakMap();
/** Final SDK-shaped JSON, after all history, tools, summaries and signatures. */
export function prepareDocumentBatchPayload(request, settings) {
  const config = jsonCopy(settings);
  if (!exactKeys(config, ['project', 'location', 'model', 'thinkingLevel', 'maxOutputTokens', 'candidateCount', 'attempts'])
    || config.project !== DOCUMENT_BATCH.project || config.location !== DOCUMENT_BATCH.location
    || config.model !== DOCUMENT_BATCH.model || !['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(config.thinkingLevel)
    || config.maxOutputTokens !== DOCUMENT_BATCH.outputTokens || config.candidateCount !== 1 || config.attempts !== 1)
    fail('batch_model_scope_mismatch');
  const input = jsonCopy(request);
  if (!exactKeys(input, ['contents', 'config']) || !Array.isArray(input.contents) || !input.contents.length)
    fail('payload_shape_invalid');
  input.contents.forEach(content => textParts(content, ['user', 'model']));
  if (!input.config || Array.isArray(input.config) || Object.keys(input.config).some(key =>
    !['systemInstruction', 'tools', 'toolConfig', 'labels', 'candidateCount', 'maxOutputTokens', 'thinkingConfig'].includes(key)))
    fail('unreviewed_generation_config');
  if ('candidateCount' in input.config && input.config.candidateCount !== 1
    || 'maxOutputTokens' in input.config && input.config.maxOutputTokens !== 1024
    || 'thinkingConfig' in input.config && canonical(input.config.thinkingConfig) !== canonical({ thinkingLevel: config.thinkingLevel }))
    fail('batch_generation_config_mismatch');
  if (typeof input.config.systemInstruction !== 'string' && input.config.systemInstruction !== undefined)
    textParts(input.config.systemInstruction, ['system']);
  if (input.config.tools !== undefined && (!Array.isArray(input.config.tools) || input.config.tools.some(tool =>
    !exactKeys(tool, ['functionDeclarations']) || !Array.isArray(tool.functionDeclarations)
      || tool.functionDeclarations.some(declaration => typeof declaration?.name !== 'string')))) fail('paid_or_unreviewed_tool_denied');
  const payload = freeze({ model: config.model, contents: input.contents, config: {
    ...input.config, candidateCount: 1, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: config.thinkingLevel },
  } });
  const scope = freeze({ project: config.project, location: config.location, model: config.model,
    sdkVersion: DOCUMENT_BATCH.sdkVersion, serviceTier: DOCUMENT_BATCH.serviceTier });
  const payloadSha256 = sha256(canonical({ scope, payload }));
  const handle = Object.freeze({ payloadSha256 });
  prepared.set(handle, { payload, scope, payloadSha256, contents: payload.contents });
  return handle;
}

/** Capture the SDK's final serialized bytes; normalization has already happened. */
export function prepareDocumentBatchWirePayload(wire, settings) {
  const payload = freeze(jsonCopy(wire));
  const expectedUrl = `https://aiplatform.googleapis.com/v1/projects/${DOCUMENT_BATCH.project}/locations/global/publishers/google/models/${DOCUMENT_BATCH.model}:generateContent`;
  if (!exactKeys(payload, ['url', 'body']) || payload.url !== expectedUrl || typeof payload.body !== 'string')
    fail('wire_target_invalid');
  let body;
  try { body = JSON.parse(payload.body); } catch { fail('wire_body_invalid'); }
  if (JSON.stringify(body) !== payload.body || !body || Array.isArray(body)
    || !Object.hasOwn(body, 'contents') || !Object.hasOwn(body, 'generationConfig')
    || Object.keys(body).some(key => !['contents', 'generationConfig', 'systemInstruction', 'tools', 'toolConfig', 'labels'].includes(key)))
    fail('wire_body_invalid');
  const config = { ...body.generationConfig };
  if (!exactKeys(config, ['candidateCount', 'maxOutputTokens', 'thinkingConfig'])
    || config.candidateCount !== 1 || config.maxOutputTokens !== 1024
    || canonical(config.thinkingConfig) !== canonical({ thinkingLevel: settings.thinkingLevel }))
    fail('wire_generation_config_invalid');
  for (const key of ['tools', 'toolConfig', 'labels']) if (key in body) config[key] = body[key];
  if ('systemInstruction' in body) {
    textParts(body.systemInstruction, ['user', 'system']);
    // Only the validation view normalizes this role; counted/sent bytes stay exact.
    config.systemInstruction = { ...body.systemInstruction, role: 'system' };
  }
  const validated = prepareDocumentBatchPayload({ contents: body.contents, config }, settings);
  const scope = prepared.get(validated).scope;
  const payloadSha256 = sha256(canonical({ scope, payload }));
  const handle = Object.freeze({ payloadSha256 });
  prepared.set(handle, { payload, scope, payloadSha256, contents: freeze(body.contents) });
  return handle;
}

function legacyView(document) {
  const { offlineBatchJournal, ...legacy } = document;
  return legacy;
}
function readDocument(filename) {
  let stat;
  try { stat = fs.lstatSync(filename); } catch { fail('batch_checkpoint_missing'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) fail('batch_checkpoint_invalid');
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { fail('batch_checkpoint_invalid'); }
}
function validateSimulation(document, expectedLegacySha256) {
  const legacy = legacyView(document), old = validateLedger(legacy);
  if (legacy.offlineSimulationOnly !== true || sha256(canonical(legacy)) !== expectedLegacySha256)
    fail('synthetic_checkpoint_required');
  if (old.uncertain || [...old.runs.values()].some(run => run.status === 'running')) fail('legacy_unknown_fail_closed');
  const journal = document.offlineBatchJournal;
  if (!journal) return { old, journal: null };
  if (!exactKeys(journal, ['schemaVersion', 'mode', 'batchId', 'legacySha256', 'provenance', 'plan', 'events'])
    || journal.schemaVersion !== 1 || journal.mode !== 'offline-simulation' || !safeId(journal.batchId)
    || journal.legacySha256 !== expectedLegacySha256 || !validProvenance(journal.provenance)
    || canonical(journal.plan) !== canonical(DOCUMENT_BATCH)
    || !Array.isArray(journal.events)) fail('batch_journal_invalid');
  let previousHash = sha256(canonical({ ...journal, events: [] }));
  let reserved = false, state = 'not_started', root = -1, pending = null, calls = 0, inputTokens = null;
  const rootCalls = [0, 0, 0], rootTools = [0, 0, 0], payloads = new Set();
  for (const event of journal.events) {
    const { hash: digest, ...entry } = event;
    if (entry.previousHash !== previousHash || digest !== sha256(canonical(entry))) fail('batch_chain_invalid');
    previousHash = digest;
    if (state === 'failed' || state === 'completed') fail('batch_after_terminal');
    if (entry.type === 'batch_reserved') {
      if (reserved || entry.microUsd !== 250000) fail('batch_reservation_invalid');
      reserved = true; state = 'between_roots';
    } else if (entry.type === 'root_started') {
      if (!reserved || state !== 'between_roots' || entry.index !== root + 1 || entry.index > 2)
        fail('batch_root_order_invalid');
      root = entry.index; state = 'running';
    } else if (entry.type === 'call_reserved') {
      if (state !== 'running' || pending || entry.root !== root || !hash(entry.payloadSha256)
        || payloads.has(entry.payloadSha256) || ++rootCalls[root] > DOCUMENT_BATCH.rootCaps[root] || ++calls > 12)
        fail('batch_duplicate_or_cap');
      pending = entry.payloadSha256; payloads.add(pending); inputTokens = null;
    } else if (entry.type === 'input_admitted') {
      if (!pending || inputTokens !== null || entry.payloadSha256 !== pending || !Number.isSafeInteger(entry.inputTokens)
        || entry.inputTokens < 0 || entry.inputTokens > 32768 || entry.counter !== 'synthetic-test-counter')
        fail('batch_input_proof_invalid');
      inputTokens = entry.inputTokens;
    } else if (entry.type === 'response') {
      if (!pending || entry.payloadSha256 !== pending || inputTokens === null || entry.inputTokens !== inputTokens
        || !Number.isSafeInteger(entry.outputTokens) || entry.outputTokens < 0 || entry.outputTokens > 1024
        || !Number.isSafeInteger(entry.toolCalls) || entry.toolCalls < 0 || (rootTools[root] += entry.toolCalls) > 8)
        fail('batch_usage_invalid');
      pending = null; inputTokens = null;
    } else if (entry.type === 'root_passed') {
      if (state !== 'running' || pending || rootCalls[root] === 0 || entry.index !== root) fail('batch_root_incomplete');
      state = root === 2 ? 'completed' : 'between_roots';
    } else if (entry.type === 'batch_failed') {
      if (!reserved || typeof entry.category !== 'string') fail('batch_failure_invalid');
      state = 'failed';
    } else fail('batch_event_invalid');
  }
  return { old, journal, previousHash, reserved, state, root, pending, calls, rootCalls, rootTools };
}

/**
 * Mechanical simulation only. It can never open a real ledger (explicit synthetic
 * marker required) or authorize live calls. The original ledger events and cap stay
 * intact; no initialization, migration, rollover, refund or successor is performed.
 */
export function openOfflineDocumentBatch(filename, { expectedLegacySha256, batchId, provenance, now = Date.now }) {
  const provenanceSnapshot = jsonCopy(provenance);
  if (!hash(expectedLegacySha256) || !safeId(batchId) || !validProvenance(provenanceSnapshot)) fail('batch_identity_invalid');
  const directory = path.dirname(filename);
  if (fs.realpathSync(directory) !== path.resolve(directory) || fs.existsSync(filename + '.next')) fail('batch_path_invalid');
  let lock;
  try { lock = fs.openSync(filename + '.lock', fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600); }
  catch { fail('batch_locked_or_unavailable'); }
  let closed = false, poisoned = false, document;
  const close = () => {
    if (!closed) { closed = true; fs.closeSync(lock); fs.unlinkSync(filename + '.lock'); }
  };
  const persist = () => {
    let fd;
    try {
      fd = fs.openSync(filename + '.next', fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeFileSync(fd, JSON.stringify(document) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(filename + '.next', filename);
      const dir = fs.openSync(directory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } catch { poisoned = true; if (fd !== undefined) fs.closeSync(fd); fail('batch_persist_failed'); }
  };
  const state = () => {
    if (closed || poisoned) fail('batch_closed_or_unavailable');
    // Detect an outside replacement before any subsequent admission or transport.
    if (canonical(readDocument(filename)) !== canonical(document)) { poisoned = true; fail('batch_checkpoint_changed'); }
    return validateSimulation(document, expectedLegacySha256);
  };
  const append = entry => {
    const current = state();
    const payload = { previousHash: current.previousHash, ...entry };
    const candidate = structuredClone(document);
    candidate.offlineBatchJournal.events.push({ ...payload, hash: sha256(canonical(payload)) });
    validateSimulation(candidate, expectedLegacySha256);
    document = candidate; persist();
  };
  const startedAt = now(); let rootStartedAt = null, runningCall = false;
  try {
    document = readDocument(filename);
    const current = validateSimulation(document, expectedLegacySha256);
    if (current.journal) fail('batch_restart_or_new_id_denied');
    document.offlineBatchJournal = { schemaVersion: 1, mode: 'offline-simulation', batchId,
      legacySha256: expectedLegacySha256, provenance: provenanceSnapshot, plan: DOCUMENT_BATCH, events: [] };
    persist();
    append({ type: 'batch_reserved', microUsd: 250000 });
  } catch (error) { close(); throw error; }
  const stop = category => {
    const current = state();
    if (!['failed', 'completed'].includes(current.state)) append({ type: 'batch_failed', category });
  };
  const check = () => {
    const current = state();
    if (['failed', 'completed'].includes(current.state)) fail('batch_terminal');
    if (now() - startedAt >= 270000 || rootStartedAt !== null && now() - rootStartedAt >= 90000) {
      stop('deadline'); fail('batch_deadline');
    }
    return current;
  };
  return {
    startRoot(rootId) {
      try {
        check(); const index = DOCUMENT_BATCH.roots.indexOf(rootId);
        append({ type: 'root_started', index }); rootStartedAt = now();
      } catch (error) { if (!poisoned) stop('root_start_failed'); throw error; }
    },
    async simulateGeneration(handle, { countSynthetic, sendSynthetic }) {
      try {
        const current = check(), request = prepared.get(handle);
        if (!request || runningCall || current.state !== 'running') fail('batch_payload_or_concurrency_invalid');
        if (request.contents.some(content => content.parts.some(part =>
          part.functionResponse && part.functionResponse.response.status !== 'succeeded')))
          fail('batch_prior_tool_failure');
        runningCall = true;
        append({ type: 'call_reserved', root: current.root, payloadSha256: request.payloadSha256 });
        // This hook is explicitly fake. No remote/local tokenizer authority is claimed.
        const inputTokens = await countSynthetic(request.payload, request.scope);
        check();
        append({ type: 'input_admitted', payloadSha256: request.payloadSha256,
          inputTokens, counter: 'synthetic-test-counter' });
        if (sha256(canonical({ scope: request.scope, payload: request.payload })) !== request.payloadSha256)
          fail('batch_payload_changed');
        check();
        const response = await sendSynthetic(request.payload, request.scope);
        check();
        const usage = response?.usageMetadata;
        if (!usage || usage.promptTokenCount !== inputTokens || !Number.isSafeInteger(usage.totalTokenCount)
          || usage.totalTokenCount < inputTokens || usage.totalTokenCount - inputTokens > 1024)
          fail('batch_usage_unknown_or_mismatch');
        if (response.finishReason !== 'STOP' || response.content?.role !== 'model'
          || !Array.isArray(response.content.parts) || !response.content.parts.length || response.errorCode
          || response.interrupted || response.partial) fail('batch_response_invalid');
        textParts(response.content, ['model']);
        const calls = response.content.parts.filter(part => part.functionCall).map(part => part.functionCall);
        // Core search schemas remain counted. Their invocation is rejected before
        // ADK receives the batch, so profile minimum embedding=1 cannot spend here.
        if (calls.some(call => !DOCUMENT_TOOLS.has(call.name))
          || calls.length > 1 && calls.some(call => call.name === 'present_answer')) fail('batch_tool_denied');
        append({ type: 'response', payloadSha256: request.payloadSha256,
          inputTokens, outputTokens: usage.totalTokenCount - inputTokens, toolCalls: calls.length });
        return response;
      } catch (error) {
        if (!closed && !poisoned) stop('generation_failed');
        throw error;
      } finally { runningCall = false; }
    },
    passRoot() { try { check(); append({ type: 'root_passed', index: state().root }); rootStartedAt = null; }
      catch (error) { if (!poisoned) stop('root_semantic_failure'); throw error; } },
    stop,
    snapshot() { const current = state(); return { mode: 'offline-simulation', state: current.state,
      historicalGenerationCalls: current.old.calls, generationCallsReserved: current.calls,
      rootCalls: [...current.rootCalls], rootTools: [...current.rootTools], reservedMicroUsd: 250000, refundedMicroUsd: 0,
      pending: current.pending !== null, checkpointSha256: sha256(fs.readFileSync(filename)) }; },
    close,
  };
}

export function offlineLegacyFingerprint(document) { return sha256(canonical(legacyView(document))); }
