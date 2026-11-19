import { createHash } from "node:crypto";
import type { AgentStopReason, AgentModelPurpose } from "./agent-budget.ts";
import type { TokenUsage } from "./ai-usage.ts";

export const AGENT_CONTEXT_ASSEMBLY_POLICY_VERSION = "context-assembly/1";

export type AgentTraceRole =
  | "main_chat"
  | "background"
  | "work_followup"
  | "delivery_review"
  | "delivery_repair"
  | "data_compose"
  | "compose_review"
  | "knowledge_organize"
  | "knowledge_review"
  | "compaction"
  | "summary";

export type AgentTraceSchemaMode =
  | "native_json_schema"
  | "degraded_prompt_strict_json"
  | "unstructured";

export type AgentTraceSchemaDegradationReason = "provider_native_schema_unsupported";

export type AgentTracePhase =
  | "run_start"
  | "context_assembled"
  | "model_attempt_start"
  | "model_attempt_retry"
  | "model_attempt_end"
  | "model_attempt_error"
  | "tool_start"
  | "tool_end"
  | "tool_error"
  | "tool_rejection"
  | "source_usable"
  | "answer_approved"
  | "run_end";

export type AgentContextCategory =
  | "profile"
  | "confirmed_facts"
  | "conversation_summary"
  | "recent_messages"
  | "official_knowledge"
  | "private_sources"
  | "family_documents"
  | "tasks"
  | "confirmation_result"
  | "media_photo"
  | "media_voice"
  | "media_file";

export type AgentContextReasonCode =
  | "included"
  | "empty"
  | "not_applicable"
  | "skipped_short_path"
  | "omitted_capacity"
  | "omitted_expired"
  | "omitted_retired_source"
  | "omitted_unverified"
  | "truncated"
  | "reused_valid"
  | "invalidated_changed"
  | "not_loaded";

export type AgentContextVersionRef = Readonly<{
  kind: "prompt_pack" | "policy" | "knowledge_source" | "summary" | "profile" | "document";
  version?: string;
  hashPrefix?: string;
}>;

export type AgentContextCategoryMetadata = Readonly<{
  category: AgentContextCategory;
  included: boolean;
  count?: number;
  characters?: number;
  reasonCode: AgentContextReasonCode;
  versionRefs?: readonly AgentContextVersionRef[];
}>;

export type AgentContextAssemblyMetadata = Readonly<{
  packVersion: string;
  recipeId: string;
  assemblyPolicyVersion: string;
  categories: readonly AgentContextCategoryMetadata[];
  capacity: Readonly<{
    inputLimitCharacters: number;
    assembledCharacters?: number;
    toolResponseReserveCharacters?: number;
  }>;
  loaderCalls: Readonly<{
    capabilityLoads: number;
    summaryReads: number;
    historyReads: number;
    knowledgeSearches: number;
  }>;
}>;

export type AgentTraceMilestones = Readonly<{
  firstMeaningfulProgressMs: number | null;
  firstUsableSourceMs: number | null;
  firstApprovedAnswerMs: number | null;
  terminalSettledMs: number | null;
}>;

export type AgentTraceTerminalCategory = "completed" | "partial" | "failed" | "cancelled" | "unknown";

export type AgentTraceEvent = Readonly<{
  runId: string;
  role: AgentTraceRole;
  recipeId?: string;
  phase: AgentTracePhase;
  elapsedMs: number;
  durationMs?: number;
  attemptIndex?: number;
  retryIndex?: number;
  attemptKeyHash?: string;
  tool?: string;
  callIdHash?: string;
  outcome?: "succeeded" | "rejected" | "conflict" | "failed" | "unknown" | "rate_limited" | "timeout" | "unauthorized" | "invalid_response" | "unavailable";
  stopReason?: AgentStopReason;
  code?: string;
  schemaMode?: AgentTraceSchemaMode;
  schemaDegradationReason?: AgentTraceSchemaDegradationReason;
  tokens?: Readonly<TokenUsage>;
  counts?: Readonly<{ modelCalls: number; toolCalls: number; queryEmbeddings: number }>;
  remainingModelCalls?: number;
  sourceCount?: number;
  terminalCategory?: AgentTraceTerminalCategory;
  milestones?: AgentTraceMilestones;
  contextAssembly?: AgentContextAssemblyMetadata;
}>;

