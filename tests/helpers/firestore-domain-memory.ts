import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';

/** Serial synthetic range/order/cursor queries. This does not verify native indexes or cloud concurrency. */
export function firestoreDomainFixture() {
  const records = new Map<string, any>();
  const versions = new Map<string, number>(); let revision = 0;
  type Ref = { path: string; collection(name: string): Query };
  type Query = Ref & { query: true; filters: [string, string, any][]; orders: [string, string][]; count: number; cursor: any[] | null;
    doc(id: string): Ref; where(key: string, op: string, value: any): Query; orderBy(key: string, direction?: string): Query;
    limit(count: number): Query; startAfter(...values: any[]): Query };
  const ref = (path: string): Ref => ({ path, collection: name => query(path + '/' + name) });
  const query = (path: string, filters: Query['filters'] = [], orders: Query['orders'] = [], count = Infinity, cursor: any[] | null = null): Query => ({
    path, collection: name => query(path + '/' + name), query: true, filters, orders, count, cursor, doc: id => ref(path + '/' + id),
    where: (key, op, value) => query(path, [...filters, [key, op, value]], orders, count, cursor),
    orderBy: (key, direction = 'asc') => query(path, filters, [...orders, [key, direction]], count, cursor),
    limit: count => query(path, filters, orders, count, cursor), startAfter: (...values) => query(path, filters, orders, count, values),
  });
  const snapshot = (path: string): any => ({ exists: records.has(path), id: path.split('/').at(-1), ref: ref(path), updateTime: versions.get(path),
    data: () => structuredClone(records.get(path)), get: (field: string) => structuredClone(records.get(path)?.[field]) });
  const compare = (a: any[], b: any[], orders: Query['orders']) => {
    for (let i = 0; i < orders.length; i++) {
      const delta = a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0;
      if (delta) return orders[i][1] === 'desc' ? -delta : delta;
    } return 0;
  };
  const read = (target: Ref | Query) => {
    if (!('query' in target)) return snapshot(target.path);
    const docs = [...records.keys()].filter(path => path.startsWith(target.path + '/') && !path.slice(target.path.length + 1).includes('/'))
      .map(snapshot).filter(doc => target.filters.every(([key, op, value]) => {
        const actual = doc.get(key);
        switch (op) {
          case '==': return actual === value; case '>': return actual > value; case '>=': return actual >= value;
          case 'in': return value.includes(actual);
          case '<': return actual < value; case '<=': return actual <= value; default: throw new Error('Unsupported synthetic operator');
        }
      })).sort((a, b) => compare(target.orders.map(([key]) => a.get(key)), target.orders.map(([key]) => b.get(key)), target.orders))
      .filter(doc => !target.cursor || compare(target.orders.map(([key]) => doc.get(key)), target.cursor, target.orders) > 0).slice(0, target.count);
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  let tail = Promise.resolve(), discard = false, lost = false, abortCommit = false, afterDiscard: (() => Promise<void>) | undefined;
  const attempt = async (callback: (tx: any) => Promise<any>, rollback: boolean) => {
    const writes = new Map<string, any>();
    const write = (target: Ref, value: any) => { writes.set(target.path, structuredClone(value)); };
    const get = async (target: Ref | Query) => { assert.equal(writes.size, 0, 'All reads must precede writes'); return read(target); };
    const result = await callback({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)), set: write,
      create: (ref: Ref, value: any) => { assert.equal(records.has(ref.path) || writes.has(ref.path), false, 'Create must be unique'); write(ref, value); },
      update: (ref: Ref, value: any) => { assert.equal(records.has(ref.path), true); write(ref, { ...records.get(ref.path), ...value }); },
      delete: (ref: Ref) => write(ref, undefined) });
    if (!rollback && abortCommit) { abortCommit = false; throw new Error('Synthetic transaction commit failed'); }
    if (!rollback) {
      if (writes.size) revision++;
      for (const [path, value] of writes) {
        if (value === undefined) { records.delete(path); versions.delete(path); }
        else { records.set(path, value); versions.set(path, revision); }
      }
    }
    return result;
  };
  const database = { collection: query, async runTransaction(callback: (tx: any) => Promise<any>) {
    let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    try {
      if (discard) {
        discard = false; await attempt(callback, true);
        const hook = afterDiscard; afterDiscard = undefined;
        // The hook mutates synthetic records only; another transaction would wait on this serial lock.
        await hook?.();
      }
      const result = await attempt(callback, false);
      if (lost) { lost = false; throw new Error('Synthetic lost commit acknowledgement'); }
      return result;
    } finally { release(); }
  }, batch() {
    const deletes: { target: Ref; lastUpdateTime?: number }[] = [];
    return { delete(target: Ref, precondition?: { lastUpdateTime?: number }) { deletes.push({ target, ...precondition }); },
      async commit() {
        await database.runTransaction(async tx => {
          for (const item of deletes) if (item.lastUpdateTime !== undefined) {
            const current = await tx.get(item.target as any) as unknown as { updateTime?: number };
            assert.equal(current.updateTime, item.lastUpdateTime, 'Synthetic batch precondition conflict');
          }
          for (const { target } of deletes) tx.delete(target as any);
        });
      } };
  } } as unknown as Firestore;
  return { database, records, retry(hook?: () => Promise<void>) { discard = true; afterDiscard = hook; }, loseReply() { lost = true; }, failCommit() { abortCommit = true; } };
}
