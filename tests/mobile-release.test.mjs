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
  assert.deepEqual([shared.web, shared.android, shared.ios, shared.server], [true, true, true, true]);
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
  const iosConfig = { ...config, platform: 'ios', profile: 'ios-preview' };
  const iosBuild = { ...build, platform: 'IOS', distribution: 'STORE', buildProfile: 'ios-preview',
    updateChannel: { name: 'ios-preview' } };
  const iosBaseline = verifyBuild(iosBuild, iosConfig, 'ios-preview');
  assert.equal(iosBaseline.platform, 'ios');
  assert.equal(verifyBuild(build, config, 'preview').platform, 'android');
  assert.equal(decideRelease(shared, 'runtime', iosBaseline, 'ios'), 'update');
  assert.equal(decideRelease(shared, 'new-runtime', iosBaseline, 'ios'), 'build');
  for (const [path, expected] of [
    ['frontend/src/platform/photos.ios.ts', [false, false, true]],
    ['frontend/src/platform/photos.android.ts', [false, true, false]],
    ['frontend/src/platform/photos.native.ts', [false, true, true]],
    ['frontend/ios/Podfile', [false, false, true]],
    ['frontend/android/build.gradle', [false, true, false]],
    ['frontend/app.config.js', [true, true, true]],
  ]) {
    const impact = classifyChanges([path]);
    assert.deepEqual([impact.web, impact.android, impact.ios], expected, path);
  }
  const iosOnly = classifyChanges(['frontend/src/platform/photos.ios.ts']);
  assert.equal(decideRelease(iosOnly, null, null), 'none');
  assert.equal(decideRelease(iosOnly, null, null, 'ios'), 'build');
  for (const invalid of [
    { ...iosBuild, platform: 'ANDROID' }, { ...iosBuild, buildProfile: 'preview' },
    { ...iosBuild, distribution: 'INTERNAL' }, { ...iosBuild, isForIosSimulator: true },
  ]) assert.throws(() => verifyBuild(invalid, iosConfig, 'ios-preview'), /Baseline/);
  assert.throws(() => verifyBuild(iosBuild, config, 'ios-preview'), /Baseline/);
  const iosGroup = [{ ...group[0], platform: 'ios', branch: 'ios-preview' }];
  assert.equal(verifyRollback(iosGroup, [iosGroup], iosBaseline, 'ios-preview', 'ios').group, 'old');
  for (const invalid of [
    group, [...iosGroup, ...iosGroup], [{ ...iosGroup[0], isRollBackToEmbedded: true }],
    [{ ...iosGroup[0], branch: 'preview' }], [{ ...iosGroup[0], runtimeVersion: 'other' }],
  ]) assert.throws(() => verifyRollback(invalid, [iosGroup], iosBaseline, 'ios-preview', 'ios'), /Rollback/);
  assert.throws(() => verifyRollback(iosGroup, group, iosBaseline, 'ios-preview', 'ios'), /Rollback/);
  assert.throws(() => verifyRollback(iosGroup, [iosGroup], baseline, 'ios-preview', 'ios'), /Rollback/);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(EXPO_|EAS_|ANDROID_GOOGLE_SERVICES_FILE|EXPO_TOKEN)/.test(name)) delete env[name];
  const planned = spawnSync(process.execPath, ['scripts/mobile-release.mjs', '--plan', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr);
  const result = JSON.parse(planned.stdout);
  assert.equal(result.mode, 'plan'); assert.equal(result.uploads, 0); assert.equal(result.publications, 0);
  assert.equal(result.runtime, null);
  assert.ok(result.blockers.some(value => value.includes('No verified build')));
  const iosPlanned = spawnSync(process.execPath, ['scripts/mobile-release.mjs', '--plan', '--platform', 'ios', '--action', 'submit', '--since', 'HEAD'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(iosPlanned.status, 0, iosPlanned.stderr);
  const iosResult = JSON.parse(iosPlanned.stdout);
  assert.deepEqual([iosResult.platform, iosResult.channel, iosResult.environment, iosResult.ios], ['ios', 'ios-preview', 'preview', 'submit']);
  assert.deepEqual([iosResult.uploads, iosResult.publications, iosResult.runtime], [0, 0, null]);
  assert.ok(iosResult.blockers.some(value => value.includes('Apple team')));
  assert.ok(iosResult.blockers.some(value => value.includes('ascAppId')));
  assert.ok(iosResult.blockers.some(value => value.includes('exact finished iOS build ID')));
});
