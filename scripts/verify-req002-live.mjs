import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseReq002LiveCliArgs, resolveReq002CandidateSha, REQ002_LIVE_UNSUPPORTED } from "../server/req002-acceptance-harness.ts";

const cli = parseReq002LiveCliArgs(process.argv.slice(2));
const candidateSha = resolveReq002CandidateSha(import.meta.url);

// Refuse before reading any credential/config path, importing SDKs, constructing clients or seeding documents.
// Live non-execution has its own report; it must not masquerade as a completed offline suite or a live receipt.
let receipt;
if (cli.mode === "live") {
  receipt = {
    candidateSha, mode: "live", budgetCaps: cli.budgetCaps,
    verdict: { status: "unsupported", reason: REQ002_LIVE_UNSUPPORTED },
    totals: { runsStarted: 0, modelCalls: 0, queryEmbeddings: 0 }, scenarios: [],
  };
} else {
  const { readAiConfig } = await import("../server/ai-config.ts");
  const { executeReq002AcceptanceSuite } = await import("./lib/req002-acceptance-runner.ts");
  receipt = await executeReq002AcceptanceSuite({
    candidateSha, mode: "offline",
    config: { ...readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-req002-offline" }), agentMaxRetries: 0 },
    providerName: "scripted_offline", budgetCaps: cli.budgetCaps,
  });
}

const output = JSON.stringify(receipt, null, 2);
if (cli.writeReceiptPath) {
  const destination = resolve(cli.writeReceiptPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output + "\n", "utf8");
}

console.log(output);
if (receipt.verdict.status !== "passed") process.exitCode = 1;
