import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyChanges, decideRelease, verifyBuild, verifyRollback } from '../scripts/mobile-release-policy.mjs';

test('release plan preserves shared delivery, runtime compatibility and scoped rollback without cloud calls', () => {
  const config = { projectId: 'project', owner: 'owner', applicationId: 'org.yuyoufang.app' };
  const build = { id: 'build', status: 'FINISHED', platform: 'ANDROID', app: { id: 'project', ownerAccount: { name: 'owner' } },
    appIdentifier: config.applicationId, updateChannel: { name: 'preview' }, buildProfile: 'preview',
    gitCommitHash: 'source', runtime: { version: 'runtime' }, fingerprint: { hash: 'runtime' } };
  const baseline = verifyBuild(build, config, 'preview');
  const shared = classifyChanges(['frontend/src/screens/AssistantScreen.tsx', 'server/tasks.ts']);
  assert.deepEqual([shared.web, shared.android, shared.server], [true, true, true]);
  assert.equal(decideRelease(shared, 'runtime', baseline), 'update');
  assert.equal(decideRelease(shared, 'new-runtime', baseline), 'build');
  assert.equal(decideRelease(shared, null, baseline), 'runtime-required');
  assert.equal(decideRelease(classifyChanges(['frontend/src/platform/photos.web.ts']), null, null), 'web');
  assert.equal(decideRelease(classifyChanges(['server/tasks.ts']), null, null), 'server');
  assert.throws(() => verifyBuild(build, config, 'production'), /Baseline/);
  const group = [{ group: 'old', platform: 'android', runtimeVersion: 'runtime', branch: 'preview' }];
  assert.equal(verifyRollback(group, group, baseline, 'preview').group, 'old');
  assert.throws(() => verifyRollback(group, [], baseline, 'preview'), /Rollback/);
  assert.throws(() => verifyRollback(group, group, { ...baseline, runtime: 'other' }, 'preview'), /Rollback/);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(EXPO_|EAS_|ANDROID_GOOGLE_SERVICES_FILE|EXPO_TOKEN)/.test(name)) delete env[name];
  const planned = spawnSync(process.execPath, ['scripts/mobile-release.mjs', '--plan', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr);
  const result = JSON.parse(planned.stdout);
  assert.equal(result.mode, 'plan'); assert.equal(result.uploads, 0); assert.equal(result.publications, 0);
  assert.equal(result.runtime, null);
  assert.ok(result.blockers.some(value => value.includes('No verified build')));
});
