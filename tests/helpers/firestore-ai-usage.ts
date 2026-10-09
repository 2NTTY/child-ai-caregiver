import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreAiUsage } from '../../server/firestore-ai-usage.ts';
import { createStorageCipher } from '../../server/storage-crypto.ts';

/** Serial fake transactions, with discarded callbacks and lost commit replies. Not an emulator. */
export function firestoreUsageFixture(start = Date.parse('2026-10-09T12:00:00Z')) {
  const records = new Map<string, unknown>(), transactions: { reads: number; writes: number }[] = [];
  let now = start, retry = false, lose = false, fail = false, tail = Promise.resolve();
  const database = {
    collection(namespace: string) { return { doc(id: string) { return { path: `${namespace}/${id}` }; } }; },
    async runTransaction(callback: (tx: unknown) => Promise<unknown>, options?: { readOnly?: boolean }) {
      let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      try {
        const run = async () => {
          const writes = new Map<string, unknown>(), stats = { reads: 0, writes: 0 }; transactions.push(stats);
          const result = await callback({
            async get(ref: { path: string }) {
              assert.equal(writes.size, 0, 'Firestore requires all reads before writes'); stats.reads++;
              const value = records.get(ref.path); return { exists: records.has(ref.path), data: () => structuredClone(value) };
            },
            create(ref: { path: string }, value: unknown) {
              assert.equal(options?.readOnly, undefined); assert.equal(records.has(ref.path), false); stats.writes++; writes.set(ref.path, structuredClone(value));
            },
            set(ref: { path: string }, value: unknown) {
              assert.equal(options?.readOnly, undefined); stats.writes++; writes.set(ref.path, structuredClone(value));
            },
          });
          return { result, writes };
        };
        if (retry) { retry = false; await run(); }
        const { result, writes } = await run();
        if (fail) { fail = false; throw new Error('Synthetic failed commit'); }
        for (const [path, value] of writes) records.set(path, value);
        if (lose) { lose = false; throw new Error('Synthetic lost commit reply'); }
        return result;
      } finally { release(); }
    },
  } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 39)), projectId: 'synthetic-project',
    namespace: 'synthetic_daily_usage', billingSource: 'platform' as const, serverClock: () => now };
  return { database, options, records, transactions, service: new FirestoreAiUsage(options),
    setNow: (value: number) => { now = value; }, retryCallback: () => { retry = true; },
    loseReply: () => { lose = true; }, failCommit: () => { fail = true; } };
}
