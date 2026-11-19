import { createHash } from "node:crypto";
import type { MemoryContext, MemoryFact } from "../src/shared/memory.ts";
import type { AgentScope } from "./agent-runtime.ts";
import { isPureGreetingOrSmallTalk } from "./chat-delivery-review.ts";
import type { ConcernStore } from "./concern-store.ts";
import type { GrowthStore } from "./growth-store.ts";
import { profileKnowledgeAge } from "./knowledge-query-context.ts";
import { knowledgeTokens } from "./knowledge-ranking.ts";
import { factIsApplicable } from "./memory-policy.ts";
import type { MemoryStore } from "./memory.ts";
import type { TaskStore } from "./tasks.ts";

export type ContextSectionStatus =
  | "provided"
  | "not_loaded"
  | "empty_authorized"
  | "read_failed"
  | "invalidated"
  | "omitted_for_capacity";

export type TurnConversationMode = "assistant" | "chat_only" | "ephemeral";

export interface TurnBackgroundSectionMeta {
  readonly status: ContextSectionStatus;
  readonly itemCount: number;
  readonly omittedCount: number;
  readonly reasonCode: string;
  readonly versionRef?: string | null;
  readonly nextCursor?: string | null;
}

export interface TurnRelevantFactItem {
  readonly id: string;
  readonly version: number;
  readonly key: string;
  readonly content: string;
  readonly validUntil: string | null;
  readonly matchReason: "safety_constraint" | "query_relevant";
}

export interface TurnBackgroundAssembly {
  readonly assemblyVersion: "req008-turn-bg-v1";
  readonly mode: TurnConversationMode;
  readonly scopeBinding: {
    readonly userId: string;
    readonly childId: string;
    readonly authorizationVersion: string;
    readonly dataVersion: string;
  };
  readonly childProfile: {
    readonly status: ContextSectionStatus;
    readonly version: number | null;
    readonly agePrecision: "birth_date" | "approximate" | "unknown" | null;
    readonly ageMonthsMin: number | null;
    readonly ageMonthsMax: number | null;
    readonly region: string | null;
    readonly truncated: boolean;
    readonly reasonCode: string;
  };
  readonly relevantFacts: {
    readonly status: ContextSectionStatus;
    readonly items: readonly TurnRelevantFactItem[];
    readonly omittedCount: number;
    readonly truncated: boolean;
    readonly nextAfterId: string | null;
    readonly reasonCode: string;
  };
  readonly activeFocus: {
    readonly status: ContextSectionStatus;
    readonly growthItems: readonly { id: string; topicId: string; state: string; sourceAvailable: boolean }[];
    readonly disabledGrowthTopics: readonly string[];
    readonly openConcerns: readonly { id: string; title: string; status: string }[];
    readonly omittedCount: number;
    readonly reasonCode: string;
  };
  readonly tasks: {
    readonly status: ContextSectionStatus;
    readonly items: readonly { id: string; title: string; dueAt: string; status: string }[];
    readonly omittedCount: number;
    readonly nextAfterId: string | null;
    readonly reasonCode: string;
  };
  readonly assemblyMetadata: {
    readonly assemblyVersion: "req008-turn-bg-v1";
    readonly mode: TurnConversationMode;
    readonly scopeFingerprint: string;
    readonly sections: Readonly<Record<"childProfile" | "relevantFacts" | "activeFocus" | "tasks", TurnBackgroundSectionMeta>>;
  };
}

export interface AssembleTurnBackgroundOptions {
  readonly scope: Readonly<AgentScope>;
  readonly mode: TurnConversationMode;
  readonly visibility?: "private" | "family";
  readonly userText: string;
  readonly isPureGreeting?: boolean;
  readonly memory?: Pick<MemoryStore, "context">;
  readonly growth?: Pick<GrowthStore, "list">;
  readonly concerns?: Pick<ConcernStore, "list">;
  readonly tasks?: Pick<TaskStore, "list">;
  readonly includeTasks?: boolean;
  readonly allowTaskPreload?: boolean;
  readonly maxFactItems?: number;
  readonly maxFactChars?: number;
  readonly maxFocusItems?: number;
  readonly maxTaskItems?: number;
  readonly now?: Date;
  readonly authorize: () => Promise<boolean>;
}

