import { openFirebaseRuntime } from './firebase-runtime.ts';

// Local operator entry in the deployed image. No browser or public HTTP write path.
const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 64 * 1024) throw new Error('Quota snapshot is too large');
  chunks.push(chunk);
}
const snapshot: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const runtime = await openFirebaseRuntime(process.env, { worker: true });
try {
  await runtime.admin.savePlatformQuotaObservation(snapshot);
  console.log('Platform quota observation saved');
} finally {
  await runtime.close();
}
