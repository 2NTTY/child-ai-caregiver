#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY } from './cli.mjs';
import { validateStatus } from './plan.mjs';

export const MARKER = '<!-- yuyoufang-site-release-alert:v1 -->';
export const TITLE = 'Site release failure or VM termination deadline';
const STATE_MARKER = '<!-- site-release-alert-state:';
const BOT = 'github-actions[bot]';

// All request data is JSON on stdin. Actor names, artifact data and issue content
// are never interpreted by a shell or interpolated into a command string.
export function githubApi(method, endpoint, body, paginate = false) {
  return new Promise((resolveRequest, reject) => {
    const args = ['api', '--method', method, endpoint];
    if (paginate) args.push('--paginate', '--slurp');
    if (body !== undefined) args.push('--input', '-');
    const child = spawn('gh', args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let output = '', errorOutput = '', settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 16 * 1024 * 1024) { child.kill(); fail(new Error('GitHub issue response exceeded the safe limit.')); }
    });
    child.stderr.on('data', (chunk) => { errorOutput = (errorOutput + chunk.toString()).slice(-4096); });
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) return fail(new Error(`GitHub issue API failed (${code}): ${errorOutput.trim()}`));
      try { const result = output.trim() ? JSON.parse(output) : null; settled = true; resolveRequest(result); }
      catch { fail(new Error('Malformed GitHub issue API response.')); }
    });
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function notification(status, environment, now) {
  if (environment.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('Unexpected notification repository.');
  if (!/^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID || '')) throw new Error('Invalid GitHub run ID.');
  if (!['success', 'failure'].includes(environment.SITE_WORKFLOW_RESULT)) throw new Error('Expected SITE_WORKFLOW_RESULT=success|failure.');
  const attempt = environment.GITHUB_RUN_ATTEMPT || '1';
  if (!/^[1-9][0-9]{0,3}$/.test(attempt)) throw new Error('Invalid GitHub run attempt.');
  if (!Number.isFinite(+now)) throw new Error('Invalid notification time.');
  let evidence = null;
  try { if (status) evidence = validateStatus(status); }
  catch { /* A failed job still needs an alert even when its artifact is invalid. */ }
  if (!evidence && environment.SITE_WORKFLOW_RESULT !== 'failure') throw new Error('A valid status artifact is required before clearing an alert.');
  const failed = environment.SITE_WORKFLOW_RESULT === 'failure' || evidence?.lastResult === 'failed';
  const terminationTime = evidence?.vm.terminationTime ? new Date(evidence.vm.terminationTime).toISOString() : null;
  const remaining = terminationTime ? Date.parse(terminationTime) - +now : Infinity;
  const deadline = remaining <= 0 ? 'expired' : remaining <= 86400000 ? '1-day' : remaining <= 7 * 86400000 ? '7-day' : null;
  const fingerprint = JSON.stringify({ failure: failed ? `${environment.GITHUB_RUN_ID}-${attempt}` : null,
    deadline: deadline ? `${deadline}:${terminationTime}` : null, statusAvailable: !!evidence });
  const lines = [MARKER, `${STATE_MARKER}${fingerprint} -->`, '', 'Current site release alert status:', ''];
  if (failed) lines.push('- Workflow failed or reported a failed release. Inspect the linked run before retrying.');
  else lines.push('- The latest workflow succeeded; no current release failure is reported.');
  if (deadline === 'expired') lines.push(`- The observed VM termination deadline has expired: ${terminationTime}.`);
  else if (deadline === '1-day') lines.push(`- The observed VM termination deadline is within 1 day: ${terminationTime}.`);
  else if (deadline === '7-day') lines.push(`- The observed VM termination deadline is within 7 days: ${terminationTime}.`);
  else if (terminationTime) lines.push(`- The observed VM termination deadline is outside the warning window: ${terminationTime}.`);
  else lines.push('- No VM termination deadline is available in this observation.');
  lines.push(evidence ? `- Site status observed at: ${new Date(evidence.observedAt).toISOString()}.`
    : '- The status artifact is missing or invalid; current VM and service state are unknown.');
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}/attempts/${attempt}`;
  lines.push(`- Workflow run: [${environment.GITHUB_RUN_ID}, attempt ${attempt}](${runUrl}).`,
    `- Alert checked at: ${now.toISOString()}.`, '',
    'Previous alert states are retained in this issue and its comments. This issue is managed by the site release notification job.');
  return { active: failed || !!deadline, fingerprint, body: lines.join('\n') };
}

function previousFingerprint(body) {
  const line = String(body || '').split('\n').find((entry) => entry.startsWith(STATE_MARKER) && entry.endsWith(' -->'));
  return line ? line.slice(STATE_MARKER.length, -4) : null;
}

export async function notify({ status, environment = process.env, now = new Date(), api = githubApi }) {
  const desired = notification(status, environment, now);
  const base = `repos/${REPOSITORY}/issues`;
  const pages = await api('GET', `${base}?state=all&creator=${encodeURIComponent(BOT)}&per_page=100`, undefined, true);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error('Malformed GitHub issue listing.');
  const issues = pages.flat().filter((issue) => !issue.pull_request && issue.title === TITLE && issue.user?.login === BOT
    && typeof issue.body === 'string' && issue.body.split('\n').includes(MARKER));
  if (issues.length > 1) throw new Error('Multiple bot-owned site release alert issues exist; refusing ambiguous writes.');
  const issue = issues[0];
  if (!issue) {
    if (!desired.active) return { action: 'none' };
    const created = await api('POST', base, { title: TITLE, body: desired.body });
    return { action: 'created', issue: created.number };
  }
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Invalid notification issue identity.');
  const state = desired.active ? 'open' : 'closed';
  const wasClosed = issue.state === 'closed';
  if (issue.state === state && previousFingerprint(issue.body) === desired.fingerprint) return { action: 'none', issue: issue.number };
  // Preserve the old failure before replacing the current-status body. If either
  // API request fails, retrying cannot erase the last known failure evidence.
  await api('POST', `${base}/${issue.number}/comments`, { body: `Previous site release alert state:\n\n${issue.body}` });
  await api('PATCH', `${base}/${issue.number}`, { state, body: desired.body });
  return { action: state === 'closed' ? 'closed' : wasClosed ? 'reopened' : 'updated', issue: issue.number };
}

export async function main() {
  let status = null;
  try { status = JSON.parse(await readFile('site-status/status.json', 'utf8')); }
  catch (error) { if (process.env.SITE_WORKFLOW_RESULT !== 'failure') throw new Error(`Cannot read valid site-status/status.json: ${error.message}`); }
  return notify({ status });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
