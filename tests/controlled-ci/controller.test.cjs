'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { test } = require('node:test');
const { POLICY, sha256, validateManifest, listAllArtifacts, verifyArtifactHistory,
  inspectSources, reserveConsumption, authorizeAfterReceipt, hashTree } = require('../../scripts/controlled-ci/controller.cjs');
const { safeTree, validateLedgerShape } = require('../../scripts/controlled-ci/finalize.cjs');
const trustedSha = 'a'.repeat(40), testedSha = 'b'.repeat(40), ledgerHash = 'c'.repeat(64), previousHash = 'd'.repeat(64);
const expected = { repository: POLICY.repository, repositoryId: POLICY.repositoryId, ownerId: POLICY.ownerId,
  actorId: POLICY.actorId, expectedBranch: POLICY.ref, pinnedWorkflowSha: trustedSha, eventName: 'push', runAttempt: 1 };
function fixtureManifest() {
  return { schemaVersion: 1, repository: POLICY.repository, approved: true, approvalRef: 'synthetic-root-review',
    testedSha, harnessSha: trustedSha, sourceTreeSha256: '0'.repeat(64), harnessTreeSha256: '1'.repeat(64),
    packageLockSha256: '2'.repeat(64), ledgerSha256: POLICY.initialSha256,
    runId: 'synthetic_test_run', case: 'B', gcpProject: 'ai-caregivers-for-children', authentication: 'existing_adc',
    ledgerId: '2NTTY/child-ai-caregiver:chat-intent:20261008', ledgerPath: 'workflow-workspace:.controlled-model-state/live-ledger.json',
    model: 'gemini-3.1-flash-lite', location: 'global', serverThinkingLevel: 'minimal',
    limits: { modelCalls: 4, toolCalls: 8, deadlineMs: 90000, outputTokens: 1024, candidateCount: 1, sdkAttempts: 1,
      queryEmbeddings: 0, historicalCalls: 12, historicalEstimatedUsd: '0.0464555', cumulativeGenerationCap: 20, additionalGenerationCap: 8 },
    expectedWorkflowContext: { ...expected }, expiresAt: '2026-10-09T23:00:00Z',
    checkpointSource: { type: 'initial', path: POLICY.initialPath, sha256: POLICY.initialSha256 }, requiredReceipts: [] };
}
function fixturePlan() { return { request: { mode: 'preflight', requestId: 'synthetic_test_run' }, trustedSha,
  testedSha, workflowContext: { callerCommitSha: 'e'.repeat(40), ...expected }, githubRunId: '777' }; }
const now = Date.parse('2026-10-09T00:00:00Z');
function artifact(id, name, runId, hash = previousHash) {
  return { id, name, digest: `sha256:${hash}`, expired: false, size_in_bytes: 1234,
    workflow_run: { id: runId, repository_id: 1377602504, head_repository_id: 1377602504 } };
}
function metadataClient(artifacts, run = null) { return { rest: { actions: {
  listArtifactsForRepo: async args => ({ data: { total_count: artifacts.length, artifacts: artifacts.slice((args.page - 1) * 100, args.page * 100) } }),
  getWorkflowRun: async () => ({ data: run }),
} } }; }

test('approved manifest is bound to static identity, original revision and bounded expiry, never just approved=true', () => {
  const m = fixtureManifest(), p = fixturePlan(); assert.equal(validateManifest(m, p, now), m);
  p.workflowContext.callerCommitSha = 'f'.repeat(40); assert.equal(validateManifest(m, p, now), m);
  for (const mutate of [m => { m.expectedWorkflowContext.actorId = '1'; }, m => { m.expectedWorkflowContext.callerCommitSha = 'e'.repeat(40); },
    m => { m.harnessSha = testedSha; }, m => { m.packageLockSha256 = null; }, m => { m.approved = false; },
    m => { m.limits.modelCalls = 5; }, m => { m.expiresAt = '2026-10-10T00:00:01Z'; }, m => { m.expiresAt = '2026-10-08T00:00:00Z'; },
    m => { m.checkpointSource.path = '/arbitrary/ledger'; }, m => { m.requiredReceipts = undefined; }]) {
    const value = fixtureManifest(); mutate(value); assert.throws(() => validateManifest(value, fixturePlan(), now));
  }
});