export type AgentTraceSink = (event: AgentTraceEvent) => void | Promise<void>;

export interface AgentRunTraceHandle {
  markUsableSource(count?: number): void;
  markApprovedAnswer(): void;
  noteLoaderCall(kind: keyof AgentContextAssemblyMetadata["loaderCalls"]): void;
  recordContextCategory(entry: AgentContextCategoryMetadata): void;
}

const VALID_ROLES = new Set<AgentTraceRole>([
  "main_chat", "background", "work_followup", "delivery_review", "delivery_repair",
  "data_compose", "compose_review", "knowledge_organize", "knowledge_review", "compaction", "summary",
]);

const VALID_PHASES = new Set<AgentTracePhase>([
  "run_start", "context_assembled", "model_attempt_start", "model_attempt_retry",
  "model_attempt_end", "model_attempt_error", "tool_start", "tool_end", "tool_error",
  "tool_rejection", "source_usable", "answer_approved", "run_end",
]);

const VALID_SCHEMA_MODES = new Set<AgentTraceSchemaMode>([
  "native_json_schema", "degraded_prompt_strict_json", "unstructured",
]);

const VALID_CATEGORIES = new Set<AgentContextCategory>([
  "profile", "confirmed_facts", "conversation_summary", "recent_messages",
  "official_knowledge", "private_sources", "family_documents", "tasks",
  "confirmation_result", "media_photo", "media_voice", "media_file",
]);

const VALID_REASON_CODES = new Set<AgentContextReasonCode>([
  "included", "empty", "not_applicable", "skipped_short_path", "omitted_capacity",
  "omitted_expired", "omitted_retired_source", "omitted_unverified", "truncated",
  "reused_valid", "invalidated_changed", "not_loaded",
]);

const VALID_REF_KINDS = new Set<AgentContextVersionRef["kind"]>([
  "prompt_pack", "policy", "knowledge_source", "summary", "profile", "document",
]);

const VALID_OUTCOMES = new Set<NonNullable<AgentTraceEvent["outcome"]>>([
  "succeeded", "rejected", "conflict", "failed", "unknown",
  "rate_limited", "timeout", "unauthorized", "invalid_response", "unavailable",
]);

const VALID_TERMINAL_CATEGORIES = new Set<AgentTraceTerminalCategory>([
  "completed", "partial", "failed", "cancelled", "unknown",
]);

const SAFE_TOKEN_RE = /^[A-Za-z0-9._:/-]{1,64}$/u;
const SAFE_TOOL_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_HEX_PREFIX_RE = /^[a-f0-9]{6,16}$/u;
const SAFE_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/u;

export function hashSafeTraceId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function traceRoleFromPurpose(purpose?: AgentModelPurpose, fallback: AgentTraceRole = "main_chat"): AgentTraceRole {
  switch (purpose) {
    case "delivery_review": return "delivery_review";
    case "delivery_repair": return "delivery_repair";
    case "compose": return "data_compose";
    case "compose_review": return "compose_review";
    case "knowledge_review": return "knowledge_review";
    case "compaction": return "compaction";
    case "summary": return "summary";
    default: return fallback;
  }
}

function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : undefined;
}

function safeNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
}

function safeStringToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN_RE.test(value) ? value : undefined;
}

function sanitizeVersionRefs(refs: readonly AgentContextVersionRef[] | undefined): AgentContextVersionRef[] | undefined {
  if (!Array.isArray(refs) || !refs.length) return undefined;
  const cleaned: AgentContextVersionRef[] = [];
  for (const ref of refs.slice(0, 12)) {
    if (!ref || typeof ref !== "object" || !VALID_REF_KINDS.has(ref.kind)) continue;
    const version = safeStringToken(ref.version);
    const hashPrefix = typeof ref.hashPrefix === "string" && SAFE_HEX_PREFIX_RE.test(ref.hashPrefix) ? ref.hashPrefix : undefined;
    cleaned.push({
      kind: ref.kind,
      ...(version ? { version } : {}),
      ...(hashPrefix ? { hashPrefix } : {}),
    });
  }
  return cleaned.length ? cleaned : undefined;
}

