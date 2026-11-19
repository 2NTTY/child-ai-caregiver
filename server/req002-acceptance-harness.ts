import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { z } from "zod";
import { AgentStopped } from "./agent-budget.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import type { readLocalAgentModel } from "./local-agent-model.ts";
import { readAgentFeedback } from "../src/client/agent-feedback-reader.ts";
import type { EmbeddingInput, EmbeddingProvider, EmbeddingReply } from "./embedding-gateway.ts";
import { matchOfficialHelpForText, officialHelpIdSchema, reconcileAgentProgress, type ReconciledAgentProgress, type OfficialHelpId } from "../src/shared/agent-feedback.ts";
import type { KnowledgeEvidence } from "../src/shared/knowledge.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

export const REQ002_DEFAULT_BUDGET_CAPS = Object.freeze({
  maxRuns: 3,
  maxModelCalls: 10,
  maxQueryEmbeddings: 4,
});

export interface Req002BudgetCaps {
  readonly maxRuns: number;
  readonly maxModelCalls: number;
  readonly maxQueryEmbeddings: number;
}

export const REQ002_SYNTHETIC_CANARY = Object.freeze({
  name: "陳大文",
  address: "沙田第一城 1 座",
  birthDateText: "2026年5月18日",
  isoBirthDate: "2026-05-18",
  tokens: ["陳大文", "沙田第一城", "1 座", "2026年5月18日", "2026-05-18"] as readonly string[],
});

export const REQ002_CORE_SCENARIOS = Object.freeze({
  greetingShortPath: "你好，多謝",
  halfYearSolidFoodWithCanary:
    "我叫陳大文，住沙田第一城 1 座，BB 2026年5月18日出世差唔多半歲，點知佢準備好開始食固體食物？",
  twoMonthRestriction: "BB 啱啱滿兩個月，想開始餵米糊固體食物得唔得？",
  uncoveredFeverVomiting: "BB 發高燒到 39.5 度兼嘔咗兩次，點算好？",
});

export class BudgetCapExceededError extends AgentStopped {
  readonly kind: "runs" | "model_calls" | "query_embeddings";
  readonly limit: number;
  readonly attempted: number;

  constructor(kind: "runs" | "model_calls" | "query_embeddings", limit: number, attempted: number) {
    super(kind === "query_embeddings" ? "quota_exceeded" : "model_limit");
    this.name = "BudgetCapExceededError";
    this.kind = kind;
    this.limit = limit;
    this.attempted = attempted;
  }
}

export interface Req002CliOptions {
  readonly mode: "live" | "offline";
  readonly writeReceiptPath: string | null;
  readonly budgetCaps: Req002BudgetCaps;
}

function parsePositiveIntFlag(raw: string, flagName: string, maximum: number): number {
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/u.test(raw) || !Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`Invalid integer for ${flagName}; expected 1..${maximum}`);
  }
  return value;
}

/**
 * Parse CLI arguments for `scripts/verify-req002-live.mjs`.
 * Refuses to execute without an explicit `--live` or `--offline` mode flag so
 * billable model or embedding providers are never touched accidentally.
 */
