import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readAiConfig } from "../server/ai-config.ts";
import { createVertexAgentProvider } from "../server/agent-model-gateway.ts";
import { readLocalAgentModel } from "../server/local-agent-model.ts";
import { createVertexEmbeddingProvider } from "../server/vertex-embedding.ts";
import { parseReq002LiveCliArgs, resolveReq002CandidateSha, selectReq002LocalAdapters } from "../server/req002-acceptance-harness.ts";
import { executeReq002AcceptanceSuite } from "./lib/req002-acceptance-runner.ts";

// readAiConfig intentionally does not read an administrative agent-retry env var.
// Bind the effective value on the config actually passed to the runtime and adapters.
function liveConfig(base) {
  return { ...base, model: base.localModelOverride ?? base.model, agentMaxRetries: 1, localContextTokenizer: false };
}

function buildSelectedAdapters(local) {
  const config = liveConfig(local.modelConfig);
  const built = selectReq002LocalAdapters(local, config, selected => ({
    agent: createVertexAgentProvider(selected), embedding: createVertexEmbeddingProvider(selected),
  }));
  return { config, providerName: local.provider, rawProvider: built.agent, rawEmbedding: built.embedding };
}

async function buildLiveAdapters() {
  if (process.env.LOCAL_AGENT_CONFIG) {
    const configured = JSON.parse(await readFile(resolve(process.env.LOCAL_AGENT_CONFIG), "utf8"));
    const providerKind = configured.provider ?? "gemini";
    if (configured.adcPath && (providerKind !== "vertex-adc" || !process.env.GOOGLE_APPLICATION_CREDENTIALS
      || resolve(configured.adcPath) !== resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS))) {
      throw new Error("ADC path must match the explicitly configured SDK environment.");
    }
    const localEnv = {
      ...process.env,
      NODE_ENV: "development",
      YUYF_LOCAL_DEVELOPMENT: "1",
      AI_ENABLED: "true",
      LOCAL_MODEL_PROVIDER: providerKind,
      LOCAL_MODEL_PROJECT: configured.project ?? process.env.P4_VERTEX_PROJECT ?? process.env.GCP_PROJECT_ID,
      VERTEX_LOCATION: configured.location ?? process.env.VERTEX_LOCATION ?? "global",
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID ?? "synthetic-req002-key-mode",
      GEMINI_MODEL: configured.model ?? process.env.LOCAL_MODEL ?? process.env.GEMINI_MODEL,
      LOCAL_MODEL_API_KEY: configured.apiKey,
      LOCAL_MODEL_BASE_URL: configured.baseUrl,
      LOCAL_MODEL_EMBEDDING_API_KEY: configured.embeddingApiKey,
      LOCAL_MODEL_EMBEDDING_PROVIDER: configured.embeddingProvider,
      LOCAL_MODEL_EMBEDDING_PROJECT: configured.embeddingProject,
      LOCAL_MODEL_EMBEDDING_LOCATION: configured.embeddingLocation,
    };
    return buildSelectedAdapters(readLocalAgentModel(localEnv, { documentEmbeddings: false }));
  }

  const projectId = process.env.P4_VERTEX_PROJECT ?? process.env.GCP_PROJECT_ID;
  if (projectId) {
    const config = liveConfig(readAiConfig({
      AI_ENABLED: "true",
      GCP_PROJECT_ID: projectId,
      VERTEX_LOCATION: process.env.VERTEX_LOCATION ?? "global",
    }));
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
      LOCAL_MODEL_PROVIDER: "gemini",
      LOCAL_MODEL_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.LOCAL_MODEL ?? "gemini-3.1-flash-lite",
      GCP_PROJECT_ID: "synthetic-req002-key-mode",
    });
    return buildSelectedAdapters(local);
  }

  throw new Error(
    "Missing live credentials: configure LOCAL_AGENT_CONFIG, P4_VERTEX_PROJECT, or GEMINI_API_KEY alongside --live.",
  );
}

const cli = parseReq002LiveCliArgs(process.argv.slice(2));
const candidateSha = resolveReq002CandidateSha(import.meta.url);

const suiteConfig = cli.mode === "live"
  ? await buildLiveAdapters()
  : {
      config: { ...readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-req002-offline" }), agentMaxRetries: 0 },
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
if (receipt.verdict.status !== "passed") process.exitCode = 1;
