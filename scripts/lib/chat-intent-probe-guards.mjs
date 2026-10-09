import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

// Retained only for the fixed read-only git queries below; never expose an arbitrary subprocess route.
const trustedReadOnlyExec = childProcess.execFileSync;

export class ProbeError extends Error {
  constructor(code) { super(code); this.name = 'ProbeError'; this.code = code; }
}
export const fail = code => { throw new ProbeError(code); };
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const LIMITS = Object.freeze({ modelCalls: 4, toolCalls: 8, deadlineMs: 90000, outputTokens: 1024,
  candidateCount: 1, sdkAttempts: 1, queryEmbeddings: 0, historicalCalls: 12, historicalEstimatedUsd: '0.0464555',
  cumulativeGenerationCap: 20, additionalGenerationCap: 8 });
export const LEDGER_ID = '2NTTY/child-ai-caregiver:chat-intent:20261008';
// A manifest identifier only, never a caller-selectable file path.
export const LIVE_LEDGER_RELATIVE_PATH = 'workflow-workspace:.controlled-model-state/live-ledger.json';
export const FIXTURE_TEXT = Object.freeze({ list: '幫我列出尚未完成的待辦',
  listB: '未完成待辦：\n• 檢查替換衣物\n• 整理出門袋', listA: '未完成待辦：\n• 檢查替換衣物',
  ambiguous: '那個幫我標成做完了', clarified: '整理出門袋那一項' });

// Install before importing the runtime. No outgoing request, socket, DNS lookup,
// subprocess, or worker is needed for synthetic offline runs.
export function denyOfflineNetwork() {
  const restore = [];
  const block = () => fail('offline_network_denied');
  const replace = (object, key) => {
    if (typeof object[key] !== 'function') return;
    const original = object[key]; object[key] = block; restore.push(() => { object[key] = original; });
  };
  replace(globalThis, 'fetch'); replace(globalThis, 'WebSocket'); replace(workerThreads, 'Worker');
  for (const object of [http, https]) for (const key of ['request', 'get']) replace(object, key);
  replace(http2, 'connect');
  for (const key of ['connect', 'createConnection']) replace(net, key);
  replace(net.Socket.prototype, 'connect'); replace(tls, 'connect');
  replace(dgram, 'createSocket');
  for (const object of [dns, dns.promises, dns.Resolver?.prototype, dns.promises?.Resolver?.prototype].filter(Boolean))
    for (const key of Object.getOwnPropertyNames(object)) if (/^(?:lookup|resolve|reverse)/u.test(key)) replace(object, key);
  for (const key of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) replace(childProcess, key);
  syncBuiltinESMExports();
  return () => { restore.reverse().forEach(fn => fn()); syncBuiltinESMExports(); };
}