const SAFETY_CONSTRAINT_PATTERN = /(?:過敏|敏感|忌口|allergy|intolerance|哮喘|asthma|蠶豆|g6pd|早產|preterm|慢性|epilepsy|抽搐|心臟|用藥禁忌)/iu;
const TASK_MENTION_PATTERN = /(?:待辦|提醒|日程|安排|預約|任務|覆診|行程|\b(?:tasks?|reminders?|appointments?|schedules?)\b)/iu;

function computeScopeFingerprint(
  binding: TurnBackgroundAssembly["scopeBinding"],
  mode: TurnConversationMode,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      userId: binding.userId,
      childId: binding.childId,
      authorizationVersion: binding.authorizationVersion,
      dataVersion: binding.dataVersion,
      mode,
    }))
    .digest("hex");
}

export function needsPersonalizedTurnBackground(userText: string): boolean {
  const trimmed = userText.trim();
  if (!trimmed) return false;
  return !isPureGreetingOrSmallTalk(trimmed);
}

export function queryMentionsTasks(userText: string): boolean {
  return TASK_MENTION_PATTERN.test(userText.normalize("NFKC"));
}

function emptyAssembly(
  binding: TurnBackgroundAssembly["scopeBinding"],
  mode: TurnConversationMode,
  status: ContextSectionStatus,
  reasonCode: string,
): TurnBackgroundAssembly {
  const scopeFingerprint = computeScopeFingerprint(binding, mode);
  const meta: TurnBackgroundSectionMeta = {
    status,
    itemCount: 0,
    omittedCount: 0,
    reasonCode,
    versionRef: null,
    nextCursor: null,
  };
  return {
    assemblyVersion: "req008-turn-bg-v1",
    mode,
    scopeBinding: binding,
    childProfile: {
      status,
      version: null,
      agePrecision: null,
      ageMonthsMin: null,
      ageMonthsMax: null,
      region: null,
      truncated: false,
      reasonCode,
    },
    relevantFacts: {
      status,
      items: [],
      omittedCount: 0,
      truncated: false,
      nextAfterId: null,
      reasonCode,
    },
    activeFocus: {
      status,
      growthItems: [],
      disabledGrowthTopics: [],
      openConcerns: [],
      omittedCount: 0,
      reasonCode,
    },
    tasks: {
      status,
      items: [],
      omittedCount: 0,
      nextAfterId: null,
      reasonCode,
    },
    assemblyMetadata: {
      assemblyVersion: "req008-turn-bg-v1",
      mode,
      scopeFingerprint,
      sections: {
        childProfile: { ...meta },
        relevantFacts: { ...meta },
        activeFocus: { ...meta },
        tasks: { ...meta },
      },
    },
  };
}

function factMatchReason(fact: MemoryFact, queryTokens: ReadonlySet<string>): "safety_constraint" | "query_relevant" | null {
  const combined = `${fact.key} ${fact.content}`;
  if (SAFETY_CONSTRAINT_PATTERN.test(combined)) return "safety_constraint";
  if (queryTokens.size > 0) {
    const factTokens = knowledgeTokens(combined, false);
    for (const token of queryTokens) {
      if (factTokens.has(token)) return "query_relevant";
    }
  }
  return null;
}

/**
 * Assembles the minimal server-authorized turn background along existing stratified contracts (REQ-008 §1.1):
 * skips private stores on pure greetings and ephemeral sessions, degrades read failures explicitly instead of
 * conflating missing vs failed vs empty, and keeps telemetry strictly metadata-only.
 */
