import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, classifyPath, gitDiffs, parseNameStatus, validateStatus } from './plan.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const status = (overrides = {}) => ({ observedAt: '2026-11-12T10:00:00Z', lastScheduledAt: null,
  vm: { status: 'RUNNING', terminationTime: null }, paused: false,
  services: Object.fromEntries(['web', 'api', 'worker'].map((name) => [name, { sha: sha(1), digest: `sha256:${'a'.repeat(64)}` }])),
  rollbackCandidates: [], lastResult: 'success', releaseId: 'test', ...overrides });

test('documentation and genuinely native-only changes skip site deployment', () => {
  const result = buildPlan(status(), sha(2), { [sha(1)]: ['docs/usage.md', 'README.md', 'frontend/src/platform/runtime.native.ts', 'frontend/plugins/ios-share/Main.swift'] });
  assert.deepEqual(result, { web: false, backend: false, reason: 'No site runtime changes.', manualPaths: [] });
});

test('bundle inputs take priority over documentation-looking extensions', () => {
  assert.equal(classifyPath('THIRD_PARTY_NOTICES.md').web, true);
  assert.equal(classifyPath('public/help.md').web, true);
  assert.equal(classifyPath('knowledge/source.md').backend, true);
  assert.equal(classifyPath('frontend/public/download.native.ts').web, true);
  assert.equal(classifyPath('frontend/plugins/with-ios-share-inbox.cjs').web, true);
  assert.deepEqual(classifyPath('Dockerfile'), { web: true, backend: true, manual: false });
  assert.deepEqual(classifyPath('.dockerignore'), { web: true, backend: true, manual: false });
});

test('mixed service releases compare each deployed SHA independently', () => {
  const value = status(); value.services.api.sha = sha(2); value.services.worker.sha = sha(3);
  const result = buildPlan(value, sha(4), { [sha(1)]: ['frontend/src/App.tsx'], [sha(2)]: ['docs/readme.md'], [sha(3)]: ['server/worker-main.ts'] });
  assert.equal(result.web, true); assert.equal(result.backend, true);
});

test('unknown runtime paths rebuild both components and malformed diffs fail closed', () => {
  assert.deepEqual(classifyPath('new-runtime/config.bin'), { web: true, backend: true, manual: false });
  assert.throws(() => buildPlan(status(), sha(2), {}), /Missing complete diff/);
  assert.throws(() => buildPlan(status(), sha(2), { [sha(1)]: [null] }), /Invalid changed path/);
});

test('infra and migrations require operator prerequisites, CI and release tooling do not', () => {
  const result = buildPlan(status(), sha(2), { [sha(1)]: ['deploy/firebase/firestore.indexes.json', 'server/migrations/040.sql', '.github/workflows/site-release.yml', 'scripts/site-release/plan.mjs', 'server/main.ts'] });
  assert.equal(result.backend, true);
  assert.deepEqual(result.manualPaths, ['server/migrations/040.sql']);
  assert.deepEqual(classifyPath('deploy/firebase/firestore.indexes.json'), { web: false, backend: true, manual: false });
  assert.deepEqual(classifyPath('deploy/site-release/host.py'), { web: false, backend: false, manual: false });
});

test('deleted and renamed files classify both source and destination with NUL-safe parsing', () => {
  const paths = parseNameStatus('D\0server/removed.ts\0R100\0frontend/src/old.ts\0docs/new.md\0');
  assert.deepEqual(paths, ['server/removed.ts', 'frontend/src/old.ts', 'docs/new.md']);
  const result = buildPlan(status(), sha(2), { [sha(1)]: paths });
  assert.equal(result.web, true); assert.equal(result.backend, true);
  assert.throws(() => parseNameStatus('R100\0old\0'), /Malformed git diff/);
});

test('malformed status never becomes an empty or skipped deployment', () => {
  assert.throws(() => validateStatus({}), /status/);
  const value = status(); value.services.api.sha = 'master';
  assert.throws(() => validateStatus(value), /SHA/);
  assert.throws(() => buildPlan(status(), 'master', {}), /SHA/);
});

test('an absent bootstrap baseline explicitly plans initial runtime deployment', () => {
  const value = status(); value.services = { web: null, api: null, worker: null };
  const result = buildPlan(value, sha(2), {});
  assert.equal(result.web, true); assert.equal(result.backend, true);
  assert.match(result.reason, /Bootstrap/);
});

test('standalone Actions planner compares real immutable Git trees including deletion and rename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'site-planner-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  const commit = (message) => git('-c', 'user.name=Planner Test', '-c', 'user.email=planner@example.invalid', 'commit', '--no-gpg-sign', '-m', message);
  try {
    git('init', '--quiet');
    await mkdir(join(directory, 'frontend', 'src'), { recursive: true });
    await mkdir(join(directory, 'server'));
    await mkdir(join(directory, 'docs'));
    await writeFile(join(directory, 'frontend', 'src', 'View.ts'), 'export const view = 1;\n');
    await writeFile(join(directory, 'server', 'main.ts'), 'export const api = 1;\n');
    git('add', '.'); commit('baseline');
    const baseline = git('rev-parse', 'HEAD');
    await writeFile(join(directory, 'docs', 'guide.md'), '# Guide\n');
    git('add', '.'); commit('documentation');
    const docs = git('rev-parse', 'HEAD');
    const value = status();
    for (const service of Object.values(value.services)) service.sha = baseline;
    assert.equal(buildPlan(value, docs, gitDiffs(value, docs, directory)).web, false);
    git('mv', 'frontend/src/View.ts', 'docs/old-view.md');
    git('rm', 'server/main.ts'); commit('remove site inputs');
    const target = git('rev-parse', 'HEAD');
    await writeFile(join(directory, 'status.json'), JSON.stringify(value));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./plan.mjs', import.meta.url)), join(directory, 'status.json'), target], { cwd: directory, encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.web, true); assert.equal(result.backend, true); assert.deepEqual(result.manualPaths, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
