// EAS public identifiers are configuration, never credentials.
export default ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID?.trim();
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Invalid EAS project identifier");
  if (process.env.EAS_BUILD_PROFILE && !projectId) throw new Error("Link the approved Expo project before cloud build");
  if (process.env.EAS_BUILD_PROFILE) {
    const required = ["EXPO_PUBLIC_FIREBASE_API_KEY", "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "EXPO_PUBLIC_FIREBASE_PROJECT_ID", "EXPO_PUBLIC_FIREBASE_APP_ID"];
    if (process.env.EXPO_PUBLIC_AUTH_PROVIDER !== "firebase" || required.some(name => !process.env[name]?.trim())) {
      throw new Error("Configure the approved Firebase client environment before cloud build");
    }
    const api = new URL(process.env.EXPO_PUBLIC_API_BASE_URL ?? "");
    if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash || api.pathname !== "/api") {
      throw new Error("Cloud builds require the approved HTTPS API endpoint");
    }
  }
  return { ...config, owner: "2NTTY",
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
    updates: projectId ? { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
      : { enabled: false } };
};