export function validateManifest(manifest, options, env) {
  if (!options.live || env.YUBAN_SEMANTIC_PROBE_LIVE !== '1' || !manifest?.approved || !manifest.approvalRef)
    fail('live_gate_missing');
  if (manifest.schemaVersion !== 1 || manifest.repository !== '2NTTY/child-ai-caregiver'
    || !/^[0-9a-f]{40}$/u.test(manifest.testedSha ?? '')
    || !/^[0-9a-f]{40}$/u.test(manifest.harnessSha ?? '')
    || !/^[0-9a-f]{64}$/u.test(manifest.sourceTreeSha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(manifest.harnessTreeSha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(manifest.ledgerSha256 ?? '')
    || manifest.ledgerId !== LEDGER_ID || manifest.ledgerPath !== LIVE_LEDGER_RELATIVE_PATH
    || manifest.model !== 'gemini-3.1-flash-lite' || manifest.location !== 'global'
    || !['minimal', 'low', 'medium', 'high'].includes(manifest.serverThinkingLevel)
    || JSON.stringify(manifest.limits) !== JSON.stringify(LIMITS)
    || manifest.runId !== options.runId || manifest.case !== options.case
    || !['A', 'B', 'C'].includes(options.case)) fail('live_manifest_invalid');
  if (Object.keys(manifest).some(key => /token|credential|password|secret|api.?key/iu.test(key))) fail('manifest_secret_field_denied');
  return manifest;
}

export function hashTree(root, directories) {
  const files = [];
  const walk = relative => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail('source_symlink_denied');
    if (stat.isDirectory()) for (const entry of fs.readdirSync(absolute).sort()) walk(path.join(relative, entry));
    else if (stat.isFile()) files.push({ path: relative.split(path.sep).join('/'), sha256: sha256(fs.readFileSync(absolute)) });
  };
  for (const directory of directories) walk(directory);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { sha256: sha256(JSON.stringify(files)), files };
}

function hashEvent(event) { const { hash, ...payload } = event; return sha256(JSON.stringify(payload)); }
export function newOfflineLedger() {
  return { schemaVersion: 1, ledgerId: LEDGER_ID,
    baseline: { generationCalls: LIMITS.historicalCalls, estimatedUsd: LIMITS.historicalEstimatedUsd,
      description: 'Previously reported twelve generations; exact per-call usage is not reconstructed.' }, events: [] };
}
export function validateLedger(document) {
  if (document?.schemaVersion !== 1 || document.ledgerId !== LEDGER_ID
    || document.baseline?.generationCalls !== 12 || document.baseline?.estimatedUsd !== LIMITS.historicalEstimatedUsd
    || !Array.isArray(document.events)) fail('ledger_invalid');
  let previousHash = sha256(JSON.stringify({ schemaVersion: document.schemaVersion, ledgerId: document.ledgerId, baseline: document.baseline }));
  const runs = new Map(), reservations = new Map(); let calls = 12;
  for (const event of document.events) {
    if (event.previousHash !== previousHash || event.hash !== hashEvent(event)) fail('ledger_chain_invalid');
    previousHash = event.hash;
    if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(event.runId ?? '')) fail('ledger_invalid');
    if (event.type === 'run_started') {
      if (runs.has(event.runId) || [...runs.values()].some(run => run.status === 'running')) fail('ledger_run_reused');
      runs.set(event.runId, { status: 'running', calls: 0, case: event.case });
    } else if (event.type === 'reserved') {
      const run = runs.get(event.runId);
      if (!run || run.status !== 'running' || ++run.calls > 4 || ++calls > 20 || reservations.has(event.reservationId)) fail('ledger_cap_exceeded');
      reservations.set(event.reservationId, { runId: event.runId, state: 'reserved' });
    } else if (event.type === 'response' || event.type === 'unknown') {
      const reservation = reservations.get(event.reservationId);
      if (!reservation || reservation.runId !== event.runId || reservation.state !== 'reserved') fail('ledger_invalid');
      if (event.type === 'response' && !validUsage(event.usage)) fail('ledger_usage_unknown');
      reservation.state = event.type;
    } else if (event.type === 'run_finished') {
      const run = runs.get(event.runId);
      if (!run || run.status !== 'running' || !['completed', 'stopped'].includes(event.status)) fail('ledger_invalid');
      run.status = event.status;
    } else if (event.type !== 'gateway_outcome') fail('ledger_invalid');
  }
  if (calls - 12 > LIMITS.additionalGenerationCap) fail('ledger_cap_exceeded');
  return { previousHash, runs, reservations, calls,
    uncertain: [...reservations.values()].some(item => item.state !== 'response') };
}
export function validUsage(usage) {
  return usage && ['promptTokenCount', 'totalTokenCount'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
    && usage.totalTokenCount >= usage.promptTokenCount;
}
export function selectedUsage(value) {
  const output = {};
  for (const key of ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount'])
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) output[key] = value[key];
  return output;
}

// Live never bootstraps. An independently reviewed checkpoint must already exist
// at the one fixed path and match the approved manifest's restored artifact hash.
export function openLedger(filename, { expectedSha256, runId, caseId, offline = false }) {
  const directory = path.dirname(filename); let lockFd;
  try {
    if (!offline && (!fs.existsSync(filename) || fs.lstatSync(filename).isSymbolicLink())) fail('ledger_checkpoint_missing');
    if (!offline && !/^[0-9a-f]{64}$/u.test(expectedSha256 ?? '')) fail('ledger_checkpoint_hash_required');
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) fail('ledger_path_symlink_denied');
    if (offline) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    lockFd = fs.openSync(filename + '.lock', fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeSync(lockFd, JSON.stringify({ runId })); fs.fsyncSync(lockFd);
  } catch (error) { if (error instanceof ProbeError) throw error; fail('ledger_locked_or_unavailable'); }
  let document;
  const close = () => { if (lockFd !== undefined) { fs.closeSync(lockFd); lockFd = undefined; fs.unlinkSync(filename + '.lock'); } };
  const persist = () => {
    const temporary = filename + '.next'; let fd;
    try {
      fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeSync(fd, JSON.stringify(document) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, filename);
      const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY); try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } catch { if (fd !== undefined) fs.closeSync(fd); fail('ledger_persist_failed'); }
  };
  const append = payload => {
    const state = validateLedger(document);
    const event = { previousHash: state.previousHash, ...payload };
    document.events.push({ ...event, hash: hashEvent(event) });
    validateLedger(document); persist();
  };
  try {
    if (!fs.existsSync(filename)) { if (!offline) fail('ledger_checkpoint_missing'); document = newOfflineLedger(); persist(); }
    const bytes = fs.readFileSync(filename);
    if (bytes.length > 1024 * 1024) fail('ledger_invalid');
    if (expectedSha256 && sha256(bytes) !== expectedSha256) fail('ledger_checkpoint_hash_mismatch');
    document = JSON.parse(bytes);
    const state = validateLedger(document);
    if (state.uncertain || [...state.runs.values()].some(run => run.status === 'running')) fail('ledger_unknown_fail_closed');
    if (state.runs.has(runId)) fail('ledger_run_reused');
    if (state.calls >= 20) fail('ledger_cap_exceeded');
    append({ type: 'run_started', runId, case: caseId });
  } catch (error) { close(); if (error instanceof ProbeError) throw error; fail('ledger_invalid'); }
  let pending = null;
  return {
    reserve() {
      const state = validateLedger(document), run = state.runs.get(runId);
      if (pending || state.uncertain || run.calls >= 4 || state.calls >= 20) fail('ledger_unknown_or_cap');
      pending = `${runId}:${run.calls + 1}`;
      append({ type: 'reserved', runId, reservationId: pending });
      return true;
    },
    response(usage) {
      if (!pending) fail('ledger_invalid');
      const selected = selectedUsage(usage);
      append(validUsage(selected) ? { type: 'response', runId, reservationId: pending, usage: selected }
        : { type: 'unknown', runId, reservationId: pending, category: 'usage_missing' });
      pending = null;
    },
    unknown(category = 'provider_unknown') {
      if (pending) { append({ type: 'unknown', runId, reservationId: pending, category }); pending = null; }
    },
    outcome(outcome) { append({ type: 'gateway_outcome', runId, outcome: ['succeeded', 'invalid_response', 'timeout', 'unauthorized', 'unavailable', 'rate_limited'].includes(outcome) ? outcome : 'unknown' }); },
    finish(status) { if (pending) this.unknown('interrupted'); append({ type: 'run_finished', runId, status }); },
    snapshot: () => ({ generationCallsReserved: validateLedger(document).calls,
      additionalCallsReserved: validateLedger(document).calls - 12, historicalEstimatedUsd: LIMITS.historicalEstimatedUsd,
      uncertain: validateLedger(document).uncertain, checkpointSha256: sha256(fs.readFileSync(filename)) }),
    close,
  };
}

