import { z } from "zod";
import { readAgentWorkSchema, saveAgentWorkSchema, historySearchSchema, historyReadSchema, memoryFactReadSchema, requestAgentConfirmationSchema } from "../src/shared/agent-work.ts";
import { agentProposalSchema } from "../src/shared/product-agent.ts";
import { AGENT_WORK_TOOL_DESCRIPTIONS } from "./agent-work-tool-descriptions.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { MemoryStore } from "./memory.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import { AgentStopped } from "./agent-budget.ts";
import { FamilyError } from "./family-access.ts";
import { normalizedFactKey } from "./memory-policy.ts";
export function createAgentWorkTools(store: ProductAgentStore, memory: MemoryStore, run: AgentRunContext, authorize: () => Promise<boolean>): AgentTool[] {
  const { userId, childId } = run.scope;
  const guard = async (fn: () => Promise<unknown>): Promise<AgentToolResult> => {
    try { const value = await fn(); if (value === null) throw new AgentStopped("unauthorized"); return { status: "succeeded", data: { result: value } }; }
    catch (error) {
      if (error instanceof z.ZodError) return { status: "rejected", data: { code: "invalid_input" } };
      if (error instanceof FamilyError) return { status: error.status === 409 ? "conflict" : "rejected", data: { code: error.code } };
      throw error;
    }
  };
  const make = (name: keyof typeof AGENT_WORK_TOOL_DESCRIPTIONS, parameters: z.ZodObject,
    execute: AgentTool["execute"]): AgentTool => ({ name, description: AGENT_WORK_TOOL_DESCRIPTIONS[name], parameters, authorize, execute });
  const revision = agentProposalSchema.options.find(schema => schema.shape.kind.value === "memory_fact_revise")!;
  const deactivation = agentProposalSchema.options.find(schema => schema.shape.kind.value === "memory_fact_deactivate")!;
  const { kind: _revisionKind, ...revisionShape } = revision.shape;
  const { kind: _deactivationKind, ...deactivationShape } = deactivation.shape;
  return [
    make("read_work", readAgentWorkSchema, args => guard(() => store.readWork(userId, childId, readAgentWorkSchema.parse(args)))),
    make("save_work", saveAgentWorkSchema, (args, call) => guard(() => store.saveWork(run.scope, run.runId, call.callId, saveAgentWorkSchema.parse(args)))),
    make("search_history", historySearchSchema, args => guard(() => store.searchHistory(userId, childId, historySearchSchema.parse(args)))),
    make("read_history", historyReadSchema, args => guard(() => store.readHistory(userId, childId, historyReadSchema.parse(args)))),
    make("read_memory_facts", memoryFactReadSchema, args => guard(async () => {
      const input = memoryFactReadSchema.parse(args);
      if (input.factId) return memory.getFact(userId, childId, input.factId);
      const page = await memory.facts(userId, childId, input.afterId ?? undefined, 10);
      if (!page) return null;
      const items: typeof page.items = [];
      for (const item of page.items) {
        if (JSON.stringify({ items: [...items, item] }).length > run.budget.toolResponseCharacters - 900) break;
        items.push(item);
      }
      const more = items.length < page.items.length || page.nextAfterId !== null;
      const keys = new Map<string, Set<string>>();
      for (const fact of items.filter(item => item.applicable)) {
        const key = normalizedFactKey(fact.key), values = keys.get(key) ?? new Set<string>(); values.add(fact.content); keys.set(key, values);
      }
      return { items, nextAfterId: items.length < page.items.length ? items.at(-1)?.id ?? input.afterId : page.nextAfterId, partial: more,
        conflictingKeys: [...keys].filter(([, values]) => values.size > 1).map(([key]) => key),
        unavailableFactKeys: items.filter(item => !item.applicable).map(item => normalizedFactKey(item.key)) };
    })),
    make("propose_fact_revision", z.object(revisionShape).strict(), (args, call) => guard(() =>
      store.propose(run.scope, run.runId, call.callId, agentProposalSchema.parse({ ...args, kind: "memory_fact_revise" })))),
    make("propose_fact_deactivation", z.object(deactivationShape).strict(), (args, call) => guard(() =>
      store.propose(run.scope, run.runId, call.callId, agentProposalSchema.parse({ ...args, kind: "memory_fact_deactivate" })))),
    make("request_confirmation", requestAgentConfirmationSchema, args => guard(() => store.requestConfirmation(run.scope, run.runId, requestAgentConfirmationSchema.parse(args)))),
  ];
}