test('artifact scans require complete stable pagination and reject duplicate IDs or read failures', async () => {
  const values = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, name: `synthetic-${i}` }));
  assert.equal((await listAllArtifacts(metadataClient(values))).length, 101);
  for (const data of [{ total_count: 2, artifacts: [{ id: 1 }] }, { total_count: 2, artifacts: [{ id: 1 }, { id: 1 }] }])
    await assert.rejects(listAllArtifacts({ rest: { actions: { listArtifactsForRepo: async () => ({ data }) } } }));
  await assert.rejects(listAllArtifacts({ rest: { actions: { listArtifactsForRepo: async () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); } } } }),
    { category: 'artifact_listing_unavailable' });
  const unstable = { rest: { actions: { listArtifactsForRepo: async ({ page }) => ({ data: {
    total_count: page === 1 ? 101 : 100, artifacts: values.slice((page - 1) * 100, page * 100),
  } }) } } };
  await assert.rejects(listAllArtifacts(unstable), { category: 'artifact_listing_incomplete' });
});

test('the unique initial checkpoint is refused if any consumption history is visible, including expired receipts', async () => {
  await verifyArtifactHistory(metadataClient([]), fixtureManifest(), fixturePlan());
  const spent = artifact(1, `controlled-model-consumed-${POLICY.initialSha256}`, 123);
  spent.expired = true;
  await assert.rejects(verifyArtifactHistory(metadataClient([spent]), fixtureManifest(), fixturePlan()),
    { category: 'initial_checkpoint_history_exists' });
});

test('previous checkpoint and every required receipt must match server provenance and terminal run', async () => {
  const m = fixtureManifest(); m.ledgerSha256 = ledgerHash;
  m.checkpointSource = { type: 'artifact', repository: POLICY.repository, runId: '123', runAttempt: 1, workflowSha: trustedSha,
    artifactId: '5', artifactName: 'controlled-model-evidence-123-1', artifactDigest: `sha256:${previousHash}`, ledgerSha256: ledgerHash };
  m.requiredReceipts = [{ artifactId: '4', name: `controlled-model-consumed-${POLICY.initialSha256}`, runId: '123', runAttempt: 1,
    digest: `sha256:${previousHash}`, ledgerSha256: POLICY.initialSha256 }];
  validateManifest(m, fixturePlan(), now);
  const values = [artifact(4, m.requiredReceipts[0].name, 123), artifact(5, m.checkpointSource.artifactName, 123)];
  const run = { id: 123, run_attempt: 1, status: 'completed', conclusion: 'success', event: 'push', head_branch: POLICY.branch,
    path: POLICY.callerPath, actor: { id: 119132090 }, triggering_actor: { id: 119132090 }, repository: { id: 1377602504, owner: { id: 119132090 } },
    referenced_workflows: [{ sha: trustedSha, path: `${POLICY.reusablePath}@${trustedSha}` }] };
  await verifyArtifactHistory(metadataClient(values, run), m, fixturePlan());
  await assert.rejects(verifyArtifactHistory(metadataClient(values.slice(1), run), m, fixturePlan()), { category: 'known_receipt_missing_or_duplicate' });
  await assert.rejects(verifyArtifactHistory(metadataClient([values[0], { ...values[1], expired: true }], run), m, fixturePlan()), { category: 'artifact_provenance_invalid' });
  await assert.rejects(verifyArtifactHistory(metadataClient(values, { ...run, status: 'in_progress' }), m, fixturePlan()), { category: 'checkpoint_run_provenance_invalid' });
  await assert.rejects(verifyArtifactHistory(metadataClient(values, { ...run, actor: { id: 1 } }), m, fixturePlan()), { category: 'checkpoint_run_provenance_invalid' });
  await assert.rejects(verifyArtifactHistory(metadataClient([...values, artifact(6, `controlled-model-consumed-${ledgerHash}`, 124)], run), m, fixturePlan()),
    { category: 'checkpoint_already_consumed' });
});

