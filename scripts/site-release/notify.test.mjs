import test from 'node:test';
import assert from 'node:assert/strict';
import { notify, MARKER, TITLE } from './notify.mjs';

const now = new Date('2026-11-12T00:00:00Z');
const env = (result = 'success', run = '123') => ({ SITE_WORKFLOW_RESULT: result, GITHUB_REPOSITORY: '2NTTY/child-ai-caregiver', GITHUB_RUN_ID: run });
const status = (days = 30) => ({ observedAt: now.toISOString(), lastScheduledAt: null, paused: false,
  vm: { status: 'RUNNING', terminationTime: new Date(+now + days * 86400000).toISOString() },
  services: { web: null, api: null, worker: null }, rollbackCandidates: [], lastResult: 'deployed', releaseId: null });

function github(issues = []) {
  const calls = [], comments = [];
  const api = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    if (method === 'GET') return [issues];
    if (method === 'POST' && endpoint.endsWith('/comments')) { comments.push(body.body); return {}; }
    if (method === 'POST') {
      const issue = { number: 10, state: 'open', user: { login: 'github-actions[bot]' }, ...body };
      issues.push(issue); return issue;
    }
    if (method === 'PATCH') { Object.assign(issues.find((item) => endpoint.endsWith(`/${item.number}`)), body); return {}; }
    throw new Error('Unexpected GitHub API call');
  };
  return { api, calls, issues, comments };
}

test('healthy successful observations never create an issue', async () => {
  const gh = github();
  const result = await notify({ status: status(), environment: env(), now, api: gh.api });
  assert.equal(result.action, 'none'); assert.equal(gh.calls.length, 1);
});

test('failure creates the single marked issue without an available status artifact', async () => {
  const gh = github();
  const result = await notify({ status: null, environment: env('failure'), now, api: gh.api });
  assert.equal(result.action, 'created'); assert.equal(gh.issues[0].title, TITLE);
  assert.ok(gh.issues[0].body.includes(MARKER)); assert.match(gh.issues[0].body, /Workflow failed/);
  assert.match(gh.issues[0].body, /actions\/runs\/123/);
});

test('seven-day, one-day and expired alerts update the same issue and preserve previous evidence', async () => {
  const gh = github();
  await notify({ status: status(7), environment: env(), now, api: gh.api });
  assert.match(gh.issues[0].body, /within 7 days/);
  await notify({ status: status(0.5), environment: env('success', '124'), now, api: gh.api });
  assert.match(gh.issues[0].body, /within 1 day/);
  await notify({ status: status(-1), environment: env('success', '125'), now, api: gh.api });
  assert.match(gh.issues[0].body, /has expired/);
  assert.equal(gh.issues.length, 1); assert.equal(gh.comments.length, 2);
  assert.match(gh.comments[0], /within 7 days/); assert.match(gh.comments[1], /within 1 day/);
});

test('failure recovery clears only that condition, deadline recovery closes and later failure reopens', async () => {
  const gh = github();
  await notify({ status: status(5), environment: env('failure'), now, api: gh.api });
  await notify({ status: status(5), environment: env('success', '124'), now, api: gh.api });
  assert.equal(gh.issues[0].state, 'open'); assert.doesNotMatch(gh.issues[0].body, /Workflow failed/);
  assert.match(gh.comments[0], /Workflow failed/);
  await notify({ status: status(30), environment: env('success', '125'), now, api: gh.api });
  assert.equal(gh.issues[0].state, 'closed');
  await notify({ status: status(), environment: env('failure', '126'), now, api: gh.api });
  assert.equal(gh.issues[0].state, 'open'); assert.equal(gh.issues.length, 1);
});

test('repeated observations do not post duplicate updates and unrelated issues are untouched', async () => {
  const unrelated = { number: 99, title: TITLE, body: `${MARKER}\nCopied marker`, user: { login: 'someone' }, state: 'open' };
  const gh = github([unrelated]);
  await notify({ status: status(5), environment: env(), now, api: gh.api });
  const writes = gh.calls.filter((call) => call.method !== 'GET').length;
  await notify({ status: status(5), environment: env('success', '124'), now, api: gh.api });
  assert.equal(gh.calls.filter((call) => call.method !== 'GET').length, writes);
  assert.equal(unrelated.body, `${MARKER}\nCopied marker`); assert.equal(unrelated.state, 'open');
});

test('invalid status, repository or run data never closes an issue or reaches shell execution', async () => {
  const gh = github();
  await assert.rejects(notify({ status: null, environment: env(), now, api: gh.api }), /status artifact/);
  await assert.rejects(notify({ status: status(), environment: { ...env(), GITHUB_REPOSITORY: 'fork/project' }, now, api: gh.api }), /repository/);
  await assert.rejects(notify({ status: status(), environment: env('failure', '123;touch /tmp/no'), now, api: gh.api }), /run ID/);
  assert.equal(gh.calls.length, 0);
});

test('a history-write failure never replaces the current evidence or touches an ambiguous issue', async () => {
  const gh = github();
  await notify({ status: status(), environment: env('failure'), now, api: gh.api });
  const body = gh.issues[0].body;
  const api = async (...args) => {
    if (args[0] === 'POST' && args[1].endsWith('/comments')) throw new Error('GitHub unavailable');
    return gh.api(...args);
  };
  await assert.rejects(notify({ status: status(), environment: env('success', '124'), now, api }), /GitHub unavailable/);
  assert.equal(gh.issues[0].body, body); assert.equal(gh.issues[0].state, 'open');
  gh.issues.push({ ...gh.issues[0], number: 11 });
  await assert.rejects(notify({ status: status(), environment: env(), now, api: gh.api }), /Multiple bot-owned/);
  assert.equal(gh.calls.some((call) => call.method === 'PATCH'), false);
});
