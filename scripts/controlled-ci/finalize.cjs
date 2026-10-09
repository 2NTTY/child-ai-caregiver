'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { POLICY, paths, readBytes, readJson, writeJson, canonical, sha256, exactKeys, fail } = require('./controller.cjs');
const ALLOWED = Object.freeze(['bootstrap.json', 'claim.json', 'preflight.json', 'inspection.json', 'synthetic-evidence.json']);
function safeTree(value, depth = 0) {
  if (depth > 40) fail('evidence_depth_exceeded');
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) { if (value.length > 4096) fail('evidence_array_exceeded'); }
    else if (Object.keys(value).some(key => /^(?:thought|thoughts|thoughtSignature|signature|credentials?|token|headers?|environment|env|apiKey|password|secret)$/iu.test(key))) fail('evidence_sensitive_field_denied');
    for (const item of Object.values(value)) safeTree(item, depth + 1);
  } else if (typeof value === 'string' && value.length > 12000 || typeof value === 'number' && !Number.isFinite(value)) fail('evidence_value_invalid');
}
function validateLedgerShape(ledger) {
  if (!exactKeys(ledger, ['schemaVersion', 'ledgerId', 'baseline', 'events'])
    || !exactKeys(ledger.baseline, ['generationCalls', 'estimatedUsd', 'description'])
    || ledger.baseline.generationCalls !== 12 || ledger.baseline.estimatedUsd !== '0.0464555'
    || typeof ledger.baseline.description !== 'string' || ledger.baseline.description.length > 512
    || !Array.isArray(ledger.events) || ledger.events.length > 512) fail('ledger_shape_invalid');
  const fields = { run_started: ['case'], reserved: ['reservationId'], response: ['reservationId', 'usage'],
    unknown: ['reservationId', 'category'], gateway_outcome: ['outcome'], run_finished: ['status'] };
  for (const event of ledger.events) {
    if (!fields[event.type] || !exactKeys(event, ['previousHash', 'type', 'runId', 'hash', ...fields[event.type]])) fail('ledger_event_shape_invalid');
    if (event.usage && Object.keys(event.usage).some(key => !['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount'].includes(key))) fail('ledger_usage_shape_invalid');
  }
  safeTree(ledger);
}
async function finalize({ core, env = process.env }) {
  const p = paths(env), safeFiles = []; let errorCategory = null, ledgerSummary = null, probe = null, probeEvidenceInLog = null;
  for (const name of ALLOWED) {
    const filename = path.join(p.evidence, name);
    if (!fs.existsSync(filename)) continue;
    try {
      const bytes = readBytes(filename, name === 'synthetic-evidence.json' ? POLICY.evidenceMaximum : 65536);
      const value = JSON.parse(bytes); safeTree(value);
      if (name === 'synthetic-evidence.json') {
        if (value.errorCategory) {
          if (!/^[a-z][a-z0-9_]{0,80}$/u.test(value.errorCategory)) fail('probe_error_category_invalid');
        } else if (value.mode !== 'live' || value.scope?.realModel !== true || value.scope?.realRuntimeAndTools !== true
          || value.scope?.completeServiceAcceptance !== false || value.scope?.realDatabase !== false
          || value.scope?.businessStores !== 'synthetic_counting_substitutes' || value.scope?.otherAgents !== false
          || value.semantic?.status !== 'root_review_required') fail('probe_scope_invalid');
        probe = value;
        const complete = canonical(value);
        probeEvidenceInLog = Buffer.byteLength(complete) <= POLICY.logMaximum;
        if (probeEvidenceInLog) core.info(`CONTROLLED_PROBE_JSON ${complete}`);
      }
      if (name === 'preflight.json' && value.errorCategory) {
        if (!/^[a-z][a-z0-9_]{0,80}$/u.test(value.errorCategory)) fail('probe_error_category_invalid');
        errorCategory = value.errorCategory;
      }
      safeFiles.push(filename);
    } catch { errorCategory = 'evidence_sanitization_failed'; core.setFailed(errorCategory); }
  }
  const ledgerPath = path.join(p.state, 'live-ledger.json');
  if (fs.existsSync(ledgerPath)) {
    try {
      const bytes = readBytes(ledgerPath, POLICY.ledgerMaximum), ledger = JSON.parse(bytes);
      validateLedgerShape(ledger);
      const { validateLedger } = await import(pathToFileURL(path.join(p.trusted, 'scripts/lib/chat-intent-probe-guards.mjs')).href);
      const state = validateLedger(ledger);
      const target = path.join(p.evidence, 'live-ledger.json');
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); safeFiles.push(target);
      ledgerSummary = { checkpointSha256: sha256(bytes), generationCallsReserved: state.calls,
        additionalCallsReserved: state.calls - 12, remainingGenerationCalls: 20 - state.calls,
        uncertain: state.uncertain, unfinishedRuns: [...state.runs.values()].filter(r => r.status === 'running').length,
        historicalEstimatedUsd: '0.0464555', historicalActualCostUnknown: true };
      const json = canonical(ledger);
      if (Buffer.byteLength(json) <= POLICY.logMaximum) core.info(`CONTROLLED_LEDGER_JSON ${json}`);
      else ledgerSummary.completeLedgerInLog = false;
    } catch { errorCategory = 'ledger_sanitization_failed'; core.setFailed(errorCategory); }
  }
  const outcomes = Object.fromEntries(['PREPARE', 'RESTORE', 'DEPENDENCIES', 'PREFLIGHT', 'CONSUMPTION', 'AUTH', 'LIVE', 'PRODUCT_CHECKOUT']
    .map(stage => [stage.toLowerCase(), ['success', 'failure', 'cancelled', 'skipped'].includes(env[`CONTROLLED_${stage}_OUTCOME`])
      ? env[`CONTROLLED_${stage}_OUTCOME`] : 'skipped']));
  if (!errorCategory && Object.values(outcomes).some(outcome => ['failure', 'cancelled'].includes(outcome))) errorCategory = 'workflow_stage_failed';
  const bootstrapResult = readJson(path.join(p.evidence, 'result.json'), 16384);
  const summary = { schemaVersion: 1, mode: bootstrapResult.mode, status: errorCategory ? 'stopped' : 'root_review_required',
    errorCategory, ownerActorVerified: true, liveEnabled: POLICY.liveEnabled,
    googleAuthenticationOutcome: outcomes.auth, stageOutcomes: outcomes,
    semantic: { status: 'root_review_required' }, completeServiceAcceptance: false, realDatabase: false,
    probeEvidenceInLog, probeEvidenceRequiresArtifactRead: probeEvidenceInLog === false,
    spending: ledgerSummary, modelCounters: probe?.result?.counts ?? null,
    historicalEstimatedUsd: '0.0464555', actualCostUnknown: true, bootstrapEvidenceSha256: bootstrapResult.bootstrapEvidenceSha256,
    probeEvidenceSha256: safeFiles.includes(path.join(p.evidence, 'synthetic-evidence.json'))
      ? sha256(readBytes(path.join(p.evidence, 'synthetic-evidence.json'), POLICY.evidenceMaximum)) : null,
    artifactHistoryLimit: 'Complete current metadata only; deleted artifacts have no API tombstone. Root review and bounded expiry remain required.' };
  const temporary = path.join(p.evidence, 'result.next.json'); writeJson(temporary, summary);
  fs.renameSync(temporary, path.join(p.evidence, 'result.json')); safeFiles.push(path.join(p.evidence, 'result.json'));
  core.info(`CONTROLLED_RESULT_JSON ${canonical(summary)}`);
  core.info(`CONTROLLED_RESULT_SHA256 ${sha256(readBytes(path.join(p.evidence, 'result.json'), POLICY.logMaximum))}`);
  core.setOutput('safe-files', safeFiles.join('\n'));
  core.setOutput('safe-evidence-ready', 'true');
}
module.exports = { ALLOWED, safeTree, validateLedgerShape, finalize };
