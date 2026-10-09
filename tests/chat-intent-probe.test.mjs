import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import net from 'node:net';
import http from 'node:http';
import childProcess from 'node:child_process';
// Captured exclusively for root-authorized temporary local Git fixture setup.
// Commands below are fixed init/add/commit operations without network or hooks.
const offlineFixtureGit = childProcess.execFileSync;
// Captured only for the fixed local Node CLI below; its preload and preflight deny networking.
const offlineFixtureNode = childProcess.spawnSync;
import { ProbeError, LIMITS, LEDGER_ID, LIVE_LEDGER_RELATIVE_PATH, sha256, denyOfflineNetwork,
  validateManifest, newOfflineLedger, validateLedger, openLedger, readVerifiedB, inspectLedgerCheckpoint, verifySeparatedRoots,
  validateManifestAuthority, LIVE_AUTHORITY_CONNECTED, deriveLiveLedgerPath, readCleanCheckoutHead, hashTree } from '../scripts/lib/chat-intent-probe-guards.mjs';

// No test below starts a genuine live provider. The guard is installed before
// importing the actual production runtime/tools and stays installed throughout.
denyOfflineNetwork();
const { readAiConfig } = await import('../server/ai-config.ts');
const { runFixture, IDS, selectResponse } = await import('../scripts/lib/chat-intent-probe-fixture.mjs');
const { main } = await import('../scripts/verify-chat-intent-probe.mjs');
const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_MAX_ATTEMPTS: '1' });
const validManifest = () => ({ schemaVersion: 1, repository: '2NTTY/child-ai-caregiver', approved: true,
  approvalRef: 'synthetic-unit-test-not-an-authorization', testedSha: 'a'.repeat(40), harnessSha: 'e'.repeat(40), sourceTreeSha256: 'b'.repeat(64),
  harnessTreeSha256: 'c'.repeat(64), ledgerSha256: 'd'.repeat(64), ledgerId: LEDGER_ID,
  ledgerPath: LIVE_LEDGER_RELATIVE_PATH, model: 'gemini-3.1-flash-lite', location: 'global',
  serverThinkingLevel: 'minimal', limits: { ...LIMITS }, runId: 'unit_test_run_01', case: 'B' });
const options = { live: true, runId: 'unit_test_run_01', case: 'B' };
const isCode = code => error => error instanceof ProbeError && error.code === code;
const directories = [];
function filename() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-probe-')); directories.push(directory); return path.join(directory, 'ledger.json'); }
function initialCheckpoint(file) { fs.writeFileSync(file, JSON.stringify(newOfflineLedger()) + '\n', { mode: 0o600 }); return sha256(fs.readFileSync(file)); }
function ledger(file, runId = 'unit_ledger_run_01') { return openLedger(file, { offline: true, runId, caseId: 'B' }); }
test.after(() => { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }); });

test('offline refuses fetch, raw sockets, and HTTP before an outgoing request', async () => {
  assert.throws(() => fetch('https://synthetic.invalid'), isCode('offline_network_denied'));
  assert.throws(() => net.connect(443, 'synthetic.invalid'), isCode('offline_network_denied'));
  assert.throws(() => http.get('http://synthetic.invalid'), isCode('offline_network_denied'));
});
for (const gate of ['cli', 'env', 'manifest']) test(`live refuses missing ${gate} gate without provider construction`, () => {
  const manifest = validManifest(); if (gate === 'manifest') manifest.approved = false;
  assert.throws(() => validateManifest(manifest, { ...options, live: gate !== 'cli' },
    { YUBAN_SEMANTIC_PROBE_LIVE: gate === 'env' ? '' : '1' }), isCode('live_gate_missing'));
});
test('complete synthetic manifest validates only its mechanical schema', () => {
  assert.equal(validateManifest(validManifest(), options, { YUBAN_SEMANTIC_PROBE_LIVE: '1' }).serverThinkingLevel, 'minimal');
});
for (const [key, value] of [['testedSha', 'master'], ['model', 'another-model'], ['location', 'us-central1'],
  ['serverThinkingLevel', 'ultra'], ['ledgerPath', 'another-ledger.json'], ['ledgerId', 'another-account']])
  test(`live manifest rejects altered ${key}`, () => {
    assert.throws(() => validateManifest({ ...validManifest(), [key]: value }, options,
      { YUBAN_SEMANTIC_PROBE_LIVE: '1' }), isCode('live_manifest_invalid'));
  });
