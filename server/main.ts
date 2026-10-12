import { serverStorageBackend } from './firebase-config.ts';
try {
  serverStorageBackend(process.env);
  await import('./firebase-main.ts');
} catch {
  console.error('server_configuration_failed');
  process.exitCode = 1;
}