export async function assembleTurnBackground(options: AssembleTurnBackgroundOptions): Promise<TurnBackgroundAssembly> {
  const binding: TurnBackgroundAssembly["scopeBinding"] = {
    userId: options.scope.userId,
    childId: options.scope.childId,
    authorizationVersion: options.scope.authorizationVersion,
    dataVersion: options.scope.dataVersion,
  };
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const visibility = options.visibility ?? "private";

  if (options.mode === "ephemeral") {
    return emptyAssembly(binding, options.mode, "not_loaded", "ephemeral_blank_scope");
  }
  const greetingShortPath = Boolean(
    options.isPureGreeting || (options.userText.trim() && isPureGreetingOrSmallTalk(options.userText.trim())),
  );
  if (greetingShortPath || !needsPersonalizedTurnBackground(options.userText)) {
    return emptyAssembly(binding, options.mode, "not_loaded", greetingShortPath ? "short_path_greeting" : "no_background_needed");
  }
  if (!await options.authorize()) {
    return emptyAssembly(binding, options.mode, "invalidated", "authorization_revoked");
  }

  const maxFactItems = Math.max(1, Math.min(8, options.maxFactItems ?? 5));
  const maxFactChars = Math.max(100, Math.min(4000, options.maxFactChars ?? 1200));
  const maxFocusItems = Math.max(1, Math.min(8, options.maxFocusItems ?? 4));
  const maxTaskItems = Math.max(1, Math.min(8, options.maxTaskItems ?? 4));
  const queryTokens = knowledgeTokens(options.userText, true);

  let childProfile: TurnBackgroundAssembly["childProfile"] = {
    status: "not_loaded",
    version: null,
    agePrecision: null,
    ageMonthsMin: null,
    ageMonthsMax: null,
    region: null,
    truncated: false,
    reasonCode: "memory_store_unavailable",
  };
  let relevantFacts: TurnBackgroundAssembly["relevantFacts"] = {
    status: "not_loaded",
    items: [],
    omittedCount: 0,
    truncated: false,
    nextAfterId: null,
    reasonCode: "memory_store_unavailable",
  };

  if (options.memory && typeof options.memory.context === "function") {
    let memContext: MemoryContext | null = null;
    let memFailed = false;
    try {
      memContext = await options.memory.context(binding.userId, binding.childId, visibility, {});
    } catch {
      memFailed = true;
    }

    if (memFailed) {
      childProfile = { ...childProfile, status: "read_failed", reasonCode: "memory_context_unavailable" };
      relevantFacts = { ...relevantFacts, status: "read_failed", reasonCode: "memory_context_unavailable" };
    } else if (!memContext || !await options.authorize()) {
      return emptyAssembly(binding, options.mode, "invalidated", "authorization_revoked");
    } else {
      if (!memContext.profileApplicable || !memContext.profile?.data) {
        childProfile = {
          status: "empty_authorized",
          version: memContext.profile?.version ?? null,
          agePrecision: "unknown",
          ageMonthsMin: null,
          ageMonthsMax: null,
          region: memContext.profile?.data?.region ?? null,
          truncated: false,
          reasonCode: memContext.profile?.data ? "profile_not_applicable" : "profile_not_recorded",
        };
      } else {
        const ageInfo = profileKnowledgeAge(memContext, now);
        const agePrecision = ageInfo.precision === "confirmed" ? "birth_date"
          : ageInfo.precision === "approximate" ? "approximate" : "unknown";
        childProfile = {
          status: "provided",
          version: memContext.profile.version,
          agePrecision,
          ageMonthsMin: ageInfo.age ? Math.floor(ageInfo.age.minMonths * 10) / 10 : null,
          ageMonthsMax: ageInfo.age ? Math.floor(ageInfo.age.maxMonths * 10) / 10 : null,
          region: memContext.profile.data.region ?? null,
          truncated: false,
          reasonCode: "authorized_profile",
        };
      }

      const matchedSafety: TurnRelevantFactItem[] = [];
      const matchedQuery: TurnRelevantFactItem[] = [];
      for (const fact of memContext.facts) {
        if (fact.childId !== binding.childId || !fact.applicable || !factIsApplicable(fact, nowMs)) continue;
        if (visibility === "family" && fact.visibility !== "family") continue;
        const reason = factMatchReason(fact, queryTokens);
        if (!reason) continue;
        const entry: TurnRelevantFactItem = {
          id: fact.id,
          version: fact.version,
          key: fact.key,
          content: fact.content,
          validUntil: fact.validUntil,
          matchReason: reason,
        };
        if (reason === "safety_constraint") matchedSafety.push(entry);
        else matchedQuery.push(entry);
      }

      const ordered = [...matchedSafety, ...matchedQuery];
      const selected: TurnRelevantFactItem[] = [];
      let usedChars = 0;
      for (const item of ordered) {
        if (selected.length >= maxFactItems) break;
        const itemCost = item.key.length + item.content.length;
        if (selected.length > 0 && usedChars + itemCost > maxFactChars) break;
        if (itemCost > maxFactChars && selected.length === 0) break;
        selected.push(item);
        usedChars += itemCost;
      }

      const totalLoadedFacts = memContext.facts.length;
      const omittedCount = Math.max(0, totalLoadedFacts - selected.length);
      const nextAfterId = memContext.nextFactsAfterId ?? null;
      if (selected.length > 0) {
        relevantFacts = {
          status: "provided",
          items: selected,
          omittedCount,
          truncated: omittedCount > 0 || memContext.truncated.facts,
          nextAfterId,
          reasonCode: omittedCount > 0 || memContext.truncated.facts ? "selected_relevant_subset" : "all_relevant_selected",
        };
      } else if (ordered.length > 0 || totalLoadedFacts > 0) {
        relevantFacts = {
          status: "omitted_for_capacity",
          items: [],
          omittedCount: totalLoadedFacts,
          truncated: true,
          nextAfterId,
          reasonCode: ordered.length > 0 ? "fact_capacity_limit" : "non_matching_or_unloaded_facts",
        };
      } else if (memContext.truncated.facts) {
        relevantFacts = {
          status: "not_loaded",
          items: [],
          omittedCount: 0,
          truncated: true,
          nextAfterId,
          reasonCode: "facts_truncated_upstream",
        };
      } else {
        relevantFacts = {
          status: "empty_authorized",
          items: [],
          omittedCount: 0,
          truncated: false,
          nextAfterId: null,
          reasonCode: "no_confirmed_facts",
        };
      }
    }
  }

  let activeFocus: TurnBackgroundAssembly["activeFocus"] = {
    status: "not_loaded",
    growthItems: [],
    disabledGrowthTopics: [],
    openConcerns: [],
    omittedCount: 0,
    reasonCode: "focus_stores_unavailable",
  };

  const hasGrowthReader = typeof options.growth?.list === "function";
  const hasConcernReader = typeof options.concerns?.list === "function";
  if (hasGrowthReader || hasConcernReader) {
    let focusFailed = false;
    const growthItemsAll: { id: string; topicId: string; state: string; sourceAvailable: boolean }[] = [];
    const disabledGrowthTopics: string[] = [];
    const openConcernsAll: { id: string; title: string; status: string }[] = [];

    if (hasGrowthReader) {
      try {
        const page = await options.growth!.list(binding.userId, binding.childId);
        if (!page) focusFailed = true;
        else {
          for (const topic of page.topics) {
            if (topic.disabled) disabledGrowthTopics.push(topic.id);
          }
          const disabledSet = new Set(disabledGrowthTopics);
          for (const item of page.items) {
            if (disabledSet.has(item.topicId)) continue;
            const snoozeExpired = item.state === "snoozed" && item.snoozeUntil !== null && Date.parse(item.snoozeUntil) <= nowMs;
            if (item.state === "proposed" || snoozeExpired) {
              growthItemsAll.push({
                id: item.id,
                topicId: item.topicId,
                state: item.state,
                sourceAvailable: item.sourceAvailable,
              });
            }
          }
        }
      } catch {
        focusFailed = true;
      }
    }

    if (hasConcernReader) {
      try {
        const page = await options.concerns!.list(binding.userId, binding.childId);
        if (!page) focusFailed = true;
        else {
          for (const concern of page.items) {
            if (concern.status === "following") {
              openConcernsAll.push({
                id: concern.id,
                title: concern.title,
                status: concern.status,
              });
            }
          }
        }
      } catch {
        focusFailed = true;
      }
    }

    const growthSlice = growthItemsAll.slice(0, maxFocusItems);
    const remainingSlots = Math.max(0, maxFocusItems - growthSlice.length);
    const concernSlice = openConcernsAll.slice(0, remainingSlots);
    const totalFocus = growthItemsAll.length + openConcernsAll.length;
    const shownFocus = growthSlice.length + concernSlice.length;
    const omittedFocus = Math.max(0, totalFocus - shownFocus);

    if (focusFailed && shownFocus === 0) {
      activeFocus = {
        status: "read_failed",
        growthItems: [],
        disabledGrowthTopics,
        openConcerns: [],
        omittedCount: 0,
        reasonCode: "focus_store_read_failed",
      };
    } else if (shownFocus > 0) {
      activeFocus = {
        status: "provided",
        growthItems: growthSlice,
        disabledGrowthTopics,
        openConcerns: concernSlice,
        omittedCount: omittedFocus,
        reasonCode: focusFailed ? "partial_focus_read_failed"
          : omittedFocus > 0 ? "active_focus_capped" : "active_focus_loaded",
      };
    } else {
      activeFocus = {
        status: "empty_authorized",
        growthItems: [],
        disabledGrowthTopics,
        openConcerns: [],
        omittedCount: 0,
        reasonCode: "no_active_focus",
      };
    }
  }

  const hasTaskReader = typeof options.tasks?.list === "function";
  let tasks: TurnBackgroundAssembly["tasks"] = {
    status: "not_loaded",
    items: [],
    omittedCount: 0,
    nextAfterId: null,
    reasonCode: hasTaskReader ? "deferred_to_read_context" : "tasks_store_unavailable",
  };
  const shouldPreloadTasks = Boolean(
    hasTaskReader && (options.includeTasks === true || (options.allowTaskPreload === true && queryMentionsTasks(options.userText))),
  );
  if (shouldPreloadTasks && hasTaskReader) {
    try {
      const page = await options.tasks!.list(binding.userId, binding.childId);
      if (!page || !await options.authorize()) {
        return emptyAssembly(binding, options.mode, "invalidated", "authorization_revoked");
      }
      const scheduled = page.items.filter(item => item.occurrence.state === "scheduled" || item.occurrence.state === "needs_review");
      const sliced = scheduled.slice(0, maxTaskItems).map(item => ({
        id: item.id,
        title: item.title,
        dueAt: item.occurrence.dueAt,
        status: item.occurrence.state,
      }));
      const omitted = Math.max(0, page.items.length - sliced.length);
      tasks = {
        status: sliced.length > 0 ? "provided" : "empty_authorized",
        items: sliced,
        omittedCount: omitted,
        nextAfterId: page.nextAfterId,
        reasonCode: sliced.length > 0 ? (omitted > 0 || page.nextAfterId ? "scheduled_tasks_subset" : "scheduled_tasks_loaded") : "no_open_tasks",
      };
    } catch {
      tasks = {
        status: "read_failed",
        items: [],
        omittedCount: 0,
        nextAfterId: null,
        reasonCode: "tasks_read_failed",
      };
    }
  }

  const scopeFingerprint = computeScopeFingerprint(binding, options.mode);
  const focusCount = activeFocus.growthItems.length + activeFocus.openConcerns.length;
  return {
    assemblyVersion: "req008-turn-bg-v1",
    mode: options.mode,
    scopeBinding: binding,
    childProfile,
    relevantFacts,
    activeFocus,
    tasks,
    assemblyMetadata: {
      assemblyVersion: "req008-turn-bg-v1",
      mode: options.mode,
      scopeFingerprint,
      sections: {
        childProfile: {
          status: childProfile.status,
          itemCount: childProfile.status === "provided" ? 1 : 0,
          omittedCount: 0,
          reasonCode: childProfile.reasonCode,
          versionRef: childProfile.version !== null ? String(childProfile.version) : null,
          nextCursor: null,
        },
        relevantFacts: {
          status: relevantFacts.status,
          itemCount: relevantFacts.items.length,
          omittedCount: relevantFacts.omittedCount,
          reasonCode: relevantFacts.reasonCode,
          versionRef: relevantFacts.items.length ? relevantFacts.items.map(f => `${f.id}@v${f.version}`).join(",") : null,
          nextCursor: relevantFacts.nextAfterId,
        },
        activeFocus: {
          status: activeFocus.status,
          itemCount: focusCount,
          omittedCount: activeFocus.omittedCount,
          reasonCode: activeFocus.reasonCode,
          versionRef: null,
          nextCursor: null,
        },
        tasks: {
          status: tasks.status,
          itemCount: tasks.items.length,
          omittedCount: tasks.omittedCount,
          reasonCode: tasks.reasonCode,
          versionRef: null,
          nextCursor: tasks.nextAfterId,
        },
      },
    },
  };
}

