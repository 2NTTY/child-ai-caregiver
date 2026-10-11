import { serverStorageBackend } from './firebase-config.ts';

// Keep the old deployment available until F08, without loading it in the Firebase process.
try {
  if (serverStorageBackend(process.env) === 'firestore') await import('./firebase-main.ts');
  else await import('./index.ts');
} catch {
  console.error('server_configuration_failed');
  process.exitCode = 1;
}
