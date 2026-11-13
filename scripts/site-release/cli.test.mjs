import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch, main, readRemoteStatus, remotePlan, trustedRun } from './cli.mjs';

const repository = { id: 42, full_name: '2NTTY/child-ai-caregiver' };
const workflow = { id: 9, path: '.github/workflows/site-release.yml', state: 'active', created_at: '2026-11-12T14:37:00Z' };
const sha = 'a'.repeat(40);
const run = (id, conclusion = 'success') => ({ id, workflow_id: 9, head_branch: 'master', path: workflow.path, head_sha: sha,
  head_repository: repository, event: 'workflow_dispatch', conclusion, status: 'completed', html_url: `https://github.com/2NTTY/child-ai-caregiver/actions/runs/${id}`,
  created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:01:00Z' });
const state = { observedAt: '2026-11-12T00:01:00Z', lastScheduledAt: null, vm: { status: 'RUNNING', terminationTime: null }, paused: false,
  services: { web: null, api: null, worker: null }, rollbackCandidates: [], lastResult: 'success', releaseId: null };

test('planning an already deployed master needs only the GitHub head lookup', async () => {
  const service = { sha, digest: 'sha256:'+'1'.repeat(64) };
  const snapshot = { status: { ...state, services:{web:service,api:service,worker:service} } };
  const reads = [];
  const view = await remotePlan(snapshot, { exec:async (cmd,args) => {
    reads.push([cmd,...args]);
    assert.deepEqual([cmd,...args], ['gh','api','repos/2NTTY/child-ai-caregiver/commits/master']);
    return JSON.stringify({sha});
  } });
  assert.equal(reads.length,1);
  assert.deepEqual([view.plan.web,view.plan.backend],[false,false]);
});

function fakeRunner({ runs = [run(2, 'failure'), run(1)], noWorkflow = false, transportError = false, malformed = false } = {}) {
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...args]);
    assert.equal(command, 'gh');
    if (args[0] === 'run') {
      assert.deepEqual(args.slice(0, 7), ['run', 'download', '1', '--repo', repository.full_name, '--name', 'site-status']);
      await writeFile(join(args[args.indexOf('--dir') + 1], 'status.json'), JSON.stringify(malformed ? {} : state));
      return '';
    }
    const endpoint = args[1];
    if (endpoint === `repos/${repository.full_name}`) return JSON.stringify(repository);
    if (endpoint.endsWith('/workflows/site-release.yml')) {
      if (noWorkflow) throw new Error('HTTP 404: Not Found');
      return JSON.stringify(workflow);
    }
    if (transportError) throw new Error('TLS connection reset');
    if (endpoint.includes('/runs?')) return JSON.stringify([{ workflow_runs: runs }]);
    if (endpoint.includes('/artifacts?')) return JSON.stringify([{ artifacts: [{ id: 5, name: 'site-status', expired: false, workflow_run: { id: 1, head_repository_id: 42, head_sha: sha } }] }]);
    throw new Error(`Unexpected request ${args.join(' ')}`);
  };
  return { exec, calls };
}

test('status identifies failed latest attempt and trusted successful artifact provenance', async () => {
  const fake = fakeRunner();
  const result = await readRemoteStatus({ exec: fake.exec });
  assert.equal(result.latestAttempt.id, 2); assert.equal(result.latestAttempt.conclusion, 'failure');
  assert.equal(result.latestAttempt.summaryUrl, run(2).html_url);
  assert.match(result.latestAttempt.failureDetails.logsCommand, /gh run view 2 .*--log-failed/);
  assert.equal(result.provenance.runId, 1); assert.equal(result.provenance.sha, sha);
  assert.equal(result.status.observedAt, state.observedAt); assert.equal(result.bootstrapPending, false);
  assert.equal(fake.calls.some((call) => call.includes('workflow')), false);
});

test('fork, PR, different branch and workflow runs cannot supply status artifacts', () => {
  for (const unsafe of [ { head_repository: { ...repository, full_name: 'fork/child-ai-caregiver' } }, { event: 'pull_request' }, { head_branch: 'feature' }, { workflow_id: 10 }, { path: '.github/workflows/other.yml' } ]) {
    assert.equal(trustedRun({ ...run(1), ...unsafe }, workflow, repository), false);
  }
});

test('first install reports bootstrap pending without inventing deployed state', async () => {
  const fake = fakeRunner({ noWorkflow: true });
  const result = await readRemoteStatus({ exec: fake.exec });
  assert.equal(result.bootstrapPending, true); assert.equal(result.status, null);
  assert.match(result.message, /Bootstrap pending/);
  assert.equal(result.daily.state, 'never-scheduled'); assert.equal(result.daily.overdue, null);
});