test('live manifest cannot raise per-run/cumulative budgets or SDK attempts', () => {
  for (const [key, value] of [['modelCalls', 5], ['toolCalls', 9], ['cumulativeGenerationCap', 21], ['sdkAttempts', 2], ['queryEmbeddings', 1]]) {
    const manifest = validManifest(); manifest.limits[key] = value;
    assert.throws(() => validateManifest(manifest, options, { YUBAN_SEMANTIC_PROBE_LIVE: '1' }), isCode('live_manifest_invalid'));
  }
});
test('live rejects absent checkpoint instead of bootstrapping twelve calls', () => {
  const file = filename();
  assert.throws(() => openLedger(file, { runId: 'live_missing_run', caseId: 'B' }), isCode('ledger_checkpoint_missing'));
  assert.equal(fs.existsSync(file), false);
});
test('restored checkpoint hash mismatch fails closed', () => {
  const file = filename(); initialCheckpoint(file);
  assert.throws(() => openLedger(file, { expectedSha256: '0'.repeat(64), runId: 'live_bad_checkpoint', caseId: 'B' }), isCode('ledger_checkpoint_hash_mismatch'));
});
test('reservation is durable before provider work and accounts for historical calls', () => {
  const file = filename(), state = ledger(file);
  try {
    assert.equal(state.reserve(), true);
    const document = JSON.parse(fs.readFileSync(file));
    assert.equal(document.events.at(-1).type, 'reserved'); assert.equal(validateLedger(document).calls, 13);
    state.response({ promptTokenCount: 9, totalTokenCount: 12 }); state.outcome('succeeded'); state.finish('completed');
    assert.equal(state.snapshot().uncertain, false); assert.equal(state.snapshot().historicalEstimatedUsd, '0.0464555');
  } finally { state.close(); }
});
test('concurrent process/checkpoint access is excluded by an exclusive lock', () => {
  const file = filename(), state = ledger(file);
  try { assert.throws(() => ledger(file, 'unit_second_process'), isCode('ledger_locked_or_unavailable')); }
  finally { state.finish('stopped'); state.close(); }
});
test('same run cannot restart even when its final outcome is known', () => {
  const file = filename(), state = ledger(file); state.finish('stopped'); state.close();
  assert.throws(() => ledger(file), isCode('ledger_run_reused'));
});
for (const fault of ['interrupted', 'unknown', 'missing_usage']) test(`ledger ${fault} is never treated as zero spend or retried`, () => {
  const file = filename(), state = ledger(file); state.reserve();
  if (fault === 'unknown') { state.unknown('provider_unknown'); state.finish('stopped'); }
  if (fault === 'missing_usage') { state.response({}); state.finish('stopped'); }
  state.close();
  assert.equal(validateLedger(JSON.parse(fs.readFileSync(file))).calls, 13);
  assert.throws(() => ledger(file, 'unit_after_unknown'), isCode('ledger_unknown_fail_closed'));
});
test('per-run fourth call and twenty cumulative generations are hard ceilings', () => {
  const file = filename();
  for (const runId of ['unit_cap_run_one', 'unit_cap_run_two']) {
    const state = ledger(file, runId);
    try {
      for (let index = 0; index < 4; index++) { state.reserve(); state.response({ promptTokenCount: 1, totalTokenCount: 2 }); }
      assert.throws(() => state.reserve(), isCode('ledger_unknown_or_cap')); state.finish('completed');
    } finally { state.close(); }
  }
  assert.equal(validateLedger(JSON.parse(fs.readFileSync(file))).calls, 20);
  assert.throws(() => ledger(file, 'unit_cap_run_three'), isCode('ledger_cap_exceeded'));
});
test('checkpoint event tampering is detected by the hash chain', () => {
  const file = filename(), state = ledger(file); state.finish('completed'); state.close();
  const document = JSON.parse(fs.readFileSync(file)); document.events[0].case = 'A';
  assert.throws(() => validateLedger(document), isCode('ledger_chain_invalid'));
});
test('thought bodies and opaque signature values never enter selected evidence', () => {
  const value = selectResponse({ finishReason: 'STOP', content: { role: 'model', parts: [
    { thought: true, text: 'DO_NOT_SAVE_THOUGHT', thoughtSignature: 'DO_NOT_SAVE_SIGNATURE' },
    { text: 'Synthetic visible text', thoughtSignature: 'DO_NOT_SAVE_SIGNATURE' },
    { functionCall: { name: 'present_answer', args: { kind: 'operation', paragraphs: [{ text: 'Synthetic visible text', citationIds: [] }] } }, thoughtSignature: 'DO_NOT_SAVE_SIGNATURE' }] },
    usageMetadata: { promptTokenCount: 1, totalTokenCount: 2, privateHeader: 'DO_NOT_SAVE_HEADER' } }, 1);
  const serialized = JSON.stringify(value);
  for (const excluded of ['DO_NOT_SAVE_THOUGHT', 'DO_NOT_SAVE_SIGNATURE', 'DO_NOT_SAVE_HEADER', 'thoughtSignature']) assert.equal(serialized.includes(excluded), false);
  assert.equal(value.parts[0].text, 'Synthetic visible text');
});
test('C refuses absent real B output and absent root review', () => {
  assert.throws(() => readVerifiedB(null, validManifest()), isCode('case_c_requires_reviewed_b'));
  assert.throws(() => readVerifiedB('/unused', { ...validManifest(), bContext: { rootReviewed: false } }), isCode('case_c_requires_reviewed_b'));
});
for (const [caseId, variant] of [['B', 'display'], ['B', 'proposal'], ['B', 'rejected_proposal'], ['A', 'display']]) {
  test(`real Runner/tools scripted ${caseId}/${variant} produce only a mechanical result`, async () => {
    const file = filename(), state = ledger(file);
    try {
      const result = await runFixture({ caseId, config, ledger: state, scriptedVariant: variant });
      state.finish(result.result.status === 'completed' ? 'completed' : 'stopped');
      assert.equal(result.semantic.status, 'root_review_required'); assert.equal(result.syntheticStateCounters.taskWrites, 0);
      assert.ok(result.taskInitialAndFinal.every(task => task.version === 1 && task.occurrence.state === 'scheduled'));
      assert.equal(result.actualReadContextResponses[0].tasks.length, caseId === 'A' ? 1 : 2);
      assert.equal(result.actualReadContextResponses[0].tasksHaveMore, false); assert.equal(result.actualReadContextResponses[0].nextTasksAfterId, null);
      assert.equal(result.actualReadContextResponses[0].uncoveredConversation.complete, true);
      assert.equal(result.mechanical.status, caseId === 'B' && variant !== 'display' ? 'failed' : 'passed');
      if (variant === 'rejected_proposal') {
        assert.equal(result.syntheticStateCounters.proposalWrites, 0); assert.equal(result.syntheticStateCounters.proposalAttempts, 1);
        assert.ok(result.result.tools.some(tool => tool.name === 'propose_task_change' && tool.status === 'conflict'));
      }
      if (caseId === 'A') {
        assert.equal(result.result.proposals[0].value.taskId, IDS.taskA); assert.equal(result.result.proposals[0].status, 'pending');
        assert.equal(result.result.proposals[0].result, null); assert.equal(result.mechanical.targetPendingOnly, true);
      }
    } finally { state.close(); }
  });
}

