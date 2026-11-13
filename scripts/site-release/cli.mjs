#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildPlan, gitDiffs, SHA, validateStatus } from './plan.mjs';

export const REPOSITORY = '2NTTY/child-ai-caregiver';
const WORKFLOW = 'site-release.yml';
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW}`;
const ARTIFACT = 'site-status';
const execAsync = promisify(execFile);
export async function runCommand(command, args, options = {}) {
  try {
    const result = await execAsync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
    return result.stdout;
  } catch (error) {
    // Never include a process environment (which can contain the GitHub token).
    throw new Error(`${command} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

async function api(exec, endpoint, paginate = false) {
  const args = ['api', endpoint];
  if (paginate) args.push('--paginate', '--slurp');
  return JSON.parse(await exec('gh', args));
}

export function trustedRun(run, workflow, repository) {
  return Number.isSafeInteger(run.id) && run.workflow_id === workflow.id
    && run.head_branch === 'master' && run.path === WORKFLOW_PATH
    && run.head_repository?.full_name === REPOSITORY && run.head_repository?.id === repository.id
    && ['schedule', 'workflow_dispatch'].includes(run.event) && SHA.test(run.head_sha);
}

function summarizeRun(run) {
  if (!run) return null;
  const summaryUrl = `https://github.com/${REPOSITORY}/actions/runs/${run.id}`;
  return { id: run.id, url: summaryUrl, summaryUrl, sha: run.head_sha, event: run.event, status: run.status,
    conclusion: run.conclusion, attempt: run.run_attempt || 1,
    createdAt: run.created_at, startedAt: run.run_started_at || run.created_at, updatedAt: run.updated_at,
    failureDetails: run.conclusion && run.conclusion !== 'success' ? { summaryUrl,
      logsCommand: `gh run view ${run.id} --repo ${REPOSITORY} --log-failed` } : null };
}

const attemptTime = (run) => Date.parse(run.run_started_at || run.created_at || run.updated_at) || 0;

function dailyStatus(runs, status, now, workflow) {
  // Keep historic native events visible across the cutover. Manual checks do not advance the clock.
  const latest = runs.filter(run => run.event === 'schedule' || (run.event === 'workflow_dispatch'
    && run.actor?.login === '2ntty-yuyoufang-site-timer[bot]'
    && /^Daily website check \d{4}-\d{2}-\d{2}$/.test(run.display_title)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const lastAttempt = summarizeRun(latest);
  const lastScheduledAt = lastAttempt?.createdAt ?? status?.lastScheduledAt ?? null;
  const baseline = Date.parse(lastScheduledAt ?? workflow?.created_at);
  const evidence = { lastScheduledAt, lastAttempt, expectedAt: null, nextExpectedBy: null, overdue: null };
  if (workflow?.state && workflow.state !== 'active') return { ...evidence, state: 'disabled', message: workflow.state };
  if (!Number.isFinite(baseline)) return { ...evidence, state: 'never-scheduled', message: 'No workflow registration or scheduled event has been observed.' };
  const slot = new Date(baseline);
  slot.setUTCHours(20, 17, 0, 0);
  if (+slot <= baseline) slot.setUTCDate(slot.getUTCDate() + 1);
  const deadline = new Date(+slot + 2 * 60 * 60 * 1000);
  const overdue = +now > +deadline;
  const state = overdue ? 'overdue' : lastScheduledAt ? 'current' : 'awaiting-first';
  return { ...evidence, state, overdue, expectedAt: slot.toISOString(), nextExpectedBy: deadline.toISOString(),
    message: 'GCP dispatches at 04:17 Hong Kong time (20:17 UTC). Status allows two hours before flagging a missing run.' };
}

export async function readRemoteStatus({ exec = runCommand, now = new Date() } = {}) {
  // Verify repository access before treating a workflow 404 as first installation.
  const repository = await api(exec, `repos/${REPOSITORY}`);
  if (repository.full_name !== REPOSITORY || !Number.isSafeInteger(repository.id)) throw new Error('Unexpected GitHub repository identity.');
  const result = { repository: REPOSITORY, workflow: WORKFLOW_PATH, bootstrapPending: true,
    message: 'Bootstrap pending: no successful trusted site-status artifact is available.',
    latestAttempt: null, provenance: null, status: null, daily: dailyStatus([], null, now) };
  let workflow;
  try { workflow = await api(exec, `repos/${REPOSITORY}/actions/workflows/${WORKFLOW}`); }
  catch (error) {
    if (/\bHTTP 404\b/.test(error.message)) return result;
    throw error;
  }
  if (workflow.path !== WORKFLOW_PATH || !Number.isSafeInteger(workflow.id)) throw new Error('Unexpected GitHub workflow identity.');
  const pages = await api(exec, `repos/${REPOSITORY}/actions/workflows/${workflow.id}/runs?branch=master&per_page=100`, true);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page.workflow_runs))) throw new Error('Malformed workflow run listing.');
  const runs = pages.flatMap((page) => page.workflow_runs).filter((run) => trustedRun(run, workflow, repository))
    .sort((a, b) => attemptTime(b) - attemptTime(a) || b.id - a.id);
  result.latestAttempt = summarizeRun(runs[0]);
  result.daily = dailyStatus(runs, null, now, workflow);
  for (const run of runs) {
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    const artifactPages = await api(exec, `repos/${REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`, true);
    if (!Array.isArray(artifactPages) || artifactPages.some((page) => !Array.isArray(page.artifacts))) throw new Error('Malformed artifact listing.');
    const candidates = artifactPages.flatMap((page) => page.artifacts).filter((artifact) => artifact.name === ARTIFACT && artifact.expired === false);
    if (candidates.length > 1) throw new Error('Ambiguous trusted site-status artifacts.');
    if (!candidates.length) continue;
    const artifact = candidates[0];
    if (!Number.isSafeInteger(artifact.id) || (artifact.workflow_run && (artifact.workflow_run.id !== run.id
        || artifact.workflow_run.head_repository_id !== repository.id || artifact.workflow_run.head_sha !== run.head_sha))) {
      throw new Error('Status artifact provenance does not match the trusted workflow run.');
    }
    const directory = await mkdtemp(join(tmpdir(), 'site-status-'));
    try {
      await exec('gh', ['run', 'download', String(run.id), '--repo', REPOSITORY, '--name', ARTIFACT, '--dir', directory]);
      const path = join(directory, 'status.json');
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink() || file.size > 1024 * 1024) throw new Error('Invalid status.json artifact file.');
      result.status = validateStatus(JSON.parse(await readFile(path, 'utf8')));
      result.daily = dailyStatus(runs, result.status, now, workflow);
      result.provenance = { runId: run.id, runUrl: run.html_url, sha: run.head_sha, artifactId: artifact.id,
        observedAt: result.status.observedAt, completedAt: run.updated_at };
      result.bootstrapPending = false;
      result.message = 'Observed site status from a successful trusted master workflow; this is a timestamped snapshot.';
      return result;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  return result;
}

