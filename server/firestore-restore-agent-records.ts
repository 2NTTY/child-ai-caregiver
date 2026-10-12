import { z } from 'zod';
import { firestoreAgentRunSchema, firestoreAgentClaimSchema } from './firestore-agent-runs.ts';
import { firestoreAgentWorkProjectionSchema, firestoreAgentWorkOperationSchema } from './firestore-agent-work.ts';
import { firestoreAgentConfirmationSchema, firestoreAgentConfirmationSlotSchema } from './firestore-agent-confirmations.ts';
import { firestoreAgentProposalSchema } from './firestore-agent-proposals.ts';
import { firestoreAgentDocumentLinkSchema } from './firestore-agent-documents.ts';
import { firestoreAgentPolicySchema, firestorePrivateInstructionSchema, firestoreAgentActionSavedSchema,
  firestoreAgentActionCallSchema, firestoreAgentManualSchema } from './firestore-agent-actions.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

export const agentRestoreSchemas = {
  'agent-run': { suffix: 'agent_runs', schema: firestoreAgentRunSchema },
  'agent-claim': { suffix: 'agent_claims', schema: firestoreAgentClaimSchema },
  'agent-work-index': { suffix: 'agent_work_index', schema: firestoreAgentWorkProjectionSchema },
  'agent-work-operation': { suffix: 'agent_work_operations', schema: firestoreAgentWorkOperationSchema },
  'agent-work-call': { suffix: 'agent_work_calls', schema: firestoreAgentWorkOperationSchema },
  'agent-confirmation': { suffix: 'agent_confirmations', schema: firestoreAgentConfirmationSchema },
  'agent-confirmation-slot': { suffix: 'agent_confirmation_slots', schema: firestoreAgentConfirmationSlotSchema },
  'agent-confirmation-response': { suffix: 'agent_confirmation_responses', schema: firestoreAgentConfirmationSlotSchema },
  'agent-proposal': { suffix: 'agent_proposals', schema: firestoreAgentProposalSchema },
  'agent-document-link': { suffix: 'agent_document_links', schema: firestoreAgentDocumentLinkSchema },
  'agent-policy': { suffix: 'agent_policies', schema: firestoreAgentPolicySchema },
  'agent-policy-revision': { suffix: 'agent_policy_revisions', schema: firestoreAgentPolicySchema },
  'private-instruction': { suffix: 'private_instructions', schema: firestorePrivateInstructionSchema },
  'agent-action-receipt': { suffix: 'agent_action_receipts', schema: firestoreAgentActionSavedSchema },
  'agent-action-call': { suffix: 'agent_action_calls', schema: firestoreAgentActionCallSchema },
  'agent-manual-operation': { suffix: 'agent_manual_operations', schema: firestoreAgentManualSchema },
} as const;
export type AgentRestoreKind = keyof typeof agentRestoreSchemas;
export type AgentRestoreValue = z.infer<(typeof agentRestoreSchemas)[AgentRestoreKind]['schema']>;
export function isAgentRestoreKind(kind: string): kind is AgentRestoreKind { return Object.hasOwn(agentRestoreSchemas, kind); }
function check(ok: boolean): void { if (!ok) throw Object.assign(new Error('Restore Agent binding rejected'), { code: 'restore_binding', status: 409 }); }
function ids(id: string): unknown[] {
  let value: unknown; try { value = JSON.parse(id); } catch { check(false); }
  check(Array.isArray(value) && JSON.stringify(value) === id); return value as unknown[];
}
function equal(id: string, expected: unknown[]): void { check(JSON.stringify(ids(id)) === JSON.stringify(expected)); }

