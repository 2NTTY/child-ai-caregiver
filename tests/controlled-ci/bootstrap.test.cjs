'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { controlledBootstrap } = require('../../scripts/controlled-ci/bootstrap.cjs');

const root = path.resolve(__dirname, '../..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const testedSha = 'a'.repeat(40), trustedSha = 'b'.repeat(40);
const provider = 'projects/1064034424208/locations/global/workloadIdentityPools/github-model-tests/providers/child-ai-caregiver-ci';
const requestPath = '.github/controlled-model/request.json';
const callerPath = '.github/workflows/controlled-model-acceptance.yml';
const callerRef = `2NTTY/child-ai-caregiver/${callerPath}@refs/heads/ci/controlled-model-acceptance`;
const syntheticCredential = 'SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR';
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-ci-test-'));
  const env = { RUNNER_TEMP: temp, CONTROLLED_REPOSITORY: '2NTTY/child-ai-caregiver',
    CONTROLLED_REPOSITORY_ID: '1377602504', CONTROLLED_OWNER_ID: '119132090',
    CONTROLLED_REF: 'refs/heads/ci/controlled-model-acceptance', CONTROLLED_EVENT_NAME: 'push',
    CONTROLLED_RUN_ID: '123456789', CONTROLLED_RUN_ATTEMPT: '1', CONTROLLED_ACTOR_ID: '119132090',
    CONTROLLED_SHA: testedSha, CONTROLLED_WORKFLOW_REF: callerRef, CONTROLLED_WORKFLOW_SHA: testedSha,
    CONTROLLED_RUNNER_ENVIRONMENT: 'github-hosted', UNRELATED_PRIVATE_VALUE: syntheticCredential };
  const claims = { repository_id: '1377602504', repository_owner_id: '119132090',
    ref: env.CONTROLLED_REF, event_name: 'push', workflow_ref: callerRef, actor_id: '119132090',
    runner_environment: 'github-hosted',
    job_workflow_ref: `2NTTY/child-ai-caregiver/.github/workflows/run-controlled-model-acceptance.yml@${trustedSha}`,
    job_workflow_sha: trustedSha, run_attempt: '1', aud: provider, iss: 'https://token.actions.githubusercontent.com',
    arbitrary_private_claim: syntheticCredential, sub: syntheticCredential, jti: syntheticCredential };
  const run = { id: 123456789, event: 'push', run_attempt: 1, head_sha: testedSha,
    head_branch: 'ci/controlled-model-acceptance', path: callerPath,
    repository: { id: 1377602504, owner: { id: 119132090 }, full_name: '2NTTY/child-ai-caregiver' },
    actor: { id: 119132090, login: syntheticCredential }, triggering_actor: { id: 119132090 } };
  const state = { info: [], failed: [], outputs: {}, tokenRequests: [], contentRequests: [], runRequests: [],
    request: { schemaVersion: 1, mode: 'bootstrap', requestId: 'bootstrap_20261009' }, run, claims,
    oidcError: null, apiError: null, rawToken: null, customContent: null, manifest: { testedSha, harnessSha: trustedSha, repository: '2NTTY/child-ai-caregiver', runId: 'bootstrap_20261009' } };
  const core = { info: message => state.info.push(message), setFailed: message => state.failed.push(message),
    setOutput: (key, value) => { state.outputs[key] = value; },
    getIDToken: async audience => {
      state.tokenRequests.push(audience);
      if (state.oidcError) throw state.oidcError;
      state.rawToken = state.customToken ?? `${Buffer.from('{"alg":"synthetic"}').toString('base64url')}.${Buffer.from(JSON.stringify(state.claims)).toString('base64url')}.${syntheticCredential}`;
      return state.rawToken;
    } };
  const github = { rest: { actions: { getWorkflowRun: async args => {
    state.runRequests.push(args); if (state.apiError) throw state.apiError; return { data: state.run };
  } }, repos: { getContent: async args => {
    state.contentRequests.push(args);
    const bytes = Buffer.from(JSON.stringify(args.path === requestPath ? state.request : state.manifest));
    return { data: state.customContent ?? { type: 'file', path: args.path, encoding: 'base64',
      size: bytes.length, content: bytes.toString('base64') } };
  } } } };
  const context = { eventName: 'push', runId: 123456789, sha: testedSha, ref: env.CONTROLLED_REF,
    repo: { owner: '2NTTY', repo: 'child-ai-caregiver' } };
  return { env, state, core, github, context, temp,
    execute: () => controlledBootstrap({ core, github, context, env }),
    read: name => JSON.parse(fs.readFileSync(path.join(temp, 'controlled-model-evidence', name), 'utf8')),
    dispose: () => fs.rmSync(temp, { recursive: true, force: true }) };
}
async function withFixture(callback) { const f = fixture(); try { await callback(f); } finally { f.dispose(); } }

