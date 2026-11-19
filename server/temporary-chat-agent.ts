import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  matchOfficialHelpForText,
  officialHelpIdSchema,
  type OfficialHelpId,
} from "../src/shared/agent-feedback.ts";
import type { KnowledgeEvidence, KnowledgeFilter, KnowledgeContextCursor } from "../src/shared/knowledge.ts";
import type { LiveSourceCitation } from "../src/shared/live-source-citation.ts";
import type { ModelBillingSource } from "../src/shared/model-settings.ts";
import type { AgentAnswer, AgentPresentation } from "../src/shared/product-agent.ts";
import type { SourceSeries } from "../src/shared/source-series.ts";
import {
  TEMPORARY_CHAT_LIMITS,
  type TemporaryChatCitation,
  type TemporaryChatCloseReason,
  type TemporaryChatCloseReceipt,
  type TemporaryChatHelpCardId,
  type TemporaryChatMessage,
  type TemporaryChatSessionMeta,
} from "../src/shared/temporary-chat.ts";
import {
  AGENT_LIMITS,
  AgentStopped,
  agentBudgetFingerprint,
  type AgentPolicyTransition,
  type AgentRunLimits,
  type AgentSoftBudgetProfileRole,
} from "./agent-budget.ts";
import { AGENT_KNOWLEDGE_TOOL_DESCRIPTIONS } from "./agent-knowledge-tool-descriptions.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import { createAgentRuntime, type AgentRunContext, type AgentScope, type AgentTool } from "./agent-runtime.ts";
import type { AiConfig } from "./ai-config.ts";
import type { AiUsageStore } from "./ai-usage.ts";
import {
  chatDeliveryContentHash,
  chatDeliveryExcerpt,
  chatDeliveryPassNeedsSources,
  chatDeliveryReviewSourceExcerpt,
  enforceChatDeliveryReview,
  requiresChatDeliveryReview,
  type ChatDeliveryDraft,
  type ChatDeliverySource,
  type ChatDeliverySurface,
} from "./chat-delivery-review.ts";
import type { DurableAiUsage, DurableAiUsageRequest } from "./durable-ai-usage.ts";
import type { DurableQueryEmbeddingUsage, EmbeddingGateway } from "./embedding-gateway.ts";
import { FamilyError } from "./family-access.ts";
import { parseKnowledgeFilter } from "./knowledge-inputs.ts";
import { baseAgentKnowledgeFilter } from "./knowledge-query-context.ts";
import { assertPublicKnowledgeQuery } from "./knowledge-query-minimization.ts";
import { accumulateKnowledgeRead } from "./knowledge-read-coverage.ts";
import { createKnowledgeRetriever } from "./knowledge-retriever.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";
import { snapshotLiveRead, type LiveSourceReader } from "./live-source-citation.ts";
import { TemporaryChatError, type TemporaryChatStore } from "./temporary-chat-store.ts";

const shortText = (max: number) =>
  z.string().min(1).max(max).refine(value => value.trim().length > 0);

const tempAnswerKindSchema = z.enum([
  "public_information",
  "caregiving",
  "safety_help",
  "clarification",
]);

const tempAnswerParagraphSchema = z
  .object({
    kind: tempAnswerKindSchema.optional(),
    text: z
      .string()
      .min(1)
      .max(1800)
      .refine(value => value.trim().length > 0),
    citationIds: z.array(z.string().min(1).max(80)).max(6),
  })
  .strict();

const tempAnswerSchema = z
  .object({
    kind: z.enum([...tempAnswerKindSchema.options, "mixed"]),
    paragraphs: z.array(tempAnswerParagraphSchema).min(1).max(6),
  })
  .strict();

const publicAgeRangeSchema = z
  .object({
    basis: z.enum(["actual", "corrected"]).default("actual"),
    minMonths: z.number().min(0).max(120),
    maxMonths: z.number().min(0).max(120),
  })
  .strict()
  .refine(value => value.minMonths <= value.maxMonths);

const EMERGENCY_REDIRECT_TEXT = "請先使用畫面上的緊急求助入口。";

const TEMPORARY_CHAT_INSTRUCTION_POLICY =
  "目前為臨時聊天（獨立空白會話）：沒有載入任何私人記憶、孩子資料、主聊天歷史或任務，"
  + "只能依據當次臨時聊天內容與公共知識庫／公共搜索回答。"
  + "嚴禁宣稱已保存、已記低、已建立記錄、任務或待確認卡片；"
  + "若使用者要求保存、建立或修改資料，請只用 kind=\"clarification\"、citationIds=[] 簡潔說明「目前為臨時聊天，不會建立或保存任何記憶或記錄；如需保存，請退出臨時聊天並於主聊天的助手模式處理。」。";

