import { readFileSync } from "node:fs";
import { isIP } from 'node:net';
// EAS public identifiers are configuration, never credentials.
export default ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID?.trim() || config.extra?.eas?.projectId;
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
  // The profile also identifies local EAS config evaluation before the build platform is set.
  const isIos = process.env.EAS_BUILD_PLATFORM === "ios"
    || !process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PROFILE === "ios-preview";
  const isAndroid = process.env.EAS_BUILD_PLATFORM === 'android'
    || !process.env.EAS_BUILD_PLATFORM && !!process.env.EAS_BUILD_PROFILE && !isIos;
  const providers = [...new Set((process.env.EXPO_PUBLIC_AUTH_PROVIDERS ?? '').split(',').map(value => value.trim()).filter(Boolean))];
  if (providers.some(provider => !['google.com', 'apple.com'].includes(provider))) throw new Error('Unknown authentication provider');
  const plugins = [...(config.plugins ?? [])], ios = { ...config.ios };
  const sharingIndex = plugins.findIndex(entry => (Array.isArray(entry) ? entry[0] : entry) === 'expo-sharing');
  const existingSharing = sharingIndex >= 0 && Array.isArray(plugins[sharingIndex]) ? plugins[sharingIndex][1] ?? {} : {};
  const sharingPlugin = ['expo-sharing', { ...existingSharing,
    android: { ...existingSharing.android, enabled: true, singleShareMimeTypes: ['*/*'], multipleShareMimeTypes: ['*/*'] },
    ios: { ...existingSharing.ios, enabled: false } }];
  if (sharingIndex < 0) plugins.push(sharingPlugin); else plugins[sharingIndex] = sharingPlugin;
  if (providers.includes('google.com') && (isIos || isAndroid)) {
    const oauthId = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
    if (!oauthId.test(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '')) throw new Error('Configure the Google Web client ID');
    if (isIos) {
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
      if (!oauthId.test(clientId)) throw new Error('Configure the Google iOS client ID');
      // Firebase JS remains the authority; only the native Google callback scheme is needed here.
      plugins.push(['@react-native-google-signin/google-signin', {
        iosUrlScheme: 'com.googleusercontent.apps.' + clientId.slice(0, -'.apps.googleusercontent.com'.length),
      }]);
    }
  }
  if (providers.includes('apple.com')) {
    if (isIos) ios.entitlements = { ...ios.entitlements, 'com.apple.developer.applesignin': ['Default'] };
    if (isAndroid) {
      const service = process.env.EXPO_PUBLIC_APPLE_SERVICE_ID ?? '';
      if (service.length > 200 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(service)) throw new Error('Configure the Apple Services ID');
      let redirect;
      try { redirect = new URL(process.env.EXPO_PUBLIC_APPLE_REDIRECT_URI ?? ''); } catch { /* Checked below. */ }
      if (!redirect || redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash
        || !redirect.hostname.includes('.') || redirect.hostname.endsWith('.localhost') || isIP(redirect.hostname.replace(/^\[|\]$/g, '')))
        throw new Error('Configure an approved HTTPS Apple Android redirect');
    }
  }
  // iOS uses Firebase JS authentication and must not read the Android-only descriptor.
  const googleServicesFile = isIos ? undefined : process.env.ANDROID_GOOGLE_SERVICES_FILE?.trim();
  if (googleServicesFile) {
    let service;
    try { service = JSON.parse(readFileSync(googleServicesFile, "utf8")); }
    catch { throw new Error("Android Firebase descriptor is unavailable or invalid"); }
    if (service.project_info?.project_id !== process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
      || !service.client?.some(client => client.client_info?.android_client_info?.package_name === "org.yuyoufang.app")) {
      throw new Error("Android Firebase descriptor does not match the approved project and application");
    }
  }
  if (process.env.EAS_BUILD_PROFILE && !isIos && !googleServicesFile)
    throw new Error("Configure the approved Android Firebase descriptor before building native notifications");
  return { ...config, plugins, ios, android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) }, owner: "2ntty",
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
    updates: projectId ? { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
      : { enabled: false } };
};
