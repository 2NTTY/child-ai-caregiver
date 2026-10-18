// Release classification is advisory; only Expo's native runtime can approve OTA compatibility.
export function classifyChanges(paths) {
  const result = { web: false, android: false, server: false, nativeInputs: false, review: [] };
  for (const path of paths) {
    if (/^(docs\/|artifacts\/|tests\/|licenses\/|\.agents\/)|\.(md|test\.[cm]?[jt]sx?)$/.test(path)) continue;
    if (/^(server\/|prompts\/|knowledge\/|deploy\/)/.test(path)) { result.server = true; continue; }
    if (/^(frontend\/scripts\/|frontend\/verification\/|scripts\/)/.test(path)) continue;
    if (/^(package(-lock)?\.json|frontend\/(package\.json|app\.(json|config\.js)|eas\.json|android\/|ios\/))/.test(path)) {
      result.web = result.android = result.nativeInputs = true; continue;
    }
    if (/^(frontend\/|src\/(client|shared|config)\/|assets\/|public\/)/.test(path)) {
      if (/\.ios\./.test(path)) continue;
      if (/\.web\.|^public\//.test(path)) result.web = true;
      else if (/\.(native|android)\./.test(path)) result.android = true;
      else result.web = result.android = true;
      if (path.startsWith('src/shared/')) result.server = true;
      continue;
    }
    result.review.push(path);
  }
  return result;
}

export function verifyBuild(build, config, channel) {
  if (!build || build.status !== 'FINISHED' || build.platform !== 'ANDROID'
    || build.app?.id !== config.projectId || build.app?.ownerAccount?.name !== config.owner
    || build.appIdentifier !== config.applicationId || build.updateChannel?.name !== channel
    || build.buildProfile !== channel || !build.gitCommitHash
    || !build.runtime?.version || build.runtime.version !== build.fingerprint?.hash) {
    throw new Error('Baseline must be a finished Android build from this project, profile, channel and fingerprint runtime');
  }
  return { id: build.id, gitSha: build.gitCommitHash, runtime: build.runtime.version,
    appVersion: build.appVersion, versionCode: build.appBuildVersion };
}

export function decideRelease(impact, runtime, baseline) {
  if (impact.review.length) return 'review-required';
  if (!impact.android) return impact.web ? 'web' : impact.server ? 'server' : 'none';
  if (!baseline) return 'build';
  if (!runtime) return 'runtime-required';
  return runtime === baseline.runtime ? 'update' : 'build';
}

export function verifyRollback(updates, visibleGroups, baseline, channel) {
  const android = updates?.filter(update => update.platform === 'android');
  if (android?.length !== 1 || android[0].runtimeVersion !== baseline.runtime
    || android[0].branch !== channel || android[0].isRollBackToEmbedded
    || !visibleGroups.some(group => (Array.isArray(group) ? group : [group]).some(update => update.group === android[0].group))) {
    throw new Error('Rollback must be a published Android update in this project branch and installed runtime');
  }
  return android[0];
}