export function parseReq002LiveCliArgs(argv: readonly string[]): Req002CliOptions {
  const hasLive = argv.includes("--live");
  const hasOffline = argv.includes("--offline");
  if (hasLive === hasOffline) {
    throw new Error(
      "Choose exactly one execution mode: pass --offline for scripted verification; --live currently only reports an unsupported baseline.",
    );
  }
  let writeReceiptPath: string | null = null;
  let maxRuns: number = REQ002_DEFAULT_BUDGET_CAPS.maxRuns;
  let maxModelCalls: number = REQ002_DEFAULT_BUDGET_CAPS.maxModelCalls;
  let maxQueryEmbeddings: number = REQ002_DEFAULT_BUDGET_CAPS.maxQueryEmbeddings;

  for (const arg of argv) {
    if (arg === "--live" || arg === "--offline") continue;
    if (arg === "--write-receipt") {
      writeReceiptPath = "artifacts/verification/REQ002_LIVE_VERIFICATION_20261119.json";
      continue;
    }
    if (arg.startsWith("--write-receipt=")) {
      const value = arg.slice("--write-receipt=".length).trim();
      if (!value) throw new Error("--write-receipt requires a non-empty relative path");
      writeReceiptPath = value;
      continue;
    }
    if (arg.startsWith("--max-runs=")) {
      maxRuns = parsePositiveIntFlag(arg.slice("--max-runs=".length), "--max-runs", REQ002_DEFAULT_BUDGET_CAPS.maxRuns);
      continue;
    }
    if (arg.startsWith("--max-model-calls=")) {
      maxModelCalls = parsePositiveIntFlag(arg.slice("--max-model-calls=".length), "--max-model-calls", REQ002_DEFAULT_BUDGET_CAPS.maxModelCalls);
      continue;
    }
    if (arg.startsWith("--max-embeddings=")) {
      maxQueryEmbeddings = parsePositiveIntFlag(arg.slice("--max-embeddings=".length), "--max-embeddings", REQ002_DEFAULT_BUDGET_CAPS.maxQueryEmbeddings);
      continue;
    }
    throw new Error(`Unknown CLI option: ${arg}`);
  }

  return {
    mode: hasLive ? "live" : "offline",
    writeReceiptPath,
    budgetCaps: { maxRuns, maxModelCalls, maxQueryEmbeddings },
  };
}

/** Select before constructing SDKs: a callable embedding adapter can be an unconfigured placeholder. */
export function selectReq002LocalAdapters<Config, Pair>(
  local: Pick<ReturnType<typeof readLocalAgentModel>, "provider" | "embeddingConfigured"> & { providers?: (config: Config) => Pair },
  config: Config, fromAdc: (config: Config) => Pair,
): Pair {
  if (local.embeddingConfigured !== true) throw new Error("Required query embedding is not configured; no provider dispatched.");
  if (local.provider === "vertex-adc") return fromAdc(config);
  if (!local.providers) throw new Error("Selected key mode has no provider factory; ADC fallback is forbidden.");
  return local.providers(config);
}

/** No caller cwd, inherited Git overrides, or dirty tracked state may supply the receipt identity. */
export function resolveReq002CandidateSha(entrypoint: string | URL): string {
  const root = realpathSync(fileURLToPath(new URL("../", entrypoint)));
  const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GIT_CONFIG_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (realpathSync(git("rev-parse", "--show-toplevel")) !== root) throw new Error("Entrypoint does not belong to the expected checkout root.");
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("Acceptance requires a clean tracked checkout.");
  const sha = git("rev-parse", "--verify", "HEAD");
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error("Cannot identify the candidate");
  return sha;
}

/** Recursively scans any value for synthetic PII canary tokens. */
export function findCanaryLeaks(value: unknown, tokens: readonly string[] = REQ002_SYNTHETIC_CANARY.tokens): string[] {
  const hits = new Set<string>();
  const seen = new WeakSet<object>();

  const scan = (current: unknown) => {
    if (typeof current === "string") {
      for (const token of tokens) {
        if (current.includes(token)) hits.add(token);
      }
      return;
    }
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) scan(item);
      return;
    }
    for (const [key, nested] of Object.entries(current)) {
      scan(key);
      scan(nested);
    }
  };

  scan(value);
  return [...hits];
}

export interface ProviderBoundaryCallLog {
  readonly callIndex: number;
  readonly roleKind: "generator_or_tool" | "review_or_repair";
  readonly promptTokens: number;
  readonly candidateTokens: number;
  readonly totalTokens: number;
}

