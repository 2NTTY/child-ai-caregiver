// Thin wrapper around the pinned Expo/EAS tools. Planning never uploads or publishes.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { classifyChanges, decideRelease, verifyBuild, verifyRollback } from './mobile-release-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), appDir = join(root, 'frontend');
const { values } = parseArgs({ options: {
  plan: { type: 'boolean' }, execute: { type: 'boolean' }, channel: { type: 'string', default: 'preview' },
  since: { type: 'string' }, baseline: { type: 'string' }, 'build-id': { type: 'string' },
  action: { type: 'string', default: 'auto' }, 'rollback-group': { type: 'string' },
  'confirm-production': { type: 'boolean' }, 'web-env-file': { type: 'string' },
  'record-build': { type: 'string' }, help: { type: 'boolean' },
} });
const configFile = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')).expo;
const easFile = JSON.parse(readFileSync(join(appDir, 'eas.json'), 'utf8'));
const config = { owner: '2ntty', projectId: configFile.extra.eas.projectId,
  applicationId: configFile.android.package, cli: easFile.cli.version,
  api: easFile.build.base.env.EXPO_PUBLIC_API_BASE_URL };
const channel = values.channel;
let manifest, manifestPath, logDir;
function fail(message) { throw new Error(message); }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function git(args) {
  const child = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (child.status !== 0) fail(`Git check failed: ${args[0]}`);
  return child.stdout.trim();
}
function save() { writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n'); }
function child(file, args, { cwd = root, env = process.env, label = 'command', jsonResult = false } = {}) {
  const result = spawnSync(file, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    windowsHide: true, shell: false });
  // Keep bounded command diagnostics outside Git; do not print environment or full cloud responses.
  if (logDir) {
    writeFileSync(join(logDir, `${label}.stderr.log`), result.stderr ?? '');
    if (!jsonResult) writeFileSync(join(logDir, `${label}.stdout.log`), result.stdout ?? '');
  }
  if (result.status !== 0) fail(`${label} failed; inspect only its log tail. Do not automatically retry a submitted cloud operation.`);
  return jsonResult ? JSON.parse(result.stdout) : result.stdout.trim();
}
function eas(args, label) {
  // npm's JS entry avoids Windows cmd.exe argument interpolation.
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) fail('Run through npm run mobile:release');
  return child(process.execPath, [npmCli, 'exec', '--yes', '--package', `eas-cli@${config.cli}`, '--', 'eas', ...args],
    { cwd: appDir, label, jsonResult: args.includes('--json') });
}
function safeExternalEnv(path) {
  const absolute = realpathSync(resolve(path)), rel = relative(realpathSync(root), absolute);
  if (!rel.startsWith('..') && !isAbsolute(rel)) fail('Keep public client environment files outside the source/upload tree');
  return absolute;
}
function localRuntime() {
  const required = ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID', 'ANDROID_GOOGLE_SERVICES_FILE'];
  if (required.some(name => !process.env[name])) return Promise.resolve(null);
  const requireApp = createRequire(join(appDir, 'package.json'));
  const updatesPath = requireApp.resolve('expo-updates/package.json');
  const resolved = realpathSync(updatesPath), rel = relative(realpathSync(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) fail('Use physical dependencies in this release checkout, not another worktree junction');
  const { resolveRuntimeVersionAsync } = requireApp(join(dirname(updatesPath), 'utils/build/resolveRuntimeVersionAsync.js'));
  return resolveRuntimeVersionAsync(appDir, 'android', {}, {}).then(value => value.runtimeVersion);
}
function buildSummary(build) {
  return { id: build.id, status: build.status, runtime: build.runtime?.version ?? null,
    versionCode: build.appBuildVersion ?? null, gitSha: build.gitCommitHash ?? null,
    url: `https://expo.dev/accounts/${config.owner}/projects/${configFile.slug}/builds/${build.id}` };
}
async function main() {
  if (values.help) {
    console.log('mobile:release [--plan] [--since REF] [--baseline EAS_BUILD_JSON]\n'
      + '  --execute --channel preview|production --action auto|build|update|web|rollback\n'
      + '  --build-id ID --rollback-group ID --web-env-file OUTSIDE_REPO_FILE\n'
      + '  --record-build ID (read-only EAS lookup and local manifest)\n'
      + 'Production additionally requires --confirm-production. See docs/PRODUCTION_FRONTEND.md#mobile-release.'); return;
  }
  for (const name of ['build-id', 'record-build', 'rollback-group']) {
    if (values[name] && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(values[name])) fail(`Invalid ${name}`);
  }
  if (!['preview', 'production'].includes(channel) || !['auto', 'build', 'update', 'web', 'rollback'].includes(values.action)) fail('Invalid channel or action');
  if (values.execute && values.plan) fail('Choose planning or execution');
  if (config.applicationId !== 'org.yuyoufang.app' || config.cli !== '24.14.0'
    || configFile.runtimeVersion.policy !== 'fingerprint' || easFile.cli.appVersionSource !== 'remote'
    || easFile.build[channel].channel !== channel || easFile.build[channel].environment !== channel
    || !easFile.build.base.autoIncrement) fail('Review changed application, runtime, CLI, channel or version-code configuration');
  const sha = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']);
  if (values['record-build']) {
    if (values.execute) fail('Recording a build does not publish');
    const build = eas(['build:view', values['record-build'], '--json'], 'build-view');
    verifyBuild(build, config, channel);
    const folder = join(root, '.cache/mobile-releases'); mkdirSync(folder, { recursive: true });
    const path = join(folder, `build-${build.id}.json`);
    // Only the fields needed for offline planning; no signed URLs, environment or build logs.
    const allowed = { ...buildSummary(build), status: build.status, platform: build.platform,
      app: { id: build.app.id, ownerAccount: { name: build.app.ownerAccount.name } },
      appIdentifier: build.appIdentifier, updateChannel: { name: build.updateChannel.name }, buildProfile: build.buildProfile,
      fingerprint: { hash: build.fingerprint.hash }, runtime: { version: build.runtime.version },
      appVersion: build.appVersion, appBuildVersion: build.appBuildVersion, gitCommitHash: build.gitCommitHash };
    writeFileSync(path, JSON.stringify(allowed, null, 2) + '\n'); console.log(JSON.stringify({ saved: path, build: buildSummary(build) })); return;
  }
  let baseline = values.baseline ? verifyBuild(json(resolve(values.baseline)), config, channel) : null;
  const since = values.since ?? baseline?.gitSha ?? 'origin/master';
  git(['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`]);
  const paths = git(['diff', '--name-only', since, '--']).split('\n').filter(Boolean);
  const impact = classifyChanges(paths);
  let runtime = null;
  // Pure plan tolerates missing credentials/dependencies and reports the missing evidence.
  if (!values.execute) {
    const blockers = [];
    if (dirty) blockers.push('Commit reviewed changes before release');
    if (!baseline) blockers.push('No verified build baseline; Android changes require a new APK');
    try { runtime = await localRuntime(); } catch { blockers.push('Local runtime could not be resolved; install physical dependencies and run mobile:prepare'); }
    if (impact.android && !runtime) blockers.push('Native Firebase environment/descriptor is missing; runtime compatibility is not verified');
    const decision = decideRelease(impact, runtime, baseline);
    console.log(JSON.stringify({ mode: 'plan', uploads: 0, publications: 0, gitSha: sha, since, channel, impact,
      android: decision, runtime, baseline, blockers,
      checks: ['Review changed contracts; reuse existing checks', ...(impact.web ? ['Build shared Web output with Web Firebase config'] : []),
        ...(impact.android ? ['Compare official runtime; only validate affected native adapters'] : [])],
      web: impact.web ? 'Prepare frontend/dist; deploy through the existing VM/Caddy path' : 'unchanged',
      server: impact.server ? 'Deploy compatible Server first when the client contract changes' : 'unchanged',
    }, null, 2)); return;
  }
  if (dirty) fail('Release requires a clean, reviewed commit');
  if (channel === 'production' && !values['confirm-production']) fail('Production requires explicit --confirm-production');
  if (impact.review.length) fail('Review unclassified paths before publishing');
  if (values.action === 'rollback' && (!values['build-id'] || !values['rollback-group'])) fail('Rollback requires the installed build ID and exact previous group');
  if (values.action === 'web' && impact.android) fail('Shared changes also require Android delivery; do not mark them Web-only');
  const releaseKey = `${sha.slice(0, 12)}-${channel}-${values.action}${values['rollback-group'] ? '-'+values['rollback-group'] : ''}`;
  logDir = join(root, '.cache/mobile-releases', releaseKey);
  mkdirSync(logDir, { recursive: true }); manifestPath = join(logDir, 'release.json');
  if (existsSync(manifestPath)) fail('A release attempt already exists. Read its original result; do not submit again');
  manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), gitSha: sha, since, channel, config, impact,
    state: 'preparing', web: { state: 'unchanged' }, android: { state: 'unchanged' } }; save();
  if (values['build-id']) baseline = verifyBuild(eas(['build:view', values['build-id'], '--json'], 'baseline'), config, channel);
  if (values.action === 'rollback') {
    const group = eas(['update:view', values['rollback-group'], '--json'], 'rollback-view');
    const visible = eas(['update:list', '--branch', channel, '--limit', '50', '--non-interactive', '--json'], 'rollback-scope');
    const previous = verifyRollback(group, visible.currentPage ?? visible, baseline, channel);
    manifest.android = { state: 'submitted', action: 'rollback', baseline, previousGroup: previous.group }; save();
    const updates = eas(['update:republish', '--group', previous.group, '--destination-channel', channel,
      '--platform', 'android', '--message', `Rollback ${sha.slice(0, 12)}`, '--non-interactive', '--json'], 'rollback');
    manifest.android = { ...manifest.android, state: 'published', updates: sanitizeUpdates(updates) };
    manifest.state = 'published-device-verification-pending'; save(); console.log(JSON.stringify(manifest)); return;
  }
  if (impact.web) {
    if (!values['web-env-file']) fail('Shared Web output requires its own --web-env-file; never build Web with the Android Auth key');
    const webEnv = { ...process.env };
    for (const name of Object.keys(webEnv)) if (name.startsWith('EXPO_PUBLIC_') || name.startsWith('EAS_BUILD_') || name === 'ANDROID_GOOGLE_SERVICES_FILE') delete webEnv[name];
    const webValues = parseEnv(readFileSync(safeExternalEnv(values['web-env-file']), 'utf8'));
    for (const [name, value] of Object.entries(webValues)) if (name.startsWith('EXPO_PUBLIC_')) webEnv[name] = value;
    child(process.execPath, [join(root, 'scripts/mobile-release-web.mjs')], { label: 'web-build', env: webEnv });
    manifest.web = { state: 'prepared-deployment-pending', directory: 'frontend/dist', gitSha: sha }; save();
  }
  if (impact.android || ['build', 'update'].includes(values.action)) {
    child(process.execPath, [join(root, 'frontend/tooling/normalize-fingerprint-paths.cjs')], { label: 'fingerprint-prepare' });
    // EAS env pull is read-only. File-type secrets must already be supplied through the protected local environment.
    const envPath = join(logDir, '.env.android');
    eas(['env:pull', '--environment', channel, '--path', envPath, '--non-interactive'], 'environment');
    const androidValues = parseEnv(readFileSync(envPath, 'utf8'));
    for (const [name, value] of Object.entries(androidValues)) {
      if (name.startsWith('EXPO_PUBLIC_') || name === 'EAS_PROJECT_ID') process.env[name] = value;
    }
    Object.assign(process.env, easFile.build.base.env, { EAS_BUILD_PROFILE: channel, EAS_BUILD_PLATFORM: 'android' });
    runtime = await localRuntime(); if (!runtime) fail('Provide the protected Android Firebase descriptor and complete client environment');
    const decision = baseline && runtime === baseline.runtime ? 'update' : 'build';
    if (values.action === 'update' && decision !== 'update') fail('Runtime does not match a verified build; create a new APK');
    const action = values.action === 'build' ? 'build' : decision;
    manifest.android = { state: 'submitted', action, runtime, baseline }; save();
    if (action === 'build') {
      const builds = eas(['build', '--platform', 'android', '--profile', channel,
        '--non-interactive', '--freeze-credentials', '--no-wait', '--json'], 'build');
      manifest.android = { ...manifest.android, state: 'queued', builds: builds.map(buildSummary) };
    } else {
      const updates = sanitizeUpdates(eas(['update', '--channel', channel, '--environment', channel, '--platform', 'android',
        '--message', `Release ${sha.slice(0, 12)}`, '--non-interactive', '--json'], 'update'));
      manifest.android.updates = updates; save();
      if (updates.length !== 1 || updates[0].runtimeVersion !== runtime) fail('Published runtime mismatch; inspect the original group before taking further action');
      manifest.android = { ...manifest.android, state: 'published', updates };
    }
  }
  manifest.state = 'prepared-delivery-verification-pending'; save(); console.log(JSON.stringify(manifest, null, 2));
}
function sanitizeUpdates(updates) {
  if (!Array.isArray(updates)) fail('Unexpected EAS update response; inspect the original operation');
  return updates.map(value => ({ id: value.id, group: value.group, runtimeVersion: value.runtimeVersion,
    platform: value.platform, gitSha: value.gitCommitHash }));
}
main().catch(error => {
  if (manifest) { manifest.state = manifest.android.state === 'submitted' ? 'unknown-do-not-resubmit' : 'stopped'; save(); }
  console.error(error.message); process.exitCode = 1;
});