test('CLI missing live gates and an offline C cannot reach a provider or ledger', async () => {
  const previous = process.env.YUBAN_SEMANTIC_PROBE_LIVE; process.env.YUBAN_SEMANTIC_PROBE_LIVE = '';
  try {
    await assert.rejects(() => main(['--live', '--case', 'B', '--run-id', 'unit_cli_live_run', '--output', '/tmp/unit-probe-unused-output.json']), isCode('live_gate_missing'));
    await assert.rejects(() => main(['--offline', '--case', 'C']), isCode('offline_case_c_requires_verified_live_context'));
  } finally { if (previous === undefined) delete process.env.YUBAN_SEMANTIC_PROBE_LIVE; else process.env.YUBAN_SEMANTIC_PROBE_LIVE = previous; }
});
test('an offline C fixture cannot fabricate absent B display text', async () => {
  const file = filename(), state = ledger(file);
  try { await assert.rejects(() => runFixture({ caseId: 'C', config, ledger: state }), isCode('case_c_requires_reviewed_b')); }
  finally { state.finish('stopped'); state.close(); }
});
test('live checkpoint requires an approved expected hash even when a file exists', () => {
  const file = filename(); initialCheckpoint(file);
  assert.throws(() => openLedger(file, { runId: 'unit_no_hash_live', caseId: 'B' }), isCode('ledger_checkpoint_hash_required'));
});