export interface TemporaryChatExecution {
  config: AiConfig;
  provider: AgentModelProvider;
  usage: Pick<AiUsageStore, "reserve" | "record">;
  embeddings?: Pick<EmbeddingGateway, "embed">;
  authorize: () => Promise<boolean>;
  runLimits?: AgentRunLimits;
  billingSource?: ModelBillingSource;
  policyVersion?: number;
  repeatedSignatureStreak?: number;
  readPolicyTransition?: () => Promise<AgentPolicyTransition | null>;
  roleSoftBudgetRatios?: Partial<Record<AgentSoftBudgetProfileRole, number>>;
  softBudgetSource?: "personal" | "administrator" | "system_default";
}

export function createDurableUsageAdapterForTemporaryChat(options: {
  dailyUsage: Pick<DurableAiUsage, "billingSource" | "reserve" | "record">;
  userId: string;
  runId: string;
  model: string;
  deadlineAtMs: number;
  billingSource: ModelBillingSource;
  baseEmbeddings?: Pick<EmbeddingGateway, "embed">;
}): {
  usage: Pick<AiUsageStore, "reserve" | "record">;
  embeddings?: Pick<EmbeddingGateway, "embed">;
} {
  let attemptSeq = 0;
  let embedSeq = 0;
  const pendingRequests: DurableAiUsageRequest[] = [];
  const bindingFingerprint = agentBudgetFingerprint({
    scope: "temporary_chat",
    rootRunId: options.runId,
    userId: options.userId,
    billingSource: options.billingSource,
  });

  const usage: Pick<AiUsageStore, "reserve" | "record"> = {
    async reserve(userId, userLimit, globalLimit) {
      attemptSeq += 1;
      const req: DurableAiUsageRequest = {
        kind: "model",
        rootRunId: options.runId,
        attemptKey: `temporary:model:${attemptSeq}`,
        bindingFingerprint,
        requestFingerprint: agentBudgetFingerprint({
          scope: "temporary_chat",
          rootRunId: options.runId,
          attemptSeq,
        }),
        userId,
        childId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
        model: options.model,
        deadlineAtMs: options.deadlineAtMs,
        userLimit,
        globalLimit,
      };
      const admission = await options.dailyUsage.reserve(req, undefined, {
        activity: "generate",
        retry: false,
      });
      if (admission.decision === "quota_exceeded") return false;
      if (admission.decision !== "execute") throw new AgentStopped("unavailable");
      pendingRequests.push(req);
      return true;
    },
    async record(attempt) {
      const req = pendingRequests.shift();
      if (!req) return;
      await options.dailyUsage.record(req, {
        kind: "model",
        outcome: attempt.outcome,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        cachedTokens: attempt.cachedTokens,
        durationMs: attempt.durationMs,
      });
    },
  };

  const embeddings: Pick<EmbeddingGateway, "embed"> | undefined = options.baseEmbeddings
    ? {
        embed(input, actor, signal, resourceAccess, durable) {
          embedSeq += 1;
          const resolvedDurable: DurableQueryEmbeddingUsage = durable ?? {
            adapter: options.dailyUsage as DurableAiUsage,
            attemptKey: `embedding:temporary:${embedSeq}`,
            revalidate: async () => {},
            context: {
              generation: 1,
              binding: {
                rootRunId: options.runId,
                ownerId: actor.actorId,
                workspaceId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
                childId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
                authorizationVersion: "temporary",
                storageEpoch: "temporary",
                trigger: { kind: "interactive", reference: "temporary" },
                workflowVersion: "temporary-chat-v1",
                promptPackVersion: "0.0.0",
                settingsVersion: "temporary",
                billingVersion: `${options.billingSource}:v1`,
                limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 },
                deadlineAtMs: options.deadlineAtMs,
              },
            },
          };
          return options.baseEmbeddings!.embed(
            input,
            actor,
            signal,
            resourceAccess,
            resolvedDurable,
          );
        },
      }
    : undefined;

  return { usage, ...(embeddings ? { embeddings } : {}) };
}

