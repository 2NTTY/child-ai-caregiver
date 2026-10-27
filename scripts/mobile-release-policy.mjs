// Release classification is advisory; only Expo's native runtime can approve OTA compatibility.
export function classifyChanges(paths) {
  const result = { web: false, android: false, ios: false, server: false, nativeInputs: false, review: [] };
  for (const path of paths) {
    if (/^(docs\/|artifacts\/|tests\/|licenses\/|\.agents\/)|\.(md|test\.[cm]?[jt]sx?)$/.test(path)) continue;
    if (/^(server\/|prompts\/|knowledge\/|deploy\/)/.test(path)) { result.server = true; continue; }
    if (/^(frontend\/scripts\/|frontend\/verification\/|scripts\/)/.test(path)) continue;
    if (/^(frontend\/)?(android|ios)\//.test(path)) {
      result[/^(frontend\/)?ios\//.test(path) ? 'ios' : 'android'] = result.nativeInputs = true; continue;
    }
    if (/^(package(-lock)?\.json|frontend\/(package(-lock)?\.json|app\.(json|config\.js)|eas\.json))$/.test(path)) {
      result.web = result.android = result.ios = result.nativeInputs = true; continue;
    }
    if (/^(frontend\/|src\/(client|shared|config)\/|assets\/|public\/)/.test(path)) {
      if (/\.web\.|^public\//.test(path)) result.web = true;
      else if (/\.ios\./.test(path)) result.ios = true;
      else if (/\.android\./.test(path)) result.android = true;
      else if (/\.native\./.test(path)) result.android = result.ios = true;
      else result.web = result.android = result.ios = true;
      if (path.startsWith('src/shared/')) result.server = true;
      continue;
    }
    result.review.push(path);
  }
  return result;
}

export function verifyBuild(build, config, channel) {
  const platform = config.platform ?? 'android', profile = config.profile ?? channel;
  if (!['android', 'ios'].includes(platform) || !build || build.status !== 'FINISHED'
    || build.platform !== platform.toUpperCase()
    || (platform === 'ios' && (build.distribution !== 'STORE' || build.isForIosSimulator))
    || build.app?.id !== config.projectId || build.app?.ownerAccount?.name !== config.owner
    || build.appIdentifier !== config.applicationId || build.updateChannel?.name !== channel
    || build.buildProfile !== profile || !build.gitCommitHash
    || !build.runtime?.version || build.runtime.version !== build.fingerprint?.hash) {
    throw new Error('Baseline must be a finished selected-platform build from this project, distribution, profile, channel and fingerprint runtime');
  }
  return { id: build.id, platform, gitSha: build.gitCommitHash, runtime: build.runtime.version,
    appVersion: build.appVersion, versionCode: build.appBuildVersion };
}

export function decideRelease(impact, runtime, baseline, platform = 'android') {
  if (impact.review.length) return 'review-required';
  if (!impact[platform]) return impact.web ? 'web' : impact.server ? 'server' : 'none';
  if (!baseline) return 'build';
  if (!runtime) return 'runtime-required';
  return runtime === baseline.runtime ? 'update' : 'build';
}

export function verifyRollback(updates, visibleGroups, baseline, channel, platform = 'android') {
  const selected = updates?.filter(update => update.platform === platform);
  if (!['android', 'ios'].includes(platform) || selected?.length !== 1 || !baseline
    || (baseline.platform && baseline.platform !== platform)
    || !selected[0].group || selected[0].runtimeVersion !== baseline.runtime
    || selected[0].branch !== channel || selected[0].isRollBackToEmbedded
    || !visibleGroups.some(group => (Array.isArray(group) ? group : [group]).some(update =>
      update.group === selected[0].group && update.platform === platform))) {
    throw new Error('Rollback must be a published selected-platform update in this project branch and installed runtime');
  }
  return selected[0];
}
