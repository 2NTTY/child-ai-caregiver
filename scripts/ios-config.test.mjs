import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getConfig } from "@expo/config";
import appConfig from '../frontend/app.config.js';

const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const eas = JSON.parse(readFileSync(join(frontend, "eas.json"), "utf8"));
const publicEnvironment = {
  ...eas.build.base.env,
  EXPO_PUBLIC_FIREBASE_API_KEY: "synthetic-config-test-key",
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "ios-config-test.firebaseapp.com",
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: "ios-config-test",
  EXPO_PUBLIC_FIREBASE_APP_ID: "1:123456789:web:abcdef123456",
};
const environmentKeys = [...Object.keys(publicEnvironment), "EAS_PROJECT_ID", "EAS_BUILD_PROFILE",
  "EAS_BUILD_PLATFORM", "ANDROID_GOOGLE_SERVICES_FILE", "EXPO_PUBLIC_AUTH_PROVIDERS",
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
  "EXPO_PUBLIC_APPLE_SERVICE_ID", "EXPO_PUBLIC_APPLE_REDIRECT_URI"];

function resolveConfig(environment = {}, raw = false) {
  const previous = new Map(environmentKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) delete process.env[key];
    for (const [key, value] of Object.entries({ ...publicEnvironment, EAS_BUILD_PROFILE: "ios-preview", ...environment })) {
      if (value !== undefined) process.env[key] = value;
    }
    // Resolve the real static and dynamic config without running native plugins or a build.
    return raw ? appConfig({ config: JSON.parse(readFileSync(join(frontend, 'app.json'), 'utf8')).expo })
      : getConfig(frontend, { skipPlugins: true }).exp;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("iPhone store profile resolves without the Android Firebase descriptor", () => {
  const config = resolveConfig();
  assert.ok(config.platforms.includes("ios"));
  assert.equal(config.ios.bundleIdentifier, "org.yuyoufang.app");
  assert.equal(config.ios.supportsTablet, false);
  assert.equal(config.ios.appleTeamId, undefined);
  assert.equal(config.android.googleServicesFile, undefined);
  assert.deepEqual(eas.build["ios-preview"], {
    extends: "base", distribution: "store", channel: "ios-preview", environment: "preview",
  });
  const explicitIos = resolveConfig({ EAS_BUILD_PLATFORM: "ios",
    ANDROID_GOOGLE_SERVICES_FILE: join(frontend, "missing-android-descriptor-for-ios-test.json") });
  assert.equal(explicitIos.android.googleServicesFile, undefined);
});

test("native providers require explicit platform configuration and derive official iOS capability settings", () => {
  const plugin = '@react-native-google-signin/google-signin';
  const disabled = resolveConfig({}, true);
  assert.equal(disabled.plugins.some(value => (Array.isArray(value) ? value[0] : value) === plugin), false);
  assert.equal(disabled.ios.entitlements?.['com.apple.developer.applesignin'], undefined);
  const configured = { EXPO_PUBLIC_AUTH_PROVIDERS: 'google.com,apple.com',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '123-web.apps.googleusercontent.com',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-ios.apps.googleusercontent.com' };
  const ios = resolveConfig(configured, true);
  assert.deepEqual(ios.plugins.find(value => Array.isArray(value) && value[0] === plugin),
    [plugin, { iosUrlScheme: 'com.googleusercontent.apps.123-ios' }]);
  assert.deepEqual(ios.ios.entitlements['com.apple.developer.applesignin'], ['Default']);
  assert.throws(() => resolveConfig({ ...configured, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: undefined }), /Google iOS client/);
  assert.throws(() => resolveConfig({ ...configured, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'invalid' }), /Google Web client/);
  const android = { EAS_BUILD_PROFILE: undefined, EAS_BUILD_PLATFORM: 'android', EXPO_PUBLIC_AUTH_PROVIDERS: 'apple.com',
    EXPO_PUBLIC_APPLE_SERVICE_ID: 'org.yuyoufang.signin', EXPO_PUBLIC_APPLE_REDIRECT_URI: 'https://app.example.invalid/auth/apple' };
  const androidConfig = resolveConfig(android);
  assert.equal(androidConfig.ios.entitlements?.['com.apple.developer.applesignin'], undefined);
  assert.throws(() => resolveConfig({ ...android, EXPO_PUBLIC_APPLE_REDIRECT_URI: 'http://localhost/auth/apple' }), /Apple Android redirect/);
  assert.throws(() => resolveConfig({ ...android, EXPO_PUBLIC_APPLE_SERVICE_ID: undefined }), /Apple Services ID/);
  assert.throws(() => resolveConfig({ EXPO_PUBLIC_AUTH_PROVIDERS: 'unknown' }), /authentication provider/);
});

test("iOS keeps the Firebase public configuration and HTTPS endpoint gates", () => {
  assert.throws(() => resolveConfig({ EXPO_PUBLIC_FIREBASE_API_KEY: undefined }), /approved Firebase client environment/);
  assert.throws(() => resolveConfig({ EXPO_PUBLIC_API_BASE_URL: "http://example.invalid/api" }), /approved HTTPS API endpoint/);
  assert.throws(() => resolveConfig({ EXPO_PUBLIC_API_BASE_URL: "https://example.invalid/api?redirect=other" }), /approved HTTPS API endpoint/);
});

test("Android still requires and validates its own Firebase descriptor", () => {
  const android = { EAS_BUILD_PROFILE: "preview", EAS_BUILD_PLATFORM: "android" };
  assert.throws(() => resolveConfig(android), /approved Android Firebase descriptor/);
  assert.throws(() => resolveConfig({ EAS_BUILD_PROFILE: "ios-preview", EAS_BUILD_PLATFORM: "android" }), /approved Android Firebase descriptor/);
  const folder = mkdtempSync(join(tmpdir(), "yuyoufang-ios-config-"));
  const descriptor = join(folder, "google-services.json");
  try {
    const service = { project_info: { project_id: publicEnvironment.EXPO_PUBLIC_FIREBASE_PROJECT_ID },
      client: [{ client_info: { android_client_info: { package_name: "org.yuyoufang.app" } } }] };
    writeFileSync(descriptor, JSON.stringify(service));
    assert.equal(resolveConfig({ ...android, ANDROID_GOOGLE_SERVICES_FILE: descriptor }).android.googleServicesFile, descriptor);
    service.client[0].client_info.android_client_info.package_name = "org.example.other";
    writeFileSync(descriptor, JSON.stringify(service));
    assert.throws(() => resolveConfig({ ...android, ANDROID_GOOGLE_SERVICES_FILE: descriptor }), /does not match the approved project and application/);
  } finally {
    unlinkSync(descriptor);
    rmdirSync(folder);
  }
});