function mapCitationsForTemporaryMessage(presentation: AgentPresentation | null): TemporaryChatCitation[] {
  if (!presentation || presentation.outcome === "no_action") return [];
  const items: TemporaryChatCitation[] = [];
  for (const chunk of presentation.citations) {
    items.push({
      id: chunk.chunkId,
      title: chunk.title,
      publisher: chunk.publisher,
      url: chunk.url,
      classification: chunk.classification,
      sourceDate: chunk.sourceUpdatedAt ?? chunk.sourcePublishedAt ?? chunk.sourceDateText ?? null,
      checkedAt: chunk.checkedAt ?? null,
      excerpt: chunk.citedExcerpt ?? (chunk.sourceExcerpt || chunk.text.slice(0, 300)),
      acquisition: "library",
    });
  }
  for (const live of presentation.liveCitations ?? []) {
    items.push({
      id: live.id,
      title: live.title,
      publisher: live.publisher,
      url: live.url,
      classification: live.classification,
      sourceDate: live.sourceDate ?? null,
      checkedAt: live.fetchedAt ?? null,
      excerpt: live.excerpt ?? "",
      acquisition: "live",
    });
  }
  return items;
}

export interface TemporaryChatAgentOptions {
  store: TemporaryChatStore;
  resolveExecution: (
    userId: string,
    runId: string,
    deadlineAtMs: number,
  ) => Promise<TemporaryChatExecution>;
  knowledge?: Pick<KnowledgeStore, "candidates">;
  liveSourceReader?: LiveSourceReader;
  publishedLiveSeries?: (sourceId: string, url: string) => Promise<SourceSeries | null>;
  clock?: () => number;
}

export interface TemporaryChatService {
  createSession(userId: string): {
    session: TemporaryChatSessionMeta;
    messages: TemporaryChatMessage[];
  };
  sendTurn(input: {
    userId: string;
    sessionId: string;
    generation: number;
    text: string;
    isCurrentUser: (userId: string) => Promise<boolean>;
    signal?: AbortSignal;
  }): Promise<{
    session: TemporaryChatSessionMeta;
    userMessage: TemporaryChatMessage;
    modelMessage: TemporaryChatMessage;
  }>;
  closeSession(
    userId: string,
    sessionId: string,
    reason?: TemporaryChatCloseReason,
  ): TemporaryChatCloseReceipt;
  closeAllForUser(userId: string, reason?: TemporaryChatCloseReason): number;
}