export interface ProviderBoundarySnapshot {
  readonly capBlocked: boolean;
  readonly runsStarted: number;
  readonly modelCalls: number;
  readonly reviewOrRepairCalls: number;
  readonly queryEmbeddings: number;
  readonly promptTokens: number;
  readonly candidateTokens: number;
  readonly totalTokens: number;
  readonly embeddingPayloads: readonly string[];
  readonly searchQueryArgs: readonly string[];
  readonly callLogs: readonly ProviderBoundaryCallLog[];
}

function classifyProviderRequest(request: LlmRequest): "generator_or_tool" | "review_or_repair" {
  const hasTools = Boolean(
    request.config?.tools?.some(tool => "functionDeclarations" in tool && (tool.functionDeclarations?.length ?? 0) > 0),
  );
  return hasTools ? "generator_or_tool" : "review_or_repair";
}

function extractSearchQueryArgs(request: LlmRequest): string[] {
  const queries: string[] = [];
  for (const content of request.contents) {
    for (const part of content.parts ?? []) {
      const fnCall = part.functionCall;
      if (fnCall?.name === "search_knowledge" && fnCall.args && typeof fnCall.args.query === "string") {
        queries.push(fnCall.args.query);
      }
    }
  }
  return queries;
}

/**
 * Wraps the true provider boundary (`AgentModelProvider.generate` and
 * `EmbeddingProvider.embed`) so every generation, delivery review, repair,
 * query embedding, and gateway retry is counted BEFORE dispatch. Supported SDKs
 * have internal transport retries disabled; these are adapter attempts, not billing data.
 */
