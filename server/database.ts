import { Pool } from "pg";
import type { ServerConfig } from "./config.ts";

export function createPool(config: ServerConfig): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    idleTimeoutMillis: 30000,
  });
  // Do not emit driver errors that can include connection details or query input.
  pool.on("connect", (client) => {
    client.on("error", () => { console.error("database_connection_error"); });
  });
  pool.on("error", () => { console.error("database_connection_error"); });
  return pool;
}