export function createTemporaryChatAgent(options: TemporaryChatAgentOptions): Pick<TemporaryChatService, "sendTurn"> {
  const clock = options.clock ?? Date.now;

  return {
    async sendTurn(input) {
      const { userId, sessionId, generation, text, isCurrentUser, signal } = input;
      const turn = options.store.beginTurn(userId, sessionId, generation, text);
      const runId = randomUUID();
      const nowMs = clock();
      const deadlineAtMs = nowMs + AGENT_LIMITS.deadlineMs;
      const combinedSignal = signal
        ? AbortSignal.any([turn.abortController.signal, signal])
        : turn.abortController.signal;

      let committedOrAborted = false;
      try {
        const preliminaryAuth = async () =>
          !combinedSignal.aborted &&
          turn.isStillValid() &&
          (await isCurrentUser(userId));

        if (!(await preliminaryAuth())) {
          const expired =
            turn.abortController.signal.reason instanceof Error &&
            turn.abortController.signal.reason.message === "temporary_session_expired";
          throw new TemporaryChatError(
            turn.isStillValid() ? 401 : 410,
            turn.isStillValid()
              ? "unauthorized"
              : expired
                ? "temporary_session_expired"
                : "temporary_session_closed",
          );
        }

        const resolved = await options.resolveExecution(userId, runId, deadlineAtMs);
        const authorize = async () => (await preliminaryAuth()) && (await resolved.authorize());

        if (!(await authorize())) {
          throw new TemporaryChatError(turn.isStillValid() ? 401 : 410, turn.isStillValid() ? "unauthorized" : "temporary_session_closed");
        }

        const scope: AgentScope = {
          userId,
          workspaceId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
          childId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
          authorizationVersion: `temporary:${sessionId}:g${generation}`,
          dataVersion: `temporary:${sessionId}:g${generation}`,
        };

        const evidence = new Map<string, { chunk: KnowledgeEvidence; filter: KnowledgeFilter }>();
        const liveEvidence = new Map<string, LiveSourceCitation>();
        const selectedEvidence = new Map<string, ChatDeliverySource>();
        const selectedOfficialHelp = new Set<OfficialHelpId>();
        let mode: AgentPresentation["retrievalMode"] = "not_used";
        let answer: z.infer<typeof tempAnswerSchema> | undefined;
        let finalPresentation: AgentPresentation | null = null;

        const runtime = createAgentRuntime({
          config: resolved.config,
          usage: resolved.usage,
          provider: resolved.provider,
          billingSource: resolved.billingSource,
          embeddings: resolved.embeddings,
          policyVersion: resolved.policyVersion,
          repeatedSignatureStreak: resolved.repeatedSignatureStreak,
          softBudgetSource: resolved.softBudgetSource,
          chatDeliveryReviewModelCalls: resolved.config.chatDeliveryReviewModelCalls,
          ...(resolved.runLimits
            ? {
                resolve: async () => ({
                  config: resolved.config,
                  provider: resolved.provider,
                  model: {
                    async generate() {
                      throw new AgentStopped("unavailable");
                    },
                  },
                  runLimits: resolved.runLimits,
                  usage: {
                    ...resolved.usage,
                    async getForUser() {
                      return {
                        day: "",
                        attempts: 0,
                        inputTokens: 0,
                        outputTokens: 0,
                        cachedTokens: 0,
                        unknownUsageAttempts: 0,
                      };
                    },
                  },
                  authorize: resolved.authorize,
                  embeddings:
                    resolved.embeddings ??
                    {
                      async embed() {
                        throw new AgentStopped("unavailable");
                      },
                    },
                }),
              }
            : {}),
        });

        const buildTools = (runContext: AgentRunContext) => {
          const { budget, deliveryReview } = runContext;
          const permitted = async () => authorize();
          const fallbackEmbedder = {
            async embed(): Promise<never> {
              throw new AgentStopped("unavailable");
            },
          };
          const retrieval = options.knowledge
            ? createKnowledgeRetriever(options.knowledge, fallbackEmbedder).createRun({
                actor: { kind: "query_embedding", actorId: userId, operationId: runId },
                budget,
                authorize: permitted,
                embeddings: runContext.embeddings,
                publicOnly: true,
              })
            : null;
          const liveReader = options.liveSourceReader;

          async function guard<T>(operation: () => Promise<T>): Promise<import("./agent-runtime.ts").AgentToolResult> {
            try {
              return { status: "succeeded", data: { result: await operation() } };
            } catch (error) {
              if (error instanceof z.ZodError) {
                return { status: "rejected", data: { code: "invalid_input" } };
              }
              if (error instanceof FamilyError && error.code === "public_query_required") {
                return {
                  status: "rejected",
                  data: {
                    code: error.code,
                    nextAction: "search_knowledge",
                    message:
                      "外部搜尋 query 只可傳去識別的公共主題條件（保留年齡段、症狀、持續時間及粗粒度地區）；必須移除姓名、完整生日、具體地址與聯絡方式後重試。",
                  },
                };
              }
              if (error instanceof FamilyError && error.code === "invalid_citation") {
                return {
                  status: "rejected",
                  data: {
                    code: error.code,
                    nextAction:
                      "只可填入本次 search_knowledge 實際回傳的 chunkId 或 live id，切勿填入求助卡 ID 或 URL。",
                  },
                };
              }
              if (error instanceof FamilyError && error.code === "use_citation_ids") {
                return {
                  status: "rejected",
                  data: {
                    code: error.code,
                    nextAction: "請勿在正文附上網址 URL，改在 citationIds 填入檢索取得的 ID。",
                  },
                };
              }
              if (error instanceof FamilyError && error.code === "citation_required") {
                return {
                  status: "rejected",
                  data: {
                    code: error.code,
                    nextAction: selectedOfficialHelp.has("emergency-hk-v1")
                      ? `若無適用官方片段，請用 kind="clarification"、citationIds=[] 輸出「${EMERGENCY_REDIRECT_TEXT}」。`
                      : "caregiving／safety_help 段落必須引用本次檢索到的 official_guidance ID；若無相關片段，請用 kind=\"clarification\"、citationIds=[] 如實說明限制。",
                  },
                };
              }
              if (error instanceof FamilyError) {
                return {
                  status: error.status === 409 ? "conflict" : error.status >= 500 ? "failed" : "rejected",
                  data: { code: error.code },
                };
              }
              throw error;
            }
          }

          function deliverySource(id: string): ChatDeliverySource | null {
            const selected = selectedEvidence.get(id);
            if (selected) return selected;
            const item = evidence.get(id);
            if (!item) return null;
            const body = item.chunk.text ?? "";
            const excerpt = item.chunk.readCoverage
              ? chatDeliveryReviewSourceExcerpt(body)
              : chatDeliveryExcerpt(body);
            const supplied = item.chunk.contentHash ?? "";
            return {
              citationId: id,
              version: item.chunk.versionId?.trim() || "unversioned",
              contentHash: /^[a-f0-9]{64}$/u.test(supplied) ? supplied : chatDeliveryContentHash(body),
              classification:
                item.chunk.classification === "recent_information"
                  ? "recent_information"
                  : "official_guidance",
              excerpt: excerpt.excerpt,
              excerptComplete: item.chunk.readCoverage
                ? item.chunk.readCoverage.complete && excerpt.excerptComplete
                : excerpt.excerptComplete,
            };
          }

          function buildCandidateDraft(parsed: z.infer<typeof tempAnswerSchema>): ChatDeliveryDraft {
            const ids = [...new Set(parsed.paragraphs.flatMap(p => p.citationIds))];
            return {
              userRequest: text,
              chatMode: "chat_only",
              temporaryChat: true,
              kind: parsed.kind,
              visibility: "private",
              serverSubstitutedSourceText: false,
              serverSubstitutedReceiptText: false,
              verifiedOperations: [],
              paragraphs: parsed.paragraphs.map(p => ({ ...p, citationIds: [...p.citationIds] })),
              sources: ids
                .map(deliverySource)
                .filter((source): source is ChatDeliverySource => source !== null),
              scope,
            };
          }

          function validatePresentation(parsed: z.infer<typeof tempAnswerSchema>) {
            for (const paragraph of parsed.paragraphs) {
              if (/https?:\/\/|www\./iu.test(paragraph.text)) {
                throw new FamilyError(400, "use_citation_ids");
              }
            }
            const draft = buildCandidateDraft(parsed);
            if (
              selectedOfficialHelp.has("emergency-hk-v1") &&
              !Array.from(evidence.values()).some(item => item.chunk.classification === "official_guidance") &&
              parsed.paragraphs.every(p => p.citationIds.length === 0) &&
              requiresChatDeliveryReview(draft) &&
              chatDeliveryPassNeedsSources(draft)
            ) {
              throw new FamilyError(400, "citation_required");
            }
            requiresChatDeliveryReview(draft, deliveryReview);

            const uniqueIds = new Set(parsed.paragraphs.flatMap(p => p.citationIds));
            if (uniqueIds.size > 6) throw new FamilyError(400, "citation_limit");

            for (const paragraph of parsed.paragraphs) {
              const kind = paragraph.kind ?? parsed.kind;
              const official = kind === "caregiving" || kind === "safety_help";
              if (
                official &&
                !paragraph.citationIds.some(id => {
                  const chunk = evidence.get(id)?.chunk;
                  return (
                    (chunk?.classification === "official_guidance" && chunk.treatment?.kind !== "overview") ||
                    liveEvidence.get(id)?.classification === "official_guidance"
                  );
                })
              ) {
                throw new FamilyError(400, "citation_required");
              }
              if (kind === "public_information") {
                const quantitative =
                  /\p{Decimal_Number}|[零〇一二兩三四五六七八九十百千萬半]+(?:個月|小時|分鐘|毫升|毫克|公斤|克|歲|日|次|度|年|月)/u.test(
                    paragraph.text,
                  );
                if (
                  !paragraph.citationIds.some(
                    id =>
                      liveEvidence.has(id) ||
                      (evidence.has(id) &&
                        (!quantitative || evidence.get(id)!.chunk.treatment?.kind !== "overview")),
                  )
                ) {
                  throw new FamilyError(400, "citation_required");
                }
              }
              for (const id of paragraph.citationIds) {
                if (
                  liveEvidence.has(id) &&
                  (!official || liveEvidence.get(id)!.classification === "official_guidance")
                ) {
                  continue;
                }
                const item = evidence.get(id);
                if (!item || (official && item.chunk.classification !== "official_guidance")) {
                  throw new FamilyError(400, "invalid_citation");
                }
              }
            }
          }

          const tools: AgentTool[] = [];

          if (retrieval || liveReader) {
            tools.push({
              name: "search_knowledge",
              description:
                AGENT_KNOWLEDGE_TOOL_DESCRIPTIONS.search_knowledge +
                (liveReader
                  ? ` 如需即時查原文，可用 acquisition=live，classification 限 ${liveReader.classifications.join("、")}。`
                  : "") +
                " 臨時聊天不載入任何孩子資料，僅搜尋公共知識庫／公共來源。",
              parameters: z
                .object({
                  query: shortText(300),
                  classification: z.enum(["official_guidance", "recent_information"]),
                  ...(liveReader ? { acquisition: z.enum(["library", "live"]).optional() } : {}),
                  ageMonths: publicAgeRangeSchema.optional(),
                })
                .strict(),
              authorize: permitted,
              execute: (args, ctx) =>
                guard(async () => {
                  const query = assertPublicKnowledgeQuery(args.query as string);
                  if (args.acquisition === "live") {
                    const classification = args.classification as KnowledgeFilter["classification"];
                    if (!liveReader || !liveReader.classifications.includes(classification)) {
                      throw new FamilyError(400, "live_source_unavailable");
                    }
                    const found = await budget.wait(() =>
                      liveReader.search(query, budget.signal, classification),
                    );
                    const sources: LiveSourceCitation[] = [];
                    for (const read of found.slice(0, 6)) {
                      if (read.classification !== classification) continue;
                      const snapshot = snapshotLiveRead(read);
                      if (!(await budget.wait(() => liveReader.mayUse(snapshot, budget.signal)))) {
                        continue;
                      }
                      if (options.publishedLiveSeries) {
                        const series = await budget.wait(() =>
                          options.publishedLiveSeries!(read.documentId, read.url),
                        );
                        if (series) snapshot.series = series;
                        else delete snapshot.series;
                      }
                      if (JSON.stringify([...sources, snapshot]).length > budget.toolResponseCharacters - 512) {
                        break;
                      }
                      sources.push(snapshot);
                      if (snapshot.excerpt) {
                        liveEvidence.set(snapshot.id, snapshot);
                        selectedEvidence.set(snapshot.id, {
                          citationId: snapshot.id,
                          version: snapshot.contentHash,
                          contentHash: snapshot.contentHash,
                          classification: snapshot.classification,
                          excerpt: snapshot.excerpt,
                          excerptComplete: false,
                        });
                      }
                    }
                    if (!(await authorize())) throw new AgentStopped("unauthorized");
                    if (sources.length) deliveryReview?.require("review");
                    return { acquisition: "live", classification, sources };
                  }

                  if (!retrieval) throw new FamilyError(400, "knowledge_unavailable");
                  const base = baseAgentKnowledgeFilter({ profileApplicable: false });
                  const ageRange = args.ageMonths as z.infer<typeof publicAgeRangeSchema> | undefined;
                  const filter = parseKnowledgeFilter({
                    ...base,
                    classification: args.classification as KnowledgeFilter["classification"],
                    ...(ageRange
                      ? {
                          age: {
                            basis: ageRange.basis,
                            minMonths: ageRange.minMonths,
                            maxMonths: ageRange.maxMonths,
                          },
                          ageMatch: "overlap" as const,
                        }
                      : {}),
                  });
                  const result = {
                    ...(await retrieval.search(query, filter, ctx.queryEmbeddingAttemptKey)),
                    complete: true,
                    omittedChunks: 0,
                    returned: 0,
                    hasMore: false,
                  };
                  result.returned = result.chunks.length;
                  if (result.mode === "keyword_degraded" || mode === "not_used") {
                    mode = result.mode;
                  }
                  const allowance = Math.max(0, budget.toolResponseCharacters - 512);
                  while (
                    result.chunks.length &&
                    JSON.stringify({ status: "succeeded", data: { result } }).length > allowance
                  ) {
                    result.chunks.pop();
                    result.omittedChunks++;
                    result.complete = false;
                    result.hasMore = true;
                    result.returned = result.chunks.length;
                  }
                  if (JSON.stringify({ status: "succeeded", data: { result } }).length > allowance) {
                    throw new FamilyError(400, "knowledge_context_input_limit");
                  }
                  for (const chunk of result.chunks) evidence.set(chunk.chunkId, { chunk, filter });
                  if (result.chunks.length > 0) deliveryReview?.require("review");
                  return result;
                }),
            });
          }

          if (retrieval) {
            tools.push({
              name: "read_knowledge_context",
              effect: "read",
              description: AGENT_KNOWLEDGE_TOOL_DESCRIPTIONS.read_knowledge_context,
              parameters: z
                .object({
                  anchorChunkId: z.uuid(),
                  cursor: z
                    .object({
                      versionId: z.uuid(),
                      anchorChunkId: z.uuid(),
                      afterKey: z.string().max(80).nullable(),
                      chunkId: z.uuid().nullable(),
                      offset: z.number().int().min(0).max(4000),
                    })
                    .strict()
                    .nullable()
                    .optional(),
                })
                .strict(),
              authorize: permitted,
              execute: args =>
                guard(async () => {
                  const anchor = evidence.get(args.anchorChunkId as string);
                  if (!anchor) throw new FamilyError(400, "invalid_citation");
                  const result = await retrieval.readContext(
                    anchor.chunk,
                    anchor.filter,
                    (args.cursor as KnowledgeContextCursor | null) ?? null,
                    Math.max(0, budget.toolResponseCharacters - 512),
                  );
                  for (const chunk of result.chunks) {
                    evidence.set(chunk.chunkId, {
                      chunk: accumulateKnowledgeRead(evidence.get(chunk.chunkId)?.chunk, chunk),
                      filter: anchor.filter,
                    });
                  }
                  if (result.chunks.length > 0) deliveryReview?.require("review");
                  return result;
                }),
            });
          }

          tools.push({
            name: "show_official_help",
            effect: "read",
            description:
              "按本次語義顯示固定官方提示：即時危險用 emergency-hk-v1；診斷或用藥判斷用 medical-consult-hk-v1。fixedOfficialCard 只是畫面卡 ID，切勿填入 citationIds。"
              + ` 若無適用官方片段，下一輪用 present_answer({ kind: "clarification", paragraphs: [{ text: "${EMERGENCY_REDIRECT_TEXT}", citationIds: [] }] })。`,
            parameters: z.object({ card: officialHelpIdSchema }).strict(),
            authorize: permitted,
            execute: args =>
              guard(async () => {
                const card = officialHelpIdSchema.parse(args.card);
                selectedOfficialHelp.add(card);
                return {
                  selected: true,
                  fixedOfficialCard: card,
                  note:
                    card === "emergency-hk-v1"
                      ? `若無適用官方片段，請用 present_answer({ kind: "clarification", paragraphs: [{ text: "${EMERGENCY_REDIRECT_TEXT}", citationIds: [] }] })。`
                      : "此 ID 只用於畫面顯示固定就醫卡，切勿放進 citationIds。",
                };
              }),
          });

          tools.push({
            name: "present_answer",
            description:
              "提交臨時聊天回覆文字（不可與其他工具同輪呼叫）。kind 僅限 public_information、caregiving、safety_help、clarification 或 mixed。"
              + " caregiving／safety_help 須引用本次 search_knowledge 取得的 official_guidance ID；限制說明或無法保存提示用 kind=clarification、citationIds=[]。",
            parameters: tempAnswerSchema,
            authorize: permitted,
            terminal: true,
            execute: args =>
              guard(async () => {
                const parsed = tempAnswerSchema.parse(args);
                validatePresentation(parsed);
                answer = parsed;
                return { acceptedForValidation: true };
              }),
          });

          const surface: ChatDeliverySurface = {
            async presentation(): Promise<AgentPresentation | null> {
              if (!answer) return null;
              const ids = [...new Set(answer.paragraphs.flatMap(p => p.citationIds))];
              const liveCitations = ids.flatMap(id =>
                liveEvidence.has(id) ? [liveEvidence.get(id)!] : [],
              );
              for (const citation of liveCitations) {
                if (!liveReader || !(await budget.wait(() => liveReader.mayUse(citation, budget.signal)))) {
                  throw new AgentStopped("unauthorized");
                }
              }
              const citations = ids
                .filter(id => evidence.has(id))
                .map(id => evidence.get(id)!);
              if (citations.length > 0 && retrieval) {
                for (const { chunk, filter } of citations) {
                  if (!(await retrieval.revalidateCitations([chunk], filter))) {
                    throw new AgentStopped("invalid_response");
                  }
                }
              }
              if (!(await authorize())) throw new AgentStopped("unauthorized");

              function citationLabel(id: string): string {
                const liveIdx = liveCitations.findIndex(item => item.id === id);
                if (liveIdx >= 0) return `[${citations.length + liveIdx + 1}]`;
                return `[${citations.findIndex(item => item.chunk.chunkId === id) + 1}]`;
              }

              const renderedText = answer.paragraphs
                .map(paragraph =>
                  paragraph.citationIds.length
                    ? `${paragraph.text} ${paragraph.citationIds.map(citationLabel).join("")}`
                    : paragraph.text,
                )
                .join("\n\n");

              return {
                text: renderedText,
                citations: citations.map(item => item.chunk),
                ...(liveCitations.length ? { liveCitations } : {}),
                retrievalMode: mode,
              };
            },
            deliveryDraft(): ChatDeliveryDraft | null {
              if (!answer) return null;
              return buildCandidateDraft(answer);
            },
            replaceDeliveryAnswer(next: AgentAnswer) {
              const parsed = tempAnswerSchema.parse(next);
              validatePresentation(parsed);
              answer = parsed;
            },
          };

          return { tools, surface };
        };

        let surface: ChatDeliverySurface | undefined;
        const runResult = await runtime.run({
          scope,
          runId,
          deadlineAtMs,
          deadlineMs: Math.max(1, Math.min(AGENT_LIMITS.deadlineMs, resolved.runLimits?.deadlineMs ?? AGENT_LIMITS.deadlineMs)),
          trigger: { kind: "interactive", reference: `temporary:${sessionId}` },
          recipeId: "knowledge-answer",
          availableInputs: ["run", "scope", "conversation", "evidence", "capabilities"],
          readPolicyTransition: resolved.readPolicyTransition,
          roleSoftBudgetRatios: resolved.roleSoftBudgetRatios,
          softBudgetSource: resolved.softBudgetSource,
          messages: [
            ...turn.priorMessages.map(message => ({ role: message.role, text: message.text })),
            { role: "user", text },
          ],
          context: {
            temporaryChatMode: true,
            instructionPolicy: TEMPORARY_CHAT_INSTRUCTION_POLICY,
          },
          tools: ctx => {
            const built = buildTools(ctx);
            surface = built.surface;
            return built.tools;
          },
          authorize,
          signal: combinedSignal,
          finalizeOnModelLimit: true,
          presentationRepair: "present_answer",
          finalize: async (innerResult, runContext, reason) => {
            if (!surface) throw new AgentStopped("delivery_review_incomplete");
            const current = await surface.presentation();
            if (!current) {
              if (
                reason === "model_limit" &&
                runContext.deliveryReview?.required &&
                runContext.budget.remainingModelCalls <= 1
              ) {
                throw new AgentStopped("delivery_review_budget");
              }
              throw new AgentStopped("delivery_review_incomplete");
            }
            const reviewed = await enforceChatDeliveryReview({
              presentation: current,
              tools: surface,
              context: runContext,
              provenance: innerResult.provenance ?? null,
            });
            finalPresentation = reviewed.presentation;
            return reviewed.presentation.text;
          },
        });

        if (!turn.isStillValid()) {
          const reason =
            turn.abortController.signal.reason instanceof Error
              ? turn.abortController.signal.reason.message
              : "";
          throw new TemporaryChatError(
            410,
            reason === "temporary_session_expired"
              ? "temporary_session_expired"
              : "temporary_session_closed",
          );
        }

        if (runResult.status !== "completed" || !runResult.text?.trim()) {
          if (runResult.stopReason === "quota_exceeded") {
            throw new TemporaryChatError(429, "ai_quota_exceeded");
          }
          if (runResult.stopReason === "unauthorized") {
            throw new TemporaryChatError(401, "unauthorized");
          }
          throw new TemporaryChatError(503, "ai_unavailable");
        }

        const completedAt = new Date(clock()).toISOString();
        const citations = mapCitationsForTemporaryMessage(finalPresentation);
        const helpCards = [...new Set<TemporaryChatHelpCardId>([...selectedOfficialHelp, ...matchOfficialHelpForText(text)])];

        const userMessage: TemporaryChatMessage = {
          id: randomUUID(),
          role: "user",
          text,
          createdAt: completedAt,
        };
        const modelMessage: TemporaryChatMessage = {
          id: randomUUID(),
          role: "model",
          text: runResult.text,
          createdAt: completedAt,
          ...(citations.length ? { citations } : {}),
          ...(helpCards.length ? { helpCards } : {}),
        };

        const committed = options.store.commitTurn(
          userId,
          sessionId,
          turn.requestId,
          generation,
          userMessage,
          modelMessage,
        );
        committedOrAborted = true;
        if (!committed.committed) {
          throw new TemporaryChatError(
            410,
            committed.reason === "expired"
              ? "temporary_session_expired"
              : "temporary_session_closed",
          );
        }

        return {
          session: committed.session,
          userMessage: committed.userMessage,
          modelMessage: committed.modelMessage,
        };
      } finally {
        if (!committedOrAborted) {
          options.store.abortTurn(userId, sessionId, turn.requestId);
        }
      }
    },
  };
}

export function createTemporaryChatService(options: TemporaryChatAgentOptions): TemporaryChatService {
  const agent = createTemporaryChatAgent(options);
  return {
    createSession: userId => options.store.create(userId),
    sendTurn: agent.sendTurn,
    closeSession: (userId, sessionId, reason) => options.store.close(userId, sessionId, reason),
    closeAllForUser: (userId, reason) => options.store.closeAllForUser(userId, reason),
  };
}
