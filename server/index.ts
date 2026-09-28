import { readFile } from "node:fs/promises";
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
import { createStorageCipher, readSecretKey } from "./storage-crypto.ts";
import { verifyEncryptedStorage } from "./storage-upgrade.ts";
import { createVertexProvider } from "./vertex-provider.ts";
import { createFamilyStore } from "./families.ts";
import { createCareStore } from "./care.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore } from "./tasks.ts";
import { createOnlineStore } from "./online.ts";
import { createWorkerQueue } from "./worker-queue.ts";
import { createTaskScheduling } from "./task-worker.ts";
import { createWebPushQueue } from "./web-push-queue.ts";
import { createWebPushStore } from "./web-push-store.ts";
import { readWebPushConfig } from "./web-push-gateway.ts";
import { createGrowthStore } from "./growth-store.ts";
import { createProductAgentServices } from "./product-agent-services.ts";

import { readTelegramConfig } from "./telegram-config.ts";
import { createTelegramStore } from "./telegram-store.ts";
import { createTelegramGateway } from "./telegram-gateway.ts";
import { telegramQueue } from "./telegram-worker.ts";
let startupCleanup: (() => Promise<void>) | undefined;

try {
  const config = readServerConfig(process.env);
  const aiConfig = readAiConfig(process.env);
  const telegramConfig = await readTelegramConfig(process.env);
  const chatPrompt = await readFile(new URL("../prompts/p1/childcare-chat.txt", import.meta.url), "utf8");
  const provider = aiConfig.enabled ? createVertexProvider(aiConfig) : undefined;
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const pool = createPool(config);
  startupCleanup = () => pool.end();
  await verifyEncryptedStorage(pool, cipher);
  // Additive rollout: older databases keep their existing stores until the new
  // migration has completed. Never make ordinary writes depend on missing tables.
  const onlineEnabled = (await pool.query<{ ready: boolean }>("SELECT EXISTS(SELECT 1 FROM app_migrations WHERE id='010-online-operations') AS ready")).rows[0].ready;
  const queue = (await pool.query("SELECT 1 FROM app_migrations WHERE id='013-task-worker'")).rowCount ? createWorkerQueue(pool, "producer") : undefined;
  startupCleanup = async () => { try { await queue?.stop(); } finally { await pool.end(); } };
  await queue?.start();
  const taskScheduling = queue ? createTaskScheduling(cipher, queue.queue) : undefined;
  const pushConfig = await readWebPushConfig(process.env);
  const pushReady = Boolean((await pool.query("SELECT 1 FROM app_migrations WHERE id='015-web-push'")).rowCount);
  const pushServices = pushReady ? { publicKey: pushConfig?.publicKey ?? null, queue: queue ? createWebPushQueue(pool, queue.boss).queue : undefined } : undefined;
  const telegramReady = Boolean((await pool.query("SELECT 1 FROM app_migrations WHERE id='018-telegram-channel'")).rowCount);
  if(telegramConfig && !telegramReady)throw new Error("telegram_migration_required");
  const telegramServices=telegramReady?{config:telegramConfig,queue:queue?telegramQueue(queue.boss):undefined}:undefined;
  const telegram=telegramServices?{store:createTelegramStore(pool,cipher,telegramServices),config:telegramConfig,gateway:createTelegramGateway(telegramConfig)}:undefined;
  const aiUsage = createAiUsageStore(pool);
  const auth = createAuth(config, pool);
  const agentEnabled = process.env.P2_AGENT_ENABLED === "true";
  if (agentEnabled && !(await pool.query("SELECT 1 FROM app_migrations WHERE id='016-product-agent'")).rowCount) throw new Error("agent_migration_required");
  const chat = createChatStore(pool, cipher, onlineEnabled, agentEnabled);
  const memory = createMemoryStore(pool, cipher, onlineEnabled && Boolean((await pool.query("SELECT 1 FROM app_migrations WHERE id='011-memory-online'")).rowCount));
  const tasks = onlineEnabled && (await pool.query("SELECT 1 FROM app_migrations WHERE id='012-task-ledger'")).rowCount ? createTaskStore(pool, cipher, taskScheduling) : undefined;
  const growthEnabled=agentEnabled && Boolean((await pool.query("SELECT 1 FROM app_migrations WHERE id='017-growth-attention'")).rowCount);
  const growth=growthEnabled ? createGrowthStore(pool,cipher,taskScheduling) : undefined;
  const productServices = agentEnabled && tasks ? createProductAgentServices(pool, cipher, aiConfig, taskScheduling, process.env.AGENT_DIAGNOSTICS === "true",growth) : undefined;
  const productAgentStore = productServices?.store, productAgent = productServices?.agent;
  const handler = createRequestHandler({
    config, auth, workspaces: createWorkspaceStore(pool),
    webPush: pushServices ? createWebPushStore(pool, cipher, pushServices, true) : undefined,
    records: createRecordStore(pool, cipher, onlineEnabled),
    families: createFamilyStore(pool, cipher, onlineEnabled),
    care: createCareStore(pool, cipher, onlineEnabled),
    online: onlineEnabled ? createOnlineStore(pool, cipher, taskScheduling, pushServices, telegramServices) : undefined,
    telegram,
    tasks, chat, memory, productAgent, productAgentStore, growth,
    chatPrompt, aiMaxInputCharacters: aiConfig.maxInputCharacters, aiUsage,
    modelGateway: createModelGateway({ config: aiConfig, usage: aiUsage, provider }),
    checkDatabase: async () => { await pool.query("SELECT 1"); },
  });
  const server = createServer((request, response) => {
    request.on("error", () => {});
    void handler(request, response).catch(() => { response.destroy(); });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let poolClosing: Promise<void> | undefined;
  const closePool = () => { poolClosing ??= (async () => { try { await queue?.stop(); } finally { await pool.end(); } })().catch(() => { process.exitCode = 1; }); return poolClosing; };
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
  await startupCleanup?.().catch(() => {});
  process.exitCode = 1;
}