export function createProviderBoundaryGuard(input: {
  caps?: Partial<Req002BudgetCaps>;
  provider: AgentModelProvider;
  embedding?: EmbeddingProvider;
  onLog?: (line: string) => void;
}) {
  const caps = Object.freeze({ ...REQ002_DEFAULT_BUDGET_CAPS, ...input.caps });
  for (const key of Object.keys(REQ002_DEFAULT_BUDGET_CAPS) as (keyof Req002BudgetCaps)[]) {
    if (!Number.isSafeInteger(caps[key]) || caps[key] < 1 || caps[key] > REQ002_DEFAULT_BUDGET_CAPS[key]) {
      throw new Error(`Invalid integer for ${key}; expected 1..${REQ002_DEFAULT_BUDGET_CAPS[key]}`);
    }
  }
  let capBlocked = false;
  let runsStarted = 0;
  let modelCalls = 0;
  let reviewOrRepairCalls = 0;
  let queryEmbeddings = 0;
  let promptTokens = 0;
  let candidateTokens = 0;
  let totalTokens = 0;
  const embeddingPayloads: string[] = [];
  const searchQueryArgs: string[] = [];
  const callLogs: ProviderBoundaryCallLog[] = [];

  // A gateway may swallow a stop and attempt a repair or degraded fallback. No later dispatch is allowed.
  let halted: AgentStopped | null = null;
  function checkActive() { if (halted) throw halted; }
  function halt(error: AgentStopped): never { halted ??= error; throw halted; }

  function beginRun(label: string) {
    checkActive();
    if (runsStarted + 1 > caps.maxRuns) {
      capBlocked = true;
      input.onLog?.(`cap_blocked kind=runs label=${label} limit=${caps.maxRuns}`);
      halt(new BudgetCapExceededError("runs", caps.maxRuns, runsStarted + 1));
    }
    runsStarted += 1;
  }

  const provider: AgentModelProvider = {
    ...(input.provider.preflight ? { preflight: input.provider.preflight.bind(input.provider) } : {}),
    ...(input.provider.countInput ? { countInput: input.provider.countInput.bind(input.provider) } : {}),
    async generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      checkActive();
      if (modelCalls + 1 > caps.maxModelCalls) {
        capBlocked = true;
        input.onLog?.(`cap_blocked kind=model_calls limit=${caps.maxModelCalls}`);
        halt(new BudgetCapExceededError("model_calls", caps.maxModelCalls, modelCalls + 1));
      }
      const queries = extractSearchQueryArgs(request);
      searchQueryArgs.push(...queries);
      if (findCanaryLeaks(queries).length) halt(new AgentStopped("invalid_tool"));
      modelCalls += 1;
      const callIndex = modelCalls;
      const roleKind = classifyProviderRequest(request);
      if (roleKind === "review_or_repair") reviewOrRepairCalls += 1;
      const response = await input.provider.generate(request, signal);
      for (const part of response.content?.parts ?? []) {
        if (part.functionCall?.name === "search_knowledge" && typeof part.functionCall.args?.query === "string") {
          searchQueryArgs.push(part.functionCall.args.query);
        }
      }
      const pTok = response.usageMetadata?.promptTokenCount ?? 0;
      const cTok = response.usageMetadata?.candidatesTokenCount ?? 0;
      const tTok = response.usageMetadata?.totalTokenCount ?? (pTok + cTok);
      promptTokens += pTok;
      candidateTokens += cTok;
      totalTokens += tTok;
      callLogs.push({ callIndex, roleKind, promptTokens: pTok, candidateTokens: cTok, totalTokens: tTok });
      if (findCanaryLeaks(searchQueryArgs).length) halt(new AgentStopped("invalid_tool"));
      return response;
    },
  };

  const embedding: EmbeddingProvider | undefined = input.embedding
    ? {
        async embed(request: EmbeddingInput, signal: AbortSignal): Promise<EmbeddingReply> {
          checkActive();
          // Documents are seeded locally. Only query embeddings may use this adapter.
          if (request.task !== "RETRIEVAL_QUERY") halt(new AgentStopped("invalid_tool"));
          embeddingPayloads.push(request.text);
          if (findCanaryLeaks(request.text).length) halt(new AgentStopped("invalid_tool"));
          if (queryEmbeddings + 1 > caps.maxQueryEmbeddings) {
            capBlocked = true;
            input.onLog?.(`cap_blocked kind=query_embeddings limit=${caps.maxQueryEmbeddings}`);
            halt(new BudgetCapExceededError("query_embeddings", caps.maxQueryEmbeddings, queryEmbeddings + 1));
          }
          queryEmbeddings += 1;
          return input.embedding!.embed(request, signal);
        },
      }
    : undefined;

  function snapshot(): ProviderBoundarySnapshot {
    return {
      capBlocked, runsStarted,
      modelCalls,
      reviewOrRepairCalls,
      queryEmbeddings,
      promptTokens,
      candidateTokens,
      totalTokens,
      embeddingPayloads: [...embeddingPayloads],
      searchQueryArgs: [...searchQueryArgs],
      callLogs: [...callLogs],
    };
  }

  return { caps, beginRun, provider, embedding, snapshot };
}

export type TerminalCategory = "completed" | "partial" | "failed" | "cancelled" | "unknown";

export interface CoreMilestones {
  readonly firstMeaningfulProgressMs: number | null;
  readonly firstUsableSourceMs: number | null;
  readonly firstApprovedAnswerMs: number | null;
  readonly terminalSettledMs: number | null;
}

export function classifyTerminalCategory(result: Pick<ProductAgentResult, "status" | "stopReason" | "citations" | "privateSourceCitations"> | null): TerminalCategory {
  if (!result || result.status === "running") return "unknown";
  if (result.status === "completed") return "completed";
  if (result.status === "unknown") return "unknown";
  if (result.stopReason === "cancelled") return "cancelled";
  if (result.stopReason === "tool_unknown") return "unknown";
  // Use only sources actually retained in the final product result, never an earlier search or draft.
  if (result.stopReason?.startsWith("delivery_review_")
    && (result.citations.length > 0 || (result.privateSourceCitations?.length ?? 0) > 0)) return "partial";
  return "failed";
}

