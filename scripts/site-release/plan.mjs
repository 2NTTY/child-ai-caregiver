#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHA = /^[a-f0-9]{40}$/;
const SERVICES = ['web', 'api', 'worker'];

export function validateStatus(status) {
  if (!status || typeof status !== 'object' || !Number.isFinite(Date.parse(status.observedAt))
      || typeof status.paused !== 'boolean' || !status.services || !status.vm
      || typeof status.vm.status !== 'string' || !Array.isArray(status.rollbackCandidates)
      || !Object.hasOwn(status, 'lastResult') || !Object.hasOwn(status, 'releaseId')) {
    throw new Error('Malformed site status artifact.');
  }
  for (const key of ['lastScheduledAt']) {
    if (status[key] !== null && !Number.isFinite(Date.parse(status[key]))) throw new Error(`Malformed status ${key}.`);
  }
  if (status.vm.terminationTime !== null && !Number.isFinite(Date.parse(status.vm.terminationTime))) throw new Error('Malformed status terminationTime.');
  for (const name of SERVICES) {
    if (!Object.hasOwn(status.services, name)) throw new Error(`Missing status service: ${name}.`);
    const service = status.services[name];
    if (service === null) continue;
    if (!service || !SHA.test(service.sha)) throw new Error(`Invalid deployed ${name} SHA.`);
    if (typeof service.digest !== 'string' || !/^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/.test(service.digest)) throw new Error(`Invalid deployed ${name} digest.`);
  }
  return status;
}

export function classifyPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) {
    throw new Error('Invalid changed path.');
  }
  const result = (web = false, backend = false, manual = false) => ({ web, backend, manual });
  // A separate installed-host hash gate protects controller upgrades.
  if (path.startsWith('deploy/site-release/')) return result();
  // These files are copied into an image, including Markdown notices and knowledge.
  if (/^(?:public\/|licenses\/|frontend\/(?:assets|public)\/)/.test(path) || path === 'THIRD_PARTY_NOTICES.md') return result(true);
  if (/^(?:knowledge\/|prompts\/)/.test(path)) return result(false, true);
  if (/^(?:Dockerfile(?:\..*)?|\.dockerignore)$/.test(path)) return result(true, true);
  // The host checks every required Firestore index dynamically before mutation.
  if (path === 'deploy/firebase/firestore.indexes.json') return result(false, true);
  if (/^(?:deploy\/|infra\/|terraform\/|server\/migrations\/)/.test(path) || /^(?:\.env(?:\..*)?|compose[^/]*\.ya?ml)$/.test(path)) return result(true, true, true);
  if (/^(?:docs\/|_archive\/|artifacts\/|tests\/|\.github\/|\.agents\/|\.codex\/|scripts\/site-release\/)/.test(path)
      || /^[^/]+\.(?:md|txt)$/.test(path) || /^frontend\/(?:verification|scripts)\//.test(path)
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return result();
  if (/^(?:frontend\/(?:ios|android|tooling)\/)/.test(path) || /^frontend\/plugins\/.*\.(?:swift|m|mm|h|java|kt)$/.test(path)
      || /\.(?:native|ios|android)\.[cm]?[jt]sx?$/.test(path)
      || /^(?:frontend\/eas\.json|frontend\/app\/\+native-intent\.ts|scripts\/mobile-release\.mjs)$/.test(path)) return result();
  if (/^(?:frontend\/|src\/(?:client|config)\/)/.test(path) || /^scripts\/(?:prepare-web-output|verify-web-install-output|write-site-version)\.mjs$/.test(path)) return result(true);
  if (/^(?:server\/|scripts\/(?:firebase-|knowledge))/.test(path)) return result(false, true);
  // Shared modules, dependency manifests and unknown runtime inputs must never skip.
  return result(true, true);
}

export function parseNameStatus(output) {
  if (!output) return [];
  const fields = output.split('\0');
  if (fields.pop() !== '') throw new Error('Malformed git diff: missing NUL terminator.');
  const paths = [];
  for (let i = 0; i < fields.length;) {
    const kind = fields[i++];
    if (!/^(?:[AMDTUXB]|[RC]\d{1,3})$/.test(kind)) throw new Error('Malformed git diff status.');
    const count = /^[RC]/.test(kind) ? 2 : 1;
    for (let n = 0; n < count; n++) {
      if (!fields[i]) throw new Error('Malformed git diff path.');
      classifyPath(fields[i]);
      paths.push(fields[i++]);
    }
  }
  return [...new Set(paths)];
}

export function buildPlan(status, targetSha, diffsBySha) {
  validateStatus(status);
  if (!SHA.test(targetSha)) throw new Error('Target must be an immutable full Git SHA.');
  let web = false, backend = false, bootstrap = false;
  const manual = new Set();
  for (const name of SERVICES) {
    const deployed = status.services[name];
    if (deployed === null) {
      bootstrap = true;
      if (name === 'web') web = true; else backend = true;
      continue;
    }
    if (deployed.sha === targetSha) continue;
    const paths = diffsBySha[deployed.sha];
    if (!Array.isArray(paths)) throw new Error(`Missing complete diff for ${name} at ${deployed.sha}.`);
    for (const path of paths) {
      const impact = classifyPath(path);
      if (name === 'web' && impact.web) web = true;
      if (name !== 'web' && impact.backend) backend = true;
      if (impact.manual) manual.add(path);
    }
  }
  const manualPaths = [...manual].sort();
  const reason = manualPaths.length ? 'Manual prerequisite review required before deployment.'
    : bootstrap ? 'Bootstrap: deploy services without an observed immutable baseline.'
    : web || backend ? `Runtime changes: ${[web && 'web', backend && 'backend'].filter(Boolean).join(', ')}.`
    : 'No site runtime changes.';
  return { web, backend, reason, manualPaths };
}

export function gitDiffs(status, targetSha, cwd) {
  if (!SHA.test(targetSha)) throw new Error('Target must be an immutable full Git SHA.');
  const diffs = {};
  for (const service of Object.values(validateStatus(status).services)) {
    if (service && service.sha !== targetSha && !Object.hasOwn(diffs, service.sha)) {
      diffs[service.sha] = parseNameStatus(execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', service.sha, targetSha, '--'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    }
  }
  return diffs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/site-release/plan.mjs <status.json> <targetSHA>');
    const status = validateStatus(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify(buildPlan(status, process.argv[3], gitDiffs(status, process.argv[3], process.cwd()))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
