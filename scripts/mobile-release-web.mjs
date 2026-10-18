// Separate process prevents Android public Firebase config from leaking into the Web bundle.
import { spawnSync } from 'node:child_process';
const { EXPO_PUBLIC_API_BASE_URL: api, EXPO_PUBLIC_AUTH_PROVIDER: auth } = process.env;
if (auth !== 'firebase' || (api && api !== '/api' && api !== 'https://ex-machina.eu.org/api')) throw new Error('Use the approved Web Firebase environment');
for (const name of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID']) {
  if (!process.env[`EXPO_PUBLIC_FIREBASE_${name}`]) throw new Error('Incomplete Web Firebase configuration');
}
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run via npm run mobile:release');
const result = spawnSync(process.execPath, [npm, 'run', 'build:web'], { stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
