'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { pathToFileURL } = require('node:url');

const POLICY = Object.freeze({ repository: '2NTTY/child-ai-caregiver', repositoryId: '1377602504',
  ownerId: '119132090', actorId: '119132090', branch: 'ci/controlled-model-acceptance',
  ref: 'refs/heads/ci/controlled-model-acceptance', callerPath: '.github/workflows/controlled-model-acceptance.yml',
  reusablePath: '2NTTY/child-ai-caregiver/.github/workflows/run-controlled-model-acceptance.yml',
  initialPath: '.github/controlled-model/initial-live-ledger.json',
  initialSha256: '362234b5ec21080e53220d35b00f1dc70f29098aa66e16ad43ae9944b0b95106',
  inspectedSha: '94f7c7b260c46b033a970ec92d3125e31f20442c', expiryCeiling: '2026-10-10T00:00:00Z',
  archiveMaximum: 2097152, ledgerMaximum: 1048576, evidenceMaximum: 524288, logMaximum: 65536,
  liveEnabled: true });
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = category => { const error = new Error(category); error.category = category; throw error; };
const exactKeys = (object, names) => object && !Array.isArray(object) && typeof object === 'object'
  && Object.keys(object).sort().join(',') === [...names].sort().join(',');
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
function readBytes(filename, maximum) {
  let stat; try { stat = fs.lstatSync(filename); } catch { fail('file_unavailable'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) fail('file_unsafe');
  return fs.readFileSync(filename);
}
function readJson(filename, maximum = POLICY.evidenceMaximum) {
  try { return JSON.parse(readBytes(filename, maximum)); } catch (error) { if (error.category) throw error; fail('json_invalid'); }
}
function writeJson(filename, value) {
  const bytes = canonical(value) + '\n';
  if (Buffer.byteLength(bytes) > POLICY.evidenceMaximum) fail('evidence_size_exceeded');
  const fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return sha256(bytes);
}
function paths(env = process.env) {
  if (!path.isAbsolute(env.GITHUB_WORKSPACE ?? '') || !path.isAbsolute(env.RUNNER_TEMP ?? '')) fail('workspace_invalid');
  const workspace = fs.realpathSync(env.GITHUB_WORKSPACE), temp = fs.realpathSync(env.RUNNER_TEMP);
  if (workspace !== env.GITHUB_WORKSPACE || temp !== env.RUNNER_TEMP) fail('workspace_symlink_denied');
  return { workspace, temp, trusted: path.join(workspace, 'trusted'), product: path.join(workspace, 'product'),
    state: path.join(workspace, '.controlled-model-state'), control: path.join(temp, 'controlled-model-control'),
    evidence: path.join(temp, 'controlled-model-evidence'), download: path.join(temp, 'controlled-model-download') };
}
function planFrom(env) { const p = paths(env); return { p, plan: readJson(path.join(p.control, 'plan.json'), 16384) }; }
function cleanHead(directory) {
  if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory) !== directory) fail('checkout_path_invalid');
  try {
    const head = childProcess.execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
    const dirty = childProcess.execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=all'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
    if (!sha(head) || dirty) fail('checkout_not_clean'); return head;
  } catch (error) { if (error.category) throw error; fail('checkout_unavailable'); }
}
function hashTree(root, entries) {
  const files = [];
  const walk = relative => {
    const stat = fs.lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) fail('source_symlink_denied');
    if (stat.isDirectory()) for (const item of fs.readdirSync(path.join(root, relative)).sort()) walk(path.join(relative, item));
    else if (stat.isFile()) files.push({ path: relative.split(path.sep).join('/'), sha256: sha256(fs.readFileSync(path.join(root, relative))) });
    else fail('source_type_denied');
  };
  for (const entry of entries) walk(entry);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { sha256: sha256(JSON.stringify(files)), files };
}
function inspectSources(p, plan) {
  const trustedHead = cleanHead(p.trusted), productHead = cleanHead(p.product);
  if (trustedHead !== plan.trustedSha || productHead !== plan.testedSha) fail('checkout_sha_mismatch');
  const source = hashTree(p.product, ['server', 'src', 'prompts', 'package.json', 'package-lock.json']);
  const harness = hashTree(p.trusted, ['scripts/verify-chat-intent-probe.mjs', 'scripts/lib', 'tests/chat-intent-probe.test.mjs']);
  const pkg = readJson(path.join(p.product, 'package.json'), 65536);
  return { schemaVersion: 1, mode: 'inspect-source', status: 'measured_root_review_required',
    productImported: false, modelCalls: 0, googleAuthentication: false, checkpointConsumed: false,
    testedSha: productHead, harnessSha: trustedHead, sourceTreeSha256: source.sha256, harnessTreeSha256: harness.sha256,
    hashAlgorithm: 'SHA256(JSON.stringify(path+sha256 records sorted by path.localeCompare(en)))',
    sourceEntries: ['server', 'src', 'prompts', 'package.json', 'package-lock.json'],
    harnessEntries: ['scripts/verify-chat-intent-probe.mjs', 'scripts/lib', 'tests/chat-intent-probe.test.mjs'],
    selectedFiles: Object.fromEntries(['package.json', 'package-lock.json'].map(file => [file, sha256(readBytes(path.join(p.product, file), 2097152))])),
    selectedGitBlobShas: Object.fromEntries(['package.json', 'package-lock.json'].map(file => {
      const value = childProcess.execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', `HEAD:${file}`],
        { cwd: p.product, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
      if (!sha(value)) fail('selected_blob_unavailable'); return [file, value];
    })),
    selectedDependencies: Object.fromEntries(['@google/adk', '@google/genai'].map(name => [name, pkg.dependencies?.[name] ?? null])),
    semantic: { status: 'root_review_required' } };
}
function validateManifest(manifest, plan, now = Date.now()) {
  const limits = { modelCalls: 4, toolCalls: 8, deadlineMs: 90000, outputTokens: 1024, candidateCount: 1, sdkAttempts: 1, queryEmbeddings: 0, historicalCalls: 12, historicalEstimatedUsd: '0.0464555', cumulativeGenerationCap: 20, additionalGenerationCap: 8 };
  if (manifest?.schemaVersion !== 1 || manifest.approved !== true || typeof manifest.approvalRef !== 'string'
    || !manifest.approvalRef || manifest.approvalRef.length > 512 || manifest.model !== 'gemini-3.1-flash-lite'
    || manifest.location !== 'global' || !['minimal', 'low', 'medium', 'high'].includes(manifest.serverThinkingLevel)
    || canonical(manifest.limits) !== canonical(limits)) fail('manifest_limits_or_approval_missing');
  const context = { repository: POLICY.repository, repositoryId: POLICY.repositoryId, ownerId: POLICY.ownerId,
    actorId: POLICY.actorId, expectedBranch: POLICY.ref, pinnedWorkflowSha: plan.trustedSha, eventName: 'push', runAttempt: 1 };
  if (!manifest || !sha(manifest.testedSha) || manifest.harnessSha !== plan.trustedSha
    || !hash(manifest.sourceTreeSha256) || !hash(manifest.harnessTreeSha256) || !hash(manifest.packageLockSha256)
    || !hash(manifest.ledgerSha256) || manifest.runId !== plan.request.requestId || manifest.repository !== POLICY.repository
    || !exactKeys(manifest.expectedWorkflowContext, Object.keys(context))
    || canonical(manifest.expectedWorkflowContext) !== canonical(context)
    || !exactKeys(plan.workflowContext, ['callerCommitSha', ...Object.keys(context)]) || !sha(plan.workflowContext.callerCommitSha)
    || canonical(Object.fromEntries(Object.keys(context).map(k => [k, plan.workflowContext[k]]))) !== canonical(context)) fail('manifest_identity_invalid');
  const expires = Date.parse(manifest.expiresAt);
  if (typeof manifest.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(manifest.expiresAt)
    || !Number.isFinite(expires) || expires <= now || expires > Date.parse(POLICY.expiryCeiling)) fail('manifest_expired_or_unbounded');
  if (manifest.gcpProject !== 'ai-caregivers-for-children' || manifest.authentication !== 'existing_adc'
    || manifest.ledgerId !== '2NTTY/child-ai-caregiver:chat-intent:20261008'
    || manifest.ledgerPath !== 'workflow-workspace:.controlled-model-state/live-ledger.json'
    || !['A', 'B', 'C'].includes(manifest.case)) fail('manifest_scope_invalid');
  const c = manifest.checkpointSource;
  if (c?.type === 'initial') {
    if (!exactKeys(c, ['type', 'path', 'sha256']) || c.path !== POLICY.initialPath || c.sha256 !== POLICY.initialSha256
      || manifest.ledgerSha256 !== POLICY.initialSha256) fail('initial_checkpoint_unapproved');
  } else if (c?.type === 'artifact') {
    if (!exactKeys(c, ['type', 'repository', 'runId', 'runAttempt', 'workflowSha', 'artifactId', 'artifactName', 'artifactDigest', 'ledgerSha256'])
      || c.repository !== POLICY.repository || !id(c.runId) || c.runAttempt !== 1 || !sha(c.workflowSha) || !id(c.artifactId)
      || c.artifactName !== `controlled-model-evidence-${c.runId}-1` || !digest(c.artifactDigest)
      || c.ledgerSha256 !== manifest.ledgerSha256) fail('artifact_checkpoint_invalid');
  } else fail('checkpoint_source_required');
  if (!Array.isArray(manifest.requiredReceipts) || manifest.requiredReceipts.length > 8
    || c.type === 'artifact' && (!manifest.requiredReceipts.length || !manifest.requiredReceipts.some(r => r.runId === c.runId))
    || c.type === 'initial' && manifest.requiredReceipts.length !== 0) fail('receipt_history_required');
  const names = new Set(), ids = new Set();
  for (const receipt of manifest.requiredReceipts) {
    if (!exactKeys(receipt, ['artifactId', 'name', 'runId', 'runAttempt', 'digest', 'ledgerSha256'])
      || !id(receipt.artifactId) || !id(receipt.runId) || receipt.runAttempt !== 1 || !digest(receipt.digest)
      || !hash(receipt.ledgerSha256) || receipt.name !== `controlled-model-consumed-${receipt.ledgerSha256}`
      || names.has(receipt.name) || ids.has(receipt.artifactId)) fail('receipt_history_invalid');
    names.add(receipt.name); ids.add(receipt.artifactId);
  }
  return manifest;
}
async function listAllArtifacts(github) {
  const artifacts = [], ids = new Set(); let expected = null;
  for (let page = 1; page <= 1000; page++) {
    let response; try { response = await github.rest.actions.listArtifactsForRepo({ owner: '2NTTY', repo: 'child-ai-caregiver', per_page: 100, page }); }
    catch { fail('artifact_listing_unavailable'); }
    const d = response.data;
    if (!Number.isSafeInteger(d?.total_count) || d.total_count < 0 || !Array.isArray(d.artifacts) || d.artifacts.length > 100
      || expected !== null && d.total_count !== expected) fail('artifact_listing_incomplete');
    expected = d.total_count;
    for (const item of d.artifacts) {
      if (!Number.isSafeInteger(item?.id) || ids.has(item.id)) fail('artifact_listing_duplicate');
      ids.add(item.id); artifacts.push(item);
    }
    if (d.artifacts.length < 100 || artifacts.length === expected) {
      if (artifacts.length !== expected) fail('artifact_listing_incomplete'); return artifacts;
    }
  }
  fail('artifact_listing_incomplete');
}
function validateArtifactMetadata(artifact, expected, runId) {
  if (!artifact || String(artifact.id) !== expected.artifactId || artifact.name !== (expected.artifactName ?? expected.name)
    || artifact.digest !== (expected.artifactDigest ?? expected.digest) || artifact.expired !== false
    || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > POLICY.archiveMaximum
    || String(artifact.workflow_run?.id) !== runId || String(artifact.workflow_run?.repository_id) !== POLICY.repositoryId
    || String(artifact.workflow_run?.head_repository_id) !== POLICY.repositoryId) fail('artifact_provenance_invalid');
}
async function verifyArtifactHistory(github, manifest, plan, { requireUnused = true } = {}) {
  const artifacts = await listAllArtifacts(github);
  if (manifest.checkpointSource.type === 'initial' && artifacts.some(a => typeof a.name === 'string'
    && a.name.startsWith('controlled-model-consumed-')
    && (requireUnused || a.name !== `controlled-model-consumed-${manifest.ledgerSha256}`))) fail('initial_checkpoint_history_exists');
  for (const receipt of manifest.requiredReceipts) {
    const matches = artifacts.filter(a => a.name === receipt.name);
    if (matches.length !== 1) fail('known_receipt_missing_or_duplicate');
    validateArtifactMetadata(matches[0], receipt, receipt.runId);
  }
  const consumed = artifacts.filter(a => a.name === `controlled-model-consumed-${manifest.ledgerSha256}`);
  if (requireUnused && consumed.length) fail('checkpoint_already_consumed');
  const c = manifest.checkpointSource;
  if (c.type === 'artifact') {
    const matches = artifacts.filter(a => String(a.id) === c.artifactId || a.name === c.artifactName);
    if (matches.length !== 1) fail('checkpoint_artifact_missing_or_duplicate');
    validateArtifactMetadata(matches[0], c, c.runId);
    let run; try { run = (await github.rest.actions.getWorkflowRun({ owner: '2NTTY', repo: 'child-ai-caregiver', run_id: Number(c.runId) })).data; }
    catch { fail('checkpoint_run_unavailable'); }
    if (String(run.id) !== c.runId || run.run_attempt !== 1 || run.status !== 'completed'
      || !['success', 'failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion)
      || run.event !== 'push' || run.head_branch !== POLICY.branch || run.path !== POLICY.callerPath
      || String(run.actor?.id) !== POLICY.actorId || String(run.triggering_actor?.id) !== POLICY.actorId
      || String(run.repository?.id) !== POLICY.repositoryId || String(run.repository?.owner?.id) !== POLICY.ownerId
      || !Array.isArray(run.referenced_workflows) || run.referenced_workflows.length !== 1
      || run.referenced_workflows[0].sha !== c.workflowSha
      || run.referenced_workflows[0].path !== `${POLICY.reusablePath}@${c.workflowSha}`
      || run.id === Number(plan.githubRunId)) fail('checkpoint_run_provenance_invalid');
  }
  return artifacts;
}
async function prepare({ github, core, env = process.env, now = Date.now() }) {
  try {
    const { p, plan } = planFrom(env);
    plan.githubRunId = env.GITHUB_RUN_ID;
    if (plan.request.mode === 'inspect-source') {
      if (plan.testedSha !== POLICY.inspectedSha) fail('inspect_revision_unapproved');
      const report = inspectSources(p, plan); writeJson(path.join(p.evidence, 'inspection.json'), report);
      core.info(`CONTROLLED_INSPECTION_JSON ${canonical(report)}`); core.setOutput('inspected', 'true'); return;
    }
    if (!['preflight', 'live'].includes(plan.request.mode)) fail('prepare_mode_invalid');
    const bytes = readBytes(path.join(p.control, 'approved-manifest.json'), 16384);
    if (sha256(bytes) !== plan.manifestSha256) fail('manifest_bytes_pin_mismatch');
    const manifest = validateManifest(JSON.parse(bytes), plan, now);
    const report = inspectSources(p, plan);
    if (report.sourceTreeSha256 !== manifest.sourceTreeSha256 || report.harnessTreeSha256 !== manifest.harnessTreeSha256
      || report.selectedFiles['package-lock.json'] !== manifest.packageLockSha256) fail('source_or_lock_hash_mismatch');
    await verifyArtifactHistory(github, manifest, plan);
    const restore = { schemaVersion: 1, ledgerSha256: manifest.ledgerSha256, checkpointSource: manifest.checkpointSource,
      runId: manifest.runId, case: manifest.case, expiresAt: manifest.expiresAt };
    writeJson(path.join(p.control, 'restore-plan.json'), restore);
    core.setOutput('checkpoint-type', manifest.checkpointSource.type);
    if (manifest.checkpointSource.type === 'artifact') {
      core.setOutput('artifact-id', manifest.checkpointSource.artifactId);
      core.setOutput('previous-run-id', manifest.checkpointSource.runId);
      core.setOutput('artifact-digest', manifest.checkpointSource.artifactDigest);
    }
    core.setOutput('prepared', 'true');
  } catch (error) { core.setFailed(error.category ?? 'preparation_error_redacted'); }
}
function validateRunnerOrigin(plan, env) {
  if (!id(env.GITHUB_RUN_ID) || env.GITHUB_RUN_ATTEMPT !== '1' || !sha(env.GITHUB_SHA)
    || plan.githubRunId !== env.GITHUB_RUN_ID || plan.workflowContext.callerCommitSha !== env.GITHUB_SHA) fail('runner_origin_mismatch');
}
async function revalidatePreflightAndClaim(p, plan, manifest, env) {
  const preflight = readJson(path.join(p.evidence, 'preflight.json'));
  const provenance = { testedSha: manifest.testedSha, harnessSha: manifest.harnessSha,
    sourceTreeSha256: manifest.sourceTreeSha256, harnessTreeSha256: manifest.harnessTreeSha256 };
  if (preflight.schemaVersion !== 1 || preflight.mode !== 'preflight' || preflight.status !== 'passed'
    || preflight.productImported !== false || preflight.networkRequests !== 0
    || preflight.runId !== manifest.runId || preflight.case !== manifest.case
    || !exactKeys(preflight.provenance, Object.keys(provenance))
    || canonical(preflight.provenance) !== canonical(provenance)) fail('preflight_pass_required');
  const { inspectLedgerCheckpoint } = await import(pathToFileURL(path.join(p.trusted, 'scripts/lib/chat-intent-probe-guards.mjs')).href);
  const checkpoint = inspectLedgerCheckpoint(path.join(p.state, 'live-ledger.json'),
    { expectedSha256: manifest.ledgerSha256, runId: manifest.runId });
  if (!exactKeys(preflight.ledger, Object.keys(checkpoint)) || canonical(preflight.ledger) !== canonical(checkpoint)
    || 20 - checkpoint.generationCallsReserved <= 0 || checkpoint.uncertain !== false) fail('preflight_checkpoint_stale');
  const claim = readJson(path.join(p.evidence, 'claim.json'));
  const expected = { schemaVersion: 1, status: 'reserved_before_auth', ledgerSha256: manifest.ledgerSha256,
    requestId: plan.request.requestId, runId: env.GITHUB_RUN_ID, runAttempt: 1,
    manifestSha256: plan.manifestSha256, testedSha: manifest.testedSha, pinnedWorkflowSha: plan.trustedSha };
  if (!exactKeys(claim, Object.keys(expected)) || canonical(claim) !== canonical(expected)) fail('consumption_claim_stale_or_missing');
}
async function reserveConsumption({ github, core, env = process.env, now = Date.now() }) {
  try {
    if (!POLICY.liveEnabled) fail('live_disabled_pending_root_review');
    const { p, plan } = planFrom(env);
    if (plan.request.mode !== 'live') fail('live_request_required');
    validateRunnerOrigin(plan, env);
    const bytes = readBytes(path.join(p.control, 'approved-manifest.json'), 16384);
    if (sha256(bytes) !== plan.manifestSha256) fail('manifest_bytes_pin_mismatch');
    const manifest = validateManifest(JSON.parse(bytes), plan, now);
    const preflight = readJson(path.join(p.evidence, 'preflight.json'));
    if (preflight.mode !== 'preflight' || preflight.status !== 'passed' || preflight.productImported !== false
      || preflight.networkRequests !== 0 || preflight.runId !== manifest.runId) fail('preflight_pass_required');
    await verifyArtifactHistory(github, manifest, plan);
    const claim = { schemaVersion: 1, status: 'reserved_before_auth', ledgerSha256: manifest.ledgerSha256,
      requestId: plan.request.requestId, runId: env.GITHUB_RUN_ID, runAttempt: 1,
      manifestSha256: plan.manifestSha256, testedSha: manifest.testedSha, pinnedWorkflowSha: plan.trustedSha };
    writeJson(path.join(p.evidence, 'claim.json'), claim);
    core.setOutput('consumption-name', `controlled-model-consumed-${manifest.ledgerSha256}`);
    core.setOutput('live-enabled', 'true');
  } catch (error) { core.setFailed(error.category ?? 'consumption_error_redacted'); }
}
async function authorizeAfterReceipt({ github, core, env = process.env, now = Date.now() }) {
  try {
    if (!POLICY.liveEnabled) fail('live_disabled_pending_root_review');
    const { p, plan } = planFrom(env);
    const bytes = readBytes(path.join(p.control, 'approved-manifest.json'), 16384);
    if (sha256(bytes) !== plan.manifestSha256 || plan.request.mode !== 'live') fail('manifest_bytes_pin_mismatch');
    const manifest = validateManifest(JSON.parse(bytes), plan, now);
    validateRunnerOrigin(plan, env);
    await revalidatePreflightAndClaim(p, plan, manifest, env);
    if (!id(env.CONTROLLED_RECEIPT_ID) || !digest(env.CONTROLLED_RECEIPT_DIGEST)) fail('receipt_upload_not_verified');
    const artifacts = await verifyArtifactHistory(github, manifest, plan, { requireUnused: false });
    const receipts = artifacts.filter(a => a.name === `controlled-model-consumed-${manifest.ledgerSha256}`);
    if (receipts.length !== 1) fail('receipt_upload_not_verified');
    validateArtifactMetadata(receipts[0], { artifactId: env.CONTROLLED_RECEIPT_ID,
      name: `controlled-model-consumed-${manifest.ledgerSha256}`, digest: env.CONTROLLED_RECEIPT_DIGEST }, env.GITHUB_RUN_ID);
    core.setOutput('auth-authorized', 'true');
  } catch (error) { core.setFailed(error.category ?? 'receipt_verification_error_redacted'); }
}

module.exports = { POLICY, canonical, sha256, fail, exactKeys, paths, planFrom, readBytes, readJson, writeJson,
  cleanHead, hashTree, inspectSources, validateManifest, listAllArtifacts, validateArtifactMetadata,
  verifyArtifactHistory, prepare, reserveConsumption, authorizeAfterReceipt, validateRunnerOrigin, revalidatePreflightAndClaim };
