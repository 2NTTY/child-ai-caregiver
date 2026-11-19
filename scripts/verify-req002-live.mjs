import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readAiConfig } from "../server/ai-config.ts";
import { createVertexAgentProvider } from "../server/agent-model-gateway.ts";
import { readLocalAgentModel } from "../server/local-agent-model.ts";
import { createVertexEmbeddingProvider } from "../server/vertex-embedding.ts";
import { parseReq002LiveCliArgs } from "../server/req002-acceptance-harness.ts";
import { executeReq002AcceptanceSuite } from "./lib/req002-acceptance-runner.ts";

function resolveCandidateSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "0000000000000000000000000000000000000000";
  }
}

async function buildLiveAdapters() {
  if (process.env.LOCAL_AGENT_CONFIG) {
    const configured = JSON.parse(await readFile(resolve(process.env.LOCAL_AGENT_CONFIG), "utf8"));
    const providerKind = configured.provider ?? "gemini";
    const localEnv = {
      ...process.env,
      NODE_ENV: "development",
      YUYF_LOCAL_DEVELOPMENT: "1",
      AI_ENABLED: "true",
      AI_AGENT_MAX_RETRIES: "1",
      LOCAL_MODEL_PROVIDER: providerKind,
      LOCAL_MODEL_PROJECT: configured.project ?? process.env.P4_VERTEX_PROJECT ?? process.env.GCP_PROJECT_ID,
      LOCAL_MODEL_LOCATION: configured.location ?? process.env.VERTEX_LOCATION ?? "global",
      LOCAL_MODEL: configured.model ?? process.env.LOCAL_MODEL,
      LOCAL_MODEL_API_KEY: configured.apiKey,
      LOCAL_MODEL_BASE_URL: configured.baseUrl,
      LOCAL_MODEL_EMBEDDING_API_KEY: configured.embeddingApiKey,
      LOCAL_MODEL_EMBEDDING_PROVIDER: configured.embeddingProvider,
      LOCAL_MODEL_EMBEDDING_PROJECT: configured.embeddingProject,
      LOCAL_MODEL_EMBEDDING_LOCATION: configured.embeddingLocation,
      ...(configured.adcPath ? { GOOGLE_APPLICATION_CREDENTIALS: resolve(configured.adcPath) } : {}),
    };
    const local = readLocalAgentModel(localEnv, { documentEmbeddings: false });
    if (local.providers) {
      const built = local.providers(local.modelConfig);
      return {
        config: local.modelConfig,
        providerName: local.provider,
        rawProvider: built.agent,
        rawEmbedding: built.embedding,
      };
    }
    return {
      config: local.modelConfig,
      providerName: local.provider,
      rawProvider: createVertexAgentProvider(local.modelConfig),
      rawEmbedding: createVertexEmbeddingProvider(local.modelConfig),
    };
  }

  const projectId = process.env.P4_VERTEX_PROJECT ?? process.env.GCP_PROJECT_ID;
  if (projectId) {
    const config = readAiConfig({
      AI_ENABLED: "true",
      GCP_PROJECT_ID: projectId,
      VERTEX_LOCATION: process.env.VERTEX_LOCATION ?? "global",
      AI_AGENT_MAX_RETRIES: "1",
    });
    return {
      config,
      providerName: "vertex-adc",
      rawProvider: createVertexAgentProvider(config),
      rawEmbedding: createVertexEmbeddingProvider(config),
    };
  }

  if (process.env.GEMINI_API_KEY) {
    const local = readLocalAgentModel({
      NODE_ENV: "development",
      YUYF_LOCAL_DEVELOPMENT: "1",
      AI_ENABLED: "true",
      AI_AGENT_MAX_RETRIES: "1",
      LOCAL_MODEL_PROVIDER: "gemini",
      LOCAL_MODEL_API_KEY: process.env.GEMINI_API_KEY,
      LOCAL_MODEL: process.env.LOCAL_MODEL ?? "gemini-3.1-flash-lite",
    });
    if (!local.providers) {
      throw new Error("Gemini local provider configuration is missing providers builder.");
    }
    const built = local.providers(local.modelConfig);
    return {
      config: local.modelConfig,
      providerName: "gemini",
      rawProvider: built.agent,
      rawEmbedding: built.embedding,
    };
  }

  throw new Error(
    "Missing live credentials: configure LOCAL_AGENT_CONFIG, P4_VERTEX_PROJECT, or GEMINI_API_KEY alongside --live.",
  );
}

const cli = parseReq002LiveCliArgs(process.argv.slice(2));
const candidateSha = resolveCandidateSha();

const suiteConfig = cli.mode === "live"
  ? await buildLiveAdapters()
  : {
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-req002-offline", AI_AGENT_MAX_RETRIES: "0" }),
      providerName: "scripted_offline",
      rawProvider: undefined,
      rawEmbedding: undefined,
    };

const receipt = await executeReq002AcceptanceSuite({
  candidateSha,
  mode: cli.mode,
  config: suiteConfig.config,
  providerName: suiteConfig.providerName,
  rawProvider: suiteConfig.rawProvider,
  rawEmbedding: suiteConfig.rawEmbedding,
  budgetCaps: cli.budgetCaps,
});

const output = JSON.stringify(receipt, null, 2);
if (cli.writeReceiptPath) {
  const destination = resolve(cli.writeReceiptPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output + "\n", "utf8");
}

console.log(output);