function sanitizeContextAssembly(raw: AgentContextAssemblyMetadata | undefined): AgentContextAssemblyMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const packVersion = safeStringToken(raw.packVersion);
  const recipeId = safeStringToken(raw.recipeId);
  const assemblyPolicyVersion = safeStringToken(raw.assemblyPolicyVersion) ?? AGENT_CONTEXT_ASSEMBLY_POLICY_VERSION;
  if (!packVersion || !recipeId) return undefined;

  const categories: AgentContextCategoryMetadata[] = [];
  for (const item of (raw.categories ?? []).slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    if (!VALID_CATEGORIES.has(item.category) || !VALID_REASON_CODES.has(item.reasonCode)) continue;
    const count = safeNonNegativeInt(item.count);
    const characters = safeNonNegativeInt(item.characters);
    const versionRefs = sanitizeVersionRefs(item.versionRefs);
    categories.push({
      category: item.category,
      included: Boolean(item.included),
      ...(count !== undefined ? { count } : {}),
      ...(characters !== undefined ? { characters } : {}),
      reasonCode: item.reasonCode,
      ...(versionRefs ? { versionRefs } : {}),
    });
  }

  return {
    packVersion,
    recipeId,
    assemblyPolicyVersion,
    categories,
    capacity: {
      inputLimitCharacters: safeNonNegativeInt(raw.capacity?.inputLimitCharacters) ?? 0,
      ...(safeNonNegativeInt(raw.capacity?.assembledCharacters) !== undefined ? { assembledCharacters: safeNonNegativeInt(raw.capacity?.assembledCharacters) } : {}),
      ...(safeNonNegativeInt(raw.capacity?.toolResponseReserveCharacters) !== undefined ? { toolResponseReserveCharacters: safeNonNegativeInt(raw.capacity?.toolResponseReserveCharacters) } : {}),
    },
    loaderCalls: {
      capabilityLoads: safeNonNegativeInt(raw.loaderCalls?.capabilityLoads) ?? 0,
      summaryReads: safeNonNegativeInt(raw.loaderCalls?.summaryReads) ?? 0,
      historyReads: safeNonNegativeInt(raw.loaderCalls?.historyReads) ?? 0,
      knowledgeSearches: safeNonNegativeInt(raw.loaderCalls?.knowledgeSearches) ?? 0,
    },
  };
}

/**
 * Rebuild an AgentTraceEvent strictly from its metadata allowlist.
 * Never passes arbitrary strings, user prompts, message text, tool arguments, or raw errors.
 */
