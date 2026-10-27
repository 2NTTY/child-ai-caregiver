import type { Firestore, DocumentReference } from '@google-cloud/firestore';
import { createFirestoreBackgroundMaintenance } from '../../server/firestore-background-maintenance.ts';
import { createFirestoreBackgroundQueue, type FirestoreBackgroundDelivery } from '../../server/firestore-background-work.ts';
import { createFirestoreKnowledgeRefresh } from '../../server/firestore-knowledge-refresh.ts';
import { createFirestoreErasureStore } from '../../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../../server/firestore-erasure-cleanup.ts';
import type { avatarDomainFixture } from './avatar-memory.ts';

/** Offline adapter adds native-style direct get/id to the existing transactional in-memory fixture. */
export function avatarMaintenanceFixture(f: Awaited<ReturnType<typeof avatarDomainFixture>>) {
  const collection = f.fake.database.collection.bind(f.fake.database);
  function wrap<T extends object>(raw: T): T {
    return new Proxy(raw, { get(target, key) {
      if (key === 'id' && 'path' in target && typeof target.path === 'string') return target.path.split('/').at(-1);
      if (key === 'get') return () => f.fake.database.runTransaction(tx => tx.get(raw as unknown as DocumentReference));
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return result !== null && typeof result === 'object' && 'path' in result ? wrap(result) : result;
      };
    } });
  }
  f.fake.database.collection = ((path: string) => wrap(collection(path))) as Firestore['collection'];
  const unavailable = async (): Promise<never> => { throw new Error('Unrelated synthetic port must not run'); };
  const erasures = createFirestoreErasureStore({ ...f.options, journal: f.journal });
  const cleanup = createFirestoreErasureCleanup({ ...f.options, journal: f.journal, erasures, avatars: f.cleanup,
    photos: { eraseForScope: unavailable }, deleteAgentSession: unavailable, eraseAgentUserPage: unavailable,
    eraseDeviceSessions: unavailable, eraseAuthUser: unavailable });
  const knowledge = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [], readControl: tx => f.authority.readControl(tx) });
  const maintenance = createFirestoreBackgroundMaintenance({ ...f.options, enabled: true, avatars: f.cleanup,
    knowledge, photos: { cleanupDeleted: unavailable }, erasures, cleanup });
  const deliveries: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
    transport: { async enqueue(job) { deliveries.push(job); return { state: 'confirmed' }; }, probe: unavailable },
    execute: (job, signal) => maintenance.process(job, signal) });
  return { maintenance, queue, deliveries };
}
