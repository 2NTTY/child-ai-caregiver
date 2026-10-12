import { serverStorageBackend } from './firebase-config.ts';
try {
  serverStorageBackend(process.env);
  await import('./firebase-worker-main.ts');
} catch {
  console.error('worker_configuration_failed');
  process.exitCode = 1;
}