/**
 * Tracks REQ-002 §7.1 timing milestones for one run without recording any message text or prompts.
 */
export function createRunMilestoneTracker(now: () => number = () => performance.now()) {
  const startedAt = now();
  let firstMeaningfulProgressMs: number | null = null;
  let firstUsableSourceMs: number | null = null;
  let firstApprovedAnswerMs: number | null = null;
  let terminalSettledMs: number | null = null;

  const elapsed = () => Math.max(0, Math.round(now() - startedAt));

  const cards = new Set<OfficialHelpId>();
  function noteProgress(event: ReconciledAgentProgress): void {
    for (const card of event.cards) cards.add(card);
    const t = elapsed();
    if (firstMeaningfulProgressMs === null && (event.phase !== "started" || event.cards.length || event.sources.length)) {
      firstMeaningfulProgressMs = t;
    }
    if (firstUsableSourceMs === null && (event.sources?.length ?? 0) > 0) {
      firstUsableSourceMs = t;
    }
  }

  function markApprovedAnswer(): void {
    if (firstApprovedAnswerMs === null) firstApprovedAnswerMs = elapsed();
  }

  function markTerminalSettled(): void {
    if (terminalSettledMs === null) terminalSettledMs = elapsed();
  }

  function snapshot(): CoreMilestones {
    return {
      firstMeaningfulProgressMs,
      firstUsableSourceMs,
      firstApprovedAnswerMs,
      terminalSettledMs,
    };
  }

  return { noteProgress, markApprovedAnswer, markTerminalSettled, snapshot, helpCards: () => [...cards] };
}

/** Observe qualified frames at the client boundary, not after buffering the response.
 * There is no earlier approved-answer frame in this protocol. Recoverability is checked separately by GET. */
export async function observeReq002Reply(response: Response, tracker: ReturnType<typeof createRunMilestoneTracker>,
  messageId: string, claimedRunId: () => string | null, approvedRunId: () => string | null): Promise<string | null> {
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "text/event-stream") {
    throw new Error("Expected a successful event stream");
  }
  let delivered: string | null = null;
  let previous: ReconciledAgentProgress | null = null;
  await readAgentFeedback(response, event => {
    // The product persists the message→run claim before publishing any progress.
    if (event.messageId !== messageId || event.runId !== claimedRunId()) return;
    const next = reconcileAgentProgress(previous, event);
    if (next !== previous) tracker.noteProgress(next);
    previous = next;
  }, result => {
    const message = (result.body as { message?: Partial<{ role: string; text: string; inReplyTo: string; agentRunId: string }> } | null)?.message;
    const runId = approvedRunId();
    if (result.status >= 200 && result.status < 300 && runId && runId === claimedRunId() && message?.role === "model"
      && message.agentRunId === runId && message.inReplyTo === messageId && typeof message.text === "string" && message.text.trim()) {
      delivered = message.text;
      tracker.markApprovedAnswer();
    }
  });
  return delivered;
}

// Pin expected wire output independently of the scripted provider. This is not a semantic judge for live output.
// Only the label leaves memory; never put the delivered text or the source text in the receipt.
export function checkReq002ScriptedAnswer(id: string, delivered: string | null,
  firstSource: { sourceId: string; key: string; text: string } | null): Req002AcceptanceReceipt["scenarios"][number]["scriptedAnswerEvidence"] {
  if (id === "case_b_two_month_restriction"
    && delivered === "根據衞生署官方指引，未足四個月大的寶寶不應吃奶以外的食物，因此兩個月大暫時不應開始餵食米糊或固體食物。 [1]"
    && firstSource?.sourceId === "fhs-solid-food" && firstSource.key === "starting-solids"
    && firstSource.text.includes("未滿四個月不應加入奶以外食物。")) return "two_month_restriction";
  if (id === "case_c_uncovered_fever_vomiting" && delivered === "暫未收錄此情況的官方資料。") return "missing_official_coverage";
  return "not_verified";
}