test('dual roots reject overlap, nested checkouts, and symlink product selection', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-roots-')); directories.push(parent);
  const trusted = path.join(parent, 'trusted'), product = path.join(parent, 'product'); fs.mkdirSync(trusted); fs.mkdirSync(product);
  assert.deepEqual(verifySeparatedRoots(trusted, product), { trustedRoot: trusted, productRoot: product });
  assert.throws(() => verifySeparatedRoots(trusted, trusted), isCode('trusted_and_product_root_overlap'));
  const nested = path.join(trusted, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => verifySeparatedRoots(trusted, nested), isCode('trusted_and_product_root_overlap'));
  const link = path.join(parent, 'product-link'); fs.symlinkSync(product, link);
  assert.throws(() => verifySeparatedRoots(trusted, link), isCode('product_root_symlink_denied'));
});
test('readonly preflight checkpoint inspection does not initialize, reserve, or mutate', () => {
  const file = filename(), expectedSha256 = initialCheckpoint(file);
  const result = inspectLedgerCheckpoint(file, { expectedSha256, runId: 'unit_readonly_preflight' });
  assert.equal(result.readOnly, true); assert.equal(result.generationCallsReserved, 12);
  assert.equal(sha256(fs.readFileSync(file)), expectedSha256); assert.equal(fs.existsSync(file + '.lock'), false);
  assert.throws(() => inspectLedgerCheckpoint(file, { expectedSha256: '0'.repeat(64), runId: 'unit_readonly_preflight' }), isCode('ledger_checkpoint_hash_mismatch'));
});
test('live cannot use a tested checkout as its implicit harness', async () => {
  await assert.rejects(() => main(['--live', '--preflight', '--case', 'B', '--run-id', 'unit_implicit_product']), isCode('live_gate_missing'));
});
test('manifest authority requires a byte pin and exact fixed upstream context', () => {
  const manifest = validManifest();
  const context = { callerCommitSha: 'f'.repeat(40), repository: '2NTTY/child-ai-caregiver', repositoryId: '1',
    ownerId: '2', actorId: '3', expectedBranch: 'refs/heads/synthetic-unit-test', pinnedWorkflowSha: manifest.harnessSha,
    eventName: 'push', runAttempt: 1 };
  const { callerCommitSha: _dynamicOrigin, ...expected } = context;
  manifest.expectedWorkflowContext = expected;
  const bytes = Buffer.from(JSON.stringify(manifest)), pin = sha256(bytes);
  assert.throws(() => validateManifestAuthority(bytes, manifest, {}), isCode('live_manifest_authority_pin_missing'));
  assert.throws(() => validateManifestAuthority(bytes, manifest, { YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: '0'.repeat(64) }), isCode('live_manifest_authority_pin_mismatch'));
  const env = { YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: pin, YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify(context) };
  assert.equal(validateManifestAuthority(bytes, manifest, env).externalTrustRequired, true);
  assert.equal(validateManifestAuthority(bytes, manifest, env).liveAuthorityConnected, true); assert.equal(LIVE_AUTHORITY_CONNECTED, true);
  for (const changed of [{ actorId: '4' }, { runAttempt: 2 }, { eventName: 'workflow_dispatch' }, { pinnedWorkflowSha: '0'.repeat(40) }])
    assert.throws(() => validateManifestAuthority(bytes, manifest, { ...env, YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify({ ...context, ...changed }) }), isCode('live_workflow_context_invalid'));
});

