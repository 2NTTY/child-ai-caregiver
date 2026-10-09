'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { POLICY, canonical, sha256, reserveConsumption, authorizeAfterReceipt } = require('../../scripts/controlled-ci/controller.cjs');
const root = path.resolve(__dirname, '../..');
const initial = fs.readFileSync(path.join(root, '.github/controlled-model/initial-live-ledger.json'));
const trustedSha = 'a'.repeat(40), testedSha = 'b'.repeat(40), callerSha = 'e'.repeat(40), archiveHash = 'f'.repeat(64);
const now = Date.parse('2026-10-09T01:00:00Z');
const context = { callerCommitSha: callerSha, repository: POLICY.repository, repositoryId: POLICY.repositoryId,
  ownerId: POLICY.ownerId, actorId: POLICY.actorId, expectedBranch: POLICY.ref, pinnedWorkflowSha: trustedSha,
  eventName: 'push', runAttempt: 1 };
function fakeCore() {
  const state = { failed: [], outputs: {}, info: [] };
  return { state, core: { setFailed: v => state.failed.push(v), setOutput: (k, v) => { state.outputs[k] = v; }, info: v => state.info.push(v) } };
}
async function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-release-'));
  const workspace = path.join(base, 'workspace'), temp = path.join(base, 'temp');
  fs.mkdirSync(workspace); fs.mkdirSync(temp);
  const trusted = path.join(workspace, 'trusted'), product = path.join(workspace, 'product');
  fs.mkdirSync(trusted); fs.mkdirSync(product);
  const lib = path.join(trusted, 'scripts/lib'); fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/lib/chat-intent-probe-guards.mjs'), path.join(lib, 'chat-intent-probe-guards.mjs'));
  const state = path.join(workspace, '.controlled-model-state'); fs.mkdirSync(state, { mode: 0o700 });
  const ledger = path.join(state, 'live-ledger.json'); fs.writeFileSync(ledger, initial, { mode: 0o600 });
  const control = path.join(temp, 'controlled-model-control'), evidence = path.join(temp, 'controlled-model-evidence');
  fs.mkdirSync(control); fs.mkdirSync(evidence);
  const { callerCommitSha: _origin, ...expected } = context;
  const manifest = { schemaVersion: 1, repository: POLICY.repository, approved: true,
    approvalRef: 'Synthetic gate unit fixture; never a real live authorization', testedSha, harnessSha: trustedSha,
    sourceTreeSha256: '0'.repeat(64), harnessTreeSha256: '1'.repeat(64), packageLockSha256: '2'.repeat(64),
    ledgerSha256: POLICY.initialSha256, ledgerId: '2NTTY/child-ai-caregiver:chat-intent:20261008',
    ledgerPath: 'workflow-workspace:.controlled-model-state/live-ledger.json', model: 'gemini-3.1-flash-lite',
    location: 'global', serverThinkingLevel: 'medium', runId: 'synthetic-release-001', case: 'B',
    gcpProject: 'ai-caregivers-for-children', authentication: 'existing_adc', expectedWorkflowContext: expected,
    expiresAt: '2026-10-10T00:00:00Z', checkpointSource: { type: 'initial', path: POLICY.initialPath, sha256: POLICY.initialSha256 },
    requiredReceipts: [], limits: { modelCalls: 4, toolCalls: 8, deadlineMs: 90000, outputTokens: 1024, candidateCount: 1,
      sdkAttempts: 1, queryEmbeddings: 0, historicalCalls: 12, historicalEstimatedUsd: '0.0464555', cumulativeGenerationCap: 20, additionalGenerationCap: 8 } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(control, 'approved-manifest.json'), manifestBytes);
  const plan = { schemaVersion: 1, request: { schemaVersion: 1, mode: 'live', requestId: manifest.runId }, workflowContext: context,
    trustedSha, testedSha, githubRunId: '777', manifestSha256: sha256(manifestBytes) };
  fs.writeFileSync(path.join(control, 'plan.json'), JSON.stringify(plan));
  const helper = await import(pathToFileURL(path.join(lib, 'chat-intent-probe-guards.mjs')).href);
  assert.equal(helper.LIVE_AUTHORITY_CONNECTED, true);
  const checkpoint = helper.inspectLedgerCheckpoint(ledger, { expectedSha256: manifest.ledgerSha256, runId: manifest.runId });
  const preflight = { schemaVersion: 1, mode: 'preflight', status: 'passed', runId: manifest.runId, case: manifest.case,
    provenance: { testedSha, harnessSha: trustedSha, sourceTreeSha256: manifest.sourceTreeSha256, harnessTreeSha256: manifest.harnessTreeSha256 },
    ledger: checkpoint, productImported: false, networkRequests: 0 };
  fs.writeFileSync(path.join(evidence, 'preflight.json'), JSON.stringify(preflight));
  const env = { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temp, GITHUB_RUN_ID: '777', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: callerSha,
    CONTROLLED_RECEIPT_ID: '55', CONTROLLED_RECEIPT_DIGEST: `sha256:${archiveHash}` };
  const artifacts = [], apiCalls = [];
  const github = { rest: { actions: { listArtifactsForRepo: async args => { apiCalls.push(args); return { data: { total_count: artifacts.length, artifacts } }; } } } };
  const receipt = { id: 55, name: `controlled-model-consumed-${manifest.ledgerSha256}`, digest: env.CONTROLLED_RECEIPT_DIGEST,
    expired: false, size_in_bytes: 456, workflow_run: { id: 777, repository_id: 1377602504, head_repository_id: 1377602504 } };
  return { base, manifest, plan, preflight, env, evidence, ledger, artifacts, receipt, github, apiCalls,
    putReceipt() { artifacts.push(structuredClone(receipt)); },
    setPreflight(value) { fs.writeFileSync(path.join(evidence, 'preflight.json'), JSON.stringify(value)); },
    setClaim(value) { fs.writeFileSync(path.join(evidence, 'claim.json'), JSON.stringify(value)); },
    dispose() { fs.rmSync(base, { recursive: true, force: true }); } };
}
async function withFixture(action) { const f = await fixture(); try { await action(f); } finally { f.dispose(); } }
async function reserve(f) { const result = fakeCore(); await reserveConsumption({ github: f.github, core: result.core, env: f.env, now }); return result.state; }
async function authorize(f) { const result = fakeCore(); await authorizeAfterReceipt({ github: f.github, core: result.core, env: f.env, now }); return result.state; }

