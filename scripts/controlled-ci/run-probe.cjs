'use strict';
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { POLICY, planFrom, readBytes, readJson, writeJson, validateManifest, sha256, fail } = require('./controller.cjs');

async function executeProbe(stage, env = process.env) {
  if (!['preflight', 'run'].includes(stage)) fail('probe_stage_invalid');
  const { p, plan } = planFrom(env);
  if (!['preflight', 'live'].includes(plan.request.mode)) fail('probe_request_mode_invalid');
  if (stage === 'run' && (!POLICY.liveEnabled || plan.request.mode !== 'live')) fail('live_disabled_pending_root_review');
  const bytes = readBytes(path.join(p.control, 'approved-manifest.json'), 16384);
  if (sha256(bytes) !== plan.manifestSha256) fail('manifest_bytes_pin_mismatch');
  const manifest = validateManifest(JSON.parse(bytes), plan);
  const { inspectLedgerCheckpoint } = await import(pathToFileURL(path.join(p.trusted, 'scripts/lib/chat-intent-probe-guards.mjs')).href);
  inspectLedgerCheckpoint(path.join(p.state, 'live-ledger.json'), { expectedSha256: manifest.ledgerSha256, runId: manifest.runId });
  const args = [path.join(p.trusted, 'scripts/verify-chat-intent-probe.mjs'), '--live', stage === 'run' ? '--run' : '--preflight',
    '--product-root', p.product, '--case', manifest.case, '--run-id', manifest.runId,
    '--approved-manifest', path.join(p.control, 'approved-manifest.json')];
  if (manifest.case === 'C') {
    const filename = path.join(p.control, 'previous-b-evidence.json');
    if (!fs.existsSync(filename)) fail('reviewed_b_evidence_unavailable');
    args.push('--b-evidence', filename);
  }
  if (stage === 'run') args.push('--output', path.join(p.control, 'live-output.json'));
  const result = childProcess.spawnSync(process.execPath, args, { cwd: p.trusted, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: stage === 'run' ? 110000 : 30000,
    maxBuffer: POLICY.evidenceMaximum, env: { ...env, YUBAN_SEMANTIC_PROBE_LIVE: '1',
      GCP_PROJECT_ID: manifest.gcpProject, YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: plan.manifestSha256,
      YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify(plan.workflowContext) } });
  let report;
  try { report = JSON.parse(result.stdout ?? ''); } catch { report = { errorCategory: 'probe_output_unavailable_redacted' }; }
  const filename = path.join(p.evidence, stage === 'preflight' ? 'preflight.json' : 'synthetic-evidence.json');
  // The finalizer enforces the complete evidence allowlist before upload.
  if (stage === 'run' && fs.existsSync(path.join(p.control, 'live-output.json')))
    report = readJson(path.join(p.control, 'live-output.json'));
  writeJson(filename, report);
  return result.status === 0 && !result.error ? 0 : 1;
}
module.exports = { executeProbe };
if (require.main === module) {
  executeProbe(process.argv.length === 3 && process.argv[2] === '--preflight' ? 'preflight'
    : process.argv.length === 3 && process.argv[2] === '--run' ? 'run' : 'invalid')
    .then(status => { process.exitCode = status; })
    .catch(error => { process.stdout.write(JSON.stringify({ errorCategory: error.category ?? 'probe_runner_error_redacted' }) + '\n'); process.exitCode = 1; });
}