export const REQ002_LIVE_UNSUPPORTED = "live_baseline_unsupported: the checked-in seed uses synthetic cue vectors, not document vectors from the query provider/model; no live run was started.";

export const req002ReceiptScenarioSchema = z.strictObject({
  id: z.string().min(1).max(64),
  runId: z.string().min(1).max(128).nullable(),
  status: z.string().min(1).max(32),
  stopReason: z.string().max(80).nullable(),
  terminalCategory: z.enum(["completed", "partial", "failed", "cancelled", "unknown"]),
  retrievalMode: z.enum(["vector_keyword", "keyword_degraded", "not_used"]).nullable(),
  scriptedAnswerEvidence: z.enum(["two_month_restriction", "missing_official_coverage", "not_verified"]),
  cacheMode: z.enum(["not_measured", "not_applicable"]),
  counts: z.strictObject({
    modelCalls: z.number().int().min(0),
    toolCalls: z.number().int().min(0),
    queryEmbeddings: z.number().int().min(0),
  }),
  providerBoundaryCalls: z.number().int().min(0),
  reviewDecision: z.string().max(32).nullable(),
  citedChunkIds: z.array(z.string().min(1).max(128)),
  citedSourceIds: z.array(z.string().min(1).max(128)),
  originalVersionVerified: z.boolean(),
  getReplyReplaySameRunId: z.boolean(),
  deterministicHelpCards: z.array(officialHelpIdSchema),
  milestones: z.strictObject({
    firstMeaningfulProgressMs: z.number().min(0).nullable(),
    firstUsableSourceMs: z.number().min(0).nullable(),
    firstApprovedAnswerMs: z.number().min(0).nullable(),
    terminalSettledMs: z.number().min(0).nullable(),
  }),
});

export const req002AcceptanceReceiptSchema = z.strictObject({
  candidateSha: z.string().min(7).max(64),
  mode: z.literal("offline_scripted"),
  suite: z.enum(["core_abc", "offline_greeting_smoke"]),
  verdict: z.strictObject({ status: z.enum(["passed", "failed"]), failures: z.array(z.string()) }),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(120),
  executedAt: z.iso.datetime({ offset: true }),
  budgetCaps: z.strictObject({
    maxRuns: z.number().int().min(1).max(REQ002_DEFAULT_BUDGET_CAPS.maxRuns),
    maxModelCalls: z.number().int().min(1).max(REQ002_DEFAULT_BUDGET_CAPS.maxModelCalls),
    maxQueryEmbeddings: z.number().int().min(1).max(REQ002_DEFAULT_BUDGET_CAPS.maxQueryEmbeddings),
  }),
  totals: z.strictObject({
    capBlocked: z.boolean(),
    runsStarted: z.number().int().min(0),
    modelCalls: z.number().int().min(0),
    reviewOrRepairCalls: z.number().int().min(0),
    queryEmbeddings: z.number().int().min(0),
    promptTokens: z.number().int().min(0),
    candidateTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }),
  scenarios: z.array(req002ReceiptScenarioSchema).min(1),
  sseDisconnectRecovery: z.strictObject({
    transport: z.literal("in_memory_http_sse"),
    abortedMidStream: z.boolean(),
    preAbortPhases: z.array(z.string().min(1).max(32)),
    retainedSourcesBeforeAbort: z.number().int().min(0),
    duplicatePostCalls: z.number().int().min(0),
    recoveredRunId: z.string().min(1).max(128),
    lateOutOfOrderIgnored: z.boolean(),
    stoppedRetainsQualifiedCards: z.boolean(),
    revocationClearedCards: z.boolean(),
  }),
  baselineComparison: z.strictObject({
    measurement: z.literal("scripted_provider_and_local_map"),
    productCache: z.literal("not_measured"),
    sampleSize: z.number().int().min(1),
    sequentialBaselineModelCalls: z.number().int().min(1),
    boundedBatchModelCalls: z.number().int().min(1),
    modelCallReduction: z.number().int().min(0),
    sequentialToolCalls: z.number().int().min(1),
    boundedBatchToolCalls: z.number().int().min(1),
    coldEmbeddings: z.number().int().min(0),
    warmReusedEmbeddings: z.number().int().min(0),
    note: z.string().min(1).max(300),
  }),
  privacyCheck: z.strictObject({
    canaryFingerprint: z.string().regex(/^[a-f0-9]{16}$/u),
    outboundQueryLeakCount: z.number().int().min(0),
    embeddingPayloadLeakCount: z.number().int().min(0),
    diagnosticAndLogLeakCount: z.number().int().min(0),
    receiptLeakCount: z.number().int().min(0),
  }),
});

