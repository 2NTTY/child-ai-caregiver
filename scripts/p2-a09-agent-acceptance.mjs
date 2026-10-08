import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, stat, realpath, copyFile, chmod } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';

// Syntax checking loads no product modules and makes no runtime connection.
// A stopped batch is preserved, never automatically retried; main reviews before cleanup.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assignedRepository = 'C:/Users/2NTTY/.codex/worktrees/p2-a09-stable-delivery/孩子ai护工';
const privateRoot = 'C:/Users/2NTTY/.codex/p2-a09-local';
const accountRoot = 'C:/Users/2NTTY/.codex/p2-a08-local';
const keyFile = 'C:/Users/2NTTY/.codex/s05-local-storage-keys/storage.key';
const adcFile = 'C:/Users/2NTTY/AppData/Roaming/gcloud/application_default_credentials.json';
const caseFile = resolve(repository, 'artifacts/verification/P2_A09_AGENT_CASE.json');
const resultFile = resolve(repository, 'artifacts/verification/P2_A09_AGENT_RUN.json');
const fixtureFile = privateRoot + '/a09-fixture.enc';
const evidenceFile = privateRoot + '/a09-private.enc';
const fixtureAad = 'p2-a09:fixture:1', evidenceAad = 'p2-a09:evidence:1';
const limits = Object.freeze({ runs: 5, modelCalls: 12, queryEmbeddings: 6, sharedAttempts: 12, businessCalls: 55 });
const counters = { businessCalls: 0, sqlReads: 0, runs: 0, poolRebuilds: 0, generationRequests: 0, embeddingRequests: 0, adcRequests: 0, blockedNetwork: 0, suppressedLogs: 0 };
const evidence = { schema: 1, cases: [], checks: [], usage: [], restart: null };
let pool, cipher, account, auth, services, chat, records, documents, apiHandler, applyPatch, config, serverConfig;
let fixture, caseData, caseHash, privateHash = null, fixtureHash = null, stage = 'entry', state = 'stopped', code = null;
let networkEnabled = false, connectionString, originalFetch, initialDay, baseline, restoredConsole;
let writesAllowed = false, originalFiles = null;
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const demand = (condition, failure) => { if (!condition) throw new Error(failure); };
const safeCode = error => typeof error?.message === 'string' && /^a09_[a-z0-9_]+$/u.test(error.message) ? error.message : 'a09_acceptance_stopped';
async function business(fn) { demand(counters.businessCalls < limits.businessCalls, 'a09_business_cap'); counters.businessCalls++; return fn(); }
// Read-only instrumentation is counted separately from explicit business commands.
const sql = (query, values = []) => { demand(/^SELECT\b/u.test(query), 'a09_read_only_probe_required'); demand(counters.sqlReads < 120, 'a09_sql_read_cap'); counters.sqlReads++; return pool.query(query, values); };
const checked = name => evidence.checks.push(name);
async function encryptedWrite(path, value, aad, exclusive = false) {
  const envelope = cipher.encrypt(JSON.stringify(value), aad);
  if (exclusive) {
    try { await writeFile(path, envelope, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('a09_existing_fixture_preserved'); throw error; }
  }
  else { await writeFile(path + '.tmp', envelope, { mode: 0o600 }); await rename(path + '.tmp', path); }
  return digest(envelope);
}
async function savePrivate(exclusive = false) {
  if (!cipher || !fixture) return;
  fixture.progress = { stage, state, code, counters: { ...counters }, initialDay, updatedAt: new Date().toISOString() };
  fixtureHash = await encryptedWrite(fixtureFile, fixture, fixtureAad, exclusive);
  privateHash = await encryptedWrite(evidenceFile, evidence, evidenceAad);
}
async function saveMetadata() {
  await mkdir(dirname(resultFile), { recursive: true });
  await writeFile(resultFile, JSON.stringify({ state, code, stage, checkedAt: new Date().toISOString(), caseSha256: caseHash,
    version: fixture?.version ?? null, scriptSha256: digest(await readFile(fileURLToPath(import.meta.url), 'utf8')), database: 'p2_a08_service_20261008', limits, sqlReadCap: 120, counters,
    fixture: { accounts: fixture?.userId ? 1 : 0, children: fixture?.childId ? 1 : 0, preserved: state !== 'cleaned',
      userHash: fixture?.userId ? digest(fixture.userId) : null, childHash: fixture?.childId ? digest(fixture.childId) : null },
    checks: evidence.checks, runs: evidence.cases.map(item => ({ caseId: item.caseId, runId: item.result?.runId ?? null,
      state: item.result?.status ?? 'unknown', stopReason: item.result?.stopReason ?? null, countsKnown: item.result?.countsKnown ?? false,
      counts: item.result?.counts ?? null, tools: item.result?.tools?.map(({ name, status }) => ({ name, status })) ?? [],
      retrievalMode: item.result?.retrievalMode ?? null, citationCount: item.result?.citations?.length ?? 0,
      proposalCount: item.result?.proposals?.length ?? 0, confirmationBindingCount: item.confirmationBindings?.length ?? 0, acceptedProposalIds: item.decisions?.map(value => value.id) ?? [] })),
    usage: evidence.usage, reviewedResumeUsed: fixture?.reviewedResumeUsed ?? false, reviewedPromptFixUsed: fixture?.reviewedPromptFixUsed ?? false, promptFixVerification: evidence.promptFixVerification ?? null, previousFailures: evidence.failures ?? [], firstFailureCheckpoint: fixture?.firstFailureCheckpoint ?? null, secondFailureCheckpoint: fixture?.secondFailureCheckpoint ?? null, safeVertexFailures: evidence.safeVertexFailures ?? [], vertexHttp: evidence.vertexHttp ?? [], networkErrorCodes: evidence.networkErrors ?? [], poolRebuilds: counters.poolRebuilds, encrypted: { fixtureSha256: fixtureHash, evidenceSha256: privateHash,
      fixtureAad, evidenceAad }, notifications: 0, externalMail: 0, automaticRetries: 0,
    reviewRequired: ['Useful clarification and no invented age/date', 'Applicable FHS citations supporting the actual answer',
      'Useful preparation content and scoped approval', 'Same document, exact requested item change and persistence'],
    limitation: 'Structural checks only; main must privately review decrypted content. No browser, deployment, SMTP or human acceptance is claimed.' }, null, 2));
}
async function checkpoint() { if (!writesAllowed) return; await savePrivate(); await saveMetadata(); }

function networkTarget(input, init = {}, protocol = 'https:') {
  let url;
  if (typeof input === 'string' || input instanceof URL) url = new URL(input);
  else if (input && typeof input.url === 'string') url = new URL(input.url);
  else {
    demand(input && !input.socketPath && !input.createConnection && input.rejectUnauthorized !== false, 'a09_network_options');
    const host = input.hostname ?? input.host;
    demand(typeof host === 'string' && !host.includes('@'), 'a09_network_destination');
    url = new URL((input.protocol ?? protocol) + '//' + host + (input.port ? ':' + input.port : '') + (input.path ?? '/'));
  }
  const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
  demand(networkEnabled && url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password && !url.hash,
    'a09_network_destination');
  if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token' && !url.search && method === 'POST') {
    demand(++counters.adcRequests <= 4, 'a09_adc_request_cap'); return 'adc';
  }
  const prefix = '/v1/projects/ai-caregivers-for-children/locations/global/publishers/google/models/';
  demand(url.hostname === 'aiplatform.googleapis.com' && method === 'POST' && !url.search && url.pathname.startsWith(prefix), 'a09_network_destination');
  const model = url.pathname.slice(prefix.length);
  const kind = model === 'gemini-3.1-flash-lite:generateContent' ? 'generation'
    : ['gemini-embedding-001:predict', 'gemini-embedding-001:embedContent'].includes(model) ? 'embedding' : null;
  demand(kind && counters.generationRequests + counters.embeddingRequests < limits.sharedAttempts, 'a09_shared_request_cap');
  if (kind === 'generation') demand(++counters.generationRequests <= limits.modelCalls, 'a09_generation_cap');
  else demand(++counters.embeddingRequests <= limits.queryEmbeddings, 'a09_embedding_cap');
  return kind;
}
function guardTarget(input, init, protocol) {
  try { return networkTarget(input, init, protocol); }
  catch (error) { counters.blockedNetwork++; (evidence.networkErrors ??= []).push(safeCode(error)); throw error; }
}
function installNetworkGuard() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const kind = guardTarget(input, init);
    const response = await originalFetch(input, { ...init, redirect: 'error' });
    if (kind !== 'adc') {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const modelMethod = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
      (evidence.vertexHttp ??= []).push({ caseId: stage, httpStatus: response.status, modelMethod });
      if (!response.ok) await captureProviderFailure(response, modelMethod);
    }
    return response;
  };
  for (const [module, protocol] of [[http, 'http:'], [https, 'https:']]) {
    for (const name of ['request', 'get']) {
      const original = module[name];
      module[name] = function (...args) {
        guardTarget(args[0], typeof args[1] === 'object' && args[1] !== null ? args[1] : {}, protocol);
        return original.apply(this, args);
      };
    }
  }
  syncBuiltinESMExports();
}
function captureConsole(...args) {
  const allowed = new Set(['invalid_request', 'unauthenticated', 'permission_denied', 'not_found', 'timeout',
    'rate_limited', 'provider_unavailable', 'http_error', 'aborted', 'unknown']);
  if (args.length === 1 && typeof args[0] === 'string' && args[0].length <= 300) {
    try {
      const value = JSON.parse(args[0]);
      if (value && value.event === 'vertex_generate_failure' && Object.keys(value).sort().join(',') === 'category,event,httpStatus'
        && allowed.has(value.category) && (value.httpStatus === null || Number.isInteger(value.httpStatus) && value.httpStatus >= 400 && value.httpStatus <= 599)) {
        (evidence.safeVertexFailures ??= []).push({ caseId: stage, event: value.event, httpStatus: value.httpStatus, category: value.category }); return;
      }
    } catch { /* All other console content remains suppressed. */ }
  }
  counters.suppressedLogs++;
}
async function captureProviderFailure(response, modelMethod) {
  // Never clone successful responses, OAuth token responses, or headers.
  let reader;
  try { reader = response.clone().body?.getReader(); } catch { return; }
  if (!reader) return;
  const chunks = []; let bytes = 0, complete = false, timer;
  try {
    await Promise.race([(async () => {
      while (bytes < 8192) {
        const next = await reader.read();
        if (next.done) { complete = true; break; }
        const part = next.value.subarray(0, 8192 - bytes); chunks.push(part); bytes += part.length;
      }
    })(), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
  } catch { /* The safe HTTP status still survives a truncated/unreadable diagnostic body. */ }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
  (evidence.providerFailureBodies ??= []).push({ caseId: stage, httpStatus: response.status, modelMethod,
    bodyPrefix: Buffer.concat(chunks).toString('utf8'), bytes, complete });
}
async function loadExistingFixture(requireQuota) {
  const [fixtureBytes, evidenceBytes, metadataBytes] = await Promise.all([
    readFile(fixtureFile, 'utf8'), readFile(evidenceFile, 'utf8'), readFile(resultFile, 'utf8')]);
  fixture = JSON.parse(cipher.decrypt(fixtureBytes, fixtureAad));
  Object.assign(evidence, JSON.parse(cipher.decrypt(evidenceBytes, evidenceAad)));
  const metadata = JSON.parse(metadataBytes);
  demand(fixture.schema === 1 && fixture.database === 'p2_a08_service_20261008'
    && /^a09-[0-9a-f-]{36}@example\.invalid$/u.test(fixture.email), 'a09_fixture_identity_mismatch');
  demand(digest(fixtureBytes) === metadata.encrypted.fixtureSha256 && digest(evidenceBytes) === metadata.encrypted.evidenceSha256
    && fixture.version === metadata.version, 'a09_original_ciphertext_hash_mismatch');
  for (const [key, value] of Object.entries(fixture.progress.counters)) demand(Object.hasOwn(counters, key) && Number.isSafeInteger(value) && value >= 0, 'a09_original_counter_invalid');
  Object.assign(counters, fixture.progress.counters); initialDay = fixture.progress.initialDay;
  demand(counters.businessCalls < 55 && counters.sqlReads < 120 && counters.generationRequests + counters.embeddingRequests <= 12
    && (!requireQuota || counters.generationRequests + counters.embeddingRequests < 12), 'a09_original_cap_exhausted');
  originalFiles = { fixtureBytes, evidenceBytes, metadataBytes, metadata };
}
async function freezeFirstFailure(batch = '01') {
  demand(['01', '02'].includes(batch), 'a09_checkpoint_batch_invalid');
  const sources = [[fixtureFile, 'batch-' + batch + '-fixture.enc', digest(originalFiles.fixtureBytes)],
    [evidenceFile, 'batch-' + batch + '-private.enc', digest(originalFiles.evidenceBytes)],
    [resultFile, 'batch-' + batch + '-metadata.json', digest(originalFiles.metadataBytes)]];
  const checkpoint = {};
  for (const [source, name, expectedHash] of sources) {
    const target = privateRoot + '/' + name;
    try { await copyFile(source, target, fsConstants.COPYFILE_EXCL); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('a09_reviewed_resume_already_checkpointed'); throw error; }
    demand(digest(await readFile(target, 'utf8')) === expectedHash, 'a09_first_failure_checkpoint_mismatch');
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $file=Get-Item -LiteralPath $env:P2_A09_FROZEN_FILE; $file.IsReadOnly=$true; if(!(Get-Item -LiteralPath $env:P2_A09_FROZEN_FILE).IsReadOnly){exit 2}"],
      { env: { ...process.env, PSModulePath: '', P2_A09_FROZEN_FILE: target }, windowsHide: true, stdio: 'pipe' });
    else await chmod(target, 0o400);
    checkpoint[name] = { path: target, sha256: expectedHash };
  }
  return checkpoint;
}
async function verifyFirstCheckpoint() {
  const checkpoint = fixture.firstFailureCheckpoint;
  demand(checkpoint && Object.keys(checkpoint).length === 3, 'a09_original_checkpoint_missing');
  for (const name of ['batch-01-fixture.enc', 'batch-01-private.enc', 'batch-01-metadata.json']) {
    const entry = checkpoint[name], target = privateRoot + '/' + name;
    demand(entry?.path === target && digest(await readFile(target, 'utf8')) === entry.sha256, 'a09_original_checkpoint_changed');
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; if(!(Get-Item -LiteralPath $env:P2_A09_FROZEN_FILE).IsReadOnly){exit 2}"],
      { env: { ...process.env, PSModulePath: '', P2_A09_FROZEN_FILE: target }, windowsHide: true, stdio: 'pipe' });
    else demand(((await stat(target)).mode & 0o222) === 0, 'a09_original_checkpoint_writable');
  }
}
async function securePrivateRoot(assertPrivatePath) {
  try { await stat(privateRoot); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Exact external evidence directory only; preserve existing directories and their ACLs.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'
$path=$env:P2_A09_PRIVATE_ROOT
New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
foreach($identity in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $path -AclObject $acl`], { env: { ...process.env, PSModulePath: '', P2_A09_PRIVATE_ROOT: privateRoot }, windowsHide: true, stdio: 'pipe' });
  }
  demand((await realpath(privateRoot)).toLowerCase() === resolve(privateRoot).toLowerCase(), 'a09_private_path');
  await assertPrivatePath(privateRoot);
}
async function installServices() {
  const [{ createProductAgentServices }, { createAgentActionsStore }, { createChatStore }, { createRecordStore }, { createFamilyDocumentStore }] = await Promise.all([
    import('../server/product-agent-services.ts'), import('../server/agent-actions-store.ts'), import('../server/chat.ts'),
    import('../server/records.ts'), import('../server/family-document-store.ts')]);
  // No scheduler, contact delivery, worker or notification provider is installed.
  services = createProductAgentServices(pool, cipher, config, undefined, false, undefined, undefined, undefined, undefined,
    createAgentActionsStore(pool, cipher));
  chat = createChatStore(pool, cipher, true, true); records = createRecordStore(pool, cipher, true);
  documents = createFamilyDocumentStore(pool, cipher);
  auth = (await import('../server/auth.ts')).createAuth(serverConfig, pool, {
    admission: (await import('../server/account-admission.ts')).createAccountAdmission(pool, { enabled: false, mailConfigured: false }) });
}
async function invariant() {
  const value = (await sql("SELECT current_database() AS database,(SELECT enabled FROM worker_control WHERE id=1) AS worker,(SELECT count(*)::int FROM app_migrations WHERE id IN ('034-account-admission','035-account-data-exit')) AS migrations")).rows[0];
  demand(value.database === 'p2_a08_service_20261008' && value.worker === false && value.migrations === 2, 'a09_database_worker_migration_gate');
}
async function usage() {
  return (await sql(`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS day,
    COALESCE((SELECT attempts FROM ai_daily_usage WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AND scope_key='global'),0)::int AS global_attempts,
    COALESCE((SELECT attempts FROM ai_daily_usage WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AND scope_key=$1),0)::int AS user_attempts,
    (SELECT count(*)::int FROM ai_attempts WHERE user_id=$2 AND child_id=$3) AS generations,
    (SELECT count(*)::int FROM embedding_attempts WHERE actor_id=$2 AND kind='query_embedding') AS embeddings,
    (SELECT count(*)::int FROM ai_attempts WHERE user_id=$2 AND child_id=$3 AND (input_tokens IS NULL OR output_tokens IS NULL OR cached_tokens IS NULL)) AS generation_usage_unknown,
    COALESCE((SELECT sum(input_tokens)::bigint::text FROM ai_attempts WHERE user_id=$2 AND child_id=$3),'0') AS generation_input_tokens,
    COALESCE((SELECT sum(output_tokens)::bigint::text FROM ai_attempts WHERE user_id=$2 AND child_id=$3),'0') AS generation_output_tokens,
    COALESCE((SELECT sum(cached_tokens)::bigint::text FROM ai_attempts WHERE user_id=$2 AND child_id=$3),'0') AS generation_cached_tokens,
    (SELECT count(*)::int FROM embedding_attempts WHERE actor_id=$2 AND kind='query_embedding' AND input_tokens IS NULL) AS embedding_usage_unknown,
    COALESCE((SELECT sum(input_tokens)::bigint::text FROM embedding_attempts WHERE actor_id=$2 AND kind='query_embedding'),'0') AS embedding_input_tokens`,
  ['user:' + (fixture?.userId ?? 'p2-a09-not-created'), fixture?.userId ?? '', fixture?.childId ?? null])).rows[0];
}
async function protectedSnapshot() {
  const tables = ['text_records', 'child_profile_revisions', 'memory_facts', 'memory_topics', 'conversation_summaries', 'care_tasks',
    'concerns', 'shared_inputs', 'agent_private_notes', 'agent_action_receipts', 'agent_operation_policies', 'contact_consents', 'contact_requests'];
  const counts = tables.map((table, index) => `(SELECT count(*)::int FROM ${table} WHERE child_id=$1) AS n${index}`);
  const row = (await sql(`SELECT ${counts.join(',')},c.profile_version,c.display_name_encrypted,w.access_version,w.storage_epoch,
    (SELECT count(*)::int FROM family_members WHERE workspace_id=w.id) AS members,
    (SELECT count(*)::int FROM family_invitations WHERE workspace_id=w.id) AS invitations,
    (SELECT count(*)::int FROM children WHERE workspace_id=w.id) AS children
    FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1 AND w.owner_user_id=$2`, [fixture.childId, fixture.userId])).rows[0];
  demand(row, 'a09_fixture_scope_missing');
  row.display_name_hash = digest(row.display_name_encrypted); delete row.display_name_encrypted;
  return row;
}
async function globalCounts() {
  return (await sql('SELECT (SELECT count(*)::int FROM "user") AS users,(SELECT count(*)::int FROM children) AS children,(SELECT count(*)::int FROM chat_messages) AS messages,(SELECT count(*)::int FROM family_documents) AS documents')).rows[0];
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const items = snapshot => snapshot.sections.flatMap(section => section.items.map(item => ({ section, item })));
function preparationShape(document) {
  demand(document?.kind === 'preparation' && document.purpose === 'appointment' && document.status === 'active'
    && document.readState === 'ready' && document.current?.eventDate === null, 'a09_preparation_shape');
  for (const text of ['帶健康手冊', '問開始加固方法']) demand(items(document.current).filter(value => value.section.kind === 'checklist' && value.item.text === text).length === 1,
    'a09_required_checklist_item');
}
function targetedChange(before, after) {
  const found = items(before).filter(value => value.section.kind === 'checklist' && value.item.text === '帶健康手冊');
  demand(found.length === 1, 'a09_edit_target_ambiguous');
  const expected = structuredClone(before.sections);
  const target = expected.find(section => section.id === found[0].section.id).items.find(item => item.id === found[0].item.id);
  target.text = '帶最新生長記錄'; if (Object.hasOwn(target, 'checked')) target.checked = false;
  demand(same(expected, after.sections), 'a09_other_items_or_sections_changed');
  for (const field of ['title', 'summary', 'ageLabel', 'period', 'eventDate', 'coverageNote', 'sources'])
    demand(same(before[field], after[field]), 'a09_other_content_changed');
}
async function confirmDocumentCandidate(entry, document, editing) {
  const proposals = entry.result.proposals;
  demand(proposals.length <= 1 && proposals.every(value => value.value.kind === 'family_document_change' && value.value.documentId === document.id
    && value.status === 'pending' && value.result === null && value.value.change.action === 'patch'), 'a09_unexpected_proposal');
  if (!proposals.length) { demand(!editing, 'a09_edit_confirmation_missing'); preparationShape(document); return document; }
  const proposal = proposals[0], patch = proposal.value.change;
  demand(patch.expectedVersion === document.version && patch.edits.every(edit => ['set_metadata', 'upsert_section', 'upsert_item'].includes(edit.op)
    && (edit.op !== 'set_metadata' || edit.eventDate === undefined)), 'a09_proposal_outside_content');
  const preview = applyPatch(document.current, patch, { entries: document.current.sources }, document.version + 1);
  if (editing) targetedChange(document.current, preview); else preparationShape({ ...document, current: preview });
  demand(await business(() => documents.validatePatch(fixture.userId, fixture.childId, document.id, patch)), 'a09_proposal_scope_changed');
  // The real handler saves the model reply and performs native question binding.
  // Named candidate selection uses the same store.decide boundary as the product UI.
  const bindings = (await sql(`SELECT state,ask_message_id,proposal_version FROM agent_confirmations
    WHERE owner_user_id=$1 AND child_id=$2 AND proposal_id=$3 AND asking_run_id=$4`,
    [fixture.userId, fixture.childId, proposal.id, entry.result.runId])).rows;
  demand(bindings.every(value => value.state === 'asked' && value.ask_message_id === entry.reply.id && value.proposal_version === proposal.version), 'a09_confirmation_not_bound');
  entry.confirmationBindings = bindings; entry.preview = preview; await checkpoint();
  const decided = await business(() => services.store.decide(fixture.userId, fixture.childId, proposal.runId, proposal.id,
    { expectedVersion: proposal.version, decision: 'accept', confirmShared: true }));
  demand(decided?.status === 'accepted' && decided.result?.kind === 'family_document' && decided.result.id === document.id, 'a09_confirmation_not_saved');
  entry.decisions = [decided]; await checkpoint();
  const saved = await business(() => documents.get(fixture.userId, fixture.childId, document.id));
  demand(saved?.version === document.version + 1 && saved.current?.version > document.current.version, 'a09_document_version_not_advanced');
  if (editing) targetedChange(document.current, saved.current); else preparationShape(saved);
  return saved;
}
async function isCurrentUser(userId) {
  if (userId !== fixture.userId || !await account.allowed(userId)) return false;
  const session = await auth.api.getSession({ headers: new Headers({ cookie: fixture.cookie }) });
  return session?.user?.id === userId;
}
async function executeCase(testCase) {
  stage = testCase.id; await invariant();
  const beforeUsage = await usage(); evidence.usage.push({ phase: testCase.id + '_before', ...beforeUsage });
  demand(beforeUsage.day === initialDay, 'a09_daily_boundary_changed');
  demand(beforeUsage.user_attempts < 12 && beforeUsage.global_attempts < 20 && beforeUsage.generations + beforeUsage.embeddings < 12, 'a09_no_shared_quota_left');
  demand(counters.runs < limits.runs, 'a09_run_cap');
  const entry = { caseId: testCase.id, userText: testCase.text, before: await protectedSnapshot(), documentBefore: null, reply: null, result: null, decisions: [] };
  evidence.cases.push(entry); counters.runs++; await checkpoint();
  const message = await business(() => chat.createUserMessageForUser(fixture.userId, fixture.childId, testCase.text));
  demand(message?.id, 'a09_user_message_not_saved'); entry.sourceMessageId = message.id; await checkpoint();
  networkEnabled = true;
  let response;
  try { response = await business(() => apiHandler(new Request('http://127.0.0.1:8197/api/children/' + fixture.childId + '/messages/' + message.id + '/reply',
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': fixture.userId }, body: '{}', signal: AbortSignal.timeout(95000) }),
    fixture.userId, { ...services, chat, isCurrentUser })); }
  finally { networkEnabled = false; }
  const body = await response.json(); entry.reply = body.message ?? null; entry.httpStatus = response.status;
  // Read only the original run; even a failed handler must never create a replacement run.
  const runRows = (await sql('SELECT id FROM agent_runs WHERE child_id=$1 AND owner_user_id=$2 AND source_message_id=$3 ORDER BY created_at,id',
    [fixture.childId, fixture.userId, message.id])).rows;
  demand(runRows.length === 1, 'a09_original_run_missing_or_duplicate');
  entry.result = await business(() => services.store.get(fixture.userId, fixture.childId, runRows[0].id));
  entry.after = await protectedSnapshot();
  const afterUsage = await usage(); evidence.usage.push({ phase: testCase.id + '_after', ...afterUsage }); await checkpoint();
  demand(response.status === 200 && entry.reply?.agentRunId === entry.result?.runId && entry.reply.inReplyTo === message.id, 'a09_real_handler_reply_failed');
  demand(entry.result.status === 'completed' && entry.result.countsKnown === true, 'a09_run_not_completed');
  demand(entry.result.counts.modelCalls <= 4 && entry.result.counts.toolCalls <= 8 && entry.result.counts.queryEmbeddings <= 2, 'a09_run_limits');
  demand(afterUsage.day === initialDay && afterUsage.user_attempts <= 12 && afterUsage.global_attempts <= 20
    && afterUsage.generations <= 12 && afterUsage.embeddings <= 6 && afterUsage.generations + afterUsage.embeddings <= 12, 'a09_actual_usage_limit');
  demand(same(entry.before, entry.after) && same(entry.after, fixture.protectedBaseline), 'a09_unrelated_side_effect');
  demand(counters.blockedNetwork === 0, 'a09_network_boundary_failed');
  return entry;
}

try {
  const args = process.argv.slice(2), cleanup = same(args, ['--cleanup']);
  const resumeUnavailable = same(args, ['--resume-after-reviewed-failure']), resumePromptFix = same(args, ['--resume-after-prompt-fix']);
  const resume = resumeUnavailable || resumePromptFix, historicalRuns = resumePromptFix ? 2 : 1;
  demand(cleanup || resume || same(args, ['--approved-local-p2-a09']), 'a09_explicit_entry_required');
  demand(resolve(process.cwd()).toLowerCase() === resolve(assignedRepository).toLowerCase() && repository.toLowerCase() === resolve(assignedRepository).toLowerCase(), 'a09_assigned_worktree_required');
  const caseBytes = await readFile(caseFile, 'utf8'); caseData = JSON.parse(caseBytes); caseHash = digest(caseBytes);
  for (const [key, value] of Object.entries(limits)) demand(caseData.limits?.[key] === value, 'a09_case_limit_mismatch');
  demand(caseData.messages.length === 3 && same(caseData.messages.map(value => value.id), ['clarify', 'grounded_prepare', 'targeted_edit']), 'a09_case_sequence_mismatch');
  for (const key of Object.keys(process.env)) if (/^(?:OTEL_|GOOGLE_API_KEY$|GEMINI_API_KEY$|GOOGLE_GEMINI_BASE_URL$|GOOGLE_VERTEX_BASE_URL$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|http_proxy$|https_proxy$|all_proxy$)/u.test(key)) delete process.env[key];
  Object.assign(process.env, { PSModulePath: '', GOOGLE_APPLICATION_CREDENTIALS: adcFile, GOOGLE_CLOUD_PROJECT: 'ai-caregivers-for-children',
    ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS: 'false', OTEL_SDK_DISABLED: 'true', AGENT_DIAGNOSTICS: 'false', DEBUG: '', NODE_ENV: 'test' });
  const names = ['log', 'info', 'warn', 'error', 'debug']; restoredConsole = Object.fromEntries(names.map(name => [name, console[name]]));
  for (const name of names) console[name] = captureConsole;
  installNetworkGuard();
  const [{ Pool }, storage, { assertPrivatePath }, { readAiConfig }, { openAccountRuntime }, { readServerConfig }] = await Promise.all([
    import('pg'), import('../server/storage-crypto.ts'), import('../server/private-path.ts'), import('../server/ai-config.ts'),
    import('../server/account-runtime.ts'), import('../server/config.ts')]);
  await securePrivateRoot(assertPrivatePath);
  cipher = storage.createStorageCipher(await storage.readSecretKey(keyFile));
  if (cleanup || resume) await loadExistingFixture(resume);
  if (resume) {
    stage = resumePromptFix ? 'prompt_fix_preserve_second_failure' : 'reviewed_resume_preserve_first_failure';
    const failed = evidence.cases.at(-1), oldMetadata = originalFiles.metadata;
    demand(fixture.progress.state === 'stopped' && fixture.progress.code === 'a09_run_not_completed'
      && fixture.progress.stage === 'clarify' && evidence.cases.length === historicalRuns && failed?.caseId === 'clarify'
      && evidence.cases.every(entry => entry.userText === caseData.messages[0].text && entry.reply?.id && entry.sourceMessageId)
      && failed.result.status === 'stopped' && failed.result.countsKnown === true && failed.result.proposals.length === 0
      && fixture.userId && fixture.childId && typeof fixture.cookie === 'string' && fixture.cookie.length > 0
      && counters.runs === historicalRuns && counters.generationRequests === historicalRuns && counters.embeddingRequests === 0 && counters.poolRebuilds === 0
      && same(oldMetadata.counters, fixture.progress.counters), 'a09_reviewed_resume_scope_mismatch');
    if (resumeUnavailable) demand(!fixture.reviewedResumeUsed && !fixture.reviewedPromptFixUsed
      && failed.result.runId === 'bed0ab16-46a2-4288-81cd-ff8629baf19e' && failed.result.stopReason === 'unavailable'
      && same(failed.result.counts, { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }) && failed.result.tools.length === 0
      && oldMetadata.scriptSha256 === 'a5ed3ee9044f7ea9cc38755006dc4275e4d58ff6eb872cbecefa4ef8d0f9a177', 'a09_reviewed_resume_scope_mismatch');
    else demand(fixture.reviewedResumeUsed === true && !fixture.reviewedPromptFixUsed
      && evidence.cases[0].result?.runId === 'bed0ab16-46a2-4288-81cd-ff8629baf19e'
      && failed.result.runId === '9918ed23-8e76-46db-b573-5d2919fe2e6d' && failed.result.stopReason === 'tool_unknown'
      && same(failed.result.counts, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 })
      && failed.result.tools.length === 1 && failed.result.tools[0].name === 'load_capabilities' && failed.result.tools[0].status === 'unknown'
      && evidence.vertexHttp?.length === 1 && evidence.vertexHttp[0].httpStatus === 200
      && evidence.vertexHttp[0].modelMethod === 'gemini-3.1-flash-lite:generateContent'
      && oldMetadata.scriptSha256 === '2dcd6e8ca49d0d9c0d6c482e6ab5b5a8941c3b1252fd678cfb01e1cb28c5c4fe', 'a09_prompt_fix_resume_scope_mismatch');
    const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim();
    demand(currentHead === fixture.version && fixture.version === 'b30a7b28b8f00f72013e2f6a01a6e65832856549', 'a09_resume_baseline_changed');
    if (resumePromptFix) {
      await verifyFirstCheckpoint();
      const manifestBytes = await readFile(resolve(repository, 'prompts/manifest.json'), 'utf8');
      const manifest = JSON.parse(manifestBytes);
      demand(manifest.version === '0.1.33' && manifest.modules.find(entry => entry.id === 'module.summary-report')?.version === '0.1.4', 'a09_prompt_fix_version_mismatch');
      const prompt = await (await import('../server/agent-prompt.ts')).loadAgentPrompt('product-interactive', 'tool_cycle',
        ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities'], ['module.summary-report']);
      demand(prompt.packVersion === '0.1.33' && prompt.moduleIds.includes('module.summary-report'), 'a09_prompt_fix_not_loaded');
      evidence.promptFixVerification = { packVersion: prompt.packVersion, summaryModuleVersion: '0.1.4', moduleIds: prompt.moduleIds,
        manifestSha256: digest(manifestBytes),
        summaryModuleSha256: digest(await readFile(resolve(repository, 'prompts/modules/summary-report.md'), 'utf8')) };
      fixture.secondFailureCheckpoint = await freezeFirstFailure('02');
    } else fixture.firstFailureCheckpoint = await freezeFirstFailure('01');
  }
  const inspected = JSON.parse(execFileSync('docker', ['inspect', 'ai-postgres-test-1'], { encoding: 'utf8', windowsHide: true }))[0];
  const env = Object.fromEntries(inspected.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  const database = new URL('postgres://127.0.0.1:5434/p2_a08_service_20261008'); database.username = env.POSTGRES_USER; database.password = env.POSTGRES_PASSWORD;
  demand(database.username && database.password && database.pathname === '/p2_a08_service_20261008', 'a09_clone_credentials_required');
  connectionString = database.toString(); pool = new Pool({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  await invariant();
  const accountEnv = { ...process.env, SERVICE_MODE: 'invited', ACCOUNT_SMTP_CONFIG_FILE: '', ACCOUNT_SMTP_ALLOW_INSECURE_LOOPBACK: 'false',
    ACCOUNT_ERASURE_JOURNAL_DIR: accountRoot + '/journal', ATTACHMENTS_DIR: accountRoot + '/attachments' };
  account = await business(() => openAccountRuntime(pool, cipher, accountEnv)); demand(account, 'a09_account_runtime_required');
  if (cleanup) {
    stage = 'cleanup_exact_fixture'; writesAllowed = true;
    caseHash = fixture.activeCaseSha256 ?? fixture.caseSha256;
    checked('cleanup_only_no_model');
    const rows = (await sql('SELECT id,email FROM "user" WHERE email=$1', [fixture.email])).rows;
    demand(rows.length <= 1 && (!rows.length || !fixture.userId || rows[0].id === fixture.userId), 'a09_cleanup_identity_mismatch');
    if (rows.length) {
      fixture.userId = rows[0].id;
      const scope = (await sql('SELECT c.id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE w.owner_user_id=$1', [fixture.userId])).rows;
      demand(scope.length <= 1 && (!scope.length || !fixture.childId || scope[0].id === fixture.childId), 'a09_cleanup_child_mismatch');
      fixture.childId = scope[0]?.id ?? fixture.childId;
      if (!fixture.cleanupReceipt) {
        const prepared = await business(() => account.data.prepare(fixture.userId, fixture.cleanupOperationId));
        demand(prepared.summary.childCount === scope.length, 'a09_cleanup_scope_changed'); fixture.cleanupReceipt = prepared; await checkpoint();
      }
      const receipt = await business(() => account.data.execute(fixture.userId, { operationId: fixture.cleanupReceipt.operationId,
        receiptToken: fixture.cleanupReceipt.receiptToken, password: fixture.password, confirmation: '永久刪除我的帳戶' }));
      demand(receipt.state === 'completed' && receipt.attachmentsPending === false, 'a09_cleanup_not_complete'); evidence.cleanup = receipt;
    } else demand(Boolean(fixture.cleanupReceipt) || !fixture.userId, 'a09_fixture_missing_without_cleanup_receipt');
    demand((await sql('SELECT 1 FROM "user" WHERE email=$1', [fixture.email])).rowCount === 0, 'a09_cleanup_user_remaining');
    if (fixture.childId) demand((await sql('SELECT 1 FROM children WHERE id=$1', [fixture.childId])).rowCount === 0, 'a09_cleanup_child_remaining');
    demand(same(await globalCounts(), fixture.baseline), 'a09_cleanup_baseline_changed'); await invariant();
    checked('journal_erasure_of_exact_synthetic_account'); state = 'cleaned';
  } else {
    stage = resume ? 'reviewed_resume_preflight' : 'preflight';
    demand((await stat(adcFile)).isFile(), 'a09_existing_adc_required');
    if (!resume) {
      try { await stat(fixtureFile); throw new Error('a09_existing_fixture_preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const before = await usage(); initialDay = before.day;
      demand(20 - before.global_attempts >= 12 && before.user_attempts === 0, 'a09_insufficient_shared_daily_quota');
      baseline = await globalCounts();
      fixture = { schema: 1, database: 'p2_a08_service_20261008', caseSha256: caseHash,
        version: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim(),
        email: 'a09-' + randomUUID() + '@example.invalid', password: 'Synthetic-' + randomBytes(24).toString('hex'),
        authSecret: randomBytes(32).toString('hex'), userId: null, childId: null, cookie: null, baseline, cleanupOperationId: randomUUID() };
      state = 'prepared'; await savePrivate(true); writesAllowed = true;
    }
    serverConfig = readServerConfig({ ...process.env, DATABASE_URL: connectionString, BETTER_AUTH_SECRET: fixture.authSecret,
      SERVER_ORIGIN: 'http://127.0.0.1:8197', WEB_ORIGIN: 'http://127.0.0.1:8197', HOST: '127.0.0.1', PORT: '8197' });
    config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'ai-caregivers-for-children', VERTEX_LOCATION: 'global',
      GEMINI_MODEL: 'gemini-3.1-flash-lite', AI_DAILY_USER_ATTEMPTS: '12', AI_DAILY_GLOBAL_ATTEMPTS: '20', AI_MAX_ATTEMPTS: '1',
      AI_TIMEOUT_MS: '30000', AI_MAX_OUTPUT_TOKENS: '1024', AI_AGENT_MAX_INPUT_CHARACTERS: '64000' });
    const { AGENT_LIMITS, AGENT_INTERACTIVE_INPUT } = await import('../server/agent-budget.ts');
    demand(AGENT_LIMITS.modelCalls === 4 && AGENT_LIMITS.toolCalls === 8 && AGENT_LIMITS.queryEmbeddings === 2
      && AGENT_LIMITS.deadlineMs === 90000 && AGENT_LIMITS.outputTokens === 1024 && AGENT_INTERACTIVE_INPUT.default === 64000, 'a09_product_run_limits_changed');
    await installServices(); apiHandler = (await import('../server/product-agent-api.ts')).handleProductAgentRequest;
    applyPatch = (await import('../server/family-document-edits.ts')).applyFamilyDocumentPatch;
    if (resume) {
      const scope = (await sql(`SELECT u.id,u.email,u."emailVerified" AS verified,c.id AS child_id FROM "user" u
        JOIN workspaces w ON w.owner_user_id=u.id JOIN children c ON c.workspace_id=w.id WHERE u.id=$1`, [fixture.userId])).rows;
      demand(scope.length === 1 && scope[0].email === fixture.email && scope[0].verified === true && scope[0].child_id === fixture.childId
        && same(await protectedSnapshot(), fixture.protectedBaseline) && await isCurrentUser(fixture.userId), 'a09_resume_current_scope_changed');
      const existing = (await sql(`SELECT (SELECT count(*)::int FROM family_documents WHERE child_id=$1) AS documents,
        (SELECT count(*)::int FROM agent_proposals p JOIN agent_runs r ON r.id=p.run_id WHERE r.child_id=$1 AND r.owner_user_id=$2) AS proposals,
        (SELECT count(*)::int FROM agent_runs WHERE child_id=$1 AND owner_user_id=$2) AS runs`, [fixture.childId, fixture.userId])).rows[0];
      demand(existing.documents === 0 && existing.proposals === 0 && existing.runs === historicalRuns, 'a09_resume_unexpected_resources');
      for (const failed of evidence.cases) {
        const originalRun = await business(() => services.store.get(fixture.userId, fixture.childId, failed.result.runId));
        demand(same(originalRun, failed.result), 'a09_original_failed_run_changed');
      }
      const originalChat = await business(() => chat.listForUser(fixture.userId, fixture.childId));
      demand(originalChat?.messages.length === historicalRuns * 2 && evidence.cases.every(failed => originalChat.messages.some(value => value.id === failed.sourceMessageId && value.text === failed.userText)
        && originalChat.messages.some(value => value.id === failed.reply.id && value.inReplyTo === failed.sourceMessageId && value.text === failed.reply.text)), 'a09_original_failed_chat_changed');
      const currentUsage = await usage(); evidence.usage.push({ phase: resumePromptFix ? 'prompt_fix_resume_preflight' : 'reviewed_resume_preflight', ...currentUsage });
      demand(currentUsage.day === initialDay && currentUsage.user_attempts === historicalRuns && currentUsage.generations === historicalRuns && currentUsage.embeddings === 0
        && 20 - currentUsage.global_attempts >= 12 - currentUsage.user_attempts, 'a09_resume_usage_changed_or_insufficient');
      if (resumePromptFix) fixture.reviewedPromptFixUsed = true; else fixture.reviewedResumeUsed = true;
      fixture.activeCaseSha256 = caseHash;
      (evidence.failures ??= []).push({ batch: historicalRuns, ...(evidence.failure ?? {}) }); delete evidence.failure;
      checked(resumePromptFix ? 'second_failure_frozen_prompt_fix_loaded_same_fixture_usage' : 'first_failure_frozen_same_fixture_and_original_usage');
      state = resumePromptFix ? 'prepared_prompt_fix_resume' : 'prepared_reviewed_resume'; code = null;
      writesAllowed = true; await checkpoint();
    } else {
    stage = 'synthetic_trial_fixture';
    const signed = await business(() => auth.api.signUpEmail({ body: { email: fixture.email, password: fixture.password, name: 'A09 合成家長' },
      headers: new Headers({ origin: serverConfig.publicOrigin }), asResponse: true }));
    const signedBody = await signed.json();
    demand(signed.status === 200 && signedBody.user?.id, 'a09_synthetic_signup_failed'); fixture.userId = signedBody.user.id;
    fixture.cookie = signed.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); demand(fixture.cookie, 'a09_native_session_missing'); await checkpoint();
    // Only this new synthetic identity is marked verified. Real SMTP/verification is outside this batch.
    demand((await business(() => pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1 AND email=$2 RETURNING id',
      [fixture.userId, fixture.email]))).rowCount === 1, 'a09_fixture_verification_failed');
    const acknowledged = await business(() => account.admission.acknowledge(fixture.userId, { policyVersion: '2026-10-08', accepted: true, operationId: randomUUID() }));
    demand(acknowledged.user?.acknowledged && acknowledged.user.emailVerified && await isCurrentUser(fixture.userId), 'a09_account_acknowledgement_failed');
    const child = await business(() => records.createChildForUser(fixture.userId, { displayName: 'A09 合成孩子' }));
    demand(child?.id, 'a09_child_not_created'); fixture.childId = child.id; fixture.protectedBaseline = await protectedSnapshot();
    checked('trial_fixture_verified_and_acknowledged_not_smtp'); await checkpoint();
    }
    const first = await executeCase(caseData.messages[0]);
    demand(first.result.proposals.length === 0 && (await business(() => documents.list(fixture.userId, fixture.childId))).items.length === 0, 'a09_clarification_has_side_effect');
    checked('clarification_completed_without_business_mutation'); await checkpoint();
    const second = await executeCase(caseData.messages[1]);
    demand(second.result.retrievalMode === 'vector_keyword' && second.result.counts.queryEmbeddings > 0
      && second.result.citations.length > 0 && second.result.citations.every(citation => citation.reviewState === 'reviewed'
        && ['applicable', 'conditional'].includes(citation.applicabilityStatus) && /^https:\/\/(?:www\.)?fhs\.gov\.hk\//u.test(citation.url)
        && typeof citation.text === 'string' && citation.text.trim().length > 0), 'a09_actual_official_vector_citations_required');
    const page = await business(() => documents.list(fixture.userId, fixture.childId));
    demand(page.items.length === 1 && !page.hasMore, 'a09_single_preparation_required'); second.documentBefore = page.items[0]; await checkpoint();
    const prepared = await confirmDocumentCandidate(second, page.items[0], false); second.documentAfter = prepared; fixture.documentId = prepared.id;
    demand(same(await protectedSnapshot(), fixture.protectedBaseline), 'a09_prepare_unrelated_side_effect');
    checked('official_vector_answer_and_single_preparation_saved'); await checkpoint();
    const third = await executeCase(caseData.messages[2]); third.documentBefore = prepared;
    const current = await business(() => documents.get(fixture.userId, fixture.childId, fixture.documentId));
    demand(current?.id === prepared.id && current.version === prepared.version && same(current.current, prepared.current), 'a09_document_changed_before_confirmation');
    const edited = await confirmDocumentCandidate(third, current, true); third.documentAfter = edited;
    const documentsAfter = await business(() => documents.list(fixture.userId, fixture.childId));
    demand(documentsAfter.items.length === 1 && documentsAfter.items[0].id === fixture.documentId, 'a09_duplicate_document');
    demand(same(await protectedSnapshot(), fixture.protectedBaseline), 'a09_edit_unrelated_side_effect');
    checked('same_document_exact_item_revision_confirmed'); await checkpoint();
    stage = 'reopen_real_pool_and_services'; await pool.end(); pool = new Pool({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
    counters.poolRebuilds++; await invariant(); account = await business(() => openAccountRuntime(pool, cipher, accountEnv)); await installServices();
    const reopened = await business(() => documents.get(fixture.userId, fixture.childId, fixture.documentId));
    const history = await business(() => documents.listVersions(fixture.userId, fixture.childId, fixture.documentId));
    const savedChat = await business(() => chat.listForUser(fixture.userId, fixture.childId));
    evidence.restart = { document: reopened, history, chat: savedChat, protected: await protectedSnapshot() };
    demand(reopened?.version === edited.version && same(reopened.current, edited.current) && reopened.id === prepared.id
      && history?.items.some(value => value.snapshotId === prepared.current.id && value.snapshotVersion === prepared.current.version)
      && history.items.some(value => value.snapshotId === edited.current.id && value.snapshotVersion === edited.current.version), 'a09_document_restart_history_mismatch');
    demand(savedChat?.messages.length === evidence.cases.length * 2 && evidence.cases.every(entry => savedChat.messages.some(value => value.id === entry.sourceMessageId && value.text === entry.userText)
      && savedChat.messages.some(value => value.id === entry.reply.id && value.inReplyTo === entry.sourceMessageId && value.text === entry.reply.text)), 'a09_chat_restart_mismatch');
    demand(same(evidence.restart.protected, fixture.protectedBaseline) && await isCurrentUser(fixture.userId), 'a09_restart_scope_changed');
    evidence.usage.push({ phase: 'final', ...await usage() }); checked('same_latest_document_versions_and_chat_after_pool_reopen');
    state = 'structural_checks_passed_pending_main_review';
  }
  await checkpoint();
} catch (error) {
  state = 'stopped'; code = safeCode(error);
  evidence.failure = { code, name: /^[A-Za-z_]+$/u.test(error?.name ?? '') ? error.name : null };
  // Preserve an existing fixture/result even if someone accidentally repeats the start command.
  if (code !== 'a09_existing_fixture_preserved') await checkpoint().catch(() => {});
  process.exitCode = 1;
} finally {
  networkEnabled = false; await pool?.end().catch(() => {});
  if (restoredConsole) for (const [name, original] of Object.entries(restoredConsole)) console[name] = original;
}
process.stdout.write(JSON.stringify({ state, code, stage, businessCalls: counters.businessCalls, sqlReads: counters.sqlReads, runs: counters.runs,
  modelRequests: counters.generationRequests, queryEmbeddingRequests: counters.embeddingRequests, sharedAttemptCap: 12,
  fixturePreserved: state !== 'cleaned', resultFile, mainReviewRequired: state === 'structural_checks_passed_pending_main_review' }) + '\n');
