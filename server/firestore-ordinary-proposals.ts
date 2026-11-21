import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentPrivateNoteSchema, type AgentPrivateNote } from '../src/shared/agent-actions.ts';
import { groundedRecordQuantity } from './agent-record-quantity.ts';
import { groundedRecordTime } from './agent-record-time.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreAgentProposal, FirestoreAgentProposalExtension } from './firestore-agent-proposals.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { createFirestorePrivateInstructions } from './firestore-private-instructions.ts';
import { normalizedFactKey } from './memory-policy.ts';

const careKindLabels: Record<'note' | 'feeding' | 'sleep' | 'diaper', string> = {
  note: '日常備註',
  feeding: '餵食',
  sleep: '睡眠',
  diaper: '換片',
};

export function createFirestoreOrdinaryProposalsExtension(options: {
  runs: FirestoreAgentRuns;
  chat: FirestoreChatStore;
  care: FirestoreCareStore;
  voices?: Pick<import('./firestore-voice.ts').FirestoreVoiceStore, 'readEvidence'>;
}): FirestoreAgentProposalExtension {
  const { runs, chat, care } = options;
  const { data } = runs;
  const instructions = createFirestorePrivateInstructions(data);

  async function verifySourceQuote(
    b: Binding,
    runId: string,
    sourceQuote: string,
    sourceBasis?: 'voice_interpretation',
  ): Promise<{ run: Awaited<ReturnType<FirestoreAgentRuns['read']>>; originalText: string }> {
    const run = await runs.read(b, runId);
    if (!run.sourceMessageId) domainReject('agent_run_expired');
    const original = await chat.readMessage(b, b.scope.childId, run.sourceMessageId);
    if (!original || original.role !== 'user' || original.authorUserId !== b.scope.ownerUserId) {
      domainReject('source_changed');
    }
    if (sourceBasis === 'voice_interpretation') {
      if (!original.voice || !options.voices) domainReject('agent_source_mismatch');
      await options.voices.readEvidence(b, original.id, original.voice);
      return { run, originalText: sourceQuote };
    }
    if (!original.text.includes(sourceQuote)) domainReject('agent_source_mismatch');
    return { run, originalText: original.text };
  }

  return {
    supports(value) {
      return value.kind === 'care_record_create'
        || value.kind === 'care_record_revise'
        || value.kind === 'private_note_create'
        || value.kind === 'private_note_revise';
    },

    async target(b: Binding, value) {
      if (value.kind === 'care_record_create') {
        return {
          label: careKindLabels[value.details.kind],
          visibility: 'family',
          sourceBasis: value.sourceBasis ?? null,
        };
      }
      if (value.kind === 'care_record_revise') {
        const existing = await care.readRecord(b, value.recordId);
        if (!existing || existing.authorUserId !== b.scope.ownerUserId || existing.version !== value.expectedVersion) {
          domainReject('version_conflict');
        }
        if (existing.details.kind !== value.details.kind) {
          domainReject('invalid_input', 400);
        }
        return {
          label: careKindLabels[value.details.kind],
          visibility: 'family',
          sourceBasis: value.sourceBasis ?? null,
        };
      }
      if (value.kind === 'private_note_create') {
        if (value.memoryKey) {
          const key = domainParse(z.string().min(1).max(100), normalizedFactKey(value.memoryKey));
          const existing = await instructions.byKey(b, key);
          if (existing && !(existing.title === value.title && existing.text === value.text && existing.memoryKey === key)) {
            domainReject('instruction_key_conflict');
          }
        }
        return { label: value.title, visibility: 'private', sourceBasis: null };
      }
      if (value.kind === 'private_note_revise') {
        const existing = await instructions.read(b, value.noteId);
        if (!existing || existing.version !== value.expectedVersion) {
          domainReject('version_conflict');
        }
        if (value.memoryKey) {
          const key = domainParse(z.string().min(1).max(100), normalizedFactKey(value.memoryKey));
          if (existing.memoryKey && key !== existing.memoryKey) domainReject('instruction_key_conflict');
          if (!existing.memoryKey) {
            const other = await instructions.byKey(b, key);
            if (other && other.id !== existing.id) domainReject('instruction_key_conflict');
          }
        }
        return { label: value.title, visibility: 'private', sourceBasis: null };
      }
      domainReject('invalid_input', 400);
    },

    async prepare(b: Binding, saved: FirestoreAgentProposal, operationId: string) {
      const value = saved.proposal.value;
      if (value.kind === 'care_record_create' || value.kind === 'care_record_revise') {
        const { originalText } = await verifySourceQuote(b, saved.proposal.runId, value.sourceQuote, value.sourceBasis);
        const grounded = groundedRecordQuantity(value.details.quantity, value.quantityEvidence, value.sourceQuote, originalText);
        let details = {
          ...groundedRecordTime(value.details, value.sourceQuote),
          quantity: grounded.quantity,
        };
        if (value.kind === 'care_record_revise') {
          const old = await care.readRecord(b, value.recordId);
          if (!old || old.authorUserId !== b.scope.ownerUserId || old.version !== value.expectedVersion) {
            domainReject('version_conflict');
          }
          if (old.details.kind !== value.details.kind) domainReject('invalid_input', 400);
          if (firestoreDomainHash(old.details.eventTime) === firestoreDomainHash(value.details.eventTime)) {
            details.eventTime = old.details.eventTime;
          }
          if (firestoreDomainHash(old.details.quantity) === firestoreDomainHash(value.details.quantity)) {
            details.quantity = old.details.quantity;
          }
        }
        const prepared = await care.prepareRecord(
          b,
          operationId,
          {
            text: value.text,
            details,
            source: value.sourceBasis === 'voice_interpretation'
              ? '由本人聊天語音整理並經明確確認的使用者陳述；非逐字文字'
              : '由本人聊天整理並經明確確認的使用者陳述',
          },
          {
            basis: 'explicit',
            ...(value.kind === 'care_record_revise'
              ? { id: value.recordId, expectedVersion: value.expectedVersion, reason: value.reason }
              : {}),
          },
        );
        return {
          changeSeq: prepared.changeSeq,
          commit: prepared.commit,
          result: { kind: 'care_record', id: prepared.value.id, version: prepared.value.version },
        };
      }

      if (value.kind === 'private_note_create' || value.kind === 'private_note_revise') {
        const { run } = await verifySourceQuote(b, saved.proposal.runId, value.sourceQuote);
        const key = value.memoryKey ? domainParse(z.string().min(1).max(100), normalizedFactKey(value.memoryKey)) : undefined;
        const old = value.kind === 'private_note_revise'
          ? await instructions.read(b, value.noteId)
          : key ? await instructions.byKey(b, key) : null;
        if (value.kind === 'private_note_revise' && (!old || old.version !== value.expectedVersion)) {
          domainReject('version_conflict');
        }
        if (key && old?.memoryKey && key !== old.memoryKey) domainReject('instruction_key_conflict');
        if (key && old && !old.memoryKey) {
          const existing = await instructions.byKey(b, key);
          if (existing && existing.id !== old.id) domainReject('instruction_key_conflict');
        }
        const duplicate = old && old.title === value.title && old.text === value.text && (!key || old.memoryKey === key);
        if (value.kind === 'private_note_create' && old && !duplicate) domainReject('instruction_key_conflict');
        if (duplicate) {
          return {
            changeSeq: b.changeSeq,
            commit() {},
            result: { kind: 'private_note', id: old.id, version: old.version },
          };
        }
        const now = new Date().toISOString();
        const memoryKey = old?.memoryKey ?? key;
        const nextNote: AgentPrivateNote = domainParse(agentPrivateNoteSchema, {
          id: old?.id ?? randomUUID(),
          childId: b.scope.childId,
          version: (old?.version ?? 0) + 1,
          title: value.title,
          text: value.text,
          sourceMessageId: run.sourceMessageId,
          provenance: 'user_statement',
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          ...(memoryKey ? { memoryKey } : {}),
          ...(old?.importedFrom ? { importedFrom: old.importedFrom } : {}),
        });
        const prepared = await instructions.prepareWrite(b, operationId, nextNote, old ?? null);
        return {
          changeSeq: prepared.changeSeq,
          commit: prepared.commit,
          result: { kind: 'private_note', id: prepared.value.id, version: prepared.value.version },
        };
      }

      domainReject('invalid_input', 400);
    },
  };
}