/** Projects a bounded, deduplicated background snapshot into the agent runtime context. */
export function formatTurnBackgroundForPrompt(assembly: TurnBackgroundAssembly): Record<string, unknown> {
  const sections = [
    assembly.childProfile.status,
    assembly.relevantFacts.status,
    assembly.activeFocus.status,
    assembly.tasks.status,
  ];
  const reasons = [
    assembly.childProfile.reasonCode,
    assembly.relevantFacts.reasonCode,
    assembly.activeFocus.reasonCode,
    assembly.tasks.reasonCode,
  ];
  if (sections.every(s => s === "not_loaded") && reasons.every(r => r === reasons[0])) {
    return {
      assemblyVersion: assembly.assemblyVersion,
      mode: assembly.mode,
      status: "not_loaded",
      reasonCode: reasons[0],
    };
  }
  return {
    assemblyVersion: assembly.assemblyVersion,
    mode: assembly.mode,
    scopeFingerprint: assembly.assemblyMetadata.scopeFingerprint,
    childProfile: assembly.childProfile,
    relevantFacts: assembly.relevantFacts,
    activeFocus: assembly.activeFocus,
    tasks: assembly.tasks,
  };
}

/**
 * Revalidates a previously assembled turn background snapshot against the current scope/mode;
 * any child switch, authorization revocation, data-version mutation, or mode switch invalidates
 * previously loaded private sections so stale snapshots are never carried forward.
 */