export function sanitizeAgentTraceEvent(raw: AgentTraceEvent): AgentTraceEvent {
  const runId = safeStringToken(raw.runId) ?? hashSafeTraceId(String(raw.runId ?? ""));
  const role: AgentTraceRole = VALID_ROLES.has(raw.role) ? raw.role : "main_chat";
  const phase: AgentTracePhase = VALID_PHASES.has(raw.phase) ? raw.phase : "run_end";
  const recipeId = safeStringToken(raw.recipeId);
  const elapsedMs = safeNonNegativeNumber(raw.elapsedMs) ?? 0;
  const durationMs = safeNonNegativeNumber(raw.durationMs);
  const attemptIndex = safeNonNegativeInt(raw.attemptIndex);
  const retryIndex = safeNonNegativeInt(raw.retryIndex);
  const attemptKeyHash = typeof raw.attemptKeyHash === "string" && SAFE_HEX_PREFIX_RE.test(raw.attemptKeyHash) ? raw.attemptKeyHash : undefined;
  const tool = typeof raw.tool === "string" && SAFE_TOOL_RE.test(raw.tool) ? raw.tool : undefined;
  const callIdHash = typeof raw.callIdHash === "string" && SAFE_HEX_PREFIX_RE.test(raw.callIdHash) ? raw.callIdHash : undefined;
  const outcome = raw.outcome && VALID_OUTCOMES.has(raw.outcome) ? raw.outcome : undefined;
  const stopReason = typeof raw.stopReason === "string" && SAFE_CODE_RE.test(raw.stopReason) ? raw.stopReason as AgentStopReason : undefined;
  const code = typeof raw.code === "string" && SAFE_CODE_RE.test(raw.code) ? raw.code : undefined;
  const schemaMode = raw.schemaMode && VALID_SCHEMA_MODES.has(raw.schemaMode) ? raw.schemaMode : undefined;
  const schemaDegradationReason = raw.schemaDegradationReason === "provider_native_schema_unsupported"
    ? raw.schemaDegradationReason : undefined;
  const remainingModelCalls = safeNonNegativeInt(raw.remainingModelCalls);
  const sourceCount = safeNonNegativeInt(raw.sourceCount);
  const terminalCategory = raw.terminalCategory && VALID_TERMINAL_CATEGORIES.has(raw.terminalCategory)
    ? raw.terminalCategory : undefined;

  const tokens = raw.tokens && typeof raw.tokens === "object"
    ? {
        inputTokens: safeNullableInt(raw.tokens.inputTokens),
        outputTokens: safeNullableInt(raw.tokens.outputTokens),
        cachedTokens: safeNullableInt(raw.tokens.cachedTokens),
      }
    : undefined;

  const counts = raw.counts && typeof raw.counts === "object"
    ? {
        modelCalls: safeNonNegativeInt(raw.counts.modelCalls) ?? 0,
        toolCalls: safeNonNegativeInt(raw.counts.toolCalls) ?? 0,
        queryEmbeddings: safeNonNegativeInt(raw.counts.queryEmbeddings) ?? 0,
      }
    : undefined;

  const milestones = raw.milestones && typeof raw.milestones === "object"
    ? {
        firstMeaningfulProgressMs: safeNullableNumber(raw.milestones.firstMeaningfulProgressMs),
        firstUsableSourceMs: safeNullableNumber(raw.milestones.firstUsableSourceMs),
        firstApprovedAnswerMs: safeNullableNumber(raw.milestones.firstApprovedAnswerMs),
        terminalSettledMs: safeNullableNumber(raw.milestones.terminalSettledMs),
      }
    : undefined;

  const contextAssembly = sanitizeContextAssembly(raw.contextAssembly);

  return {
    runId,
    role,
    ...(recipeId ? { recipeId } : {}),
    phase,
    elapsedMs,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(attemptIndex !== undefined ? { attemptIndex } : {}),
    ...(retryIndex !== undefined ? { retryIndex } : {}),
    ...(attemptKeyHash ? { attemptKeyHash } : {}),
    ...(tool ? { tool } : {}),
    ...(callIdHash ? { callIdHash } : {}),
    ...(outcome ? { outcome } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(code ? { code } : {}),
    ...(schemaMode ? { schemaMode } : {}),
    ...(schemaDegradationReason ? { schemaDegradationReason } : {}),
    ...(tokens ? { tokens } : {}),
    ...(counts ? { counts } : {}),
    ...(remainingModelCalls !== undefined ? { remainingModelCalls } : {}),
    ...(sourceCount !== undefined ? { sourceCount } : {}),
    ...(terminalCategory ? { terminalCategory } : {}),
    ...(milestones ? { milestones } : {}),
    ...(contextAssembly ? { contextAssembly } : {}),
  };
}

export interface OtelMetadataSpanRecord {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Project a sanitized trace event into a flat OTel-compatible metadata-only span record.
 * Excludes all raw prompt/message/tool/error bodies by construction.
 */
export function formatOtelMetadataSpan(raw: AgentTraceEvent): OtelMetadataSpanRecord {
  const event = sanitizeAgentTraceEvent(raw);
  const attributes: Record<string, string | number | boolean> = {
    "yuban.run_id": event.runId,
    "yuban.role": event.role,
    "yuban.phase": event.phase,
    "yuban.elapsed_ms": event.elapsedMs,
  };
  if (event.recipeId) attributes["yuban.recipe_id"] = event.recipeId;
  if (event.durationMs !== undefined) attributes["yuban.duration_ms"] = event.durationMs;
  if (event.attemptIndex !== undefined) attributes["yuban.attempt_index"] = event.attemptIndex;
  if (event.retryIndex !== undefined) attributes["yuban.retry_index"] = event.retryIndex;
  if (event.attemptKeyHash) attributes["yuban.attempt_key_hash"] = event.attemptKeyHash;
  if (event.tool) attributes["yuban.tool"] = event.tool;
  if (event.callIdHash) attributes["yuban.call_id_hash"] = event.callIdHash;
  if (event.outcome) attributes["yuban.outcome"] = event.outcome;
  if (event.stopReason) attributes["yuban.stop_reason"] = event.stopReason;
  if (event.code) attributes["yuban.code"] = event.code;
  if (event.schemaMode) attributes["yuban.schema_mode"] = event.schemaMode;
  if (event.schemaDegradationReason) attributes["yuban.schema_degradation_reason"] = event.schemaDegradationReason;
  if (event.remainingModelCalls !== undefined) attributes["yuban.remaining_model_calls"] = event.remainingModelCalls;
  if (event.sourceCount !== undefined) attributes["yuban.source_count"] = event.sourceCount;
  if (event.terminalCategory) attributes["yuban.terminal_category"] = event.terminalCategory;
  if (event.tokens) {
    if (event.tokens.inputTokens !== null) attributes["gen_ai.usage.input_tokens"] = event.tokens.inputTokens;
    if (event.tokens.outputTokens !== null) attributes["gen_ai.usage.output_tokens"] = event.tokens.outputTokens;
    if (event.tokens.cachedTokens !== null) attributes["gen_ai.usage.cached_tokens"] = event.tokens.cachedTokens;
  }
  if (event.counts) {
    attributes["yuban.counts.model_calls"] = event.counts.modelCalls;
    attributes["yuban.counts.tool_calls"] = event.counts.toolCalls;
    attributes["yuban.counts.query_embeddings"] = event.counts.queryEmbeddings;
  }
  if (event.milestones) {
    if (event.milestones.firstMeaningfulProgressMs !== null) {
      attributes["yuban.milestones.first_meaningful_progress_ms"] = event.milestones.firstMeaningfulProgressMs;
    }
    if (event.milestones.firstUsableSourceMs !== null) {
      attributes["yuban.milestones.first_usable_source_ms"] = event.milestones.firstUsableSourceMs;
    }
    if (event.milestones.firstApprovedAnswerMs !== null) {
      attributes["yuban.milestones.first_approved_answer_ms"] = event.milestones.firstApprovedAnswerMs;
    }
    if (event.milestones.terminalSettledMs !== null) {
      attributes["yuban.milestones.terminal_settled_ms"] = event.milestones.terminalSettledMs;
    }
  }
  if (event.contextAssembly) {
    attributes["yuban.context.pack_version"] = event.contextAssembly.packVersion;
    attributes["yuban.context.recipe_id"] = event.contextAssembly.recipeId;
    attributes["yuban.context.policy_version"] = event.contextAssembly.assemblyPolicyVersion;
    attributes["yuban.context.input_limit_chars"] = event.contextAssembly.capacity.inputLimitCharacters;
    if (event.contextAssembly.capacity.assembledCharacters !== undefined) {
      attributes["yuban.context.assembled_chars"] = event.contextAssembly.capacity.assembledCharacters;
    }
    attributes["yuban.context.loader_capability_loads"] = event.contextAssembly.loaderCalls.capabilityLoads;
    attributes["yuban.context.loader_summary_reads"] = event.contextAssembly.loaderCalls.summaryReads;
    attributes["yuban.context.loader_history_reads"] = event.contextAssembly.loaderCalls.historyReads;
    attributes["yuban.context.loader_knowledge_searches"] = event.contextAssembly.loaderCalls.knowledgeSearches;
    attributes["yuban.context.categories"] = event.contextAssembly.categories
      .map(item => `${item.category}:${item.included ? "in" : "out"}:${item.reasonCode}`)
      .join(",");
  }
  return Object.freeze({
    name: `yuban.agent.${event.phase}`,
    attributes: Object.freeze(attributes),
  });
}

export function createAgentRunTraceCollector(options: {
  runId: string;
  role: AgentTraceRole;
  recipeId?: string;
  sinks?: readonly (AgentTraceSink | undefined)[];
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const sinks = [...new Set((options.sinks ?? []).filter((sink): sink is AgentTraceSink => Boolean(sink)))];
  const recorded: AgentTraceEvent[] = [];
  const loaderCalls = { capabilityLoads: 0, summaryReads: 0, historyReads: 0, knowledgeSearches: 0 };
  const dynamicCategories: AgentContextCategoryMetadata[] = [];
  let lastContextAssemblyInput: {
    packVersion: string;
    recipeId: string;
    categories: readonly AgentContextCategoryMetadata[];
    capacity: AgentContextAssemblyMetadata["capacity"];
    loaderCalls?: Partial<AgentContextAssemblyMetadata["loaderCalls"]>;
  } | null = null;

  let firstMeaningfulProgressMs: number | null = null;
  let firstUsableSourceMs: number | null = null;
  let firstApprovedAnswerMs: number | null = null;
  let terminalSettledMs: number | null = null;
  let attemptCounter = 0;

  const elapsed = () => Math.max(0, Math.round((now() - startedAt) * 1000) / 1000);

  const emit = (partial: Omit<AgentTraceEvent, "runId" | "elapsedMs"> & { elapsedMs?: number }): AgentTraceEvent => {
    const t = partial.elapsedMs ?? elapsed();
    if (
      firstMeaningfulProgressMs === null
      && (partial.phase === "model_attempt_start"
        || partial.phase === "tool_start"
        || partial.phase === "source_usable")
    ) {
      firstMeaningfulProgressMs = t;
    }
    const sanitized = sanitizeAgentTraceEvent({
      ...partial,
      runId: options.runId,
      recipeId: partial.recipeId ?? options.recipeId,
      elapsedMs: t,
    });
    recorded.push(sanitized);
    for (const sink of sinks) {
      try {
        void Promise.resolve(sink(structuredClone(sanitized))).catch(() => {});
      } catch {
        // Trace sinks are strictly observational and must never disrupt execution.
      }
    }
    return sanitized;
  };

  const handle: AgentRunTraceHandle = {
    markUsableSource(count?: number) {
      const t = elapsed();
      if (firstUsableSourceMs === null) firstUsableSourceMs = t;
      emit({
        role: options.role,
        phase: "source_usable",
        elapsedMs: t,
        ...(count !== undefined ? { sourceCount: count } : {}),
        milestones: snapshotMilestones(),
      });
    },
    markApprovedAnswer() {
      const t = elapsed();
      if (firstApprovedAnswerMs === null) firstApprovedAnswerMs = t;
      emit({
        role: options.role,
        phase: "answer_approved",
        elapsedMs: t,
        milestones: snapshotMilestones(),
      });
    },
    noteLoaderCall(kind) {
      loaderCalls[kind] += 1;
    },
    recordContextCategory(entry) {
      dynamicCategories.push(entry);
    },
  };

  function snapshotMilestones(): AgentTraceMilestones {
    return {
      firstMeaningfulProgressMs,
      firstUsableSourceMs,
      firstApprovedAnswerMs,
      terminalSettledMs,
    };
  }

  return {
    handle,
    nextAttemptIndex(): number {
      return ++attemptCounter;
    },
    emit,
    emitGatewayEvent(event: AgentTraceEvent): void {
      emit({
        ...event,
        elapsedMs: elapsed(),
      });
    },
    emitContextAssembly(input: {
      packVersion: string;
      recipeId: string;
      categories: readonly AgentContextCategoryMetadata[];
      capacity: AgentContextAssemblyMetadata["capacity"];
      loaderCalls?: Partial<AgentContextAssemblyMetadata["loaderCalls"]>;
    }): AgentTraceEvent {
      lastContextAssemblyInput = input;
      const byCategory = new Map<AgentContextCategory, AgentContextCategoryMetadata>();
      for (const item of input.categories) byCategory.set(item.category, item);
      for (const item of dynamicCategories) byCategory.set(item.category, item);
      const mergedCategories = [...byCategory.values()];
      return emit({
        role: options.role,
        phase: "context_assembled",
        contextAssembly: {
          packVersion: input.packVersion,
          recipeId: input.recipeId,
          assemblyPolicyVersion: AGENT_CONTEXT_ASSEMBLY_POLICY_VERSION,
          categories: mergedCategories,
          capacity: input.capacity,
          loaderCalls: {
            capabilityLoads: (input.loaderCalls?.capabilityLoads ?? 0) + loaderCalls.capabilityLoads,
            summaryReads: (input.loaderCalls?.summaryReads ?? 0) + loaderCalls.summaryReads,
            historyReads: (input.loaderCalls?.historyReads ?? 0) + loaderCalls.historyReads,
            knowledgeSearches: (input.loaderCalls?.knowledgeSearches ?? 0) + loaderCalls.knowledgeSearches,
          },
        },
      });
    },
    finalize(input: {
      status: "completed" | "stopped";
      stopReason?: AgentStopReason;
      hasUsablePartial?: boolean;
      counts: { modelCalls: number; toolCalls: number; queryEmbeddings: number };
    }): AgentTraceEvent {
      const t = elapsed();
      terminalSettledMs = t;
      const terminalCategory: AgentTraceTerminalCategory = input.status === "completed"
        ? "completed"
        : input.stopReason === "cancelled"
          ? "cancelled"
          : input.stopReason === "tool_unknown"
            ? "unknown"
            : input.hasUsablePartial
              ? "partial"
              : "failed";
      const finalContextAssembly: AgentContextAssemblyMetadata | undefined = lastContextAssemblyInput
        ? (() => {
            const byCategory = new Map<AgentContextCategory, AgentContextCategoryMetadata>();
            for (const item of lastContextAssemblyInput.categories) byCategory.set(item.category, item);
            for (const item of dynamicCategories) byCategory.set(item.category, item);
            return {
              packVersion: lastContextAssemblyInput.packVersion,
              recipeId: lastContextAssemblyInput.recipeId,
              assemblyPolicyVersion: AGENT_CONTEXT_ASSEMBLY_POLICY_VERSION,
              categories: [...byCategory.values()],
              capacity: lastContextAssemblyInput.capacity,
              loaderCalls: {
                capabilityLoads: (lastContextAssemblyInput.loaderCalls?.capabilityLoads ?? 0) + loaderCalls.capabilityLoads,
                summaryReads: (lastContextAssemblyInput.loaderCalls?.summaryReads ?? 0) + loaderCalls.summaryReads,
                historyReads: (lastContextAssemblyInput.loaderCalls?.historyReads ?? 0) + loaderCalls.historyReads,
                knowledgeSearches: (lastContextAssemblyInput.loaderCalls?.knowledgeSearches ?? 0) + loaderCalls.knowledgeSearches,
              },
            };
          })()
        : undefined;
      return emit({
        role: options.role,
        phase: "run_end",
        elapsedMs: t,
        outcome: input.status === "completed" ? "succeeded" : input.stopReason === "unauthorized" ? "unauthorized" : "failed",
        ...(input.stopReason ? { stopReason: input.stopReason } : {}),
        terminalCategory,
        counts: input.counts,
        milestones: snapshotMilestones(),
        ...(finalContextAssembly ? { contextAssembly: finalContextAssembly } : {}),
      });
    },
    snapshotMilestones,
    events(): readonly AgentTraceEvent[] {
      return recorded;
    },
  };
}
