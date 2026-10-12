import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';

/** Serial synthetic transactions for native Session/root/daily composition, not an emulator. */
export function serialFirestoreFixture() {
  const records = new Map<string, any>();
  const versions = new Map<string, number>();
  let tail = Promise.resolve(), revision = 0;
  let beforeBatchCommit: (() => Promise<void>) | undefined, loseBatchReply = false;
  type Ref = { path: string; collection: (name: string) => Query };
  type Query = { path: string; query: true; filters: [string, string, unknown][]; orders: [string, string][]; cap: number;
    doc: (id: string) => Ref; where: (key: string, op: string, value: unknown) => Query;
    orderBy: (key: any, direction?: string) => Query; limit: (value: number) => Query;
    startAfter: (value: string) => Query; get: () => Promise<any>; count: () => { get: () => Promise<any> } };
  const ref = (path: string): Ref => ({ path, collection: name => query(path + '/' + name) });
  const query = (path: string, filters: Query['filters'] = [], orders: Query['orders'] = [], count = Infinity): Query => ({
    path, query: true, filters, orders, cap: count, doc: id => ref(path + '/' + id),
    where: (key, op, value) => query(path, [...filters, [key, op, value]], orders, count),
    orderBy: (key, direction = 'asc') => query(path, filters, [...orders, [typeof key === 'string' ? key : key.toString(), direction]], count),
    limit: value => query(path, filters, orders, value),
    startAfter: value => query(path, [...filters, [orders[0][0], '>', value]], orders, count),
    get: async () => read(query(path, filters, orders, count)),
    count: () => ({ get: async () => ({ data: () => ({ count: read(query(path, filters, orders, count)).size }) }) }),
  });
  const snapshot = (path: string) => ({ exists: records.has(path), id: path.split('/').at(-1), ref: ref(path), updateTime: versions.get(path),
    data: () => structuredClone(records.get(path)), get: (key: string) => key === '__name__' ? path.split('/').at(-1) : structuredClone(records.get(path)?.[key]) });
  const read = (target: Ref | Query): any => {
    if (!('query' in target)) return snapshot(target.path);
    const docs = [...records.keys()].filter(path => path.startsWith(target.path + '/')
      && path.slice(target.path.length + 1).indexOf('/') === -1).map(snapshot).filter(row => target.filters.every(([key, op, value]) => {
        if (op === '==') return row.get(key) === value;
        if (op === '>=') return row.get(key) >= (value as number);
        if (op === '>') return row.get(key) > (value as number);
        throw new Error('Unsupported synthetic query');
      })).sort((a, b) => { for (const [key, direction] of target.orders) {
        const x = a.get(key), y = b.get(key), delta = x < y ? -1 : x > y ? 1 : 0;
        if (delta) return direction === 'desc' ? -delta : delta;
      } return 0; }).slice(0, target.cap);
    return { docs, size: docs.length };
  };
  async function runTransaction(callback: (tx: any) => Promise<any>, options?: { readOnly?: boolean }) {
    let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    const writes = new Map<string, any>();
    const write = (target: Ref, value: any) => { assert.equal(options?.readOnly, undefined); writes.set(target.path, structuredClone(value)); };
    const get = async (target: Ref | Query) => { assert.equal(writes.size, 0); return read(target); };
    try {
      const result = await callback({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
        create: (target: Ref, value: any) => { assert.equal(records.has(target.path), false); write(target, value); },
        set: write, update: (target: Ref, value: any) => { assert.equal(records.has(target.path), true); write(target, { ...records.get(target.path), ...value }); },
        delete: (target: Ref) => write(target, undefined),
      });
      if (writes.size) revision++;
      for (const [path, value] of writes) {
        if (value === undefined) { records.delete(path); versions.delete(path); }
        else { records.set(path, value); versions.set(path, revision); }
      }
      return result;
    } finally { release(); }
  }
  const database = { collection: query, runTransaction, batch() {
    const deletes: { target: Ref; lastUpdateTime?: number }[] = [];
    return { delete(target: Ref, precondition?: { lastUpdateTime?: number }) { deletes.push({ target, ...precondition }); },
      async commit() {
        await beforeBatchCommit?.();
        await runTransaction(async tx => {
          for (const item of deletes) if (item.lastUpdateTime !== undefined) {
            const current = await tx.get(item.target);
            assert.equal(current.updateTime, item.lastUpdateTime, 'Synthetic batch precondition conflict');
          }
          for (const { target } of deletes) tx.delete(target);
        });
        if (loseBatchReply) { loseBatchReply = false; throw new Error('Synthetic lost batch acknowledgement'); }
      } };
  } } as unknown as Firestore;
  return { database, records, beforeBatch: (callback?: () => Promise<void>) => { beforeBatchCommit = callback; },
    loseBatchReply: () => { loseBatchReply = true; } };
}