test('release flags are active and only a complete synthetic preflight/claim/server receipt chain authorizes auth', async () => withFixture(async f => {
  assert.equal(POLICY.liveEnabled, true);
  const before = fs.readFileSync(f.ledger);
  const reservation = await reserve(f);
  assert.deepEqual(reservation.failed, []); assert.equal(reservation.outputs['live-enabled'], 'true');
  const noReceipt = await authorize(f); assert.equal(noReceipt.outputs['auth-authorized'], undefined);
  f.putReceipt(); const accepted = await authorize(f);
  assert.deepEqual(accepted.failed, []); assert.equal(accepted.outputs['auth-authorized'], 'true');
  assert.deepEqual(fs.readFileSync(f.ledger), before); assert.equal(fs.existsSync(f.ledger + '.lock'), false);
}));
test('unreviewed manifest, stale bytes pin, wrong caller/run and attempts are rejected before consumption', async () => {
  for (const mutate of [f => { const file = path.join(f.env.RUNNER_TEMP, 'controlled-model-control/approved-manifest.json');
    const m = { ...f.manifest, approved: false }; const bytes = Buffer.from(JSON.stringify(m)); fs.writeFileSync(file, bytes);
    f.plan.manifestSha256 = sha256(bytes); fs.writeFileSync(path.join(f.env.RUNNER_TEMP, 'controlled-model-control/plan.json'), JSON.stringify(f.plan)); },
    f => { fs.appendFileSync(path.join(f.env.RUNNER_TEMP, 'controlled-model-control/approved-manifest.json'), '\n'); },
    f => { f.env.GITHUB_SHA = '9'.repeat(40); }, f => { f.env.GITHUB_RUN_ID = '778'; }, f => { f.env.GITHUB_RUN_ATTEMPT = '2'; }])
    await withFixture(async f => { mutate(f); const r = await reserve(f); assert.equal(r.outputs['live-enabled'], undefined);
      assert.equal(r.failed.length, 1); assert.equal(fs.existsSync(path.join(f.evidence, 'claim.json')), false); });
});
test('spent or expired receipt history cannot reuse an initial checkpoint', async () => withFixture(async f => {
  f.receipt.expired = true; f.putReceipt(); const r = await reserve(f);
  assert.equal(r.outputs['live-enabled'], undefined); assert.deepEqual(r.failed, ['initial_checkpoint_history_exists']);
}));
test('missing, stale or mismatching preflight is rejected even with a valid-looking server receipt', async () => {
  for (const mutate of [f => fs.unlinkSync(path.join(f.evidence, 'preflight.json')),
    f => f.setPreflight({ ...f.preflight, case: 'A' }),
    f => f.setPreflight({ ...f.preflight, provenance: { ...f.preflight.provenance, harnessSha: '9'.repeat(40) } }),
    f => f.setPreflight({ ...f.preflight, ledger: { ...f.preflight.ledger, generationCallsReserved: 13 } }),
    f => f.setPreflight({ ...f.preflight, ledger: { ...f.preflight.ledger, uncertain: true } })])
    await withFixture(async f => { assert.deepEqual((await reserve(f)).failed, []); f.putReceipt(); mutate(f);
      const r = await authorize(f); assert.equal(r.outputs['auth-authorized'], undefined); assert.equal(r.failed.length, 1); });
});
test('missing, stale or augmented claim cannot authorize auth', async () => {
  for (const mutate of [f => fs.unlinkSync(path.join(f.evidence, 'claim.json')),
    f => { const claim = JSON.parse(fs.readFileSync(path.join(f.evidence, 'claim.json'))); f.setClaim({ ...claim, runId: '778' }); },
    f => { const claim = JSON.parse(fs.readFileSync(path.join(f.evidence, 'claim.json'))); f.setClaim({ ...claim, manifestSha256: '9'.repeat(64) }); },
    f => { const claim = JSON.parse(fs.readFileSync(path.join(f.evidence, 'claim.json'))); f.setClaim({ ...claim, arbitraryApproval: true }); }])
    await withFixture(async f => { assert.deepEqual((await reserve(f)).failed, []); f.putReceipt(); mutate(f);
      const r = await authorize(f); assert.equal(r.outputs['auth-authorized'], undefined); assert.equal(r.failed.length, 1); });
});
test('remote receipt duplicate/digest/run mismatches and unreadable history stay failclosed', async () => {
  for (const mutate of [f => f.artifacts.push({ ...f.receipt, id: 56 }), f => { f.artifacts[0].digest = 'sha256:' + '9'.repeat(64); },
    f => { f.artifacts[0].workflow_run.id = 778; }, f => { f.github.rest.actions.listArtifactsForRepo = async () => { throw new Error('Synthetic unavailable'); }; }])
    await withFixture(async f => { assert.deepEqual((await reserve(f)).failed, []); f.putReceipt(); mutate(f);
      const r = await authorize(f); assert.equal(r.outputs['auth-authorized'], undefined); assert.equal(r.failed.length, 1); });
});
test('a checkpoint changed or locked after preflight cannot authorize auth', async () => {
  for (const mutate of [f => fs.appendFileSync(f.ledger, '\n'), f => fs.writeFileSync(f.ledger + '.lock', '{}')])
    await withFixture(async f => { assert.deepEqual((await reserve(f)).failed, []); f.putReceipt(); mutate(f);
      const r = await authorize(f); assert.equal(r.outputs['auth-authorized'], undefined); assert.equal(r.failed.length, 1); });
});

test('auth rechecks native caller/run/attempt and exact claim binding after reservation', async () => {
  for (const mutate of [f => { f.env.GITHUB_SHA = '9'.repeat(40); }, f => { f.env.GITHUB_RUN_ID = '778'; },
    f => { f.env.GITHUB_RUN_ATTEMPT = '2'; },
    f => { const claim = JSON.parse(fs.readFileSync(path.join(f.evidence, 'claim.json'))); f.setClaim({ ...claim, pinnedWorkflowSha: '9'.repeat(40) }); }])
    await withFixture(async f => { assert.deepEqual((await reserve(f)).failed, []); f.putReceipt(); mutate(f);
      const r = await authorize(f); assert.equal(r.outputs['auth-authorized'], undefined); assert.equal(r.failed.length, 1); });
});
