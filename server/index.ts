import { createServer } from "node:http";
import { createAuth } from "./auth.ts";
import { createRequestHandler } from "./app.ts";
import { readServerConfig } from "./config.ts";
import { createPool } from "./database.ts";
import { createWorkspaceStore } from "./workspaces.ts";
import { createRecordStore } from "./records.ts";
import { readAiConfig } from "./ai-config.ts";
import { createAiUsageStore } from "./ai-usage.ts";
import { createChatStore } from "./chat.ts";
import { createModelGateway } from "./model-gateway.ts";

try {
  const config = readServerConfig(process.env);
  const aiConfig = readAiConfig(process.env);
  const pool = createPool(config);
  const auth = createAuth(config, pool);
  const handler = createRequestHandler({
    config, auth, workspaces: createWorkspaceStore(pool),
    records: createRecordStore(pool),
    chat: createChatStore(pool),
    // S11 wires the real provider together with authorized chat orchestration.
    modelGateway: createModelGateway({ config: aiConfig, usage: createAiUsageStore(pool) }),
    checkDatabase: async () => { await pool.query("SELECT 1"); },
  });
  const server = createServer((request, response) => {
    request.on("error", () => {});
    void handler(request, response).catch(() => { response.destroy(); });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let poolClosing: Promise<void> | undefined;
  const closePool = () => { poolClosing ??= pool.end().catch(() => { process.exitCode = 1; }); return poolClosing; };
  server.on("error", () => { console.error("server_start_failed"); void closePool(); process.exitCode = 1; });
  server.listen(config.port, config.host, () => { console.info("server_started"); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); }, 5000).unref();
    server.close(() => { clearTimeout(deadline); void closePool(); });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch {
  console.error("server_configuration_failed");
  process.exitCode = 1;
}