test('release authority connection still rejects a fabricated mismatching caller identity before product evaluation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-authority-')); directories.push(directory);
  const manifest = validManifest();
  const context = { callerCommitSha: 'f'.repeat(40), repository: '2NTTY/child-ai-caregiver', repositoryId: '1', ownerId: '2', actorId: '3',
    expectedBranch: 'refs/heads/synthetic-unit-test', pinnedWorkflowSha: manifest.harnessSha, eventName: 'push', runAttempt: 1 };
  const { callerCommitSha: _dynamic, ...expected } = context; manifest.expectedWorkflowContext = expected;
  const bytes = Buffer.from(JSON.stringify(manifest));
  assert.throws(() => validateManifestAuthority(bytes, manifest, {
    YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: sha256(bytes),
    YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify({ ...context, actorId: '4' }),
  }), isCode('live_workflow_context_invalid'));
  assert.equal(LIVE_AUTHORITY_CONNECTED, true);
});

function makeCleanLocalGitFixture(directory) {
  fs.mkdirSync(directory);
  const env = { PATH: process.env.PATH, HOME: directory, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = args => offlineFixtureGit('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet', '--initial-branch=synthetic-offline-fixture', '--template=']);
  fs.writeFileSync(path.join(directory, 'synthetic.txt'), 'Offline Git fixture. No model or database.\n');
  git(['add', '--', 'synthetic.txt']);
  git(['-c', 'user.name=Offline synthetic fixture', '-c', 'user.email=fixture@synthetic.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Offline synthetic fixture']);
  return readCleanCheckoutHead(directory);
}
test('real temporary dual Git checkouts stay clean while sibling ledger locks/reserves/updates', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-dual-git-')); directories.push(workspace);
  const trusted = path.join(workspace, 'trusted'), product = path.join(workspace, 'product');
  const trustedSha = makeCleanLocalGitFixture(trusted), productSha = makeCleanLocalGitFixture(product);
  const stateDirectory = path.join(workspace, '.controlled-model-state'); fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const file = path.join(stateDirectory, 'live-ledger.json'), checkpointHash = initialCheckpoint(file);
  assert.equal(deriveLiveLedgerPath(trusted, product), file);
  const state = openLedger(file, { expectedSha256: checkpointHash, runId: 'unit_clean_dual_git', caseId: 'B' });
  try {
    assert.equal(fs.existsSync(file + '.lock'), true);
    assert.equal(readCleanCheckoutHead(trusted), trustedSha); assert.equal(readCleanCheckoutHead(product), productSha);
    state.reserve(); state.response({ promptTokenCount: 1, totalTokenCount: 2 }); state.outcome('succeeded');
    assert.equal(readCleanCheckoutHead(trusted), trustedSha); assert.equal(readCleanCheckoutHead(product), productSha);
    state.finish('completed');
  } finally { state.close(); }
  assert.equal(readCleanCheckoutHead(trusted), trustedSha); assert.equal(readCleanCheckoutHead(product), productSha);
  assert.notEqual(sha256(fs.readFileSync(file)), checkpointHash);
  const untracked = path.join(product, 'unexpected-untracked.txt'); fs.writeFileSync(untracked, 'Must not be silently ignored.');
  assert.throws(() => readCleanCheckoutHead(product), isCode('live_clean_checkout_required')); fs.unlinkSync(untracked);
  fs.writeFileSync(path.join(product, 'synthetic.txt'), 'Dirty product fixture.');
  assert.throws(() => readCleanCheckoutHead(product), isCode('live_clean_checkout_required'));
  assert.throws(() => deriveLiveLedgerPath(trusted, trusted), isCode('trusted_and_product_root_overlap'));
  const link = path.join(workspace, 'product-link'); fs.symlinkSync(product, link);
  assert.throws(() => deriveLiveLedgerPath(trusted, link), isCode('product_root_symlink_denied'));
});
test('live state path is fixed outside checkouts and rejects state symlink or arbitrary layout', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-state-layout-')); directories.push(workspace);
  const trusted = path.join(workspace, 'trusted'), product = path.join(workspace, 'product'); fs.mkdirSync(trusted); fs.mkdirSync(product);
  assert.throws(() => deriveLiveLedgerPath(trusted, product), isCode('ledger_state_directory_missing'));
  const elsewhere = path.join(workspace, 'elsewhere'); fs.mkdirSync(elsewhere);
  const state = path.join(workspace, '.controlled-model-state'); fs.symlinkSync(elsewhere, state);
  assert.throws(() => deriveLiveLedgerPath(trusted, product), isCode('ledger_state_symlink_denied'));
  fs.unlinkSync(state); fs.mkdirSync(state);
  const ledgerLink = path.join(state, 'live-ledger.json'); fs.symlinkSync(path.join(workspace, 'missing-ledger'), ledgerLink);
  assert.throws(() => deriveLiveLedgerPath(trusted, product), isCode('ledger_state_symlink_denied'));
  fs.unlinkSync(ledgerLink);
  const otherRoot = path.join(workspace, 'arbitrary-checkout'); fs.mkdirSync(otherRoot);
  assert.throws(() => deriveLiveLedgerPath(otherRoot, product), isCode('live_fixed_checkout_layout_required'));
  assert.equal(LIVE_LEDGER_RELATIVE_PATH, 'workflow-workspace:.controlled-model-state/live-ledger.json');
});

