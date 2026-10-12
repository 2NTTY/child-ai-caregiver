import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';

// Operator-only entry: no public endpoint can issue invitations or initialise authority.
let runtime;
try {
  const command = process.argv[2];
  if (!['initialize', 'set-enabled', 'invite', 'revoke-invitation'].includes(command)) throw new Error('command');
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('input');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  runtime = await openFirebasePersistence(process.env);
  if (command === 'initialize') await runtime.authority.initializeControl(input);
  else if (command === 'set-enabled') await setFirebaseBackupControl({ database: runtime.database, cipher: runtime.cipher,
    projectId: runtime.config.projectId, namespace: runtime.config.namespace }, input);
  else if (command === 'invite') await runtime.authority.issueInvitation(input);
  else await runtime.authority.revokeInvitation(input);
  console.info(JSON.stringify({ command, confirmed: true }));
} catch {
  // No address, credentials, ciphertext or rejected payload in operator logs.
  console.error('firebase_control_unconfirmed'); process.exitCode = 1;
} finally {
  await runtime?.close().catch(() => { process.exitCode = 1; });
}