/** Preserve business receipts and history; restored protocol claims never authorize new execution. */
export function restoreAgentRecord(context: FirestoreRecoveryContext & { kind: AgentRestoreKind }, raw: AgentRestoreValue,
  targetScope?: WorkRecoveryScope): { value: AgentRestoreValue; metadata: Record<string, unknown> } {
  const { kind, id, scope, recordVersion } = context;
  check(scope.workspaceId !== '00000000-0000-0000-0000-000000000000' && scope.childId !== '00000000-0000-0000-0000-000000000000'
    && context.family === 'domain' && context.envelopeVersion === 1 && recordVersion !== undefined);
  const singleton = () => check(recordVersion === 1);
  let value: AgentRestoreValue = raw, metadata: Record<string, unknown> = {};
  switch (kind) {
    case 'agent-run': {
      const row = firestoreAgentRunSchema.parse(raw); singleton();
      check(row.id === id && row.ownerUserId === scope.ownerUserId && row.workspaceId === scope.workspaceId && row.childId === scope.childId
        && row.storageEpoch === scope.storageEpoch && row.dataVersion.startsWith(scope.storageEpoch + ':')
        && /^\d+$/u.test(row.dataVersion.slice(scope.storageEpoch.length + 1)) && (!row.result || row.result.runId === id)
        && (row.trigger.kind === 'interactive' ? row.sourceMessageId === row.trigger.reference : row.sourceMessageId === null));
      value = targetScope ? { ...row, storageEpoch: targetScope.storageEpoch,
        dataVersion: targetScope.storageEpoch + row.dataVersion.slice(scope.storageEpoch.length),
        state: row.state === 'running' ? 'unknown' : row.state,
        stopReason: row.state === 'running' ? 'interrupted' : row.stopReason } : row;
      metadata = { runId: id, createdAt: row.createdAt, triggerKind: row.trigger.kind }; break;
    }
    case 'agent-claim': {
      singleton(); const key = ids(id);
      check(key.length === 4 && key[0] === scope.ownerUserId && key[1] === scope.childId
        && ['interactive', 'worker'].includes(String(key[2])) && z.uuid().safeParse(key[3]).success); break;
    }
    case 'agent-work-index': {
      const row = firestoreAgentWorkProjectionSchema.parse(raw); check(row.workId === id && row.version === recordVersion);
      metadata = { workId: row.workId, createdAt: row.createdAt }; break;
    }
    case 'agent-work-operation': case 'agent-work-call': {
      singleton(); const row = firestoreAgentWorkOperationSchema.parse(raw); check(row.result.childId === scope.childId);
      equal(id, kind === 'agent-work-operation' ? [scope.ownerUserId, scope.childId, row.operationId] : [row.runId, row.callId]); break;
    }
    case 'agent-confirmation': {
      singleton(); const row = firestoreAgentConfirmationSchema.parse(raw); check(row.id === id);
      const state = targetScope && ['waiting', 'asked'].includes(row.state) ? 'invalidated' as const : row.state;
      value = { ...row, state }; metadata = { confirmationId: row.id, askingRunId: row.askingRunId, askMessageId: row.askMessageId, state, expiresAt: row.expiresAt }; break;
    }
    case 'agent-confirmation-slot': {
      singleton(); const key = ids(id); check(key.length === 3 && z.uuid().safeParse(key[0]).success && z.uuid().safeParse(key[1]).success
        && z.number().int().positive().safeParse(key[2]).success); break;
    }
    case 'agent-confirmation-response': {
      singleton(); const key = ids(id); check(key.length === 3 && key[0] === scope.ownerUserId && key[1] === scope.childId && z.uuid().safeParse(key[2]).success); break;
    }
    case 'agent-proposal': {
      const row = firestoreAgentProposalSchema.parse(raw), p = row.proposal;
      check(p.id === id && p.childId === scope.childId && p.version === recordVersion);
      const proposal = targetScope && p.status === 'pending' ? { ...p, status: 'expired' as const } : p;
      value = { ...row, proposal }; metadata = { runId: p.runId, proposalId: p.id, createdAt: p.createdAt, expiresAt: p.expiresAt, status: proposal.status, authorizationVersion: row.authorizationVersion }; break;
    }
    case 'agent-document-link': {
      singleton(); const row = firestoreAgentDocumentLinkSchema.parse(raw); equal(id, [scope.ownerUserId, row.operationId]);
      metadata = { runId: row.runId }; break;
    }
    case 'agent-policy': case 'agent-policy-revision': {
      const row = firestoreAgentPolicySchema.parse(raw), key = JSON.stringify([scope.ownerUserId, scope.childId]);
      check(row.value.version === recordVersion);
      if (kind === 'agent-policy') check(id === key); else equal(id, [key, row.value.version]);
      // Keep the old authorization version: restoration cannot renew consent.
      break;
    }
    case 'private-instruction': {
      const row = firestorePrivateInstructionSchema.parse(raw); check(row.id === id && row.childId === scope.childId && row.version === recordVersion);
      metadata = { noteId: row.id, createdAt: row.createdAt }; break;
    }
    case 'agent-action-receipt': {
      singleton(); const row = firestoreAgentActionSavedSchema.parse(raw); check(row.receipt.id === id);
      metadata = { receiptId: id, runId: row.receipt.runId, createdAt: row.receipt.createdAt }; break;
    }
    case 'agent-action-call': {
      singleton(); const key = ids(id); check(key.length === 2 && z.uuid().safeParse(key[0]).success && z.string().min(1).max(200).safeParse(key[1]).success); break;
    }
    case 'agent-manual-operation': {
      singleton(); const row = firestoreAgentManualSchema.parse(raw), key = ids(id);
      check(row.childId === scope.childId && key.length === 2 && key[0] === scope.ownerUserId && z.uuid().safeParse(key[1]).success); break;
    }
  }
  return { value, metadata };
}
