'use strict';

// This function is embedded verbatim in the immutable reusable workflow.
// It never authenticates to Google Cloud or initializes a model-spending ledger.
async function controlledBootstrap({ core, github, context, env = process.env, requireModule = require }) {
  const fs = requireModule('node:fs');
  const path = requireModule('node:path');
  const crypto = requireModule('node:crypto');
  const constants = Object.freeze({
    repository: '2NTTY/child-ai-caregiver', repositoryId: '1377602504', ownerId: '119132090', actorId: '119132090',
    ref: 'refs/heads/ci/controlled-model-acceptance', requestPath: '.github/controlled-model/request.json',
    callerPath: '.github/workflows/controlled-model-acceptance.yml',
    reusablePath: '2NTTY/child-ai-caregiver/.github/workflows/run-controlled-model-acceptance.yml',
    audience: 'projects/1064034424208/locations/global/workloadIdentityPools/github-model-tests/providers/child-ai-caregiver-ci',
    maximumFileBytes: 16384, liveEnabled: true,
    manifestPath: '.github/controlled-model/approved-manifest.json',
    inspectedSha: '94f7c7b260c46b033a970ec92d3125e31f20442c',
  });
  const error = category => { const value = new Error(category); value.category = category; throw value; };
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value);
  const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
  const text = value => typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
  const selected = (object, names) => Object.fromEntries(names.filter(key => text(object?.[key]))
    .map(key => [key, object[key]]));
  const result = { schemaVersion: 1, mode: 'bootstrap', status: 'failed', errorCategory: null,
    gcpAuthenticationPerformed: false, modelCallsPerformed: 0, ledgerInitialized: false,
    liveEnabled: constants.liveEnabled, ownerActorVerified: false, semanticStatus: 'not_run',
    spendingState: 'not_loaded', historicalCalls: 12, cumulativeGenerationCap: 20,
    historicalEstimatedUsd: '0.0464555', currentRunEstimatedUsd: '0', historicalActualCostUnknown: true };
  const snapshot = { schemaVersion: 1, mode: 'bootstrap', context: {}, serverRun: null,
    oidc: { status: 'not_requested', signatureVerification: 'not_performed', claims: {} }, request: null,
    ownerActorVerified: false };
  let directory;
  const persist = (name, document) => {
    const bytes = canonical(document) + '\n';
    if (Buffer.byteLength(bytes) > constants.maximumFileBytes) error('evidence_size_exceeded');
    const filename = path.join(directory, name);
    const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return hash(bytes);
  };
  try {
    if (!path.isAbsolute(env.RUNNER_TEMP ?? '')) error('runner_temp_invalid');
    if (fs.lstatSync(env.RUNNER_TEMP).isSymbolicLink()) error('evidence_path_denied');
    const candidate = path.join(env.RUNNER_TEMP, 'controlled-model-evidence');
    fs.mkdirSync(candidate, { mode: 0o700 });
    directory = candidate;
    snapshot.context = selected(env, ['CONTROLLED_REPOSITORY', 'CONTROLLED_REPOSITORY_ID',
      'CONTROLLED_OWNER_ID', 'CONTROLLED_REF', 'CONTROLLED_EVENT_NAME', 'CONTROLLED_RUN_ID',
      'CONTROLLED_RUN_ATTEMPT', 'CONTROLLED_ACTOR_ID', 'CONTROLLED_SHA', 'CONTROLLED_WORKFLOW_REF',
      'CONTROLLED_WORKFLOW_SHA', 'CONTROLLED_RUNNER_ENVIRONMENT']);
    if (env.CONTROLLED_REPOSITORY !== constants.repository || env.CONTROLLED_REPOSITORY_ID !== constants.repositoryId
      || env.CONTROLLED_OWNER_ID !== constants.ownerId || env.CONTROLLED_REF !== constants.ref
      || env.CONTROLLED_EVENT_NAME !== 'push' || env.CONTROLLED_RUN_ATTEMPT !== '1'
      || env.CONTROLLED_RUNNER_ENVIRONMENT !== 'github-hosted' || !id(env.CONTROLLED_RUN_ID)
      || !Number.isSafeInteger(Number(env.CONTROLLED_RUN_ID))
      || env.CONTROLLED_ACTOR_ID !== constants.actorId || !sha(env.CONTROLLED_SHA)
      || env.CONTROLLED_WORKFLOW_SHA !== env.CONTROLLED_SHA
      || env.CONTROLLED_WORKFLOW_REF !== `${constants.repository}/${constants.callerPath}@${constants.ref}`
      || context.eventName !== 'push' || String(context.runId) !== env.CONTROLLED_RUN_ID
      || context.sha !== env.CONTROLLED_SHA || context.ref !== constants.ref
      || context.repo.owner !== '2NTTY' || context.repo.repo !== 'child-ai-caregiver') error('context_policy_denied');
    let run;
    try { run = (await github.rest.actions.getWorkflowRun({ owner: '2NTTY', repo: 'child-ai-caregiver',
      run_id: Number(env.CONTROLLED_RUN_ID) })).data; } catch { error('server_run_unavailable'); }
    if (String(run.id) !== env.CONTROLLED_RUN_ID || run.event !== 'push' || run.run_attempt !== 1
      || run.head_sha !== env.CONTROLLED_SHA || run.head_branch !== 'ci/controlled-model-acceptance'
      || String(run.repository?.id) !== constants.repositoryId || String(run.repository?.owner?.id) !== constants.ownerId
      || run.repository?.full_name !== constants.repository || run.path !== constants.callerPath
      || String(run.actor?.id) !== env.CONTROLLED_ACTOR_ID
      || String(run.triggering_actor?.id) !== env.CONTROLLED_ACTOR_ID) error('server_run_policy_denied');
    snapshot.serverRun = { runId: String(run.id), runAttempt: run.run_attempt, event: run.event,
      headSha: run.head_sha, headBranch: run.head_branch, path: run.path,
      repositoryId: String(run.repository.id), ownerId: String(run.repository.owner.id),
      actorId: String(run.actor.id), triggeringActorId: String(run.triggering_actor.id) };
    snapshot.oidc.status = 'requesting';
    let claims;
    try {
      // The native API masks the credential. No token, headers, or environment is logged or written.
      const token = await core.getIDToken(constants.audience);
      if (typeof token !== 'string' || token.length > 32768) error('oidc_claims_invalid');
      const parts = token.split('.');
      if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/u.test(parts[1])) error('oidc_claims_invalid');
      const bytes = Buffer.from(parts[1], 'base64url');
      if (bytes.length > 16384) error('oidc_claims_invalid');
      claims = JSON.parse(bytes.toString('utf8'));
    } catch (cause) { error(cause?.category === 'oidc_claims_invalid' ? 'oidc_claims_invalid' : 'oidc_unavailable'); }
    const names = ['repository_id', 'repository_owner_id', 'ref', 'event_name', 'workflow_ref', 'actor_id',
      'runner_environment', 'job_workflow_ref', 'job_workflow_sha', 'run_attempt', 'aud', 'iss'];
    if (names.some(name => !text(claims?.[name]))) error('oidc_required_claim_missing');
    snapshot.oidc.claims = selected(claims, names);
    const trustedSha = claims.job_workflow_sha;
    if (claims.repository_id !== constants.repositoryId || claims.repository_owner_id !== constants.ownerId
      || claims.ref !== constants.ref || claims.event_name !== 'push' || claims.run_attempt !== '1'
      || claims.actor_id !== env.CONTROLLED_ACTOR_ID || claims.runner_environment !== 'github-hosted'
      || claims.workflow_ref !== env.CONTROLLED_WORKFLOW_REF || !sha(trustedSha)
      || claims.job_workflow_ref !== `${constants.reusablePath}@${trustedSha}`
      || claims.aud !== constants.audience || claims.iss !== 'https://token.actions.githubusercontent.com') error('oidc_policy_denied');
    snapshot.oidc.status = 'allowlist_decoded';
    snapshot.ownerActorVerified = true; result.ownerActorVerified = true;
    // Read only the fixed request path at the push SHA. Triggered source code is never executed.
    let content;
    try { content = (await github.rest.repos.getContent({ owner: '2NTTY', repo: 'child-ai-caregiver',
      path: constants.requestPath, ref: env.CONTROLLED_SHA })).data; } catch { error('request_unavailable'); }
    if (!content || Array.isArray(content) || content.type !== 'file' || content.path !== constants.requestPath
      || content.encoding !== 'base64' || !Number.isSafeInteger(content.size) || content.size < 1
      || content.size > 4096 || typeof content.content !== 'string' || content.content.length > 8192) error('request_invalid');
    let request;
    try {
      const bytes = Buffer.from(content.content, 'base64');
      if (bytes.length > 4096 || bytes.length !== content.size) error('request_invalid');
      request = JSON.parse(bytes.toString('utf8'));
      const required = request?.mode === 'inspect-source' ? 'mode,requestId,schemaVersion,testedSha' : 'mode,requestId,schemaVersion';
      if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== required
        || request.schemaVersion !== 1 || !['bootstrap', 'inspect-source', 'preflight', 'live'].includes(request.mode)
        || typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/u.test(request.requestId)
        || request.mode === 'inspect-source' && request.testedSha !== constants.inspectedSha) error('request_invalid');
      snapshot.request = { path: constants.requestPath, commitSha: env.CONTROLLED_SHA,
        bytesSha256: hash(bytes), schemaVersion: request.schemaVersion, mode: request.mode, requestId: request.requestId,
        ...(request.mode === 'inspect-source' ? { testedSha: request.testedSha } : {}) };
    } catch { error('request_invalid'); }
    const workflowContext = { callerCommitSha: env.CONTROLLED_SHA, repository: constants.repository,
      repositoryId: constants.repositoryId, ownerId: constants.ownerId, actorId: constants.actorId,
      expectedBranch: constants.ref, pinnedWorkflowSha: trustedSha, eventName: 'push', runAttempt: 1 };
    const control = path.join(env.RUNNER_TEMP, 'controlled-model-control');
    fs.mkdirSync(control, { mode: 0o700 });
    const writeControl = (name, bytes) => fs.writeFileSync(path.join(control, name), bytes, { flag: 'wx', mode: 0o600 });
    const plan = { schemaVersion: 1, request, workflowContext, trustedSha, githubRunId: env.CONTROLLED_RUN_ID, manifestSha256: null };
    if (['preflight', 'live'].includes(request.mode)) {
      let manifestContent;
      try { manifestContent = (await github.rest.repos.getContent({ owner: '2NTTY', repo: 'child-ai-caregiver',
        path: constants.manifestPath, ref: env.CONTROLLED_SHA })).data; } catch { error('manifest_unavailable'); }
      if (!manifestContent || Array.isArray(manifestContent) || manifestContent.type !== 'file'
        || manifestContent.path !== constants.manifestPath || manifestContent.encoding !== 'base64'
        || !Number.isSafeInteger(manifestContent.size) || manifestContent.size < 1 || manifestContent.size > 16384
        || typeof manifestContent.content !== 'string' || manifestContent.content.length > 32768) error('manifest_invalid');
      const bytes = Buffer.from(manifestContent.content, 'base64');
      if (bytes.length !== manifestContent.size || bytes.length > 16384) error('manifest_invalid');
      let manifest; try { manifest = JSON.parse(bytes.toString('utf8')); } catch { error('manifest_invalid'); }
      if (!manifest || Array.isArray(manifest) || !sha(manifest.testedSha) || manifest.harnessSha !== trustedSha
        || manifest.runId !== request.requestId || manifest.repository !== constants.repository) error('manifest_invalid');
      plan.manifestSha256 = hash(bytes); plan.testedSha = manifest.testedSha;
      writeControl('approved-manifest.json', bytes);
    } else if (request.mode === 'inspect-source') plan.testedSha = request.testedSha;
    writeControl('plan.json', canonical(plan) + '\n');
    result.status = request.mode === 'bootstrap' ? 'claims_recorded_root_review_required' : 'identity_recorded_preparation_required';
    result.mode = request.mode;
    core.setOutput('mode', request.mode);
    core.setOutput('trusted-reusable-sha', trustedSha);
    if (plan.testedSha) core.setOutput('tested-sha', plan.testedSha);
  } catch (cause) {
    result.errorCategory = typeof cause?.category === 'string' ? cause.category : 'bootstrap_error_redacted';
    if (snapshot.oidc.status === 'requesting') snapshot.oidc.status = 'failed';
    core.setFailed(result.errorCategory);
  } finally {
    try {
      if (!directory) error('evidence_directory_unavailable');
      result.bootstrapEvidenceSha256 = persist('bootstrap.json', snapshot);
      const resultSha256 = persist('result.json', result);
      core.info(`CONTROLLED_BOOTSTRAP_JSON ${canonical(snapshot)}`);
      core.info(`CONTROLLED_RESULT_JSON ${canonical(result)}`);
      core.info(`CONTROLLED_RESULT_SHA256 ${resultSha256}`);
      core.setOutput('evidence-ready', 'true');
    } catch {
      core.setFailed('evidence_persistence_failed');
    }
  }
}

module.exports = { controlledBootstrap };