// This is a synthetic native API substitute. No tests contact GitHub or acquire any credential.
test('bootstrap records bounded native claims and server metadata with the fixed verified actor identity', async () => withFixture(async f => {
  await f.execute();
  assert.deepEqual(f.state.failed, []);
  assert.equal(f.read('result.json').status, 'claims_recorded_root_review_required');
  assert.equal(f.read('result.json').ownerActorVerified, true);
  assert.equal(f.read('result.json').gcpAuthenticationPerformed, false);
  assert.equal(f.read('result.json').modelCallsPerformed, 0);
  assert.equal(f.read('result.json').ledgerInitialized, false);
  assert.equal(f.read('result.json').historicalActualCostUnknown, true);
  assert.equal(f.read('result.json').spendingState, 'not_loaded');
  assert.equal(f.read('bootstrap.json').serverRun.actorId, '119132090');
  assert.equal(f.read('bootstrap.json').oidc.signatureVerification, 'not_performed');
  assert.equal(f.state.outputs['trusted-reusable-sha'], trustedSha);
  assert.equal(f.state.outputs['evidence-ready'], 'true');
  assert.deepEqual(f.state.tokenRequests, [provider]);
  assert.deepEqual(f.state.contentRequests, [{ owner: '2NTTY', repo: 'child-ai-caregiver', path: requestPath, ref: testedSha }]);
  const outputs = f.state.info.join('\n') + fs.readFileSync(path.join(f.temp, 'controlled-model-evidence', 'bootstrap.json'));
  assert.equal(outputs.includes(syntheticCredential), false);
  assert.equal(outputs.includes(f.state.rawToken), false);
  assert.deepEqual(Object.keys(f.read('bootstrap.json').oidc.claims).sort(), ['actor_id', 'aud', 'event_name',
    'iss', 'job_workflow_ref', 'job_workflow_sha', 'ref', 'repository_id', 'repository_owner_id',
    'run_attempt', 'runner_environment', 'workflow_ref'].sort());
  const result = f.read('result.json');
  assert.equal(result.bootstrapEvidenceSha256, digest(fs.readFileSync(path.join(f.temp, 'controlled-model-evidence', 'bootstrap.json'))));
  for (const name of ['bootstrap.json', 'result.json']) {
    const stat = fs.statSync(path.join(f.temp, 'controlled-model-evidence', name));
    assert.ok(stat.size <= 16384); assert.equal(stat.mode & 0o777, 0o600);
  }
  assert.deepEqual(fs.readdirSync(path.join(f.temp, 'controlled-model-evidence')).sort(), ['bootstrap.json', 'result.json']);
}));

test('live request only prepares a byte-pinned control plan and never authenticates or invokes a provider', async () => withFixture(async f => {
  f.state.request.mode = 'live'; await f.execute();
  assert.deepEqual(f.state.failed, []);
  assert.equal(f.read('result.json').status, 'identity_recorded_preparation_required');
  assert.equal(f.read('result.json').modelCallsPerformed, 0);
  assert.equal(f.read('result.json').liveEnabled, true);
  assert.equal(f.read('bootstrap.json').request.mode, 'live');
  const plan = JSON.parse(fs.readFileSync(path.join(f.temp, 'controlled-model-control', 'plan.json')));
  assert.equal(plan.request.mode, 'live');
  assert.equal(plan.manifestSha256, digest(fs.readFileSync(path.join(f.temp, 'controlled-model-control', 'approved-manifest.json'))));
  assert.equal(plan.workflowContext.callerCommitSha, testedSha);
}));

test('inspect-source accepts only the root-reviewed revision and does not load a live manifest', async () => withFixture(async f => {
  f.state.request.mode = 'inspect-source'; f.state.request.testedSha = '94f7c7b260c46b033a970ec92d3125e31f20442c';
  await f.execute(); assert.deepEqual(f.state.failed, []);
  assert.equal(f.state.outputs['tested-sha'], f.state.request.testedSha);
  assert.equal(f.state.contentRequests.length, 1);
}));

test('invalid local execution contexts fail before requesting OIDC or reading a request', async () => {
  for (const [key, value] of [['CONTROLLED_REPOSITORY_ID', '1'], ['CONTROLLED_OWNER_ID', '1'],
    ['CONTROLLED_EVENT_NAME', 'pull_request_target'], ['CONTROLLED_REF', 'refs/pull/1/merge'],
    ['CONTROLLED_RUN_ATTEMPT', '2'], ['CONTROLLED_RUNNER_ENVIRONMENT', 'self-hosted'],
    ['CONTROLLED_WORKFLOW_REF', 'other-workflow'], ['CONTROLLED_SHA', 'master'],
    ['CONTROLLED_RUN_ID', '99999999999999999999']]) await withFixture(async f => {
    f.env[key] = value; await f.execute();
    assert.equal(f.read('result.json').errorCategory, 'context_policy_denied', key);
    assert.deepEqual(f.state.tokenRequests, []); assert.deepEqual(f.state.contentRequests, []);
  });
});

