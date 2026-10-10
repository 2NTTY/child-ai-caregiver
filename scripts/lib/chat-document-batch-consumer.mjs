import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { fail } from './chat-intent-probe-guards.mjs';
import { DOCUMENT_BATCH, openOfflineDocumentBatch, prepareDocumentBatchPayload, prepareDocumentBatchWirePayload,
  requireControlledLiveReadiness } from './chat-document-batch-guards.mjs';

// There is deliberately no live implementation or authority supplied by callers.
export function createControlledDocumentBatchConsumer() { requireControlledLiveReadiness(); }

const INPUTS = Object.freeze([
  Object.freeze({ text: '請把準備單的書包勾好。', freshConversation: false }),
  Object.freeze({ text: '二', freshConversation: false }),
  Object.freeze({ text: '查回我之前改過的準備單。', freshConversation: true }),
]);
const requireCondition = (value, reason) => { if (!value) fail(reason); };
function snapshotEvidence(inspect) {
  const value = structuredClone(inspect());
  requireCondition(value && Array.isArray(value.documents) && value.documents.length === 2
    && Array.isArray(value.works) && Array.isArray(value.receipts)
    && Number.isSafeInteger(value.documentWrites), 'scenario_evidence_invalid');
  return value;
}
function expectedEditedDocument(original) {
  const value = structuredClone(original);
  requireCondition(value?.version === 3 && value.current?.sections?.length === 1
    && value.current.sections[0].items.length === 2
    && value.current.sections[0].items[0].id === 'bag'
    && value.current.sections[0].items.every(item => item.checked === false), 'scenario_fixture_invalid');
  value.version++; value.current.sections[0].items[0].checked = true; return value;
}

/** Fixed scenario assertions, never a caller-provided passed/approved callback. */
function assertRootOutcome(index, result, evidence, original, previous, selectedDocument) {
  requireCondition(result?.status === 'completed' && Array.isArray(result.tools) && result.tools.length > 0
    && result.tools.every(tool => tool.status === 'succeeded') && Array.isArray(result.proposals)
    && result.proposals.length === 0 && result.countsKnown === true
    && result.counts?.queryEmbeddings === 0, 'root_result_not_successful');
  requireCondition(isDeepStrictEqual(evidence.documents[0], original.documents[0]), 'unselected_document_changed');
  const tools = new Set(result.tools.map(tool => tool.name));
  requireCondition(['read_work', 'read_family_documents', 'present_answer'].every(name => tools.has(name)), 'root_required_reads_missing');
  requireCondition(evidence.works.length === 1, 'work_identity_missing');
  const work = evidence.works[0];
  if (index === 0) {
    requireCondition(tools.has('read_context') && tools.has('save_work') && !tools.has('change_family_document')
      && evidence.documentWrites === 0 && evidence.receipts.length === 0
      && isDeepStrictEqual(evidence.documents, original.documents)
      && work.status === 'waiting' && work.version === 1 && work.questions?.length > 0
      && work.resources?.length === 2
      && original.documents.every(doc => work.resources.filter(ref => ref.kind === 'family_document'
        && doc.id === ref.id && doc.version === ref.version).length === 1)
      && typeof result.text === 'string' && result.text.includes('入學') && result.text.includes('旅行'), 'clarification_outcome_invalid');
  } else {
    requireCondition(work.id === previous.works[0].id && work.status === 'completed' && work.version === 3
      && work.questions?.length === 0 && work.resources?.length === 1
      && work.resources[0].kind === 'family_document'
      && work.resources[0].id === selectedDocument.id && work.resources[0].version === selectedDocument.version
      && evidence.documentWrites === 1 && evidence.receipts.length === 1
      && isDeepStrictEqual(evidence.documents[1], selectedDocument), 'edit_or_work_outcome_invalid');
    const receipt = evidence.receipts[0];
    requireCondition(receipt.documentId === selectedDocument.id && receipt.savedVersion === selectedDocument.version
      && receipt.toolName === 'change_family_document' && typeof receipt.operationId === 'string'
      && receipt.operationId.length > 0, 'original_receipt_missing');
    if (index === 1) requireCondition(tools.has('change_family_document') && tools.has('save_work')
      && receipt.runId === result.runId, 'edit_receipt_run_mismatch');
    else requireCondition(!tools.has('change_family_document') && !tools.has('save_work')
      && isDeepStrictEqual(evidence, previous) && typeof result.text === 'string'
      && result.text.includes(selectedDocument.current.title) && result.text.includes(`第${selectedDocument.version}版`), 'readback_outcome_invalid');
  }
}

/**
 * Only the reviewed offline harness supplies dependencies. Nothing here accepts
 * user messages, approvals, a semantic boolean, token proofs or arbitrary roots.
 * Synthetic callbacks are not a live transport/authority plugin interface.
 */
