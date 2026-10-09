import { port, host, projectId, connections, blocked } from './firestore-session-emulator-guard.mjs';
const { Firestore } = await import('@google-cloud/firestore');
const { FirestoreRootBudget } = await import('../server/firestore-root-budget.ts');
const { createStorageCipher } = await import('../server/storage-crypto.ts');
const request = JSON.parse(process.argv[3]);
if (!/^budget_contract_[a-f0-9]{16}$/.test(request.namespace) || !process.send) throw new Error('Synthetic child fixture required');
const database = new Firestore({ projectId, host: '127.0.0.1', port, ssl: false, ignoreUndefinedProperties: false });
const service = new FirestoreRootBudget({ database, projectId, namespace: request.namespace, cipher: createStorageCipher(Buffer.alloc(32, 47)) });
process.send({ ready: true, pid: process.pid });
try {
  await new Promise(resolve => process.once('message', resolve));
  const opened = await service.open(request.context);
  const admission = await service.reserve(request.context, request.attempt);
  // Deliberately discard the permit after durable commit, modelling a lost reply.
  process.send(request.dropReply ? { committedReplyLost: true, pid: process.pid } : { admission, opened, pid: process.pid });
} catch (error) {
  process.send({ error: error.code ?? 'unexpected', message: error.message, pid: process.pid });
} finally {
  await database.terminate();
  process.send({ audit: { host, connections: connections.length, blocked, clientClosedByComposer: true } });
  process.disconnect();
}
