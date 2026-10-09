#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ProbeError, fail, LIMITS, LEDGER_ID, LIVE_LEDGER_RELATIVE_PATH, denyOfflineNetwork,
  validateManifest, hashTree, openLedger, readVerifiedB, inspectLedgerCheckpoint, verifySeparatedRoots, readCleanCheckoutHead, sha256, validateManifestAuthority, LIVE_AUTHORITY_CONNECTED, deriveLiveLedgerPath } from './lib/chat-intent-probe-guards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function argumentsFrom(argv) {
  const options = { live: false, case: 'B', runId: null, manifest: null, output: null, bEvidence: null, variant: 'display', selfTest: false, productRoot: null, preflight: false, run: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--live') options.live = true;
    else if (flag === '--offline') { if (argv.includes('--live')) fail('conflicting_mode'); }
    else if (flag === '--self-test') options.selfTest = true;
    else if (flag === '--preflight') options.preflight = true;
    else if (flag === '--run') options.run = true;
    else if (['--case', '--run-id', '--approved-manifest', '--output', '--b-evidence', '--scripted-variant', '--product-root'].includes(flag)) {
      const value = argv[++index]; if (!value || value.startsWith('--')) fail('invalid_cli');
      options[{ '--case': 'case', '--run-id': 'runId', '--approved-manifest': 'manifest', '--output': 'output',
        '--b-evidence': 'bEvidence', '--scripted-variant': 'variant', '--product-root': 'productRoot' }[flag]] = value;
    } else fail('invalid_cli');
  }
  if (!['A', 'B', 'C'].includes(options.case) || !['display', 'proposal', 'rejected_proposal'].includes(options.variant)) fail('invalid_cli');
  if (options.runId !== null && !/^[a-zA-Z0-9_-]{8,80}$/u.test(options.runId)) fail('invalid_run_id');
  if (options.preflight && options.run || (options.preflight || options.run || options.productRoot) && !options.live) fail('invalid_cli');
  if (options.live && (!options.runId || options.variant !== 'display' || options.selfTest
    || !options.productRoot || options.preflight === options.run || options.run && !options.output)) fail('live_gate_missing');
  if (argv.length === 0) options.selfTest = true;
  if (options.selfTest && argv.length > 1) fail('invalid_cli');
  return options;
}
function readJson(filename) { try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { fail('manifest_unreadable'); } }
function validateCheckouts(manifest, source, harness, roots) {
  if (readCleanCheckoutHead(roots.trustedRoot) !== manifest.harnessSha || readCleanCheckoutHead(roots.productRoot) !== manifest.testedSha
    || source.sha256 !== manifest.sourceTreeSha256 || harness.sha256 !== manifest.harnessTreeSha256) fail('live_source_provenance_mismatch');
  const dependencies = path.join(roots.productRoot, 'node_modules');
  if (!fs.existsSync(dependencies) || fs.realpathSync(dependencies) !== dependencies) fail('live_dependency_root_invalid');
  for (const [name, version] of [['@google/adk', '2.1.0'], ['@google/genai', '2.24.0']]) {
    const filename = path.join(dependencies, name, 'package.json');
    if (!fs.realpathSync(filename).startsWith(dependencies + path.sep) || readJson(filename).version !== version) fail('live_dependency_mismatch');
  }
  if (process.env.GCP_PROJECT_ID !== manifest.gcpProject || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(manifest.gcpProject ?? '')
    || manifest.authentication !== 'existing_adc' || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) fail('live_adc_project_required');
}
async function loadProductModules(productRoot) {
  const load = filename => import(pathToFileURL(path.join(productRoot, 'server', filename)).href);
  return { runtime: await load('agent-runtime.ts'), product: await load('product-agent.ts'), api: await load('product-agent-api.ts'),
    family: await load('family-access.ts'), config: await load('ai-config.ts') };
}
export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFrom(argv);
  if (options.selfTest) {
    const result = spawnSync(process.execPath, ['--test', 'tests/chat-intent-probe.test.mjs'], { cwd: root, stdio: 'inherit',
      env: { ...process.env, YUBAN_SEMANTIC_PROBE_LIVE: '' } });
    process.exitCode = result.status ?? 1; return;
  }
  // Offline denial happens before any dynamic product import or provider work.
  if (!options.live || options.preflight) denyOfflineNetwork();
  let manifest = null;
  if (options.live) {
    let manifestBytes, manifestDocument;
    try {
      manifestBytes = options.manifest ? fs.readFileSync(options.manifest) : null;
      manifestDocument = manifestBytes ? JSON.parse(manifestBytes) : null;
    } catch { fail('manifest_unreadable'); }
    manifest = validateManifest(manifestDocument, options, process.env);
    validateManifestAuthority(manifestBytes, manifest, process.env);
    if (!LIVE_AUTHORITY_CONNECTED) fail('live_authority_context_unconnected');
  }
  else if (options.case === 'C') fail('offline_case_c_requires_verified_live_context');
  const roots = options.live ? verifySeparatedRoots(root, options.productRoot) : { trustedRoot: root, productRoot: root };
  const source = hashTree(roots.productRoot, ['server', 'src', 'prompts', 'package.json', 'package-lock.json']);
  const harness = hashTree(root, ['scripts/verify-chat-intent-probe.mjs', 'scripts/lib', 'tests/chat-intent-probe.test.mjs']);
  if (options.live) validateCheckouts(manifest, source, harness, roots);
  const bVisibleText = options.case === 'C' ? readVerifiedB(options.bEvidence, manifest) : undefined;
  const runId = options.runId ?? `offline_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const ledgerPath = options.live ? deriveLiveLedgerPath(roots.trustedRoot, roots.productRoot)
    : path.join(roots.trustedRoot, '.probe-state/offline-ledger.json');
  if (options.preflight) {
    const checkpoint = inspectLedgerCheckpoint(ledgerPath, { expectedSha256: manifest.ledgerSha256, runId });
    const report = { schemaVersion: 1, mode: 'preflight', status: 'passed', runId, case: options.case,
      provenance: { testedSha: manifest.testedSha, harnessSha: manifest.harnessSha,
        sourceTreeSha256: source.sha256, harnessTreeSha256: harness.sha256 }, ledger: checkpoint, productImported: false, networkRequests: 0 };
    process.stdout.write(JSON.stringify(report) + '\n'); return;
  }
  let outputFd;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    if (options.live && [roots.trustedRoot, roots.productRoot].some(directory => outputPath === directory || outputPath.startsWith(directory + path.sep))) fail('live_evidence_must_be_outside_checkout');
    try { outputFd = fs.openSync(outputPath, 'wx', 0o600); } catch { fail('evidence_destination_unavailable'); }
  }
  let ledger;
  try { ledger = openLedger(ledgerPath, { expectedSha256: manifest?.ledgerSha256, runId, caseId: options.case, offline: !options.live }); }
  catch (error) { if (outputFd !== undefined) fs.closeSync(outputFd); throw error; }
  const writeOutput = evidence => {
    if (outputFd !== undefined) { fs.writeSync(outputFd, JSON.stringify(evidence, null, 2) + '\n'); fs.fsyncSync(outputFd); }
  };
  let evidence;
  try {
    // Live rechecks both immutable checkouts and hashes immediately before product evaluation.
    if (options.live) {
      validateCheckouts(manifest, hashTree(roots.productRoot, ['server', 'src', 'prompts', 'package.json', 'package-lock.json']),
        hashTree(roots.trustedRoot, ['scripts/verify-chat-intent-probe.mjs', 'scripts/lib', 'tests/chat-intent-probe.test.mjs']), roots);
    }
    const productModules = await loadProductModules(roots.productRoot);
    const { readAiConfig } = productModules.config;
    const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: manifest?.gcpProject ?? 'synthetic-project',
      GEMINI_MODEL: 'gemini-3.1-flash-lite', VERTEX_LOCATION: 'global', AI_MAX_ATTEMPTS: '1', AI_MAX_OUTPUT_TOKENS: '1024',
      AI_AGENT_THINKING_LEVEL: manifest?.serverThinkingLevel ?? 'minimal' });
    let provider;
    if (options.live) {
      const { createVertexAgentProvider } = await import(pathToFileURL(path.join(roots.productRoot, 'server/agent-model-gateway.ts')).href);
      provider = createVertexAgentProvider(config);
    }
    const { runFixture } = await import('./lib/chat-intent-probe-fixture.mjs');
    const result = await runFixture({ caseId: options.case, config, provider, ledger, bVisibleText, scriptedVariant: options.variant, productModules });
    ledger.finish(result.result.status === 'completed' ? 'completed' : 'stopped');
    evidence = { schemaVersion: 1, mode: options.live ? 'live' : 'offline', runId, case: options.case,
      provenance: { repository: '2NTTY/child-ai-caregiver', testedSha: manifest?.testedSha ?? null, harnessSha: manifest?.harnessSha ?? null,
        offlineComposite: options.live ? null : { currentMaster: '69da307b7c99945581b75122fba69d0769185d61',
          unmergedProductIntentDraft: '98e77b0bc85fc61d22b42c92f564e7d2f6f97da5',
          copiedConfigPr: 'aa3b1611ed0f2a3724b4ebf503e6ab68a967766e',
          copiedWorkGuardPr: 'a061e176b0c6d0e9ca14d43c6404ea812b324741', cleanSingleCommit: false },
        sourceTreeSha256: source.sha256, harnessTreeSha256: harness.sha256,
        model: config.model, location: config.location, serverThinkingLevel: config.agentThinkingLevel },
      limits: LIMITS, ledger: ledger.snapshot(), ...result,
      scope: { realRuntimeAndTools: true, realModel: options.live, realDatabase: false, businessStores: 'synthetic_counting_substitutes',
        completeServiceAcceptance: false, otherAgents: false } };
    // Avoid overwriting a previous result. A spent live run is never rerun merely
    // because evidence delivery failed; the ledger remains the spending authority.
    writeOutput(evidence);
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
    if (result.mechanical.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    ledger.unknown('invocation_interrupted');
    const failure = { schemaVersion: 1, mode: options.live ? 'live' : 'offline', runId,
      errorCategory: error instanceof ProbeError ? error.code : 'unknown_error_redacted', ledger: ledger.snapshot(),
      semantic: { status: 'root_review_required' } };
    try { writeOutput(failure); } catch { /* The durable spending ledger remains authoritative. */ }
    process.stdout.write(JSON.stringify(failure) + '\n');
    process.exitCode = 1;
  } finally { ledger.close(); if (outputFd !== undefined) fs.closeSync(outputFd); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    process.stdout.write(JSON.stringify({ errorCategory: error instanceof ProbeError ? error.code : 'unknown_error_redacted' }) + '\n');
    process.exitCode = 1;
  }
}