export type Req002AcceptanceReceipt = z.infer<typeof req002AcceptanceReceiptSchema>;

/** Validates a receipt and rejects any accidental PII canary leakage before persistence. */
export function buildSanitizedAcceptanceReceipt(
  raw: Omit<Req002AcceptanceReceipt, "privacyCheck" | "verdict"> & {
    outboundQueryLeakCount: number;
    embeddingPayloadLeakCount: number;
    diagnosticAndLogLeakCount: number;
  },
): Req002AcceptanceReceipt {
  const { outboundQueryLeakCount, embeddingPayloadLeakCount, diagnosticAndLogLeakCount, ...body } = raw;
  const preliminary: Req002AcceptanceReceipt = {
    ...body,
    verdict: { status: "failed", failures: [] },
    privacyCheck: {
      canaryFingerprint: createHash("sha256").update(REQ002_SYNTHETIC_CANARY.tokens.join("|")).digest("hex").slice(0, 16),
      outboundQueryLeakCount,
      embeddingPayloadLeakCount,
      diagnosticAndLogLeakCount,
      receiptLeakCount: 0,
    },
  };
  const receiptLeaks = findCanaryLeaks(preliminary);
  if (receiptLeaks.length > 0) {
    throw new Error("Sanitized receipt leaked synthetic canary tokens; receipt suppressed.");
  }
  const checked = req002AcceptanceReceiptSchema.parse(preliminary);
  checked.verdict = evaluateReq002Receipt(checked);
  return checked;
}