export async function remotePlan(snapshot, { exec = runCommand } = {}) {
  const master = await api(exec, `repos/${REPOSITORY}/commits/master`);
  if (!SHA.test(master.sha)) throw new Error('GitHub did not return an immutable master SHA.');
  if (!snapshot.status) return { targetSha: master.sha, plan: null, message: `${snapshot.message} Run the workflow to inspect and bootstrap the existing site before planning.` };
  const services = Object.values(validateStatus(snapshot.status).services);
  if (services.every(service => service?.sha === master.sha)) {
    return { targetSha: master.sha, plan: buildPlan(snapshot.status, master.sha, {}) };
  }
  const directory = await mkdtemp(join(tmpdir(), 'site-plan-'));
  try {
    // GitHub comparisons cap their file list. Fetch immutable trees into an isolated
    // bare repository so this also works from a shallow or stale operator checkout.
    const token = (await exec('gh', ['auth', 'token'])).trim();
    if (!token || /[\r\n]/.test(token)) throw new Error('GitHub authentication token is unavailable.');
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0',
      SITE_RELEASE_GIT_AUTH: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` };
    await exec('git', ['init', '--bare', directory]);
    const shas = [...new Set([master.sha, ...Object.values(snapshot.status.services).filter(Boolean).map((service) => service.sha)])];
    for (const sha of shas) {
      await exec('git', ['--config-env=http.https://github.com/.extraheader=SITE_RELEASE_GIT_AUTH', '-c', 'credential.helper=',
        '-C', directory, 'fetch', '--no-tags', '--depth=1', `https://github.com/${REPOSITORY}.git`, sha], { env: environment });
    }
    return { targetSha: master.sha, plan: buildPlan(snapshot.status, master.sha, gitDiffs(snapshot.status, master.sha, directory)) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function dispatch(operation, releaseId, { exec = runCommand } = {}) {
  if (!['run', 'pause', 'resume', 'rollback'].includes(operation)) throw new Error('Unsupported site release operation.');
  if (releaseId != null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(releaseId)) throw new Error('Invalid release ID.');
  if (operation === 'rollback' && !releaseId) throw new Error('Rollback requires a release ID from status.rollbackCandidates.');
  // Accept the dispatch asynchronously. A receipt is read through status, even if the CLI disconnects.
  const args = ['api', '--method', 'POST', '-H', 'X-GitHub-Api-Version: 2022-11-28',
    `repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, '-f', 'ref=master', '-f', `inputs[operation]=${operation}`];
  if (releaseId) args.push('-f', `inputs[release_id]=${releaseId}`);
  await exec('gh', args);
  return { dispatched: true, repository: REPOSITORY, workflow: WORKFLOW_PATH, ref: 'master', operation,
    releaseId: releaseId || null, message: 'Workflow dispatch accepted. Use status to inspect the latest attempt and observed result.' };
}

export async function main(args = process.argv.slice(2), options = {}) {
  const [operation, releaseId, ...extra] = args;
  if (extra.length || !['status', 'plan', 'run', 'pause', 'resume', 'rollback'].includes(operation) || (['status', 'plan'].includes(operation) && releaseId)) {
    throw new Error('Usage: npm run deploy:site -- status|plan|run|pause|resume|rollback [releaseId]');
  }
  if (operation === 'status') return readRemoteStatus(options);
  if (operation === 'rollback' && !releaseId) {
    const snapshot = await readRemoteStatus(options);
    return { ...snapshot, operation: 'rollback', dispatched: false,
      rollbackCandidates: snapshot.status?.rollbackCandidates || [],
      message: snapshot.status ? 'Select a listed releaseId and run rollback <releaseId> to dispatch a rollback.' : snapshot.message };
  }
  if (operation === 'plan') {
    const snapshot = await readRemoteStatus(options);
    return { ...snapshot, ...await remotePlan(snapshot, options) };
  }
  return dispatch(operation, releaseId, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
