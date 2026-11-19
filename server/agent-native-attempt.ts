import type { Context, Event } from "@google/adk";
import type { AgentScope } from "./agent-runtime.ts";
import { AgentStopped, agentBudgetFingerprint } from "./agent-budget.ts";

/** Only acknowledged native events in this exact invocation/branch can anchor a later attempt. */
export function durableSessionEvents(context: Context, scope: Readonly<AgentScope>, runId: string) {
  const invocation = context.invocationContext, session = invocation.session;
  if (session.id !== runId || session.userId !== scope.userId || session.appName !== "yuban_hk") throw new AgentStopped("unavailable");
  return session.events.filter(event => !event.partial && event.invocationId === context.invocationId
    && event.branch === invocation.branch);
}
export function uniqueEvent(context: Context, event: Event) {
  if (!event.id || context.invocationContext.session.events.filter(item => item.id === event.id).length !== 1) throw new AgentStopped("unavailable");
  return event.id;
}
export function queryEmbeddingAttemptKey(context: Context | undefined, scope: Readonly<AgentScope>, runId: string, name: string, args: unknown, callId = context?.functionCallId) {
  if (!context || !callId) throw new AgentStopped("unavailable");
  const matches = durableSessionEvents(context, scope, runId).flatMap(event => (event.content?.parts ?? []).flatMap(part =>
    part.functionCall && part.functionCall.id === callId ? [{ event, call: part.functionCall }] : []));
  if (matches.length !== 1 || matches[0].event.author !== context.agentName || matches[0].call.name !== name
    || agentBudgetFingerprint(matches[0].call.args ?? {}) !== agentBudgetFingerprint(args)) throw new AgentStopped("unavailable");
  return "embedding:" + agentBudgetFingerprint([runId, uniqueEvent(context, matches[0].event), callId, "query-embedding"]);
}