test('transport errors and malformed artifacts fail instead of becoming skipped', async () => {
  await assert.rejects(readRemoteStatus({ exec: fakeRunner({ transportError: true }).exec }), /TLS/);
  await assert.rejects(readRemoteStatus({ exec: fakeRunner({ malformed: true }).exec }), /Malformed site status/);
});

test('no successful artifact preserves latest attempt and explicitly reports bootstrap pending', async () => {
  const result = await readRemoteStatus({ exec: fakeRunner({ runs: [run(2, 'failure')] }).exec });
  assert.equal(result.bootstrapPending, true); assert.equal(result.latestAttempt.conclusion, 'failure');
});

test('latest attempt includes a newly rerun older workflow run', async () => {
  const rerun = { ...run(1, 'failure'), run_attempt: 2, run_started_at: '2026-11-13T00:00:00Z' };
  const result = await readRemoteStatus({ exec: fakeRunner({ runs: [run(2, 'failure'), rerun] }).exec });
  assert.equal(result.latestAttempt.id, 1); assert.equal(result.latestAttempt.attempt, 2);
});

test('mutations only dispatch fixed master workflow and validate operation and release IDs', async () => {
  const calls = [];
  const exec = async (...args) => { calls.push(args); return ''; };
  await dispatch('rollback', 'site-20261112', { exec });
  assert.deepEqual(calls[0].slice(0, 2), ['gh', ['api', '--method', 'POST', '-H', 'X-GitHub-Api-Version: 2022-11-28',
    `repos/${repository.full_name}/actions/workflows/site-release.yml/dispatches`, '-f', 'ref=master',
    '-f', 'inputs[operation]=rollback', '-f', 'inputs[release_id]=site-20261112']]);
  await assert.rejects(dispatch('delete', null, { exec }), /Unsupported/);
  await assert.rejects(dispatch('rollback', null, { exec }), /release ID/);
  await assert.rejects(dispatch('run', 'bad\nvalue', { exec }), /release ID/);
  assert.equal(calls.length, 1);
});

test('rollback without an ID lists read-only candidates without dispatching', async () => {
  const fake = fakeRunner();
  const result = await main(['rollback'], { exec: fake.exec });
  assert.deepEqual(result.rollbackCandidates, []); assert.equal(result.dispatched, false);
  assert.equal(fake.calls.some((call) => call[1] === 'workflow'), false);
});

test('daily status reports the latest scheduled failure and a missed next daily attempt', async () => {
  const scheduled = { ...run(2, 'failure'), actor: {login:'2ntty-yuyoufang-site-timer[bot]'}, display_title:'Daily website check 2026-11-11' };
  const manual = { ...scheduled, id:3, actor:{login:'2NTTY'}, created_at:'2026-11-12T00:30:00Z' };
  const fresh = await readRemoteStatus({ exec: fakeRunner({ runs: [manual, scheduled, run(1)] }).exec, now: new Date('2026-11-12T01:00:00Z') });
  assert.equal(fresh.daily.state, 'current'); assert.equal(fresh.daily.lastAttempt.conclusion, 'failure');
  assert.equal(fresh.daily.lastScheduledAt, scheduled.created_at);
  const old = await readRemoteStatus({ exec: fakeRunner({ runs: [scheduled, run(1)] }).exec, now: new Date('2026-11-12T22:17:01Z') });
  assert.equal(old.daily.state, 'overdue'); assert.equal(old.daily.overdue, true);
  assert.equal(old.daily.nextExpectedBy, '2026-11-12T22:17:00.000Z');
});

test('the first daily slot can become overdue even if manual runs keep succeeding', async () => {
  const check = (time) => readRemoteStatus({ exec: fakeRunner().exec, now: new Date(time) });
  const first = await check('2026-11-12T16:55:00Z');
  assert.equal(first.daily.state, 'awaiting-first');
  assert.equal(first.daily.expectedAt, '2026-11-12T20:17:00.000Z');
  assert.equal(first.daily.overdue, false);
  const late = await check('2026-11-12T22:17:01Z');
  assert.equal(late.daily.state, 'overdue');
  assert.equal(late.daily.lastScheduledAt, null);
});

test('a rerun of an older scheduled event cannot hide a missed day', async () => {
  const older = { ...run(3, 'failure'), event: 'schedule', created_at: '2026-11-10T20:22:00Z',
    run_started_at: '2026-11-13T03:00:00Z', run_attempt: 2 };
  const latest = { ...run(2, 'failure'), event: 'schedule', created_at: '2026-11-11T20:23:00Z' };
  const snapshot = await readRemoteStatus({ exec: fakeRunner({ runs: [older, latest, run(1)] }).exec,
    now: new Date('2026-11-13T03:01:00Z') });
  assert.equal(snapshot.latestAttempt.id, 3);
  assert.equal(snapshot.daily.lastAttempt.id, 2);
  assert.equal(snapshot.daily.lastScheduledAt, latest.created_at);
  assert.equal(snapshot.daily.overdue, true);
});
