import { AgentBudget, AgentStopped, agentBudgetFingerprint } from './agent-budget.ts';
import { AgentGatewayModel } from './agent-model-gateway.ts';
import type { DurableRootBudget, RootBudgetContext } from './durable-root-budget.ts';
import type { EmbeddingInput } from './embedding-gateway.ts';
import { requireDurableUsage, type FirestoreModelRouting } from './firestore-model-routing.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

export interface PrivateSourceModelSessionOptions {
  routing: Pick<FirestoreModelRouting, 'resolve'>;
  rootBudget: DurableRootBudget;
  owner: string;
  scope: WorkRecoveryScope;
  authorizationVersion: string;
  rootRunId: string;
  reference: string;
  signal: AbortSignal;
  authorize: () => Promise<boolean>;
  /** Interactive sessions may only create retrieval query vectors. */
  interactive?: boolean;
  /** The original persisted stage deadline, retained on recovery. */
  deadlineAtMs: number;
}

/** A single persisted private-source stage with its original payer and attempt identities. */
export async function createPrivateSourceModelSession(options: PrivateSourceModelSessionOptions) {
  const scope = workRecoveryScopeSchema.parse(options.scope);
  const interactive = options.interactive === true;
  if (scope.ownerUserId !== options.owner) throw new AgentStopped('unauthorized');
  const selected = await options.routing.resolve(options.owner, interactive ? 'interactive' : 'private-source-worker');
  const deadlineAtMs = options.deadlineAtMs;
  const budget = new AgentBudget(options.signal, selected.runLimits.deadlineMs, deadlineAtMs);
  const context: RootBudgetContext = { generation: 1, binding: {
    rootRunId: options.rootRunId, ownerId: options.owner, workspaceId: scope.workspaceId, childId: scope.childId,
    authorizationVersion: options.authorizationVersion, storageEpoch: scope.storageEpoch,
    trigger: { kind: interactive ? 'private-source-query' : 'private-source-index', reference: options.reference },
    workflowVersion: 'private-source-model/v1', promptPackVersion: 'private-source-model/v1',
    settingsVersion: selected.settingsVersion, billingVersion: selected.billingSource + ':' + selected.settingsVersion,
    limits: { modelCalls: selected.runLimits.modelCalls, toolCalls: selected.runLimits.toolCalls,
      queryEmbeddings: selected.runLimits.queryEmbeddings }, deadlineAtMs,
  } };
  let current = true;
  const authorize = async () => {
    budget.check();
    // A policy transition invalidates this fixed stage, even if a later read is unchanged.
    if (!current) return false;
    const permitted = await selected.authorize() && await selected.readPolicyTransition() === null && await options.authorize();
    if (!permitted) current = false;
    return current;
  };
  const revalidate = async () => {
    await budget.checkDurable();
    if (!await budget.wait(authorize)) throw new AgentStopped('unauthorized');
  };
  try {
    budget.configurePersonal(selected.runLimits, { softBudgetSource: selected.softBudgetSource });
    if (!await budget.wait(authorize)) throw new AgentStopped('unauthorized');
    await budget.initializeDurable({ adapter: options.rootBudget, context, dailyUsage: selected.dailyUsage,
      runLimits: selected.runLimits });
    const model = new AgentGatewayModel({ config: selected.config, provider: selected.provider, usage: requireDurableUsage,
      budget, userId: options.owner, childId: scope.childId, authorize,
      durableDailyUsage: { adapter: selected.dailyUsage, context } });
    return {
      settingsVersion: selected.settingsVersion,
      billingSource: selected.billingSource,
      model: selected.config.model,
      async completeText(input: Parameters<AgentGatewayModel['completeText']>[0]) {
        if (interactive || input.imageIds?.length || input.voice) throw new AgentStopped('unauthorized');
        await revalidate();
        const result = await model.completeText(input);
        await revalidate();
        return result;
      },
      async embed(input: EmbeddingInput, attemptKey: string) {
        if (input.task !== (interactive ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT')
          || !attemptKey.startsWith('embedding:')) throw new AgentStopped('unauthorized');
        const request = Object.freeze({ ...input });
        await revalidate();
        await budget.admit({ key: attemptKey, fingerprint: agentBudgetFingerprint(request), kind: 'embedding', units: 1 });
        const result = await selected.embeddings.embed(request, {
          kind: interactive ? 'query_embedding' : 'private_document_embedding',
          actorId: options.owner, operationId: options.rootRunId,
        }, budget.signal, authorize, { adapter: selected.dailyUsage, context, attemptKey, revalidate });
        await revalidate();
        return result;
      },
      close() { budget.close(); },
    };
  } catch (error) { budget.close(); throw error; }
}
export type PrivateSourceModelSession = Awaited<ReturnType<typeof createPrivateSourceModelSession>>;
