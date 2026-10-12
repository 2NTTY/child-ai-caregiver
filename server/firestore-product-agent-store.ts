import type { ProductAgentStore } from './product-agent-store.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { WorkResource } from '../src/shared/agent-work.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreAgentRuns, type FirestoreAgentRun } from './firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from './firestore-agent-proposals.ts';
import { createFirestoreAgentWork } from './firestore-agent-work.ts';
import { createFirestoreAgentConfirmations } from './firestore-agent-confirmations.ts';
import { createFirestoreAgentActions, firestoreAgentActionSavedSchema } from './firestore-agent-actions.ts';
import { createFirestoreAgentHistory } from './firestore-agent-history.ts';
import { domainReject, firestoreTaskSchema } from './firestore-domain-data.ts';
import { agentActionToolNames } from '../src/shared/agent-actions.ts';

export function createFirestoreProductAgentStore(options: FirestoreDomainOptions & {
  chat: FirestoreChatStore; care: FirestoreCareStore; memory: FirestoreMemoryStore; online: FirestoreOnlineStore;
  validateKnowledge(binding: Binding, sourceId: string): Promise<void>;
}) {
  const runs = createFirestoreAgentRuns(options), { data, authority } = runs;
  const proposals = createFirestoreAgentProposals({ ...options, runs });
  const actions = createFirestoreAgentActions({ ...options, runs, proposals });
  const confirmations = createFirestoreAgentConfirmations({ runs, proposals, chat: options.chat,
    policyVersion: async b => (await actions.readPolicy(b)).version });
  async function validateResource(b: Binding, resource: WorkResource) {
    let version: number | undefined;
    if (resource.kind === 'memory_fact') version = (await options.memory.readFact(b, resource.id))?.version;
    else if (resource.kind === 'care_record') version = (await options.care.readRecord(b, resource.id))?.version;
    else if (resource.kind === 'private_note') version = (await actions.readNote(b, resource.id))?.version;
    else if (resource.kind === 'task' || resource.kind === 'receipt') {
      const task = resource.kind === 'task', kind = task ? 'task' : 'agent-action-receipt';
      const row = await b.transaction.get(data.ref(task ? 'tasks' : 'agent_action_receipts', kind, resource.id));
      if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
      if (task) {
        const value = data.open(kind, resource.id, b.scope, firestoreTaskSchema, row);
        if (value.id !== resource.id || value.childId !== b.scope.childId) domainReject('work_binding', 500);
        version = value.version;
      } else {
        const value = data.open(kind, resource.id, b.scope, firestoreAgentActionSavedSchema, row);
        if (value.receipt.id !== resource.id) domainReject('work_binding', 500);
        version = 1;
      }
    } else domainReject('domain_not_ready', 503);
    if (version === undefined) domainReject('not_found', 404);
    if (version !== resource.version) domainReject('work_resource_changed');
  }
  const work = createFirestoreAgentWork({ runs, proposals, validateResource, validateKnowledge: options.validateKnowledge });
  const history = createFirestoreAgentHistory({ runs, actions, chat: options.chat, memory: options.memory });
  async function project(b: Binding, run: FirestoreAgentRun, original: ProductAgentResult): Promise<ProductAgentResult> {
    if (!runs.matches(b, runs.current(b), run, false)) domainReject('agent_scope_changed');
    const candidates = (await proposals.inRun(b, run.id)).map(proposals.visible);
    const receipts = await actions.readReceipts(b, run.id);
    const confirmation = run.sourceMessageId ? await confirmations.recorded(b, run.sourceMessageId) : null;
    const value: ProductAgentResult = { ...original, proposals: candidates, tools: original.tools.filter(tool =>
      tool.name !== 'confirmed_proposal' && !Object.values(agentActionToolNames).includes(tool.name)) };
    for (const { receipt } of receipts) value.tools.push({ name: agentActionToolNames[receipt.kind], status: 'succeeded', reference: receipt.id });
    if (confirmation) value.tools.push({ name: 'confirmed_proposal', status: 'succeeded', reference: confirmation.id });
    // Document/contact tools are not exposed until their authoritative adapters are connected.
    if (value.tools.some(tool => ['generate_family_document', 'change_family_document', 'contact_caregiver'].includes(tool.name)))
      domainReject('receipt_adapter_missing', 503);
    if (!value.text && (receipts.length || confirmation)) value.text = '已有操作保存了 Server 收據；請查看原操作及目前結果，勿重複提交。已安排不代表已通知或照護已完成。';
    return value;
  }
  const store: ProductAgentStore = {
    ...work, ...history,
    requestConfirmation: confirmations.requestConfirmation, confirmationQuestions: confirmations.confirmationQuestions,
    bindConfirmationQuestion: confirmations.bindConfirmationQuestion, consumeConfirmation: confirmations.consumeConfirmation,
    recordedConfirmation: confirmations.recordedConfirmation,
    claim: runs.claim, authorize: runs.authorize, cancelReply: runs.cancelReply, finish: runs.finish,
    propose: proposals.propose, decide: proposals.decide, pendingProposals: proposals.pendingProposals, backgroundRuns: runs.backgroundRuns,
    get: (userId, childId, runId) => runs.result(userId, childId, runId, { read: project }),
    readCancelled: (scope, runId) => runs.result(scope.userId, scope.childId, runId, { read: async (b, run, result) => {
      if (!runs.matches(b, scope, run, false)) domainReject('agent_scope_changed');
      return project(b, run, result);
    } }, true),
    async writeDocument() { domainReject('domain_not_ready', 503); },
    async documentReceipts(scope, runId) {
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        const run = await runs.read(b, runId);
        if (!runs.matches(b, scope, run, false)) return null;
        if (run.result?.tools.some(tool => ['generate_family_document', 'change_family_document'].includes(tool.name)))
          domainReject('receipt_adapter_missing', 503);
        return { receipts: [], unavailable: false, linked: false };
      });
    },
  };
  return { store, actions, runs };
}
