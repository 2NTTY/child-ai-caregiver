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
import { createFirestoreAgentDocuments } from './firestore-agent-documents.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { createFirestoreAgentSources } from './firestore-agent-sources.ts';
import type { FirestoreSharedInputStore } from './firestore-shared-inputs.ts';

import type { FirestoreConcernStore } from "./firestore-concerns.ts";

import type { FirestoreAgentRunOptions } from "./firestore-agent-runs.ts";
import type { FirestoreContact } from './firestore-contact.ts';
import { createFirestoreWorkFollowUp } from './firestore-work-followup.ts';
import type { ResourceBasis, KnowledgeCurrent } from './agent-work-continuation-core.ts';
import { firestoreFamilyDocumentSchemas } from './firestore-family-documents.ts';
import { firestoreSharedInputSchema } from './firestore-shared-inputs.ts';

export function createFirestoreProductAgentStore(options: FirestoreDomainOptions & {
  chat: FirestoreChatStore; care: FirestoreCareStore; memory: FirestoreMemoryStore; online: FirestoreOnlineStore;
  authorizeWorker?: FirestoreAgentRunOptions['authorizeWorker'];
  sources?: FirestoreSharedInputStore; concerns?: FirestoreConcernStore;
  contact?: FirestoreContact;
  validateKnowledge(binding: Binding, sourceId: string): Promise<void>;
  continuationKnowledge(binding: Binding, ids: readonly string[]): Promise<KnowledgeCurrent[]>;
}) {
  const runs = createFirestoreAgentRuns(options), { data, authority } = runs;
  const documents = createFirestoreAgentDocuments({ ...options, runs });
  const proposals = createFirestoreAgentProposals({ ...options, runs,
    extensions: [documents.extension, ...(options.concerns ? [options.concerns.extension] : []), ...(options.sources ? [createFirestoreAgentSources(options.sources)] : [])] });
  const actions = createFirestoreAgentActions({ ...options, runs, proposals });
  const confirmations = createFirestoreAgentConfirmations({ runs, proposals, chat: options.chat,
    policyVersion: async b => (await actions.readPolicy(b)).version });
  async function resourceBasis(b: Binding, resource: WorkResource): Promise<ResourceBasis> {
    let version: number | undefined, status = 'current', available = true, terminal = false;
    try {
      if (resource.kind === 'memory_fact') {
        const fact = await options.memory.readFact(b, resource.id); version = fact?.version; status = fact?.status ?? 'unavailable'; available = !!fact?.applicable;
      } else if (resource.kind === 'care_record') version = (await options.care.readRecord(b, resource.id))?.version;
      else if (resource.kind === 'concern') {
        const concern = await options.concerns?.head(b, resource.id); version = concern?.version; status = concern?.status ?? 'unavailable'; terminal = status === 'closed';
      } else if (resource.kind === 'private_note') version = (await actions.readNote(b, resource.id))?.version;
      else {
        const spec = resource.kind === 'family_document' ? ['documents', 'family-document'] : resource.kind === 'private_source' ? ['shared_inputs', 'shared-input']
          : resource.kind === 'task' ? ['tasks', 'task'] : ['agent_action_receipts', 'agent-action-receipt'];
        const row = await b.transaction.get(data.ref(spec[0], spec[1], resource.id));
        if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
        if (resource.kind === 'family_document') {
          const value = data.open(spec[1], resource.id, b.scope, firestoreFamilyDocumentSchemas.metadata, row);
          version = value.version; status = value.status; terminal = status === 'archived';
        } else if (resource.kind === 'private_source') {
          if (row.get('live') !== true) domainReject('not_found', 404);
          const value = data.open(spec[1], resource.id, b.scope, firestoreSharedInputSchema, row);
          version = value.version; available = value.management?.enabled !== false; status = available ? 'current' : 'disabled';
        } else if (resource.kind === 'task') {
          const value = data.open(spec[1], resource.id, b.scope, firestoreTaskSchema, row);
          if (value.id !== resource.id || value.childId !== b.scope.childId) domainReject('work_binding', 500);
          version = value.version; status = value.occurrence.state; terminal = ['completed', 'cancelled'].includes(status);
        } else {
          const value = data.open(spec[1], resource.id, b.scope, firestoreAgentActionSavedSchema, row);
          if (value.receipt.id !== resource.id) domainReject('work_binding', 500); version = 1;
        }
      }
    } catch (error) { if (!error || typeof error !== 'object' || !('status' in error) || Number(error.status) !== 404) throw error; }
    return { ...resource, version: version ?? resource.version, status: version === undefined ? 'unavailable' : status,
      available: version !== undefined && available, terminal };
  }
  async function validateResource(b: Binding, resource: WorkResource) {
    const value = await resourceBasis(b, resource);
    if (!value.available) domainReject('not_found', 404);
    if (value.version !== resource.version) domainReject('work_resource_changed');
  }
  const continuation = createFirestoreWorkFollowUp({ ...options, resource: resourceBasis, knowledge: options.continuationKnowledge, runs: () => runs });
  const work = createFirestoreAgentWork({ runs, proposals, validateResource, validateKnowledge: options.validateKnowledge, continuation });
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
    const documentReceipts = await documents.read(b, run.id);
    value.tools = value.tools.filter(tool => !['generate_family_document', 'change_family_document'].includes(tool.name));
    for (const receipt of documentReceipts.receipts) value.tools.push({ name: receipt.toolName, status: 'succeeded', reference: receipt.documentId });
    value.tools = value.tools.filter(tool => tool.name !== 'contact_caregiver');
    for (const reference of await options.contact?.recorded(b, run.id) ?? []) value.tools.push({ name: 'contact_caregiver', status: 'succeeded', reference });
    if (!value.text && (receipts.length || confirmation)) value.text = '已有操作保存了 Server 收據；請查看原操作及目前結果，勿重複提交。已安排不代表已通知或照護已完成。';
    if (value.outcome && (value.text || value.proposals.length || value.tools.some(tool => tool.reference))) delete value.outcome;
    return value;
  }
  const store: ProductAgentStore = {
    ...work, ...history,
    requestConfirmation: confirmations.requestConfirmation, confirmationQuestions: confirmations.confirmationQuestions,
    bindConfirmationQuestion: confirmations.bindConfirmationQuestion, consumeConfirmation: confirmations.consumeConfirmation,
    recordedConfirmation: confirmations.recordedConfirmation,
    replyState: runs.replyState, claim: runs.claim, authorize: runs.authorize, cancelReply: runs.cancelReply, finish: runs.finish,
    propose: proposals.propose, decide: proposals.decide, pendingProposals: proposals.pendingProposals, backgroundRuns: runs.backgroundRuns,
    get: (userId, childId, runId) => runs.result(userId, childId, runId, { read: project }),
    readCancelled: (scope, runId) => runs.result(scope.userId, scope.childId, runId, { read: async (b, run, result) => {
      if (!runs.matches(b, scope, run, false)) domainReject('agent_scope_changed');
      return project(b, run, result);
    } }, true),
    writeDocument: documents.writeDocument, documentReceipts: documents.documentReceipts,
  };
  return { store, actions, runs, continuation };
}