export function evaluateReq002Receipt(receipt: Omit<Req002AcceptanceReceipt, "verdict">): Req002AcceptanceReceipt["verdict"] {
  const failures: string[] = [];
  const { totals, budgetCaps, scenarios, sseDisconnectRecovery: recovery } = receipt;
  const greeting = "case_g_greeting_short_path", a = "case_a_half_year_solid_food", b = "case_b_two_month_restriction", c = "case_c_uncovered_fever_vomiting";
  const expected = receipt.suite === "offline_greeting_smoke" ? [greeting] : [a, b, c];
  if (receipt.mode !== "offline_scripted") failures.push("wrong_mode");
  if (scenarios.length !== expected.length || !expected.every((id, i) => scenarios[i]?.id === id)) failures.push("incomplete_scenarios");
  if (totals.capBlocked || totals.runsStarted !== scenarios.length || totals.runsStarted > budgetCaps.maxRuns
    || totals.modelCalls > budgetCaps.maxModelCalls || totals.queryEmbeddings > budgetCaps.maxQueryEmbeddings
    || scenarios.reduce((n, s) => n + s.providerBoundaryCalls, 0) !== totals.modelCalls) failures.push("budget_or_accounting");
  const privacy = receipt.privacyCheck;
  if (privacy.outboundQueryLeakCount || privacy.embeddingPayloadLeakCount || privacy.diagnosticAndLogLeakCount || privacy.receiptLeakCount) failures.push("privacy");
  for (const s of scenarios) {
    if (s.status !== "completed" || s.terminalCategory !== "completed" || s.stopReason !== null || !s.runId
      || !s.getReplyReplaySameRunId || s.providerBoundaryCalls < 1 || s.milestones.firstApprovedAnswerMs === null
      || s.milestones.terminalSettledMs === null || s.milestones.firstMeaningfulProgressMs === null) failures.push("scenario_not_delivered");
    if ((s.id === a || s.id === b || s.id === c) && s.retrievalMode !== "vector_keyword")
      failures.push("vector_retrieval_not_observed");
    if (s.id === b && s.scriptedAnswerEvidence !== "two_month_restriction") failures.push("age_restriction_not_verified");
    if (s.id === c && s.scriptedAnswerEvidence !== "missing_official_coverage") failures.push("coverage_limitation_not_verified");
    if ((s.id === a || s.id === b) && (s.reviewDecision !== "pass" || !s.originalVersionVerified || !s.citedChunkIds.length
      || !s.citedSourceIds.includes("fhs-solid-food") || s.milestones.firstUsableSourceMs === null)) failures.push("unverified_official_answer");
    if (s.id === c && (s.citedChunkIds.length || s.citedSourceIds.length || !s.deterministicHelpCards.includes("medical-consult-hk-v1")
      || s.deterministicHelpCards.includes("emergency-hk-v1"))) failures.push("uncovered_case_boundary");
    if (s.id === greeting && (s.providerBoundaryCalls !== 1 || s.counts.queryEmbeddings || s.reviewDecision !== null)) failures.push("greeting_not_short");
  }
  const paired = receipt.baselineComparison;
  if (paired.sequentialBaselineModelCalls <= paired.boundedBatchModelCalls
    || paired.modelCallReduction !== paired.sequentialBaselineModelCalls - paired.boundedBatchModelCalls
    || paired.boundedBatchToolCalls !== paired.sequentialToolCalls || paired.coldEmbeddings !== 3
    || paired.warmReusedEmbeddings !== paired.coldEmbeddings) failures.push("synthetic_probe");
  if (!recovery.abortedMidStream || !recovery.retainedSourcesBeforeAbort || recovery.duplicatePostCalls !== 0
    || !recovery.lateOutOfOrderIgnored || !recovery.stoppedRetainsQualifiedCards || !recovery.revocationClearedCards) failures.push("recovery");
  return { status: failures.length ? "failed" : "passed", failures: [...new Set(failures)] };
}

/**
 * Verifies deterministically that uncovered topic text does not invent a 999 rule
 * solely from numeric fever degrees, while keeping existing medical/urgent cues exact.
 */
export function inspectCaseCHelpMatch(text: string): {
  cards: OfficialHelpId[];
  respectsExistingEmergencyBoundaries: boolean;
} {
  const cards = matchOfficialHelpForText(text);
  const hasExplicitUrgentCue = /抽搐|痙攣|呼吸困難|透唔到氣|高燒不退|無反應|昏迷|999/u.test(text);
  const respectsExistingEmergencyBoundaries = hasExplicitUrgentCue ? cards.includes("emergency-hk-v1") : !cards.includes("emergency-hk-v1");
  return { cards, respectsExistingEmergencyBoundaries };
}

/** Verifies cited chunks match the persisted source versionId and contentHash in store. */
export async function verifyCitedVersionsInStore(
  citations: readonly KnowledgeEvidence[],
  readChunk: (chunk: KnowledgeEvidence) => Promise<{ versionId: string; contentHash: string; sourceId: string; text: string } | null>,
): Promise<boolean> {
  if (!citations.length) return false;
  for (const citation of citations) {
    const persisted = await readChunk(citation);
    if (!persisted) return false;
    if (
      persisted.versionId !== citation.versionId
      || persisted.contentHash !== citation.contentHash
      || persisted.sourceId !== citation.sourceId
    ) {
      return false;
    }
  }
  return true;
}
