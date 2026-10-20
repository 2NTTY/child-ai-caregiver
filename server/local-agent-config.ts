import { readFirebaseServerConfig } from './firebase-config.ts';

type Environment = Record<string, string | undefined>;
const disabledChannels = ['WEB_PUSH_ENABLED', 'ANDROID_PUSH_ENABLED', 'TELEGRAM_ENABLED'];

export function localEmulatorOrigin(value: string | undefined): string {
  if (!value || !/^127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(value)) throw new Error('Local emulator must use an explicit IPv4 loopback port');
  const url = new URL('http://' + value);
  if (!url.port || Number(url.port) > 65535) throw new Error('Invalid local emulator port');
  return url.origin;
}

/** Called before constructing any Admin SDK or database client. No missing-service cloud fallback. */
export function assertLocalAgentEnvironment(env: Environment) {
  if (env.YUYF_LOCAL_DEVELOPMENT !== '1' || env.NODE_ENV === 'production') throw new Error('Local Agent mode requires explicit development configuration');
  const config = readFirebaseServerConfig(env);
  if (!config.projectId.startsWith('demo-') || config.databaseId !== '(default)' || config.namespace !== 'local_agent'
    || config.host !== '127.0.0.1' || new URL(config.publicOrigin).hostname !== '127.0.0.1'
    || new URL(config.publicOrigin).protocol !== 'http:'
    || config.photoBucket !== config.projectId + '-private' || config.erasureBucket !== config.projectId + '-journal') {
    throw new Error('Local Agent data must use its isolated demo project');
  }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[key] !== undefined && env[key] !== config.projectId) throw new Error('Local data and model projects must be configured separately');
  }
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) localEmulatorOrigin(env[key]);
  if (env.STORAGE_EMULATOR_HOST !== localEmulatorOrigin(env.FIREBASE_STORAGE_EMULATOR_HOST)
    || disabledChannels.some(key => env[key] !== 'false') || !['true', 'false'].includes(env.FIREBASE_AUTH_EMAIL_ENABLED ?? '')) {
    throw new Error('Local Agent external delivery must stay disabled');
  }
  return config;
}
