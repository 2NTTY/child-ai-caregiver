import { z } from 'zod';
import { privateSummaryPolicyFixture } from './private-summary-policy.ts';
import { readAiConfig } from '../../server/ai-config.ts';
import { claimedRunAssembly } from '../../server/agent-run-assembly.ts';
import { FirestoreRootBudget, firestoreRootBudgetContextSchema } from '../../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../../server/firestore-ai-usage.ts';
import { FirestoreSessionService } from '../../server/firestore-session-service.ts';
import { agentBudgetFingerprint, AGENT_LIMITS } from '../../server/agent-budget.ts';
import { summaryGrantRecordSchema } from '../../server/private-summary-work.ts';
import type { AgentRunClaim } from '../../server/product-agent-store.ts';
import type { SummaryWorkPolicyPort } from '../../server/firestore-private-summary-work.ts';
import type { RootBudgetContext } from '../../server/durable-root-budget.ts';

// Encrypted synthetic policy profile, parsed through the original config and root validators.
const profileSchema = z.object({ env: z.record(z.string(), z.string()), workflowVersion: z.string(),
  promptPackVersion: z.string(), settingsVersion: z.string(), billingVersion: z.string(),
  billingSource: z.enum(['platform', 'personal']), limits: firestoreRootBudgetContextSchema.shape.binding.shape.limits }).strict();
export async function privateSummaryRootFixture(sourceText?: string, ownerUserId = 'owner') {
  const f = await privateSummaryPolicyFixture(sourceText, ownerUserId);
  const profile: z.infer<typeof profileSchema> = { env: { AI_ENABLED: 'true', GCP_PROJECT_ID: f.options.projectId }, workflowVersion: f.grant.policyVersion,
    promptPackVersion: f.grant.promptPackVersion, settingsVersion: f.grant.settingsVersion, billingVersion: f.grant.billingVersion,
    billingSource: f.grant.billingSource, limits: { modelCalls: AGENT_LIMITS.modelCalls, toolCalls: AGENT_LIMITS.toolCalls, queryEmbeddings: AGENT_LIMITS.queryEmbeddings } };
  f.grant.model = readAiConfig(profile.env).model;
  const root = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_summary_root' });
  const daily = new FirestoreAiUsage({ ...f.options, namespace: 'synthetic_summary_daily', billingSource: 'platform' });
  const sessions = new FirestoreSessionService({ ...f.options, namespace: 'synthetic_summary_session' });
  function context(claim: AgentRunClaim, selected = profile, deadline = Date.parse(claim.expiresAt)): RootBudgetContext {
    const config = readAiConfig(selected.env);
    return claimedRunAssembly(config, { nativeSessionService: sessions, rootBudget: root, dailyUsage: daily,
      profile: { ...selected, config } }, null, false, false, true).bindDurableRun({ runId: claim.runId, claimedRun: claim,
      scope: claim.scope, trigger: claim.trigger!, recipeId: claim.recipeId!, deadlineAtMs: Date.parse(claim.expiresAt) },
    selected.promptPackVersion, selected.limits, deadline).context;
  }
  const policy: SummaryWorkPolicyPort = { ...f.policy, async validateRootBinding(b: Parameters<NonNullable<typeof f.policy.validateRootBinding>>[0],
    input: Parameters<NonNullable<typeof f.policy.validateRootBinding>>[1]) {
    const grantRow = await b.transaction.get(f.data.ref('private_summary_usage', 'private-summary-grant', input.grantRecord.id));
    const profileRow = await b.transaction.get(f.data.ref('test_summary_profiles', 'test-summary-profile', input.grantRecord.id));
    if (!grantRow.exists || !profileRow.exists) return { kind: 'blocked' as const, reason: 'missing' as const };
    const grant = f.data.open('private-summary-grant', input.grantRecord.id, b.scope, summaryGrantRecordSchema, grantRow);
    const saved = f.data.open('test-summary-profile', input.grantRecord.id, b.scope, profileSchema, profileRow);
    if (agentBudgetFingerprint(grant) !== agentBudgetFingerprint(input.grantRecord)
      || grant.grant.policyVersion !== saved.workflowVersion || grant.grant.settingsVersion !== saved.settingsVersion
      || grant.grant.promptPackVersion !== saved.promptPackVersion || grant.grant.billingVersion !== saved.billingVersion
      || grant.grant.billingSource !== saved.billingSource || grant.grant.model !== readAiConfig(saved.env).model)
      return { kind: 'blocked' as const, reason: 'binding' as const };
    const expected = context(f.runs.projectClaim(b, input.run, true), saved, input.context.binding.deadlineAtMs);
    return agentBudgetFingerprint(expected) === agentBudgetFingerprint(input.context)
      ? { kind: 'matched' as const, grantRecordId: grant.id, contextFingerprint: agentBudgetFingerprint(expected) }
      : { kind: 'blocked' as const, reason: 'binding' as const };
  }, async validateDailyRequest(b, input) {
    const rootProof = await policy.validateRootBinding!(b, input);
    if (rootProof.kind !== 'matched') return rootProof;
    const row = await b.transaction.get(f.data.ref('test_summary_profiles', 'test-summary-profile', input.grantRecord.id));
    if (!row.exists) return { kind: 'blocked', reason: 'missing' };
    const saved = f.data.open('test-summary-profile', input.grantRecord.id, b.scope, profileSchema, row), config = readAiConfig(saved.env);
    if (input.request.userLimit !== config.dailyUserAttempts || input.request.globalLimit !== config.dailyGlobalAttempts
      || daily.billingSource !== input.grantRecord.grant.billingSource) return { kind: 'blocked', reason: 'binding' };
    return { ...rootProof, dailyRequestHash: agentBudgetFingerprint(input.request) };
  } };
  async function saveProfile(grantRecordId: string, selected = profile) {
    await f.authority.runTransaction(ownerUserId, f.childId, async b => {
      b.transaction.set(f.data.ref('test_summary_profiles', 'test-summary-profile', grantRecordId),
        f.data.seal('test-summary-profile', grantRecordId, b.scope, profileSchema, selected));
    });
  }
  const store = () => f.build(policy);
  return { ...f, root, daily, sessions, profile, context, policy, saveProfile, store };
}
