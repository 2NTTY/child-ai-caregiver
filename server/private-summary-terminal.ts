import { z } from 'zod';
import type { FirestoreRootBudget } from './firestore-root-budget.ts';
import type { FirestoreAiUsage } from './firestore-ai-usage.ts';
import type { FirestoreSessionService } from './firestore-session-service.ts';
import { RootBudgetError } from './durable-root-budget.ts';
import type { SummaryFastNoDispatchVerifier, SummaryTerminalVerifier } from './firestore-private-summary-work.ts';
import type { SummaryRunBinding } from './private-summary-work.ts';
import { agentBudgetFingerprint } from './agent-budget.ts';

// The original private-maintenance terminal ceiling; this is not a new policy allowance.
export const SUMMARY_PART_TEXT_MAX = 1500;
export function privateSummaryMarker(binding: SummaryRunBinding, manifestHash: string) {
  return JSON.stringify({ purpose: 'private_summary_part_marker/v1', binding, manifestHash });
}
export function privateSummaryStageSchema(limit: () => number | null) {
  return z.object({ text: z.string().trim().min(1).max(SUMMARY_PART_TEXT_MAX).superRefine((text, ctx) => {
    const maximum = limit();
    if (maximum === null || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > SUMMARY_PART_TEXT_MAX
      || text.length > maximum || !text.isWellFormed() || text.includes('\0'))
      ctx.addIssue({ code: 'custom', message: 'The original fixed part output limit is required' });
  }) });
}
/** Constructor-only readers from the same trusted database and pinned billing profile. */
export function createPrivateSummaryTerminalVerifier(options: {
  root: FirestoreRootBudget; daily: FirestoreAiUsage; sessions: FirestoreSessionService;
}): SummaryTerminalVerifier {
  return { async verify(b, input) {
    const { attempt, run, modelReservation: model, toolReservation: tool, grantRecord } = input;
    if (attempt.state === 'claimed' && attempt.plan === null && attempt.modelReservationId === null && !model && !tool)
      return { kind: 'no_effect', dispatchOutcome: 'not_dispatched', stopReason: 'unavailable',
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, tools: [], evidenceHash: agentBudgetFingerprint({ attempt, run }) };
    if (!attempt.rootContext || !attempt.plan || !model || model.kind !== 'model'
      || options.daily.billingSource !== grantRecord.grant.billingSource) return { kind: 'unknown' };
    // Adapter integrity errors must propagate, rather than masquerade as recoverable missing evidence.
    const root = await options.root.readInTransaction(attempt.rootContext, b.transaction);
    const daily = await options.daily.readInTransaction(model.originalDailyRequest, b.transaction);
    const session = await options.sessions.readSessionEvidenceInTransaction({ appName: 'yuban_hk', userId: run.ownerUserId, sessionId: run.id }, b.transaction);
    if (root.status !== 'stopped' || root.used.queryEmbeddings !== 0) return { kind: 'unknown' };
    if (root.attempts.length === 0 && !daily && !tool
      && (!session || session.events.every(event => event.author === 'user' && event.content?.role === 'user')))
      return { kind: 'no_effect', dispatchOutcome: 'not_dispatched', stopReason: 'unavailable', counts: root.used, tools: [],
        evidenceHash: agentBudgetFingerprint({ root, daily, session: session ?? null, attempt, model }) };
    if (!daily?.record || daily.record.outcome !== 'succeeded' || !session) return { kind: 'unknown' };
    const events = session.events;
    if (![2, 3].includes(events.length) || events.some(event => event.partial || event.errorCode
      || event.invocationId !== events[0].invocationId || event.branch !== events[0].branch)
      || new Set(events.map(event => event.id)).size !== events.length) return { kind: 'unknown' };
    // The native store sorts equal timestamps by opaque event ID. IDs do not
    // establish causality; this single-model protocol has unambiguous roles.
    const markers = events.filter(event => event.author === 'user' && event.content?.role === 'user');
    const models = events.filter(event => event.author === 'yuban_agent' && event.content?.role === 'model');
    const outputs = events.filter(event => event.author === 'yuban_agent' && event.content?.role === 'user');
    if (markers.length !== 1 || models.length !== 1 || outputs.length !== events.length - 2
      || markers.length + models.length + outputs.length !== events.length
      || events.some(event => !Number.isFinite(event.timestamp))) return { kind: 'unknown' };
    const user = markers[0], response = models[0], output = outputs[0];
    if (user.timestamp > response.timestamp || output && response.timestamp > output.timestamp) return { kind: 'unknown' };
    const marker = { role: 'user', parts: [{ text: privateSummaryMarker(attempt.binding, attempt.plan.manifestHash) }] };
    if (user.author !== 'user' || agentBudgetFingerprint(user.content) !== agentBudgetFingerprint(marker)
      || response.author !== 'yuban_agent' || response.content?.role !== 'model') return { kind: 'unknown' };
    const modelKey = 'model:' + agentBudgetFingerprint([run.id, run.trigger, 'first-model']);
    if (model.originalAttemptKey !== modelKey || model.requestFingerprint !== attempt.plan.requestFingerprint
      || root.used.modelCalls !== 1 || !root.attempts.some(entry => entry.kind === 'model' && entry.key === modelKey
        && entry.fingerprint === model.requestFingerprint && entry.units === 1)) return { kind: 'unknown' };
    const evidenceHash = agentBudgetFingerprint({ root, daily, session, grantRecordId: attempt.grantRecordId, plan: attempt.plan });
    if (events.length === 2 && !tool && response.turnComplete === true && response.content.parts?.length === 1
      && typeof response.content.parts[0].text === 'string' && response.content.parts[0].text.trim()
      && root.attempts.length === 1 && root.used.toolCalls === 0)
      return { kind: 'no_effect', dispatchOutcome: 'response_observed', stopReason: 'invalid_response', counts: root.used, tools: [], evidenceHash };
    const calls = response.content.parts?.flatMap(part => part.functionCall ? [part.functionCall] : []);
    if (!calls || calls.length !== 1 || !calls[0].id || !tool || tool.kind !== 'tool') return { kind: 'unknown' };
    // A unique durable native stage call is sufficient for pure terminal parsing.
    // It cannot cause a business effect, and recovery must not execute its handler
    // or fabricate the function response that a crash may have prevented.
    if (events.length === 3) {
      const answers = output.content?.parts?.flatMap(part => part.functionResponse ? [part.functionResponse] : []);
      if (output.author !== 'yuban_agent' || output.content?.role !== 'user' || !answers || answers.length !== 1
        || calls[0].id !== answers[0].id || calls[0].name !== answers[0].name
        || agentBudgetFingerprint(answers[0].response) !== agentBudgetFingerprint({ status: 'succeeded', data: { staged: true, saved: false } }))
        return { kind: 'unknown' };
    }
    const batchHash = agentBudgetFingerprint({ calls, units: calls.length });
    if (tool.originalAttemptKey !== modelKey + ':tool-batch' || tool.requestFingerprint !== batchHash || tool.units !== calls.length
      || root.attempts.length !== 2 || root.used.toolCalls !== calls.length
      || !root.attempts.some(entry => entry.kind === 'tool_batch' && entry.key === tool.originalAttemptKey
        && entry.fingerprint === batchHash && entry.units === calls.length)) return { kind: 'unknown' };
    const args = privateSummaryStageSchema(() => attempt.plan!.outputTextLimit).strict().safeParse(calls[0].args);
    if (calls[0].name !== 'stage_private_summary' || !args.success)
      return { kind: 'unknown' };
    return { kind: 'terminal', text: args.data.text, counts: root.used, tools: [{ name: calls[0].name, status: 'succeeded' }], evidenceHash };
  } };
}

