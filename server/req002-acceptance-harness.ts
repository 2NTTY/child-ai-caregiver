import { createHash } from "node:crypto";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { z } from "zod";
import { AgentStopped } from "./agent-budget.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import type { AgentDiagnostic } from "./agent-observer.ts";
import type { EmbeddingInput, EmbeddingProvider, EmbeddingReply } from "./embedding-gateway.ts";
import { matchOfficialHelpForText, officialHelpIdSchema, type AgentProgress, type OfficialHelpId } from "../src/shared/agent-feedback.ts";
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

function parsePositiveIntFlag(raw: string, flagName: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error(`Invalid integer for ${flagName}: ${raw}`);
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
      "Choose exactly one execution mode: pass --live with explicit credentials for a real bounded check, or --offline for the synthetic offline verification.",
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
      maxRuns = parsePositiveIntFlag(arg.slice("--max-runs=".length), "--max-runs");
      continue;
    }
    if (arg.startsWith("--max-model-calls=")) {
      maxModelCalls = parsePositiveIntFlag(arg.slice("--max-model-calls=".length), "--max-model-calls");
      continue;
    }
    if (arg.startsWith("--max-embeddings=")) {
      maxQueryEmbeddings = parsePositiveIntFlag(arg.slice("--max-embeddings=".length), "--max-embeddings");
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
 * query embedding, and SDK retry is counted against hard ceilings BEFORE dispatch.
 */
export function createProviderBoundaryGuard(input: {
  caps?: Partial<Req002BudgetCaps>;
  provider: AgentModelProvider;
  embedding?: EmbeddingProvider;
  onLog?: (line: string) => void;
}) {
  const caps: Req002BudgetCaps = { ...REQ002_DEFAULT_BUDGET_CAPS, ...input.caps };
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

  function beginRun(label: string) {
    if (runsStarted + 1 > caps.maxRuns) {
      input.onLog?.(`cap_blocked kind=runs label=${label} limit=${caps.maxRuns}`);
      throw new BudgetCapExceededError("runs", caps.maxRuns, runsStarted + 1);
    }
    runsStarted += 1;
  }

  const provider: AgentModelProvider = {
    ...(input.provider.preflight ? { preflight: input.provider.preflight.bind(input.provider) } : {}),
    ...(input.provider.countInput ? { countInput: input.provider.countInput.bind(input.provider) } : {}),
    async generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      if (modelCalls + 1 > caps.maxModelCalls) {
        input.onLog?.(`cap_blocked kind=model_calls limit=${caps.maxModelCalls}`);
        throw new BudgetCapExceededError("model_calls", caps.maxModelCalls, modelCalls + 1);
      }
      modelCalls += 1;
      const callIndex = modelCalls;
      const roleKind = classifyProviderRequest(request);
      if (roleKind === "review_or_repair") reviewOrRepairCalls += 1;
      const response = await input.provider.generate(request, signal);
      for (const query of extractSearchQueryArgs(request)) searchQueryArgs.push(query);
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
      return response;
    },
  };

  const embedding: EmbeddingProvider | undefined = input.embedding
    ? {
        async embed(request: EmbeddingInput, signal: AbortSignal): Promise<EmbeddingReply> {
          if (request.task === "RETRIEVAL_QUERY") {
            if (queryEmbeddings + 1 > caps.maxQueryEmbeddings) {
              input.onLog?.(`cap_blocked kind=query_embeddings limit=${caps.maxQueryEmbeddings}`);
              throw new BudgetCapExceededError("query_embeddings", caps.maxQueryEmbeddings, queryEmbeddings + 1);
            }
            queryEmbeddings += 1;
            embeddingPayloads.push(request.text);
          }
          return input.embedding!.embed(request, signal);
        },
      }
    : undefined;

  function snapshot(): ProviderBoundarySnapshot {
    return {
      runsStarted,
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

export function classifyTerminalCategory(result: Pick<ProductAgentResult, "status" | "stopReason" | "citations"> | null): TerminalCategory {
  if (!result) return "failed";
  if (result.status === "completed") return "completed";
  if (result.status === "unknown") return "unknown";
  if (result.stopReason === "cancelled") return "cancelled";
  if (result.citations.length > 0) return "partial";
  return "failed";
}

/**
 * Tracks REQ-002 §7.1 timing milestones for one run without recording any message text or prompts.
 */
export function createRunMilestoneTracker(now: () => number = () => Date.now()) {
  const startedAt = now();
  let firstMeaningfulProgressMs: number | null = null;
  let firstUsableSourceMs: number | null = null;
  let firstApprovedAnswerMs: number | null = null;
  let terminalSettledMs: number | null = null;

  const elapsed = () => Math.max(0, Math.round(now() - startedAt));

  function noteDiagnostic(event: AgentDiagnostic): void {
    const t = Math.max(0, Math.round(event.elapsedMs));
    if (firstMeaningfulProgressMs === null && (event.phase === "model_start" || event.phase === "tool_start")) {
      firstMeaningfulProgressMs = t;
    }
  }

  function noteProgress(event: AgentProgress): void {
    const t = elapsed();
    if (firstMeaningfulProgressMs === null && event.phase !== "started") {
      firstMeaningfulProgressMs = t;
    }
    if (firstUsableSourceMs === null && (event.sources?.length ?? 0) > 0) {
      firstUsableSourceMs = t;
    }
  }

  function markApprovedAnswer(): void {
    if (firstApprovedAnswerMs === null) firstApprovedAnswerMs = elapsed();
  }

  function markTerminalSettled(approved: boolean): void {
    const t = elapsed();
    if (approved && firstApprovedAnswerMs === null) firstApprovedAnswerMs = t;
    if (terminalSettledMs === null) terminalSettledMs = t;
  }

  function snapshot(): CoreMilestones {
    return {
      firstMeaningfulProgressMs,
      firstUsableSourceMs,
      firstApprovedAnswerMs,
      terminalSettledMs,
    };
  }

  return { noteDiagnostic, noteProgress, markApprovedAnswer, markTerminalSettled, snapshot };
}

export const req002ReceiptScenarioSchema = z.strictObject({
  id: z.string().min(1).max(64),
  runId: z.string().min(1).max(128).nullable(),
  status: z.string().min(1).max(32),
  stopReason: z.string().max(80).nullable(),
  terminalCategory: z.enum(["completed", "partial", "failed", "cancelled", "unknown"]),
  cacheMode: z.enum(["cold", "warm", "not_applicable"]),
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
  mode: z.enum(["live", "offline_scripted"]),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(120),
  executedAt: z.iso.datetime({ offset: true }),
  budgetCaps: z.strictObject({
    maxRuns: z.number().int().min(1),
    maxModelCalls: z.number().int().min(1),
    maxQueryEmbeddings: z.number().int().min(1),
  }),
  totals: z.strictObject({
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
  raw: Omit<Req002AcceptanceReceipt, "privacyCheck"> & {
    outboundQueryLeakCount: number;
    embeddingPayloadLeakCount: number;
    diagnosticAndLogLeakCount: number;
  },
): Req002AcceptanceReceipt {
  const { outboundQueryLeakCount, embeddingPayloadLeakCount, diagnosticAndLogLeakCount, ...body } = raw;
  const preliminary: Req002AcceptanceReceipt = {
    ...body,
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
    throw new Error(`Sanitized receipt leaked synthetic canary tokens: ${receiptLeaks.join(", ")}`);
  }
  return req002AcceptanceReceiptSchema.parse(preliminary);
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
