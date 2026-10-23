import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getConfig } from "@expo/config";

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
  "EAS_BUILD_PLATFORM", "ANDROID_GOOGLE_SERVICES_FILE"];

function resolveConfig(environment = {}) {
  const previous = new Map(environmentKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) delete process.env[key];
    for (const [key, value] of Object.entries({ ...publicEnvironment, EAS_BUILD_PROFILE: "ios-preview", ...environment })) {
      if (value !== undefined) process.env[key] = value;
    }
    // Resolve the real static and dynamic config without running native plugins or a build.
    return getConfig(frontend, { skipPlugins: true }).exp;
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