export function revalidateTurnBackground(
  snapshot: TurnBackgroundAssembly,
  currentScope: {
    readonly userId: string;
    readonly childId: string;
    readonly authorizationVersion: string;
    readonly dataVersion: string;
    readonly mode?: TurnConversationMode;
  },
): TurnBackgroundAssembly {
  const nextMode = currentScope.mode ?? snapshot.mode;
  const reasonCode =
    snapshot.scopeBinding.childId !== currentScope.childId ? "child_switched"
      : snapshot.scopeBinding.userId !== currentScope.userId
        || snapshot.scopeBinding.authorizationVersion !== currentScope.authorizationVersion ? "authorization_changed"
        : nextMode !== snapshot.mode ? "mode_changed"
          : snapshot.scopeBinding.dataVersion !== currentScope.dataVersion ? "data_version_changed"
            : null;
  if (!reasonCode) return snapshot;

  const binding: TurnBackgroundAssembly["scopeBinding"] = {
    userId: currentScope.userId,
    childId: currentScope.childId,
    authorizationVersion: currentScope.authorizationVersion,
    dataVersion: currentScope.dataVersion,
  };
  const scrubStatus = (prior: ContextSectionStatus): ContextSectionStatus =>
    prior === "provided" || prior === "omitted_for_capacity" || prior === "invalidated" ? "invalidated" : prior;
  const nextChildStatus = scrubStatus(snapshot.childProfile.status);
  const nextFactsStatus = scrubStatus(snapshot.relevantFacts.status);
  const nextFocusStatus = scrubStatus(snapshot.activeFocus.status);
  const nextTasksStatus = scrubStatus(snapshot.tasks.status);
  const nextReason = (s: ContextSectionStatus, old: string) => s === "invalidated" ? reasonCode : old;

  return {
    assemblyVersion: "req008-turn-bg-v1",
    mode: nextMode,
    scopeBinding: binding,
    childProfile: {
      status: nextChildStatus,
      version: null,
      agePrecision: null,
      ageMonthsMin: null,
      ageMonthsMax: null,
      region: null,
      truncated: false,
      reasonCode: nextReason(nextChildStatus, snapshot.childProfile.reasonCode),
    },
    relevantFacts: {
      status: nextFactsStatus,
      items: [],
      omittedCount: 0,
      truncated: false,
      nextAfterId: null,
      reasonCode: nextReason(nextFactsStatus, snapshot.relevantFacts.reasonCode),
    },
    activeFocus: {
      status: nextFocusStatus,
      growthItems: [],
      disabledGrowthTopics: [],
      openConcerns: [],
      omittedCount: 0,
      reasonCode: nextReason(nextFocusStatus, snapshot.activeFocus.reasonCode),
    },
    tasks: {
      status: nextTasksStatus,
      items: [],
      omittedCount: 0,
      nextAfterId: null,
      reasonCode: nextReason(nextTasksStatus, snapshot.tasks.reasonCode),
    },
    assemblyMetadata: {
      assemblyVersion: "req008-turn-bg-v1",
      mode: nextMode,
      scopeFingerprint: computeScopeFingerprint(binding, nextMode),
      sections: {
        childProfile: {
          status: nextChildStatus,
          itemCount: 0,
          omittedCount: 0,
          reasonCode: nextReason(nextChildStatus, snapshot.childProfile.reasonCode),
          versionRef: null,
          nextCursor: null,
        },
        relevantFacts: {
          status: nextFactsStatus,
          itemCount: 0,
          omittedCount: 0,
          reasonCode: nextReason(nextFactsStatus, snapshot.relevantFacts.reasonCode),
          versionRef: null,
          nextCursor: null,
        },
        activeFocus: {
          status: nextFocusStatus,
          itemCount: 0,
          omittedCount: 0,
          reasonCode: nextReason(nextFocusStatus, snapshot.activeFocus.reasonCode),
          versionRef: null,
          nextCursor: null,
        },
        tasks: {
          status: nextTasksStatus,
          itemCount: 0,
          omittedCount: 0,
          reasonCode: nextReason(nextTasksStatus, snapshot.tasks.reasonCode),
          versionRef: null,
          nextCursor: null,
        },
      },
    },
  };
}