test('dynamic upstream caller origin avoids self-reference while missing/malformed origin still fails', () => {
  const manifest = validManifest();
  const context = { callerCommitSha: 'f'.repeat(40), repository: '2NTTY/child-ai-caregiver', repositoryId: '1', ownerId: '2', actorId: '3',
    expectedBranch: 'refs/heads/synthetic-unit-test', pinnedWorkflowSha: manifest.harnessSha, eventName: 'push', runAttempt: 1 };
  const { callerCommitSha: _origin, ...expected } = context; manifest.expectedWorkflowContext = expected;
  const bytes = Buffer.from(JSON.stringify(manifest));
  const env = { YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: sha256(bytes), YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify(context) };
  assert.equal(Object.hasOwn(manifest.expectedWorkflowContext, 'callerCommitSha'), false);
  assert.equal(validateManifestAuthority(bytes, manifest, env).contextMatched, true);
  assert.equal(validateManifestAuthority(bytes, manifest, { ...env,
    YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify({ ...context, callerCommitSha: 'a'.repeat(40) }) }).contextMatched, true);
  assert.equal(LIVE_AUTHORITY_CONNECTED, true);
  const { callerCommitSha: _missing, ...missingOrigin } = context;
  for (const invalid of [missingOrigin, { ...context, callerCommitSha: null }, { ...context, callerCommitSha: 'self-claimed-author' },
    { ...context, actorId: '4' }, { ...context, expectedBranch: 'refs/heads/other-branch' }, { ...context, repositoryId: '9' }])
    assert.throws(() => validateManifestAuthority(bytes, manifest, { ...env,
      YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify(invalid) }), isCode('live_workflow_context_invalid'));
});

function makeReadonlyCliFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-readonly-cli-')); directories.push(workspace);
  const trusted = path.join(workspace, 'trusted'), product = path.join(workspace, 'product');
  makeCleanLocalGitFixture(trusted); makeCleanLocalGitFixture(product);
  const sourceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  fs.mkdirSync(path.join(trusted, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(trusted, 'tests'));
  fs.copyFileSync(path.join(sourceRoot, 'scripts/verify-chat-intent-probe.mjs'), path.join(trusted, 'scripts/verify-chat-intent-probe.mjs'));
  fs.cpSync(path.join(sourceRoot, 'scripts/lib'), path.join(trusted, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'tests/chat-intent-probe.test.mjs'), path.join(trusted, 'tests/chat-intent-probe.test.mjs'));
  const marker = path.join(workspace, 'product-import-marker');
  for (const directory of ['server', 'src', 'prompts']) fs.mkdirSync(path.join(product, directory));
  for (const filename of ['agent-runtime.ts', 'product-agent.ts', 'product-agent-api.ts', 'family-access.ts', 'ai-config.ts', 'agent-model-gateway.ts'])
    fs.writeFileSync(path.join(product, 'server', filename), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected-product-import'); throw new Error('Product import forbidden in readonly preflight');\n`);
  for (const directory of ['src', 'prompts']) fs.writeFileSync(path.join(product, directory, 'synthetic.json'), '{}\n');
  fs.writeFileSync(path.join(product, 'package.json'), JSON.stringify({ name: 'synthetic-readonly-preflight', type: 'module',
    dependencies: { '@google/adk': '2.1.0', '@google/genai': '2.24.0' } }) + '\n');
  fs.writeFileSync(path.join(product, 'package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(product, '.gitignore'), 'node_modules/\n');
  // Reuse the already-verified installed SDK metadata without importing or installing a provider.
  for (const [name, version] of [['@google/adk', '2.1.0'], ['@google/genai', '2.24.0']]) {
    const directory = path.join(product, 'node_modules', name); fs.mkdirSync(directory, { recursive: true });
    const bytes = fs.readFileSync(path.join(sourceRoot, 'node_modules', name, 'package.json'));
    assert.equal(JSON.parse(bytes).version, version);
    fs.writeFileSync(path.join(directory, 'package.json'), bytes);
  }
  const env = { PATH: process.env.PATH, HOME: workspace, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', YUBAN_SEMANTIC_PROBE_LIVE: '1', GCP_PROJECT_ID: 'synthetic-project' };
  for (const directory of [trusted, product]) {
    const git = args => offlineFixtureGit('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['add', '--', '.']);
    git(['-c', 'user.name=Offline synthetic fixture', '-c', 'user.email=fixture@synthetic.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Readonly preflight fixture']);
  }
  const stateDirectory = path.join(workspace, '.controlled-model-state'); fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const ledgerPath = path.join(stateDirectory, 'live-ledger.json'), ledgerSha256 = initialCheckpoint(ledgerPath);
  const manifest = { ...validManifest(), testedSha: readCleanCheckoutHead(product), harnessSha: readCleanCheckoutHead(trusted),
    sourceTreeSha256: hashTree(product, ['server', 'src', 'prompts', 'package.json', 'package-lock.json']).sha256,
    harnessTreeSha256: hashTree(trusted, ['scripts/verify-chat-intent-probe.mjs', 'scripts/lib', 'tests/chat-intent-probe.test.mjs']).sha256,
    ledgerSha256, runId: 'unit_readonly_cli_preflight', gcpProject: 'synthetic-project', authentication: 'existing_adc' };
  const context = { callerCommitSha: 'f'.repeat(40), repository: '2NTTY/child-ai-caregiver', repositoryId: '1377602504',
    ownerId: '119132090', actorId: '119132090', expectedBranch: 'refs/heads/ci/controlled-model-acceptance',
    pinnedWorkflowSha: manifest.harnessSha, eventName: 'push', runAttempt: 1 };
  const { callerCommitSha: _origin, ...expected } = context; manifest.expectedWorkflowContext = expected;
  const manifestPath = path.join(workspace, 'synthetic-manifest.json');
  const observer = path.join(workspace, 'network-observer.mjs');
  // Property setters retain counters even when denyOfflineNetwork replaces native functions.
  fs.writeFileSync(observer, `import fs from 'node:fs';\nimport http from 'node:http';\nimport https from 'node:https';\nimport net from 'node:net';\nimport tls from 'node:tls';\nimport dns from 'node:dns';\nimport dgram from 'node:dgram';\nlet networkAttempts=0;\nconst observe=(object,key)=>{let current=object[key];if(typeof current!=='function')return;Object.defineProperty(object,key,{configurable:true,get(){return function(...args){networkAttempts++;return current.apply(this,args)}},set(value){current=value}})};\nobserve(globalThis,'fetch');for(const object of [http,https])for(const key of ['request','get'])observe(object,key);for(const key of ['connect','createConnection'])observe(net,key);observe(net.Socket.prototype,'connect');observe(tls,'connect');observe(dgram,'createSocket');for(const key of ['lookup','resolve','reverse'])observe(dns,key);\nprocess.on('exit',()=>fs.writeFileSync(process.env.SYNTHETIC_NETWORK_OBSERVER_OUTPUT,JSON.stringify({networkAttempts})));\n`);
  let invocation = 0;
  return { workspace, trusted, product, manifest, context, manifestPath, ledgerPath, marker,
    invoke(stage, change = () => {}, envChange = {}) {
      assert.equal(stage, 'preflight', 'Release unit fixtures must never invoke the live CLI');
      const document = structuredClone(manifest); change(document);
      const bytes = Buffer.from(JSON.stringify(document)); fs.writeFileSync(manifestPath, bytes, { mode: 0o600 });
      const observerOutput = path.join(workspace, `network-observer-${++invocation}.json`);
      const args = ['--import', observer, path.join(trusted, 'scripts/verify-chat-intent-probe.mjs'), '--live',
        '--preflight', '--case', 'B', '--run-id', document.runId,
        '--approved-manifest', manifestPath, '--product-root', product];
      const result = offlineFixtureNode(process.execPath, args, { cwd: trusted, env: { ...env,
        SYNTHETIC_NETWORK_OBSERVER_OUTPUT: observerOutput, YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: sha256(bytes),
        YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify(context), ...envChange }, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.error, undefined); assert.equal(result.stderr, '');
      return { exitCode: result.status, report: JSON.parse(result.stdout), network: JSON.parse(fs.readFileSync(observerOutput)) };
    } };
}

test('readonly CLI preflight passes real clean dual Git roots with zero product imports/network and unchanged ledger', () => {
  const fixture = makeReadonlyCliFixture(), before = fs.readFileSync(fixture.ledgerPath);
  const result = fixture.invoke('preflight');
  assert.equal(result.exitCode, 0); assert.equal(result.report.status, 'passed'); assert.equal(result.report.mode, 'preflight');
  assert.equal(result.report.productImported, false); assert.equal(result.report.networkRequests, 0);
  assert.deepEqual(result.network, { networkAttempts: 0 }); assert.equal(fs.existsSync(fixture.marker), false);
  assert.equal(result.report.ledger.generationCallsReserved, 12); assert.equal(result.report.ledger.additionalCallsReserved, 0);
  assert.equal(result.report.ledger.readOnly, true); assert.deepEqual(fs.readFileSync(fixture.ledgerPath), before);
  assert.equal(fs.existsSync(fixture.ledgerPath + '.lock'), false); assert.equal(fs.existsSync(fixture.ledgerPath + '.next'), false);
  assert.equal(readCleanCheckoutHead(fixture.trusted), fixture.manifest.harnessSha);
  assert.equal(readCleanCheckoutHead(fixture.product), fixture.manifest.testedSha); assert.equal(LIVE_AUTHORITY_CONNECTED, true);
});
test('readonly CLI preflight retains manifest limits, bytes pin, identity and source hash rejection', () => {
  const fixture = makeReadonlyCliFixture(), before = fs.readFileSync(fixture.ledgerPath);
  const cases = [
    [document => { document.limits.modelCalls = 5; }, {}, 'live_manifest_invalid'],
    [() => {}, { YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256: '0'.repeat(64) }, 'live_manifest_authority_pin_mismatch'],
    [() => {}, { YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON: JSON.stringify({ ...fixture.context, actorId: '1' }) }, 'live_workflow_context_invalid'],
    [document => { document.sourceTreeSha256 = '0'.repeat(64); }, {}, 'live_source_provenance_mismatch'],
  ];
  for (const [change, env, category] of cases) {
    const result = fixture.invoke('preflight', change, env);
    assert.equal(result.exitCode, 1); assert.equal(result.report.errorCategory, category);
    assert.deepEqual(result.network, { networkAttempts: 0 }); assert.equal(fs.existsSync(fixture.marker), false);
    assert.deepEqual(fs.readFileSync(fixture.ledgerPath), before);
  }
});