export function readVerifiedB(pathname, manifest) {
  if (!pathname || !manifest?.bContext || manifest.bContext.rootReviewed !== true) fail('case_c_requires_reviewed_b');
  const bytes = fs.readFileSync(pathname);
  if (sha256(bytes) !== manifest.bContext.evidenceSha256) fail('case_c_b_hash_mismatch');
  let value; try { value = JSON.parse(bytes); } catch { fail('case_c_b_invalid'); }
  if (value.schemaVersion !== 1 || value.mode !== 'live' || value.case !== 'B'
    || value.runId !== manifest.bContext.runId || value.provenance.testedSha !== manifest.testedSha
    || value.provenance.sourceTreeSha256 !== manifest.sourceTreeSha256
    || value.provenance.harnessTreeSha256 !== manifest.harnessTreeSha256
    || value.provenance.harnessSha !== manifest.harnessSha
    || value.provenance.model !== manifest.model || value.provenance.serverThinkingLevel !== manifest.serverThinkingLevel
    || value.mechanical?.status !== 'passed' || value.result?.status !== 'completed' || !value.result.visibleText?.trim()) fail('case_c_b_invalid');
  // Use the final actual Server-visible text byte for byte. No replacement question.
  return value.result.visibleText;
}

export function inspectLedgerCheckpoint(filename, { expectedSha256, runId }) {
  if (!fs.existsSync(filename) || fs.lstatSync(filename).isSymbolicLink()) fail('ledger_checkpoint_missing');
  if (fs.lstatSync(path.dirname(filename)).isSymbolicLink()) fail('ledger_path_symlink_denied');
  if (fs.existsSync(filename + '.lock') || fs.existsSync(filename + '.next')) fail('ledger_locked_or_unavailable');
  const bytes = fs.readFileSync(filename);
  if (bytes.length > 1024 * 1024 || sha256(bytes) !== expectedSha256) fail('ledger_checkpoint_hash_mismatch');
  let document; try { document = JSON.parse(bytes); } catch { fail('ledger_invalid'); }
  const state = validateLedger(document);
  if (state.uncertain || [...state.runs.values()].some(run => run.status === 'running')) fail('ledger_unknown_fail_closed');
  if (state.runs.has(runId)) fail('ledger_run_reused');
  if (state.calls >= 20) fail('ledger_cap_exceeded');
  return { generationCallsReserved: state.calls, additionalCallsReserved: state.calls - 12,
    checkpointSha256: sha256(bytes), uncertain: false, readOnly: true };
}
export function verifySeparatedRoots(trustedRoot, productRoot) {
  const trusted = fs.realpathSync(trustedRoot), supplied = path.resolve(productRoot);
  let tested; try { tested = fs.realpathSync(supplied); } catch { fail('product_root_unavailable'); }
  if (tested !== supplied || fs.lstatSync(supplied).isSymbolicLink()) fail('product_root_symlink_denied');
  if (trusted === tested || trusted.startsWith(tested + path.sep) || tested.startsWith(trusted + path.sep)) fail('trusted_and_product_root_overlap');
  return { trustedRoot: trusted, productRoot: tested };
}

