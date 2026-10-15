// EAS public identifiers are configuration, never credentials.
export default ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID?.trim();
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Invalid EAS project identifier");
  if (process.env.EAS_BUILD_PROFILE && !projectId) throw new Error("Link the approved Expo project before cloud build");
  return { ...config, owner: "2NTTY",
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
    updates: projectId ? { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
      : { enabled: false } };
};
