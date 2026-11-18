import { z } from 'zod';
import { agentBudgetFingerprint } from './agent-budget.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreModelRouting } from './firestore-model-routing.ts';
import type { FirestoreAgentRun } from './firestore-agent-runs.ts';
import type { RootBudgetContext } from './durable-root-budget.ts';
import type { SummaryWorkPolicyPort } from './firestore-private-summary-work.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { summaryWorkGrantSchema, type SummaryWorkGrant } from './private-summary-work.ts';

const sponsorSchema = z.strictObject({
  scope: workRecoveryScopeSchema, authorizationVersion: z.string().min(1), generation: z.string().min(1),
  payer: summaryWorkGrantSchema.shape.billingSource, model: z.string().min(1), expiresAt: z.iso.datetime({ offset: true }),
  limits: summaryWorkGrantSchema.shape.limits,
});
export type SummarySponsor = z.infer<typeof sponsorSchema>;
export function parseSummarySponsor(value: string | undefined): SummarySponsor | undefined {
  if (value === undefined) return undefined;
  try { return sponsorSchema.parse(JSON.parse(value)); }
  catch { throw new Error('invalid_private_summary_sponsor'); }
}
export function summarySponsorMatches(sponsor: SummarySponsor, b: Binding, now: number): boolean {
  return !b.sharedAccess && b.actorUserId === b.scope.ownerUserId && Date.parse(sponsor.expiresAt) > now
    && sponsor.generation === b.generation && sponsor.authorizationVersion === b.authorizationVersion
    && agentBudgetFingerprint(sponsor.scope) === agentBudgetFingerprint(b.scope);
}
export type SummaryWorkerProfile = Awaited<ReturnType<FirestoreModelRouting['readWorkerProfileIn']>>;
export function createFundedSummaryPolicy(options: {
  sponsor: SummarySponsor; promptPackVersion: string; readProfile: FirestoreModelRouting['readWorkerProfileIn'];
  readLegacyAdmission: SummaryWorkPolicyPort['readLegacyAdmission'];
  bind(b: Binding, run: FirestoreAgentRun, profile: SummaryWorkerProfile, deadline: number): RootBudgetContext;
}): SummaryWorkPolicyPort {
  const { sponsor } = options;
  async function selected(b: Binding) {
    if (!summarySponsorMatches(sponsor, b, Date.now()) || !sponsor.limits.modelCalls || !sponsor.limits.toolCalls) return null;
    const profile = await options.readProfile(b);
    return profile.enabled && profile.billingSource === sponsor.payer && profile.selectedConfig.model === sponsor.model ? profile : null;
  }
  function grant(workId: string, profile: SummaryWorkerProfile): SummaryWorkGrant {
    return { grantId: workId, revision: 1, policyVersion: agentBudgetFingerprint(sponsor),
      settingsVersion: 'firestore:' + profile.settingsVersion, promptPackVersion: options.promptPackVersion,
      model: sponsor.model, billingSource: sponsor.payer, billingVersion: sponsor.payer + ':v1',
      limits: sponsor.limits, workDeadlineAt: sponsor.expiresAt, retryPolicyVersion: 'original-attempt/v1' };
  }
  const blocked = { kind: 'blocked' as const, reason: 'policy_missing' as const };
  async function next(b: Binding, workId: string, original: SummaryWorkGrant) {
    const profile = await selected(b);
    return profile && agentBudgetFingerprint(grant(workId, profile)) === agentBudgetFingerprint(original)
      ? { kind: 'due' as const, dueAt: new Date().toISOString() } : blocked;
  }
  type Check = Parameters<NonNullable<SummaryWorkPolicyPort['validateRootBinding']>>[1];
  async function validate(b: Binding, input: Check, daily?: Parameters<NonNullable<SummaryWorkPolicyPort['validateDailyRequest']>>[1]['request']) {
    const profile = await selected(b), rejected = { kind: 'blocked' as const, reason: 'binding' as const };
    if (!profile || agentBudgetFingerprint(grant(input.grantRecord.workId, profile)) !== agentBudgetFingerprint(input.grantRecord.grant)) return rejected;
    if (daily && (daily.globalLimit !== profile.selectedConfig.dailyGlobalAttempts || daily.userLimit !== profile.selectedConfig.dailyUserAttempts)) return rejected;
    const expected = options.bind(b, input.run, profile, input.context.binding.deadlineAtMs);
    const fingerprint = agentBudgetFingerprint(expected);
    return fingerprint === agentBudgetFingerprint(input.context)
      ? { kind: 'matched' as const, grantRecordId: input.grantRecord.id, contextFingerprint: fingerprint } : rejected;
  }
  return {
    availableIn: async b => Boolean(await selected(b)),
    readLegacyAdmission: options.readLegacyAdmission,
    async resolveInitial(b, input) {
      const profile = await selected(b);
      return profile ? { grant: grant(input.workId, profile), dueAt: new Date().toISOString() } : null;
    },
    resolveNextPartDueAt: (b, { work }) => next(b, work.id, work.grant),
    resolveSourceRevisionDueAt: (b, { work }) => next(b, work.id, work.grant),
    resolveWakeDueAt: (b, { work }) => next(b, work.id, work.grant),
    validateRootBinding: (b, input) => validate(b, input),
    async validateDailyRequest(b, input) {
      const proof = await validate(b, input, input.request);
      return proof.kind === 'matched' ? { ...proof, dailyRequestHash: agentBudgetFingerprint(input.request) } : proof;
    },
  };
}