const emptyNativeActions = z.object({ artifactDelta: z.record(z.string(), z.never()),
  requestedAuthConfigs: z.record(z.string(), z.never()), requestedToolConfirmations: z.record(z.string(), z.never()),
  stateDelta: z.record(z.string(), z.never()) }).strict();
const localFitEventIdentity = { id: z.string().min(1), invocationId: z.string().min(1), timestamp: z.number().finite(),
  branch: z.string().optional(), partial: z.literal(false).optional(), actions: emptyNativeActions,
  longRunningToolIds: z.array(z.never()) };
const originalFastUserEvent = z.object({ ...localFitEventIdentity, author: z.literal('user'),
  content: z.object({ role: z.literal('user'), parts: z.array(z.object({ text: z.string() }).strict()).min(1) }).strict() }).strict();
// ADK 2.1.0 persists this precise content-free wrapper for the local fit callback's AgentStopped.
const localFastFitErrorEvent = z.object({ ...localFitEventIdentity, author: z.literal('yuban_agent'),
  errorCode: z.literal('UNKNOWN_ERROR'), errorMessage: z.literal('input_limit') }).strict();
/** Narrow original-root proof, shared by fast settlement and its one-way T0 transition. */
export function createPrivateSummaryFastNoDispatchVerifier(options: {
  root: Pick<FirestoreRootBudget, 'readInTransaction'>; sessions: Pick<FirestoreSessionService, 'readSessionEvidenceInTransaction'>;
}): SummaryFastNoDispatchVerifier {
  return { async verify(b, run) {
    const fast = run.summaryFast;
    if (!fast?.rootContext || fast.selected || run.trigger.kind !== 'worker' || run.recipeId !== 'memory-refresh'
      || run.sourceMessageId !== null || run.ownerUserId !== b.scope.ownerUserId || run.workspaceId !== b.scope.workspaceId
      || run.childId !== b.scope.childId || run.storageEpoch !== b.scope.storageEpoch
      || run.authorizationVersion !== b.authorizationVersion || run.workerGeneration !== b.generation) return { kind: 'blocked' };
    let root;
    try { root = await options.root.readInTransaction(fast.rootContext, b.transaction); }
    catch (error) { if (error instanceof RootBudgetError && error.code === 'root_not_found') return { kind: 'blocked' }; throw error; }
    if (root.status !== 'stopped' || root.attempts.length !== 0
      || root.used.modelCalls !== 0 || root.used.toolCalls !== 0 || root.used.queryEmbeddings !== 0) return { kind: 'blocked' };
    const session = await options.sessions.readSessionEvidenceInTransaction({ appName: 'yuban_hk', userId: run.ownerUserId, sessionId: run.id }, b.transaction);
    if (session && session.events.length) {
      const users = session.events.filter(event => event.author === 'user');
      const errors = session.events.filter(event => event.author === 'yuban_agent');
      if (users.length !== 1 || errors.length > 1 || users.length + errors.length !== session.events.length
        || !originalFastUserEvent.safeParse(users[0]).success) return { kind: 'blocked' };
      if (errors.length && (!localFastFitErrorEvent.safeParse(errors[0]).success
        || errors[0].id === users[0].id || errors[0].invocationId !== users[0].invocationId || errors[0].branch !== users[0].branch
        || errors[0].timestamp < users[0].timestamp)) return { kind: 'blocked' };
    }
    // Do not include mutable state/result/certificate/transfer or disposable native contents.
    return { kind: 'verified', evidenceId: agentBudgetFingerprint({ format: 'private-summary-fast-no-dispatch/v1',
      runId: run.id, scope: b.scope, authorizationVersion: run.authorizationVersion, workerGeneration: run.workerGeneration,
      trigger: run.trigger, target: fast.target, lineageKey: fast.lineageKey, manifestHash: fast.manifestHash, candidate: fast.candidate,
      rootContextFingerprint: agentBudgetFingerprint(fast.rootContext), root, reason: 'input_limit' }) };
  } };
}
