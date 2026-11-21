import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentScope } from './agent-runtime.ts';
import type { ProductAgentStore, StagedSpecialistDraftInput } from './product-agent-store.ts';
import type { AgentOriginalDocumentReceipts } from './agent-original-receipts.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import { domainParse, domainReject, FirestoreDomainError } from './firestore-domain-data.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { createFirestoreAgentRuns } from './firestore-agent-runs.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { documentPatchIsStructural } from './family-document-edits.ts';
import type { FirestoreAgentProposalExtension } from './firestore-agent-proposals.ts';
import { SPECIALIST_DRAFT_MAX_BYTES, specialistArtifactSummarySchema, type SpecialistArtifactSummary } from '../src/shared/specialist-artifact.ts';

export const firestoreAgentDocumentLinkSchema = z.object({ runId: z.uuid(), operationId: z.uuid(), documentId: z.uuid(),
  savedVersion: z.number().int().positive(), toolName: z.enum(['generate_family_document', 'change_family_document']) }).strict();

export const firestoreSpecialistDraftSchema = z.object({
  summary: specialistArtifactSummarySchema,
  bytesBase64: z.string().min(1).max(1_000_000),
}).strict();

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
      if (receipt.contentState === 'invalidated') result.unavailable = true;
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
  const draftId = (b: Binding, runId: string, artifactId: string) => JSON.stringify([b.scope.ownerUserId, runId, artifactId]);
  const liveDocumentValid = (described: Awaited<ReturnType<ReturnType<typeof createFirestoreFamilyDocumentStore>['describe']>>, expected: Pick<SpecialistArtifactSummary, 'expectedVersion' | 'authorityVersion'>) =>
    Boolean(described && described.authorityVersion === expected.authorityVersion
      && described.item.version === expected.expectedVersion
      && described.item.status !== 'archived'
      && described.item.readState === 'ready'
      && described.item.current !== null);

  const stageSpecialistDraft = async (scope: AgentScope, runId: string, input: StagedSpecialistDraftInput): Promise<SpecialistArtifactSummary> => {
    const artifactId = domainParse(z.uuid(), input.artifactId);
    const sourceQuote = domainParse(z.string().trim().min(1).max(1000), input.sourceQuote);
    const summary = domainParse(specialistArtifactSummarySchema, {
      ...input.summary,
      artifactId,
      runId,
      formalSave: false,
      published: false,
      requiresFormalConfirmation: true,
    });
    if (input.bytes.byteLength === 0 || input.bytes.byteLength !== summary.byteLength) domainReject('invalid_input', 400);
    if (input.bytes.byteLength > SPECIALIST_DRAFT_MAX_BYTES) domainReject('specialist_draft_too_large', 413);
    const computedHash = createHash('sha256').update(input.bytes).digest('hex');
    if (computedHash !== summary.artifactHash) domainReject('specialist_draft_integrity', 400);

    return authority.runTransaction(scope.userId, scope.childId, async b => {
      const run = await runs.requireLive(b, scope, runId);
      if (run.trigger.kind !== 'interactive' || !run.sourceMessageId) domainReject('agent_source_mismatch');
      const message = await chat.readMessage(b, scope.childId, run.sourceMessageId);
      if (message?.role !== 'user' || !message.text.includes(sourceQuote)) domainReject('agent_source_mismatch');

      const docs = createFirestoreFamilyDocumentStore({ ...options, transaction: b });
      const described = await docs.describe(scope.userId, scope.childId, summary.documentId);
      if (!liveDocumentValid(described, summary)) domainReject('document_changed', 409);

      let query: import('@google-cloud/firestore').Query = data.collection('agent_specialist_drafts').where('runId', '==', runId);
      for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
      const existing = await b.transaction.get(query.limit(7));
      if (existing.size >= 6) domainReject('specialist_draft_limit', 400);

      const id = draftId(b, runId, artifactId);
      const ref = data.ref('agent_specialist_drafts', 'agent-specialist-draft', id);
      const previous = await b.transaction.get(ref);
      const storedSummary: SpecialistArtifactSummary = { ...summary, contentState: 'ready' };
      if (previous.exists) {
        const opened = data.open('agent-specialist-draft', id, b.scope, firestoreSpecialistDraftSchema, previous);
        if (opened.summary.artifactHash !== summary.artifactHash || opened.summary.documentId !== summary.documentId) {
          domainReject('operation_mismatch');
        }
        return { ...opened.summary, contentState: 'ready' };
      }

      const bytesBase64 = Buffer.from(input.bytes).toString('base64');
      const envelope = (() => {
        try {
          return data.seal('agent-specialist-draft', id, b.scope, firestoreSpecialistDraftSchema, { summary: storedSummary, bytesBase64 });
        } catch (error) {
          if (error instanceof FirestoreDomainError && error.code === 'document_too_large') domainReject('specialist_draft_too_large', 413);
          throw error;
        }
      })();
      b.transaction.create(ref, { ...data.tags(b.scope), runId, artifactId, ...envelope });
      return storedSummary;
    });
  };

  async function readDrafts(b: Binding, runId: string): Promise<SpecialistArtifactSummary[]> {
    let query: import('@google-cloud/firestore').Query = data.collection('agent_specialist_drafts').where('runId', '==', runId);
    for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
    const rows = await b.transaction.get(query.limit(7));
    if (rows.empty) return [];
    const docs = createFirestoreFamilyDocumentStore({ ...options, transaction: b });
    const cache = new Map<string, Awaited<ReturnType<typeof docs.describe>>>();
    const out: SpecialistArtifactSummary[] = [];
    for (const row of rows.docs) {
      const artifactId = domainParse(z.uuid(), row.get('artifactId'), 'receipt_binding', 500);
      const id = draftId(b, runId, artifactId);
      const opened = data.open('agent-specialist-draft', id, b.scope, firestoreSpecialistDraftSchema, row);
      if (opened.summary.runId !== runId || opened.summary.artifactId !== artifactId) domainReject('receipt_binding', 500);
      if (!cache.has(opened.summary.documentId)) {
        cache.set(opened.summary.documentId, await docs.describe(b.scope.ownerUserId, b.scope.childId, opened.summary.documentId));
      }
      const valid = liveDocumentValid(cache.get(opened.summary.documentId) ?? null, opened.summary);
      out.push({ ...opened.summary, contentState: valid ? 'ready' : 'invalidated' });
    }
    return out;
  }

  async function specialistDrafts(scope: AgentScope, runId: string): Promise<SpecialistArtifactSummary[]> {
    return authority.runTransaction(scope.userId, scope.childId, async b => {
      const run = await runs.read(b, runId);
      if (!run || !runs.matches(b, scope, run, false)) return [];
      return readDrafts(b, runId);
    });
  }

  async function readSpecialistDraft(userId: string, childId: string, runId: string, artifactId: string): Promise<{ summary: SpecialistArtifactSummary; bytes: Buffer } | null> {
    domainParse(z.uuid(), childId, 'invalid_input', 400);
    domainParse(z.uuid(), runId, 'invalid_input', 400);
    domainParse(z.uuid(), artifactId, 'invalid_input', 400);
    return authority.runTransaction(userId, childId, async b => {
      const run = await runs.read(b, runId);
      if (!run || !runs.matches(b, runs.current(b), run, false)) return null;
      const id = draftId(b, runId, artifactId);
      const ref = data.ref('agent_specialist_drafts', 'agent-specialist-draft', id);
      const snap = await b.transaction.get(ref);
      if (!snap.exists) return null;
      if (Object.entries(data.tags(b.scope)).some(([key, value]) => snap.get(key) !== value)) return null;
      const opened = data.open('agent-specialist-draft', id, b.scope, firestoreSpecialistDraftSchema, snap);
      if (opened.summary.runId !== runId || opened.summary.artifactId !== artifactId) domainReject('receipt_binding', 500);
      const docs = createFirestoreFamilyDocumentStore({ ...options, transaction: b });
      const described = await docs.describe(userId, childId, opened.summary.documentId);
      if (!liveDocumentValid(described, opened.summary)) domainReject('document_changed', 409);
      const bytes = Buffer.from(opened.bytesBase64, 'base64');
      if (bytes.byteLength !== opened.summary.byteLength || createHash('sha256').update(bytes).digest('hex') !== opened.summary.artifactHash) {
        domainReject('specialist_draft_integrity', 500);
      }
      return { summary: { ...opened.summary, contentState: 'ready' }, bytes };
    });
  }

  return { writeDocument, documentReceipts, read, extension, stageSpecialistDraft, readSpecialistDraft, readDrafts, specialistDrafts };
}