export function readCleanCheckoutHead(directory) {
  const execute = args => {
    try { return trustedReadOnlyExec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
      { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim(); }
    catch { fail('live_clean_checkout_required'); }
  };
  const head = execute(['rev-parse', 'HEAD']);
  const dirty = execute(['status', '--porcelain', '--untracked-files=all']);
  if (!/^[0-9a-f]{40}$/u.test(head) || dirty) fail('live_clean_checkout_required');
  return head;
}

// This pin/context must come from the fixed upstream workflow's verified GitHub
// server run and Contents API lookup. They do not independently prove approval.
// Phase 1 has no complete trusted upstream; the CLI keeps the final connection
// gate closed even for schema-valid inputs.
export const LIVE_AUTHORITY_CONNECTED = false;
export function validateManifestAuthority(bytes, manifest, env) {
  const pin = env.YUBAN_SEMANTIC_PROBE_APPROVED_MANIFEST_SHA256;
  if (!/^[0-9a-f]{64}$/u.test(pin ?? '')) fail('live_manifest_authority_pin_missing');
  if (sha256(bytes) !== pin) fail('live_manifest_authority_pin_mismatch');
  let context;
  try { context = JSON.parse(env.YUBAN_SEMANTIC_PROBE_WORKFLOW_CONTEXT_JSON ?? ''); }
  catch { fail('live_workflow_context_missing'); }
  const keys = ['callerCommitSha', 'repository', 'repositoryId', 'ownerId', 'actorId', 'expectedBranch',
    'pinnedWorkflowSha', 'eventName', 'runAttempt'];
  // callerCommitSha is a dynamic origin verified by GitHub upstream. It must
  // not be embedded in a manifest committed by that very push.
  const expectedKeys = keys.filter(key => key !== 'callerCommitSha');
  if (!context || !manifest.expectedWorkflowContext || Object.keys(context).sort().join(',') !== [...keys].sort().join(',')
    || Object.keys(manifest.expectedWorkflowContext).sort().join(',') !== [...expectedKeys].sort().join(',')
    || !/^[0-9a-f]{40}$/u.test(context.callerCommitSha ?? '') || !/^[0-9a-f]{40}$/u.test(context.pinnedWorkflowSha ?? '')
    || context.pinnedWorkflowSha !== manifest.harnessSha || context.repository !== '2NTTY/child-ai-caregiver'
    || !['repositoryId', 'ownerId', 'actorId'].every(key => /^[1-9][0-9]{0,19}$/u.test(context[key] ?? ''))
    || !/^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/u.test(context.expectedBranch ?? '')
    || context.eventName !== 'push' || context.runAttempt !== 1
    || expectedKeys.some(key => context[key] !== manifest.expectedWorkflowContext[key])) fail('live_workflow_context_invalid');
  return { manifestSha256: pin, contextMatched: true, externalTrustRequired: true, liveAuthorityConnected: LIVE_AUTHORITY_CONNECTED };
}

export function deriveLiveLedgerPath(trustedRoot, productRoot) {
  const roots = verifySeparatedRoots(trustedRoot, productRoot);
  if (path.basename(roots.trustedRoot) !== 'trusted' || path.basename(roots.productRoot) !== 'product'
    || path.dirname(roots.trustedRoot) !== path.dirname(roots.productRoot)) fail('live_fixed_checkout_layout_required');
  const workspace = path.dirname(roots.trustedRoot), state = path.join(workspace, '.controlled-model-state');
  let stateStat; try { stateStat = fs.lstatSync(state); } catch { fail('ledger_state_directory_missing'); }
  if (stateStat.isSymbolicLink() || fs.realpathSync(state) !== state) fail('ledger_state_symlink_denied');
  if (!stateStat.isDirectory()) fail('ledger_state_directory_missing');
  if ([roots.trustedRoot, roots.productRoot].some(directory => state === directory || state.startsWith(directory + path.sep)
    || directory.startsWith(state + path.sep))) fail('ledger_state_checkout_overlap');
  const filename = path.join(state, 'live-ledger.json');
  let fileStat; try { fileStat = fs.lstatSync(filename); } catch (error) { if (error.code !== 'ENOENT') fail('ledger_path_unavailable'); }
  if (fileStat && (fileStat.isSymbolicLink() || fs.realpathSync(filename) !== filename)) fail('ledger_state_symlink_denied');
  return filename;
}
