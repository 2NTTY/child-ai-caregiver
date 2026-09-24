import type { Pool, PoolClient } from "pg";

/** A request-scoped adapter for the existing short, sequential store transactions.
 * Every query stays on the outer transaction's connection. A store's transaction
 * becomes a savepoint; only the owner may commit/release the real connection.
 * Never use this adapter for model calls, notifications or concurrent stores.
 */
export function transactionPool(client: PoolClient): { pool: Pool; assertReleased: () => void } {
  let borrowed = false, sequence = 0, poisoned = false;
  const pool = {
    query: client.query.bind(client),
    async connect() {
      if (borrowed || poisoned) throw new Error("Overlapping store transactions are not supported");
      borrowed = true;
      const name = `online_store_${++sequence}`;
      let active = false, released = false;
      return {
        async query(sql: string, values?: unknown[]) {
          if (released || poisoned) throw new Error("Transaction connection is unavailable");
          if (sql === "BEGIN") {
            if (active) throw new Error("Nested store transaction");
            const result = await client.query(`SAVEPOINT ${name}`); active = true; return result;
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (!active) throw new Error("No store transaction");
            if (sql === "ROLLBACK") await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
            const result = await client.query(`RELEASE SAVEPOINT ${name}`); active = false; return result;
          }
          return client.query(sql, values);
        },
        release(discard = false) {
          if (released) throw new Error("Transaction connection already released");
          released = true; borrowed = false; poisoned ||= discard || active;
        },
      };
    },
  } as unknown as Pool;
  return { pool, assertReleased() { if (borrowed || poisoned) throw new Error("Store transaction was not closed"); } };
}
