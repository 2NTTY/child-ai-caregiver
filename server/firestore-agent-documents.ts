import { z } from 'zod';
import type { AgentScope } from './agent-runtime.ts';
import type { ProductAgentStore } from './product-agent-store.ts';
import type { AgentOriginalDocumentReceipts } from './agent-original-receipts.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { createFirestoreAgentRuns } from './firestore-agent-runs.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { documentPatchIsStructural } from './family-document-edits.ts';
import type { FirestoreAgentProposalExtension } from './firestore-agent-proposals.ts';

export const firestoreAgentDocumentLinkSchema = z.object({ runId: z.uuid(), operationId: z.uuid(), documentId: z.uuid(),
  savedVersion: z.number().int().positive(), toolName: z.enum(['generate_family_document', 'change_family_document']) }).strict();

/** A tool link and its document operation commit in the same business transaction. */
export function createFirestoreAgentDocuments(options: FirestoreDomainOptions & {
  runs: ReturnType<typeof createFirestoreAgentRuns>; chat: FirestoreChatStore;
}) {
  const { runs, chat } = options, { data, authority } = runs;
  const linkId = (b: Binding, opId: string) => JSON.stringify([b.scope.ownerUserId, opId]);
  const writeDocument: ProductAgentStore['writeDocument'] = async (scope, runId, opId, sourceQuote, mutation) => {
    domainParse(z.uuid(), opId); domainParse(z.string().trim().min(1).max(1000), sourceQuote);
    if ('change' in mutation && mutation.change.action === 'patch' && !documentPatchIsStructural(mutation.change))
      domainReject('document_confirmation_required', 400);
    return authority.runTransaction(scope.userId, scope.childId, async b => {
      const run = await runs.requireLive(b, scope, runId);
      if (run.trigger.kind !== 'interactive' || !run.sourceMessageId) domainReject('agent_source_mismatch');
      const message = await chat.readMessage(b, scope.childId, run.sourceMessageId);
      if (message?.role !== 'user' || !message.text.includes(sourceQuote)) domainReject('agent_source_mismatch');
      const id = linkId(b, opId), ref = data.ref('agent_document_links', 'agent-document-link', id), previous = await b.transaction.get(ref);
      const toolName = 'request' in mutation ? 'generate_family_document' : 'change_family_document';
      const prior = previous.exists ? data.open('agent-document-link', id, b.scope, firestoreAgentDocumentLinkSchema, previous) : null;
      if (prior && (prior.runId !== runId || prior.operationId !== opId || prior.toolName !== toolName)) domainReject('operation_mismatch');
      let sequence = b.changeSeq;
      const documents = createFirestoreFamilyDocumentStore({ ...options, transaction: { ...b, async prepareChange(...args) {
        const prepared = await b.prepareChange(...args); sequence = prepared.changeSeq; return prepared;
      } } });
      const item = 'request' in mutation ? await documents.create(scope.userId, scope.childId, mutation.request, opId)
        : await documents.change(scope.userId, scope.childId, mutation.id, mutation.change, opId);
      if (!item) domainReject('document_receipt_scope_changed');
      if (prior && (prior.documentId !== item.id || prior.savedVersion !== item.version)) domainReject('operation_mismatch');
      if (prior) {
        if (sequence !== b.changeSeq) domainReject('receipt_binding', 500);
        return item;
      }
      if (sequence === b.changeSeq) domainReject('document_receipt_scope_changed');
      if (!prior) b.transaction.create(ref, { ...data.tags(b.scope), runId, operationId: opId,
        ...data.seal('agent-document-link', id, b.scope, firestoreAgentDocumentLinkSchema,
          { runId, operationId: opId, documentId: item.id, savedVersion: item.version, toolName }) });
      runs.advance(b, run, sequence);
      return item;
    });
  };
  async function read(b: Binding, runId: string): Promise<AgentOriginalDocumentReceipts> {
    let query: import('@google-cloud/firestore').Query = data.collection('agent_document_links').where('runId', '==', runId);
    for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
    const rows = await b.transaction.get(query.limit(9)); if (rows.size > 8) domainReject('receipt_overflow', 500);
    const documents = createFirestoreFamilyDocumentStore({ ...options, transaction: b });
    const result: AgentOriginalDocumentReceipts = { receipts: [], unavailable: false, linked: rows.size > 0 };
    for (const row of rows.docs) {
      // The encrypted recovery locator is not needed: op IDs are held in a scoped link index.
      const opId = domainParse(z.uuid(), row.get('operationId'), 'receipt_binding', 500);
      const link = data.open('agent-document-link', linkId(b, opId), b.scope, firestoreAgentDocumentLinkSchema, row);
      if (link.runId !== runId || link.operationId !== opId) domainReject('receipt_binding', 500);
      const receipt = await documents.operationReceipt(b.scope.ownerUserId, b.scope.childId, opId);
      if (!receipt) { result.unavailable = true; continue; }
      if (receipt.documentId !== link.documentId || receipt.savedVersion !== link.savedVersion) domainReject('receipt_binding', 500);
      result.receipts.push({ ...receipt, toolName: link.toolName });
    }
    return result;
  }
  async function documentReceipts(scope: AgentScope, runId: string) {
    return authority.runTransaction(scope.userId, scope.childId, async b => {
      const run = await runs.read(b, runId); if (!runs.matches(b, scope, run, false)) return null;
      return read(b, runId);
    });
  }
  const extension: FirestoreAgentProposalExtension = {
    supports: value => value.kind === 'family_document_change',
    async target(b, value) {
      if (value.kind !== 'family_document_change') domainReject('invalid_input', 400);
      const item = await createFirestoreFamilyDocumentStore({ ...options, transaction: b })
        .validatePatch(b.scope.ownerUserId, b.scope.childId, value.documentId, value.change);
      if (!item) domainReject('not_found', 404);
      return { label: item.title, visibility: 'family', sourceBasis: item.sourceBasis };
    },
    async prepare(b, saved, operationId) {
      const value = saved.proposal.value; if (value.kind !== 'family_document_change') domainReject('invalid_input', 400);
      let sequence = b.changeSeq; const commits: (() => void)[] = [];
      const documents = createFirestoreFamilyDocumentStore({ ...options, deferCommit: commit => commits.push(commit),
        transaction: { ...b, async prepareChange(...args) { const result = await b.prepareChange(...args); sequence = result.changeSeq; return result; } } });
      const item = await documents.change(b.scope.ownerUserId, b.scope.childId, value.documentId,
        { ...value.change, confirmShared: true }, operationId);
      if (!item) domainReject('not_found', 404);
      return { result: { kind: 'family_document', id: item.id, version: item.version }, changeSeq: sequence,
        commit() { for (const commit of commits) commit(); } };
    },
  };
  return { writeDocument, documentReceipts, read, extension };
}