export function createOfflineDocumentBatchConsumer({ config, productModelModule, checkpoint, synthetic, execution }) {
  // GenAI reads these environment values before honoring explicit project/location.
  // Inspect presence only, without reading values or altering the environment.
  requireCondition(!['GOOGLE_API_KEY', 'GEMINI_API_KEY'].some(key => Object.hasOwn(process.env, key)),
    'consumer_credential_environment_denied');
  const sdkEntry = import.meta.resolve('@google/genai');
  requireCondition(sdkEntry.endsWith('/dist/node/index.mjs')
    && JSON.parse(readFileSync(new URL('../../package.json', sdkEntry), 'utf8')).version === DOCUMENT_BATCH.sdkVersion,
  'consumer_sdk_version_unreviewed');
  const fixedConfig = Object.freeze({ ...config });
  requireCondition(fixedConfig.project === DOCUMENT_BATCH.project && fixedConfig.location === DOCUMENT_BATCH.location
    && fixedConfig.model === DOCUMENT_BATCH.model && fixedConfig.maxOutputTokens === 1024
    && fixedConfig.maxAttempts === 1, 'consumer_profile_invalid');
  const buildPayload = productModelModule.createVertexAgentPayloadBuilder(fixedConfig);
  const clientOptions = productModelModule.vertexAgentClientOptions(fixedConfig);
  requireCondition(clientOptions.enterprise === true && clientOptions.project === DOCUMENT_BATCH.project
    && clientOptions.location === 'global' && clientOptions.apiVersion === 'v1'
    && clientOptions.httpOptions?.retryOptions?.attempts === 1, 'consumer_sdk_profile_invalid');
  const batch = openOfflineDocumentBatch(checkpoint.filename, checkpoint);
  let started = false, closed = false, active = false, root = -1, inFlight = false, sending = null;
  const stop = reason => { if (!closed) batch.stop(reason); };
  const settings = { project: fixedConfig.project, location: fixedConfig.location, model: fixedConfig.model,
    thinkingLevel: buildPayload({ contents: [], config: {} }).config.thinkingConfig.thinkingLevel,
    candidateCount: 1, maxOutputTokens: 1024, attempts: 1 };
  // No credential values are available to the SDK, ADC is replaced by fake auth,
  // and this transport never delegates to the network.
  // Its native schema normalizer may mutate its private clone. Admission therefore
  // belongs here, at the final wire boundary, not before SDK normalization.
  const client = new GoogleGenAI({ ...clientOptions,
    googleAuthOptions: { authClient: { getRequestHeaders: async () => new Headers() } },
    httpOptions: { ...clientOptions.httpOptions, baseUrl: 'https://aiplatform.googleapis.com', fetch: async (url, init) => {
      requireCondition(active && sending && ++sending.fetches === 1 && init.method === 'POST', 'consumer_send_identity_invalid');
      const handle = prepareDocumentBatchWirePayload({ url: String(url), body: init.body }, settings);
      const result = await batch.simulateGeneration(handle, {
        countSynthetic: (wire, scope) => synthetic.count(wire, scope),
        sendSynthetic: (wire, scope) => {
          requireCondition(active && !sending.signal.aborted && wire.body === init.body && wire.url === String(url), 'consumer_wire_changed');
          return synthetic.generate(wire, { scope, signal: sending.signal, toolsDict: sending.toolsDict });
        },
      });
      return Response.json({ candidates: [{ content: result.content, finishReason: result.finishReason }], usageMetadata: result.usageMetadata });
    } },
  });
  const provider = Object.freeze({ async generate(request, signal) {
    let ownsFlight = false;
    try {
      requireCondition(active && !closed && !signal.aborted && !inFlight, 'consumer_root_not_active');
      inFlight = true; ownsFlight = true;
      const sdkPayload = buildPayload(request);
      requireCondition(Object.keys(sdkPayload).sort().join(',') === 'config,contents,model'
        && sdkPayload.model === fixedConfig.model, 'consumer_payload_identity_mismatch');
      prepareDocumentBatchPayload({ contents: sdkPayload.contents, config: sdkPayload.config }, settings);
      const privatePayload = structuredClone(sdkPayload);
      sending = { signal, toolsDict: request.toolsDict, fetches: 0 };
      const response = await client.models.generateContent({ ...privatePayload, config: { ...privatePayload.config, abortSignal: signal } });
      requireCondition(sending.fetches === 1 && response.candidates?.length === 1, 'consumer_send_identity_invalid');
      return { content: response.candidates[0].content, finishReason: response.candidates[0].finishReason, usageMetadata: response.usageMetadata };
    } catch (error) { stop('provider_or_preparation_failed'); throw error; }
    finally { if (ownsFlight) { inFlight = false; sending = null; } }
  } });
  return Object.freeze({
    async run() {
      requireCondition(!started && !closed, 'consumer_run_reused'); started = true;
      try {
        const original = snapshotEvidence(execution.inspect);
        requireCondition(original.documentWrites === 0 && original.works.length === 0 && original.receipts.length === 0
          && new Set(original.documents.map(doc => doc.id)).size === 2,
          'scenario_fixture_not_fresh');
        const selectedDocument = expectedEditedDocument(original.documents[1]);
        let previous = original;
        const results = [];
        for (root = 0; root < INPUTS.length; root++) {
          batch.startRoot(DOCUMENT_BATCH.roots[root]); active = true;
          let result;
          try { result = await execution.runRoot({ ...INPUTS[root], index: root,
            runLimits: Object.freeze({ modelCalls: DOCUMENT_BATCH.rootCaps[root], queryEmbeddings: 1 }) }, provider); }
          finally { active = false; }
          const evidence = snapshotEvidence(execution.inspect);
          assertRootOutcome(root, result, evidence, original, previous, selectedDocument);
          requireCondition(result.counts.modelCalls === batch.snapshot().rootCalls[root], 'root_call_count_mismatch');
          batch.passRoot(); previous = evidence; results.push(structuredClone(result));
        }
        return { mode: 'offline-simulation', results, ledger: batch.snapshot() };
      } catch (error) { active = false; stop('root_result_or_scenario_failed'); throw error; }
    },
    snapshot: () => batch.snapshot(),
    close() { if (!closed) { active = false; closed = true; batch.close(); } },
  });
}