test('server actor and request provenance mismatch prevents credential acquisition', async () => {
  for (const modify of [f => { f.state.run.actor.id = 1; }, f => { f.state.run.triggering_actor.id = 1; },
    f => { f.state.run.repository.id = 1; }, f => { f.state.run.head_sha = trustedSha; },
    f => { f.state.run.path = '.github/workflows/other.yml'; }, f => { f.state.run.run_attempt = 2; }])
    await withFixture(async f => { modify(f); await f.execute();
      assert.equal(f.read('result.json').errorCategory, 'server_run_policy_denied');
      assert.deepEqual(f.state.tokenRequests, []);
    });
});

test('required claims, immutable reusable pin, issuer and audience all fail closed', async () => {
  for (const [key, value] of [['repository_id', '1'], ['repository_owner_id', '1'], ['actor_id', '1'],
    ['job_workflow_ref', '2NTTY/child-ai-caregiver/.github/workflows/run-controlled-model-acceptance.yml@master'],
    ['job_workflow_sha', 'c'.repeat(40)], ['workflow_ref', 'different'], ['ref', 'refs/heads/master'],
    ['run_attempt', '2'], ['runner_environment', 'self-hosted'], ['aud', 'wrong'], ['iss', 'https://example.invalid']])
    await withFixture(async f => { f.state.claims[key] = value; await f.execute();
      assert.equal(f.read('result.json').errorCategory, 'oidc_policy_denied', key);
      assert.deepEqual(f.state.contentRequests, []);
    });
  await withFixture(async f => { delete f.state.claims.job_workflow_sha; await f.execute();
    assert.equal(f.read('result.json').errorCategory, 'oidc_required_claim_missing'); });
});

test('raw OIDC and GitHub errors are replaced with fixed sanitized categories', async () => {
  for (const [key, expected] of [['oidcError', 'oidc_unavailable'], ['apiError', 'server_run_unavailable']])
    await withFixture(async f => { f.state[key] = new Error(syntheticCredential); await f.execute();
      assert.equal(f.read('result.json').errorCategory, expected);
      assert.equal(f.state.info.join('\n').includes(syntheticCredential), false);
      assert.deepEqual(f.state.failed, [expected]);
    });
  await withFixture(async f => { f.state.customToken = syntheticCredential; await f.execute();
    assert.equal(f.read('result.json').errorCategory, 'oidc_claims_invalid');
    assert.equal(f.state.info.join('\n').includes(syntheticCredential), false);
  });
});

test('unexpected request fields cannot grant approval, shell execution, or arbitrary path access', async () => {
  for (const modify of [f => { f.state.request.approved = true; }, f => { f.state.request.command = 'echo arbitrary'; },
    f => { f.state.request.mode = 'mock'; }, f => { f.state.request.requestId = 12345678; }, f => { f.state.request.requestId = '../unsafe'; },
    f => { f.state.customContent = { type: 'symlink', path: requestPath, encoding: 'base64', size: 1, content: 'eA==' }; },
    f => { f.state.customContent = { type: 'file', path: requestPath, encoding: 'base64', size: 4097, content: 'eA==' }; }])
    await withFixture(async f => { modify(f); await f.execute();
      assert.equal(f.read('result.json').errorCategory, 'request_invalid');
      assert.equal(f.read('bootstrap.json').request, null);
      assert.equal(f.state.outputs['evidence-ready'], 'true');
    });
});

test('existing evidence directories and symlinks are not written or uploaded', async () => withFixture(async f => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-ci-denied-'));
  try {
    fs.symlinkSync(elsewhere, path.join(f.temp, 'controlled-model-evidence'));
    await f.execute();
    assert.deepEqual(fs.readdirSync(elsewhere), []);
    assert.equal(f.state.outputs['evidence-ready'], undefined);
    assert.equal(f.state.failed.includes('evidence_persistence_failed'), true);
    assert.deepEqual(f.state.tokenRequests, []);
  } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
}));

test('the workflow embeds the exact tested bootstrap function', () => {
  const module = fs.readFileSync(path.join(root, 'scripts/controlled-ci/bootstrap.cjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/run-controlled-model-acceptance.yml'), 'utf8');
  const start = workflow.indexOf('          script: |\n') + '          script: |\n'.length;
  const end = workflow.indexOf('      - name: Checkout immutable trusted workflow', start);
  const actual = workflow.slice(start, end).split('\n').filter(Boolean).map(line => line.slice(12)).join('\n') + '\n';
  const expected = module.slice(module.indexOf('async function controlledBootstrap'), module.indexOf('\nmodule.exports')).trim()
    + '\nawait controlledBootstrap({ core, github, context });\n';
  assert.equal(actual, expected);
});
