// Thin wrapper around the pinned Expo/EAS tools. Planning never uploads or publishes.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { classifyChanges, decideRelease, verifyBuild, verifyRollback } from './mobile-release-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), appDir = join(root, 'frontend');
const { values } = parseArgs({ options: {
  plan: { type: 'boolean' }, execute: { type: 'boolean' }, platform: { type: 'string', default: 'android' }, channel: { type: 'string' },
  since: { type: 'string' }, baseline: { type: 'string' }, 'build-id': { type: 'string' },
  action: { type: 'string', default: 'auto' }, 'rollback-group': { type: 'string' },
  'confirm-production': { type: 'boolean' }, 'web-env-file': { type: 'string' },
  'record-build': { type: 'string' }, help: { type: 'boolean' },
} });
const configFile = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')).expo;
const easFile = JSON.parse(readFileSync(join(appDir, 'eas.json'), 'utf8'));
const platform = values.platform, channel = values.channel ?? (platform === 'ios' ? 'ios-preview' : 'preview');
const profile = easFile.build[channel], environment = profile?.environment;
const config = { owner: '2ntty', projectId: configFile.extra.eas.projectId, platform, profile: channel,
  applicationId: platform === 'ios' ? configFile.ios.bundleIdentifier : configFile.android.package, cli: easFile.cli.version,
  api: easFile.build.base.env.EXPO_PUBLIC_API_BASE_URL };
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
function eas(args, label, env = process.env) {
  // npm's JS entry avoids Windows cmd.exe argument interpolation.
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) fail('Run through npm run mobile:release');
  return child(process.execPath, [npmCli, 'exec', '--yes', '--package', `eas-cli@${config.cli}`, '--', 'eas', ...args],
    { cwd: appDir, env, label, jsonResult: args.includes('--json') });
}
function safeExternalEnv(path) {
  const absolute = realpathSync(resolve(path)), rel = relative(realpathSync(root), absolute);
  if (!rel.startsWith('..') && !isAbsolute(rel)) fail('Keep public client environment files outside the source/upload tree');
  return absolute;
}
function localRuntime() {
  const required = ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID',
    ...(platform === 'android' ? ['ANDROID_GOOGLE_SERVICES_FILE'] : [])];
  if (required.some(name => !process.env[name])) return Promise.resolve(null);
  const requireApp = createRequire(join(appDir, 'package.json'));
  const updatesPath = requireApp.resolve('expo-updates/package.json');
  const resolved = realpathSync(updatesPath), rel = relative(realpathSync(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) fail('Use physical dependencies in this release checkout, not another worktree junction');
  const { resolveRuntimeVersionAsync } = requireApp(join(dirname(updatesPath), 'utils/build/resolveRuntimeVersionAsync.js'));
  return resolveRuntimeVersionAsync(appDir, platform, {}, {}).then(value => value.runtimeVersion);
}
function applyNativeProfile() {
  Object.assign(process.env, easFile.build.base.env, profile.env,
    { EAS_BUILD_PROFILE: channel, EAS_BUILD_PLATFORM: platform });
}
function discoveryEnvironment() {
  const env = { ...process.env };
  for (const name of ['ANDROID_GOOGLE_SERVICES_FILE', 'EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM']) delete env[name];
  return env;
}
function iosPrerequisites(action) {
  if (platform !== 'ios') return [];
  const missing = [];
  const team = configFile.ios.appleTeamId;
  if (!/^[A-Z0-9]{10}$/.test(team ?? '')) missing.push('Choose the authorized paid Apple team and set expo.ios.appleTeamId before release');
  if (action === 'submit') {
    const submit = easFile.submit?.[channel]?.ios;
    if (!/^[1-9][0-9]+$/.test(submit?.ascAppId ?? '')) missing.push(`Set submit.${channel}.ios.ascAppId to the existing App Store Connect app`);
    if (!team || submit?.appleTeamId !== team) missing.push('Submit and build must name the same approved Apple team');
    if (submit?.ascApiKeyPath && !isAbsolute(submit.ascApiKeyPath)) missing.push('Keep the App Store Connect private key at an absolute path outside the checkout');
  }
  return missing;
}
function buildSummary(build) {
  return { id: build.id, status: build.status, runtime: build.runtime?.version ?? null,
    platform: build.platform, versionCode: build.appBuildVersion ?? null, gitSha: build.gitCommitHash ?? null,
    url: `https://expo.dev/accounts/${config.owner}/projects/${configFile.slug}/builds/${build.id}` };
}
async function main() {
  if (values.help) {
    console.log('mobile:release [--plan] [--platform android|ios] [--since REF] [--baseline EAS_BUILD_JSON]\n'
      + '  --execute --channel preview|production|ios-preview --action auto|build|update|web|rollback|submit\n'
      + '  --build-id ID --rollback-group ID --web-env-file OUTSIDE_REPO_FILE\n'
      + '  --record-build ID (read-only EAS lookup and local manifest)\n'
      + 'Default: Android preview; --platform ios defaults to ios-preview. Submit requires an exact iOS build ID.\n'
      + 'Production additionally requires --confirm-production. See docs/PRODUCTION_FRONTEND.md#mobile-release.'); return;
  }
  for (const name of ['build-id', 'record-build', 'rollback-group']) {
    if (values[name] && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(values[name])) fail(`Invalid ${name}`);
  }
  if (!['android', 'ios'].includes(platform) || !(platform === 'ios' ? ['ios-preview'] : ['preview', 'production']).includes(channel)
    || !['auto', 'build', 'update', 'web', 'rollback', 'submit'].includes(values.action)) fail('Invalid platform, channel or action');
  if (values.action === 'submit' && platform !== 'ios') fail('Submit is limited to the iOS TestFlight workflow');
  if (values.execute && values.plan) fail('Choose planning or execution');
  if (config.applicationId !== 'org.yuyoufang.app' || config.cli !== '24.14.0'
    || configFile.runtimeVersion.policy !== 'fingerprint' || easFile.cli.appVersionSource !== 'remote'
    || profile?.extends !== 'base' || profile.channel !== channel || environment !== (platform === 'ios' ? 'preview' : channel)
    || (platform === 'ios' && (profile.distribution !== 'store' || profile.ios?.simulator))
    || !easFile.build.base.autoIncrement) fail('Review changed application, runtime, CLI, channel or version-code configuration');
  const sha = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']);
  if (values['record-build']) {
    if (values.execute || values.plan) fail('Recording a build is a separate read-only cloud lookup, not an offline plan or publication');
    const build = eas(['build:view', values['record-build'], '--json'], 'build-view', discoveryEnvironment());
    verifyBuild(build, config, channel);
    const folder = join(root, '.cache/mobile-releases'); mkdirSync(folder, { recursive: true });
    const path = join(folder, `build-${build.id}.json`);
    // Only the fields needed for offline planning; no signed URLs, environment or build logs.
    const allowed = { ...buildSummary(build), status: build.status, platform: build.platform,
      app: { id: build.app.id, ownerAccount: { name: build.app.ownerAccount.name } },
      appIdentifier: build.appIdentifier, updateChannel: { name: build.updateChannel.name }, buildProfile: build.buildProfile,
      fingerprint: { hash: build.fingerprint.hash }, runtime: { version: build.runtime.version },
      appVersion: build.appVersion, appBuildVersion: build.appBuildVersion, gitCommitHash: build.gitCommitHash,
      distribution: build.distribution, isForIosSimulator: build.isForIosSimulator };
    writeFileSync(path, JSON.stringify(allowed, null, 2) + '\n'); console.log(JSON.stringify({ saved: path, build: buildSummary(build) })); return;
  }
  let baseline = values.baseline ? verifyBuild(json(resolve(values.baseline)), config, channel) : null;
  const since = values.since ?? baseline?.gitSha ?? 'origin/master';
  git(['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`]);
  const paths = git(['diff', '--name-only', since, '--']).split('\n').filter(Boolean);
  const impact = classifyChanges(paths);
  const otherMobile = ['android', 'ios'].filter(name => name !== platform && impact[name]);
  let runtime = null;
  // Pure plan tolerates missing credentials/dependencies and reports the missing evidence.
  if (!values.execute) {
    const blockers = [];
    if (dirty) blockers.push('Commit reviewed changes before release');
    if (!baseline) blockers.push(`No verified build baseline; ${platform} changes require a new binary`);
    blockers.push(...iosPrerequisites(values.action));
    if (values.action === 'submit' && !values['build-id']) blockers.push('Submit requires the exact finished iOS build ID; plan does not query EAS');
    try { applyNativeProfile(); runtime = await localRuntime(); } catch { blockers.push('Local runtime could not be resolved; install physical dependencies and run mobile:prepare'); }
    if (impact[platform] && !runtime) blockers.push('Native Firebase environment/required descriptor is missing; runtime compatibility is not verified');
    const decision = decideRelease(impact, runtime, baseline, platform);
    console.log(JSON.stringify({ mode: 'plan', uploads: 0, publications: 0, gitSha: sha, since, platform, channel, environment, impact,
      [platform]: values.action === 'auto' ? decision : values.action, runtime, baseline, blockers, otherMobileDelivery: otherMobile,
      checks: ['Review changed contracts; reuse existing checks', ...(impact.web ? ['Build shared Web output with Web Firebase config'] : []),
        ...(impact[platform] ? ['Compare official runtime; only validate affected native adapters'] : [])],
      web: impact.web ? 'Prepare frontend/dist; deploy through the existing VM/Caddy path' : 'unchanged',
      server: impact.server ? 'Deploy compatible Server first when the client contract changes' : 'unchanged',
    }, null, 2)); return;
  }
  if (dirty) fail('Release requires a clean, reviewed commit');
  if (channel === 'production' && !values['confirm-production']) fail('Production requires explicit --confirm-production');
  if (impact.review.length) fail('Review unclassified paths before publishing');
  const prerequisites = iosPrerequisites(values.action);
  if (prerequisites.length) fail(prerequisites.join('; '));
  if (values.action === 'rollback' && (!values['build-id'] || !values['rollback-group'])) fail('Rollback requires the installed build ID and exact previous group');
  if (values.action === 'submit' && !values['build-id']) fail('Submit requires the exact finished iOS build ID');
  if (values.action === 'web' && (impact.android || impact.ios)) fail('Shared changes also require native delivery; do not mark them Web-only');
  const suffix = values['rollback-group'] ? '-'+values['rollback-group'] : '';
  const releaseKey = values.action === 'submit' ? `submit-${platform}-${channel}-${values['build-id']}`
    : `${sha.slice(0, 12)}-${platform}-${channel}-${values.action}${suffix}`;
  const legacyManifest = join(root, '.cache/mobile-releases', `${sha.slice(0, 12)}-${channel}-${values.action}${suffix}`, 'release.json');
  if (platform === 'android' && existsSync(legacyManifest)) fail('A legacy Android release attempt exists; inspect its original result before proceeding');
  logDir = join(root, '.cache/mobile-releases', releaseKey);
  mkdirSync(logDir, { recursive: true }); manifestPath = join(logDir, 'release.json');
  if (existsSync(manifestPath)) fail('A release attempt already exists. Read its original result; do not submit again');
  manifest = { schemaVersion: 2, createdAt: new Date().toISOString(), gitSha: sha, since, platform, channel, environment, config, impact,
    otherMobileDelivery: otherMobile, state: 'preparing', web: { state: 'unchanged' }, [platform]: { state: 'unchanged' } }; save();
  if (values['build-id']) baseline = verifyBuild(eas(['build:view', values['build-id'], '--json'], 'baseline', discoveryEnvironment()), config, channel);
  if (values.action === 'submit') {
    const submitProfile = easFile.submit[channel].ios;
    if (submitProfile.ascApiKeyPath) safeExternalEnv(submitProfile.ascApiKeyPath);
    manifest.ios = { state: 'submitted', action: 'submit', baseline,
      appleTeamId: configFile.ios.appleTeamId, ascAppId: submitProfile.ascAppId }; save();
    // CLI 24.14 has no submit --json. Explicit ID and disabled setup avoid selecting another build or inviting testers.
    const output = eas(['submit', '--platform', 'ios', '--profile', channel, '--id', baseline.id,
      '--non-interactive', '--no-wait', '--no-auto-testflight-setup'], 'submit', discoveryEnvironment());
    const ids = [...output.matchAll(/\/submissions\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\b/gi)].map(match => match[1]);
    manifest.ios = { ...manifest.ios, state: 'queued', submissionIds: [...new Set(ids)] };
    manifest.state = 'submission-queued-apple-processing-pending'; save(); console.log(JSON.stringify(manifest, null, 2)); return;
  }
  if (values.action === 'rollback') {
    const group = eas(['update:view', values['rollback-group'], '--json'], 'rollback-view', discoveryEnvironment());
    const visible = eas(['update:list', '--branch', channel, '--limit', '50', '--non-interactive', '--json'], 'rollback-scope', discoveryEnvironment());
    const previous = verifyRollback(group, visible.currentPage ?? visible, baseline, channel, platform);
    manifest[platform] = { state: 'submitted', action: 'rollback', baseline, previousGroup: previous.group }; save();
    const updates = eas(['update:republish', '--group', previous.group, '--destination-channel', channel,
      '--platform', platform, '--message', `Rollback ${sha.slice(0, 12)}`, '--non-interactive', '--json'], 'rollback', discoveryEnvironment());
    const restored = sanitizeUpdates(updates);
    if (restored.length !== 1 || restored[0].platform !== platform || restored[0].runtimeVersion !== baseline.runtime)
      fail('Rollback response differs from the requested platform/runtime; inspect the original operation');
    manifest[platform] = { ...manifest[platform], state: 'published', updates: restored };
    manifest.state = 'published-device-verification-pending'; save(); console.log(JSON.stringify(manifest)); return;
  }
  if (impact.web) {
    if (!values['web-env-file']) fail('Shared Web output requires its own --web-env-file; never build Web with the native Auth key');
    const webEnv = { ...process.env };
    for (const name of Object.keys(webEnv)) if (name.startsWith('EXPO_PUBLIC_') || name.startsWith('EAS_BUILD_') || name === 'ANDROID_GOOGLE_SERVICES_FILE') delete webEnv[name];
    const webValues = parseEnv(readFileSync(safeExternalEnv(values['web-env-file']), 'utf8'));
    for (const [name, value] of Object.entries(webValues)) if (name.startsWith('EXPO_PUBLIC_')) webEnv[name] = value;
    child(process.execPath, [join(root, 'scripts/mobile-release-web.mjs')], { label: 'web-build', env: webEnv });
    // EAS Update also exports to frontend/dist. Preserve the Web artifact before native export.
    const webOutput = join(logDir, 'web');
    cpSync(join(appDir, 'dist'), webOutput, { recursive: true, errorOnExist: true, force: false });
    manifest.web = { state: 'prepared-deployment-pending', directory: relative(root, webOutput), gitSha: sha }; save();
  }
  if (impact[platform] || ['build', 'update'].includes(values.action)) {
    child(process.execPath, [join(root, 'frontend/tooling/normalize-fingerprint-paths.cjs')], { label: 'fingerprint-prepare' });
    // EAS env pull is read-only. File-type secrets must already be supplied through the protected local environment.
    const envPath = join(logDir, `.env.${platform}`);
    // Project discovery precedes public env loading; native descriptor validation belongs to the build stage.
    eas(['env:pull', '--environment', environment, '--path', envPath, '--non-interactive'], 'environment', discoveryEnvironment());
    const nativeValues = parseEnv(readFileSync(envPath, 'utf8'));
    for (const name of Object.keys(process.env)) if (name.startsWith('EXPO_PUBLIC_') || name === 'EAS_PROJECT_ID') delete process.env[name];
    for (const [name, value] of Object.entries(nativeValues)) {
      if (name.startsWith('EXPO_PUBLIC_') || name === 'EAS_PROJECT_ID') process.env[name] = value;
    }
    applyNativeProfile();
    runtime = await localRuntime(); if (!runtime) fail('Provide the complete client environment and platform-required Firebase descriptor');
    const decision = baseline && runtime === baseline.runtime ? 'update' : 'build';
    if (values.action === 'update' && decision !== 'update') fail('Runtime does not match a verified build; create a new binary');
    const action = values.action === 'build' ? 'build' : decision;
    manifest[platform] = { state: 'submitted', action, runtime, baseline }; save();
    if (action === 'build') {
      const builds = eas(['build', '--platform', platform, '--profile', channel,
        '--non-interactive', '--freeze-credentials', '--no-wait', '--json'], 'build');
      manifest[platform] = { ...manifest[platform], state: 'queued', builds: builds.map(buildSummary) };
    } else {
      const updates = sanitizeUpdates(eas(['update', '--channel', channel, '--environment', environment, '--platform', platform,
        '--message', `Release ${sha.slice(0, 12)}`, '--non-interactive', '--json'], 'update'));
      manifest[platform].updates = updates; save();
      if (updates.length !== 1 || updates[0].platform !== platform || updates[0].runtimeVersion !== runtime) fail('Published platform/runtime mismatch; inspect the original group before taking further action');
      manifest[platform] = { ...manifest[platform], state: 'published', updates };
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
  if (manifest) { manifest.state = manifest[platform].state === 'submitted' ? 'unknown-do-not-resubmit' : 'stopped'; save(); }
  console.error(error.message); process.exitCode = 1;
});