test('release enablement alone cannot authorize a missing manifest or runner origin', async () => {
  assert.equal(POLICY.liveEnabled, true);
  for (const action of [reserveConsumption, authorizeAfterReceipt]) {
    const failures = [], outputs = {};
    await action({ github: new Proxy({}, { get() { throw new Error('Should not query'); } }),
      core: { setFailed: v => failures.push(v), setOutput: (k, v) => { outputs[k] = v; } }, env: {} });
    assert.equal(failures.length, 1); assert.equal(outputs['auth-authorized'], undefined);
    assert.equal(outputs['live-enabled'], undefined);
  }
});

test('trusted source inspection hashes clean Git checkouts without importing executable product modules', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-inspect-'));
  try {
    const trusted = path.join(temp, 'trusted'), product = path.join(temp, 'product');
    for (const directory of [trusted, product]) {
      fs.mkdirSync(directory);
      cp.execFileSync('git', ['init', '-q'], { cwd: directory });
      for (const [name, value] of [['user.name', 'Synthetic Test'], ['user.email', 'synthetic@example.invalid']])
        cp.execFileSync('git', ['config', name, value], { cwd: directory });
    }
    for (const relative of ['server', 'src', 'prompts']) fs.mkdirSync(path.join(product, relative));
    fs.writeFileSync(path.join(product, 'server/must-not-execute.mjs'), 'throw new Error("Product must never run");\n');
    fs.writeFileSync(path.join(product, 'package.json'), JSON.stringify({ dependencies: { '@google/adk': '2.1.0', '@google/genai': '2.24.0' } }));
    fs.writeFileSync(path.join(product, 'package-lock.json'), '{}\n');
    fs.mkdirSync(path.join(trusted, 'scripts/lib'), { recursive: true }); fs.mkdirSync(path.join(trusted, 'tests'));
    fs.writeFileSync(path.join(trusted, 'scripts/verify-chat-intent-probe.mjs'), 'throw new Error("Probe must never run");\n');
    fs.writeFileSync(path.join(trusted, 'scripts/lib/guard.mjs'), '// Synthetic guard\n');
    fs.writeFileSync(path.join(trusted, 'tests/chat-intent-probe.test.mjs'), '// Synthetic test\n');
    const heads = {};
    for (const directory of [trusted, product]) { cp.execFileSync('git', ['add', '.'], { cwd: directory });
      cp.execFileSync('git', ['commit', '-qm', 'Synthetic fixture'], { cwd: directory });
      heads[directory] = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(); }
    const report = inspectSources({ trusted, product }, { trustedSha: heads[trusted], testedSha: heads[product] });
    assert.equal(report.productImported, false); assert.equal(report.status, 'measured_root_review_required');
    assert.equal(report.selectedDependencies['@google/adk'], '2.1.0');
    assert.match(report.selectedGitBlobShas['package-lock.json'], /^[a-f0-9]{40}$/u);
    assert.equal(report.selectedFiles['package-lock.json'], sha256('{}\n'));
    assert.equal(report.sourceTreeSha256, hashTree(product, ['server', 'src', 'prompts', 'package.json', 'package-lock.json']).sha256);
    fs.writeFileSync(path.join(product, 'untracked-private.txt'), 'synthetic');
    assert.throws(() => inspectSources({ trusted, product }, { trustedSha: heads[trusted], testedSha: heads[product] }), { category: 'checkout_not_clean' });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('sanitization rejects thought bodies and credentials while preserving usage metrics', () => {
  safeTree({ usage: { thoughtsTokenCount: 3, totalTokenCount: 10 }, semantic: { status: 'root_review_required' } });
  for (const key of ['thought', 'thoughtSignature', 'credentials', 'Token', 'env', 'headers'])
    assert.throws(() => safeTree({ nested: [{ [key]: 'SYNTHETIC_PRIVATE_VALUE' }] }), { category: 'evidence_sensitive_field_denied' });
  assert.throws(() => validateLedgerShape({ schemaVersion: 1, ledgerId: 'synthetic', baseline: {}, events: [], token: 'synthetic' }));
});

test('final logs contain actual synthetic visible evidence; unsafe fields and oversized evidence are never logged as complete', async () => {
  const { finalize } = require('../../scripts/controlled-ci/finalize.cjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-finalize-'));
  try {
    const workspace = path.join(base, 'workspace'); fs.mkdirSync(workspace);
    for (const variant of ['normal', 'sensitive', 'oversized']) {
      const temp = path.join(base, variant); fs.mkdirSync(temp);
      const evidence = path.join(temp, 'controlled-model-evidence'); fs.mkdirSync(evidence);
      fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ mode: 'live', bootstrapEvidenceSha256: '0'.repeat(64) }));
      const value = { schemaVersion: 1, mode: 'live', runId: 'synthetic_log_test', case: 'B',
        syntheticConversation: [{ role: 'user', text: '那個幫我標成做完了' }],
        actualReadContextResponses: [{ tasks: { partial: false, items: [{ title: '整理出門袋' }] } }],
        providerResponses: [{ usage: { totalTokenCount: 20, thoughtsTokenCount: 0 }, parts: [{ text: '你指的是整理出門袋嗎？' }] }],
        result: { visibleText: '你指的是整理出門袋嗎？', counts: { modelCalls: 1 }, proposals: [] },
        mechanical: { status: 'passed', taskEffectsAbsent: true }, semantic: { status: 'root_review_required' },
        scope: { realRuntimeAndTools: true, realModel: true, completeServiceAcceptance: false, realDatabase: false, businessStores: 'synthetic_counting_substitutes', otherAgents: false } };
      if (variant === 'sensitive') value.providerResponses[0].parts[0].thoughtSignature = 'SYNTHETIC_PRIVATE_SIGNATURE';
      if (variant === 'oversized') value.providerResponses = Array.from({ length: 10 }, () => ({ text: '合'.repeat(11000) }));
      fs.writeFileSync(path.join(evidence, 'synthetic-evidence.json'), JSON.stringify(value));
      const info = [], failed = [], outputs = {};
      await finalize({ core: { info: v => info.push(v), setFailed: v => failed.push(v), setOutput: (k, v) => { outputs[k] = v; } },
        env: { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temp, CONTROLLED_AUTH_OUTCOME: 'success' } });
      const summary = JSON.parse(fs.readFileSync(path.join(evidence, 'result.json')));
      assert.equal(summary.semantic.status, 'root_review_required');
      if (variant === 'normal') {
        assert.equal(summary.probeEvidenceInLog, true);
        const log = info.find(v => v.startsWith('CONTROLLED_PROBE_JSON '));
        assert.ok(log.includes('你指的是整理出門袋嗎？'));
        assert.ok(log.includes('"partial":false'));
        assert.deepEqual(failed, []);
      } else if (variant === 'sensitive') {
        assert.equal(info.join('\n').includes('SYNTHETIC_PRIVATE_SIGNATURE'), false);
        assert.equal(info.some(v => v.startsWith('CONTROLLED_PROBE_JSON ')), false);
        assert.equal(outputs['safe-files'].includes('synthetic-evidence.json'), false);
        assert.equal(summary.errorCategory, 'evidence_sanitization_failed');
      } else {
        assert.equal(summary.probeEvidenceInLog, false);
        assert.equal(summary.probeEvidenceRequiresArtifactRead, true);
        assert.equal(info.some(v => v.startsWith('CONTROLLED_PROBE_JSON ')), false);
      }
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
