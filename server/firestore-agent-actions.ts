import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import { agentPolicyUpdateSchema, agentDirectActionSchema, type AgentOperationPolicy, type AgentPrivateNote,
  type AgentActionReceipt, type AgentPolicyUpdate, type AgentDirectAction } from '../src/shared/agent-actions.ts';
import type { AgentScope } from './agent-runtime.ts';
import type { AgentActionsStore } from './agent-actions-store.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreAgentProposals } from './firestore-agent-proposals.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';
import { firestoreTaskSchema, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
import { normalizedFactKey } from './memory-policy.ts';
import { groundedRecordTime } from './agent-record-time.ts';
import { groundedRecordQuantity, type QuantityGrounding } from './agent-record-quantity.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().min(0).max(2147483646);
const permissions = z.object({ version, recordKinds: agentPolicyUpdateSchema.shape.recordKinds,
  allowPrivateNotes: z.boolean(), allowSelfTasks: z.boolean(), allowRecordCorrections: z.boolean(),
  reminderConsentVersion: agentPolicyUpdateSchema.shape.reminderConsentVersion, reminderBindings: agentPolicyUpdateSchema.shape.reminderBindings }).strict();
export const firestoreAgentPolicySchema = z.object({ value: permissions, authorizationVersion: z.string() }).strict();
export const firestorePrivateInstructionSchema = z.object({
  id: uuid, childId: uuid, version: version.min(1), title: z.string().min(1).max(100), text: z.string().min(1).max(2000),
  sourceMessageId: uuid, createdAt: time, updatedAt: time, provenance: z.literal('user_statement'), memoryKey: z.string().min(1).max(100).optional(),
}).strict();
export const firestoreAgentActionReceiptSchema = z.object({
  id: uuid, runId: uuid, kind: z.enum(['save_record', 'revise_record', 'save_private_note', 'revise_private_note', 'create_self_task', 'change_self_task']),
  resource: z.object({ kind: z.enum(['care_record', 'private_note', 'task']), id: uuid, version: version.min(1) }).strict(),
  state: z.enum(['saved', 'updated', 'scheduled', 'completed', 'cancelled']),
  notification: z.enum(['not_authorized', 'authorized_for_due_event']), channels: z.array(z.enum(['telegram', 'web_push', 'native_push'])).max(3),
  memoryOutcome: z.enum(['created', 'updated', 'duplicate']).optional(),
  sourceBasis: z.literal("voice_interpretation").optional(),
  createdAt: time, quantityGrounding: z.object({ status: z.enum(['source_supported', 'removed', 'absent', 'unchanged']) }).optional(),
}).strict();
export const firestoreAgentActionSavedSchema = z.object({
  receipt: firestoreAgentActionReceiptSchema, hash: z.string().regex(/^[a-f0-9]{64}$/u), sourceMessageId: uuid,
  sourceMessageIds: z.array(uuid).max(6), policyVersion: version,
  voiceEvidence: z.object({ kind: z.literal('voice_interpretation'), voiceId: uuid, voiceVersion: version.min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u), sourceMessageId: uuid, interpretedQuote: z.string().min(1).max(2000) }).strict().optional(),
}).strict();
export const firestoreAgentActionCallSchema = z.object({ receiptId: uuid }).strict();
export const firestoreAgentManualSchema = z.object({ childId: uuid, kind: z.enum(['policy', 'delete_note']),
  hash: z.string().regex(/^[a-f0-9]{64}$/u), result: z.union([permissions.extend({ effective: z.boolean() }), z.boolean(), z.null()]) }).strict();
const instructionKeySchema = z.object({ id: uuid }).strict();
const deletion = z.object({ expectedVersion: version.min(1), confirmDelete: z.literal(true), operationId: uuid }).strict();
type Saved = z.infer<typeof firestoreAgentActionSavedSchema>;
export interface FirestoreAgentActions extends AgentActionsStore {
  readPolicy(binding: Binding): Promise<AgentOperationPolicy>;
  readNote(binding: Binding, id: string): Promise<AgentPrivateNote | null>;
  readReceipts(binding: Binding, runId: string): Promise<Saved[]>;
}
export function createFirestoreAgentActions(options: {
  voices?: Pick<import("./firestore-voice.ts").FirestoreVoiceStore, "readEvidence">;
  runs: FirestoreAgentRuns; proposals: FirestoreAgentProposals; care: FirestoreCareStore; online: FirestoreOnlineStore;
}): FirestoreAgentActions {
  const { runs, proposals, care, online } = options, { authority, data } = runs;
  const empty = (): AgentOperationPolicy => ({ version: 0, effective: false, recordKinds: [], allowPrivateNotes: false,
    allowRecordCorrections: false, allowSelfTasks: false, reminderConsentVersion: null, reminderBindings: [] });
  const scopedId = (b: Binding) => JSON.stringify([b.scope.ownerUserId, b.scope.childId]);
  function scoped(b: Binding, suffix: string) {
    const tags = data.tags(b.scope);
    return data.collection(suffix).where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function open<T>(b: Binding, kind: string, id: string, schema: z.ZodType<T>, row: DocumentSnapshot) {
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, row);
  }
  async function readPolicy(b: Binding): Promise<AgentOperationPolicy> {
    const id = scopedId(b), row = await b.transaction.get(data.ref('agent_policies', 'agent-policy', id));
    if (!row.exists) return empty();
    const saved = open(b, 'agent-policy', id, firestoreAgentPolicySchema, row);
    if (saved.value.version !== row.get('recordVersion')) domainReject('policy_binding', 500);
    return { ...saved.value, effective: saved.authorizationVersion === b.authorizationVersion };
  }
  async function readNote(b: Binding, id: string): Promise<AgentPrivateNote | null> {
    domainParse(uuid, id); const row = await b.transaction.get(data.ref('private_instructions', 'private-instruction', id));
    if (!row.exists) return null;
    const value = open(b, 'private-instruction', id, firestorePrivateInstructionSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('instruction_binding', 500);
    return value;
  }
  const instructionKey = (b: Binding, key: string) => JSON.stringify([b.scope.ownerUserId, b.scope.childId, 'instructions', 'private', normalizedFactKey(key)]);
  async function noteByKey(b: Binding, key: string) {
    const id = instructionKey(b, key), row = await b.transaction.get(data.ref('memory_keys', 'memory-key', id));
    if (!row.exists) return null;
    const pointer = open(b, 'memory-key', id, instructionKeySchema, row);
    const note = await readNote(b, pointer.id);
    // Deleted notes never become readable through a stale pointer after recovery.
    if (note && note.memoryKey !== normalizedFactKey(key)) domainReject('instruction_key_binding', 500);
    return note;
  }
  async function readReceipts(b: Binding, runId: string) {
    const rows = await b.transaction.get(scoped(b, 'agent_action_receipts').where('runId', '==', runId).orderBy('receiptId').limit(9));
    if (rows.size > 8) domainReject('agent_action_limit');
    return rows.docs.map(row => {
      const id = domainParse(uuid, row.get('receiptId'), 'receipt_binding', 500);
      const value = open(b, 'agent-action-receipt', id, firestoreAgentActionSavedSchema, row);
      if (value.receipt.id !== id || value.receipt.runId !== runId) domainReject('receipt_binding', 500);
      return value;
    });
  }
  async function manual(b: Binding, operationId: string, kind: 'policy' | 'delete_note', raw: unknown) {
    const id = JSON.stringify([b.scope.ownerUserId, operationId]), ref = data.ref('agent_manual_operations', 'agent-manual-operation', id);
    const row = await b.transaction.get(ref), hash = firestoreDomainHash(raw);
    let prior: z.infer<typeof firestoreAgentManualSchema> | null = null;
    if (row.exists) {
      if (Object.entries(data.tags(b.scope)).some(([key, tag]) => row.get(key) !== tag)) domainReject('operation_conflict');
      prior = data.open('agent-manual-operation', id, b.scope, firestoreAgentManualSchema, row);
      if (prior.kind !== kind || prior.hash !== hash || prior.childId !== b.scope.childId) domainReject('operation_conflict');
    }
    return { prior, save(result: z.infer<typeof firestoreAgentManualSchema>['result']) {
      const envelope = { ...data.tags(b.scope), ...data.seal('agent-manual-operation', id, b.scope, firestoreAgentManualSchema,
        { childId: b.scope.childId, kind, hash, result }) }; b.transaction.create(ref, envelope);
    } };
  }
  return {
    readPolicy, readNote, readReceipts,
    records: (u, c, query) => care.search(u, c, { query }),
    policy: (u, c) => authority.runTransaction(u, c, readPolicy),
    async savePolicy(userId: string, childId: string, raw: AgentPolicyUpdate) {
      const input = domainParse(agentPolicyUpdateSchema, raw);
      return authority.runTransaction(userId, childId, async b => {
        const receipt = await manual(b, input.operationId, 'policy', input), current = await readPolicy(b);
        if (receipt.prior) {
          const previous = domainParse(permissions.extend({ effective: z.boolean() }), receipt.prior.result, 'receipt_binding', 500);
          return { ...previous, effective: previous.effective && current.effective && previous.version === current.version };
        }
        if (current.version !== input.expectedVersion) domainReject('version_conflict');
        // Notification grants are wired in F06; never pretend an unconnected grant is effective.
        if (input.reminderBindings.length || current.reminderBindings.length) domainReject('contact_services_required_for_revocation');
        const { operationId: _op, expectedVersion: _version, confirm: _confirm, confirmShared: _shared, ...values } = input;
        const value: AgentOperationPolicy = { ...values, version: current.version + 1, effective: true };
        const id = scopedId(b), { effective: _effective, ...savedValues } = value;
        const saved = { value: savedValues, authorizationVersion: b.authorizationVersion };
        const envelope = { ...data.tags(b.scope), ...data.seal('agent-policy', id, b.scope, firestoreAgentPolicySchema, saved, value.version) };
        const revisionId = JSON.stringify([id, value.version]);
        const revision = { ...data.tags(b.scope), ...data.seal('agent-policy-revision', revisionId, b.scope, firestoreAgentPolicySchema, saved, value.version) };
        const change = await b.prepareChange(input.operationId, 'preferences', false);
        change.commit(); b.transaction.set(data.ref('agent_policies', 'agent-policy', id), envelope);
        b.transaction.create(data.ref('agent_policy_revisions', 'agent-policy-revision', revisionId), revision); receipt.save(value); return value;
      });
    },
    async notesByKeys(userId, childId, keys) {
      domainParse(z.array(z.string().min(1).max(100)).min(1).max(4), keys);
      return authority.runTransaction(userId, childId, async b => {
        const items: AgentPrivateNote[] = [], missingKeys: string[] = [];
        for (const key of new Set(keys.map(normalizedFactKey))) {
          const note = await noteByKey(b, key);
          if (note) items.push(note); else missingKeys.push(key);
        }
        return { items, missingKeys, legacyUnkeyedNotSearched: true as const };
      });
    },
    async notes(userId, childId, rawQuery = '', afterId) {
      const search = domainParse(z.string().max(2000), rawQuery).toLocaleLowerCase('zh-HK'); if (afterId) domainParse(uuid, afterId);
      return authority.runTransaction(userId, childId, async b => {
        let query = scoped(b, 'private_instructions').orderBy('noteId').limit(201); if (afterId) query = query.startAfter(afterId);
        const rows = await b.transaction.get(query), items: AgentPrivateNote[] = []; let scanned = 0;
        for (const row of rows.docs.slice(0, 200)) {
          scanned++; const id = domainParse(uuid, row.get('noteId'), 'instruction_binding', 500);
          const item = open(b, 'private-instruction', id, firestorePrivateInstructionSchema, row);
          if ((item.title + '\n' + item.text).toLocaleLowerCase('zh-HK').includes(search)) items.push(item);
          if (items.length === 20) break;
        }
        return { items, nextAfterId: scanned < rows.size && scanned ? rows.docs[scanned - 1].get('noteId') as string : null };
      });
    },
    async deleteNote(userId, childId, noteId, raw) {
      domainParse(uuid, noteId); const input = domainParse(deletion, raw);
      return authority.runTransaction(userId, childId, async b => {
        const receipt = await manual(b, input.operationId, 'delete_note', { noteId, ...input });
        if (receipt.prior) return domainParse(z.boolean().nullable(), receipt.prior.result, 'receipt_binding', 500);
        const note = await readNote(b, noteId);
        if (note && note.version !== input.expectedVersion) domainReject('version_conflict');
        const context = note ? await prepareContextChange(data, b) : null;
        const change = note ? await b.prepareChange(input.operationId, 'memory', true) : null;
        context?.(); change?.commit();
        if (note) {
          b.transaction.delete(data.ref('private_instructions', 'private-instruction', noteId));
          if (note.memoryKey) b.transaction.delete(data.ref('memory_keys', 'memory-key', instructionKey(b, note.memoryKey)));
        }
        receipt.save(note ? true : null); return note ? true : null;
      });
    },
    receipts: (u, c, runId) => authority.runTransaction(u, c, async b => {
      await runs.read(b, runId); return (await readReceipts(b, runId)).map(item => item.receipt);
    }),
    async execute(scope: AgentScope, runId: string, callId: string, raw: AgentDirectAction) {
      const input = domainParse(agentDirectActionSchema, raw), hash = firestoreDomainHash(input);
      domainParse(uuid, runId); domainParse(z.string().min(1).max(200), callId);
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        const originalRun = await runs.read(b, runId), saved = await readReceipts(b, runId);
        const key = JSON.stringify([runId, callId]), callRef = data.ref('agent_action_calls', 'agent-action-call', key);
        const row = await b.transaction.get(callRef);
        if (row.exists) {
          const pointer = open(b, 'agent-action-call', key, firestoreAgentActionCallSchema, row);
          const prior = saved.find(item => item.receipt.id === pointer.receiptId);
          if (!prior || prior.hash !== hash) domainReject('agent_call_conflict'); return prior.receipt;
        }
        const equivalent = saved.find(item => item.hash === hash);
        const saveCall = (receiptId: string) => b.transaction.create(callRef, { ...data.tags(b.scope),
          ...data.seal('agent-action-call', key, b.scope, firestoreAgentActionCallSchema, { receiptId }) });
        if (equivalent) { saveCall(equivalent.receipt.id); return equivalent.receipt; }
        const run = await runs.requireLive(b, scope, originalRun.id);
        if (run.trigger.kind !== 'interactive' || !run.sourceMessageId) domainReject('agent_run_expired');
        if (saved.length >= 8) domainReject('agent_action_limit');
        const original = await proposals.source(b, run, run.sourceMessageId);
        const voiceEvidence = input.sourceBasis === 'voice_interpretation' ? (() => {
          if (!original.voice || !options.voices) domainReject('agent_source_mismatch');
          return options.voices.readEvidence(b, original.id, original.voice);
        })() : undefined;
        const audioSource = voiceEvidence ? { ...await voiceEvidence, interpretedQuote: input.sourceQuote } : undefined;
        if (!audioSource && !original.text.includes(input.sourceQuote)) domainReject('agent_source_mismatch');
        const sources = [{ quote: input.sourceQuote, original: audioSource ? input.sourceQuote : original.text }];
        for (const ref of input.sourceMessages ?? []) {
          const old = await proposals.source(b, run, ref.messageId);
          if (!old.text.includes(ref.quote)) domainReject('agent_source_mismatch');
          sources.push({ quote: ref.quote, original: old.text });
        }
        const policy = await readPolicy(b);
        if (!policy.effective || policy.version !== input.expectedPolicyVersion) domainReject('agent_policy_changed');
        const receiptId = randomUUID(), at = new Date().toISOString();
        let prepared: { changeSeq: string; commit(): void }, resource: AgentActionReceipt['resource'], state: AgentActionReceipt['state'];
        let quantity: QuantityGrounding | undefined, memoryOutcome: AgentActionReceipt['memoryOutcome'];
        if (input.kind === 'save_record' || input.kind === 'revise_record') {
          if (!policy.recordKinds.includes(input.details.kind)) domainReject('agent_policy_denied');
          const grounded = sources.map(item => groundedRecordQuantity(input.details.quantity, input.quantityEvidence, item.quote, item.original));
          quantity = grounded.find(item => item.status === 'source_supported') ?? grounded[0];
          let details = { ...groundedRecordTime(input.details, sources.map(item => item.quote).join('\n')), quantity: quantity.quantity };
          if (input.kind === 'revise_record') {
            if (!policy.allowRecordCorrections) domainReject('agent_policy_denied');
            const old = await care.readRecord(b, input.recordId);
            if (!old || old.authorUserId !== scope.userId || old.version !== input.expectedVersion) domainReject('version_conflict');
            if (old.details.kind !== input.details.kind) domainReject('agent_policy_denied');
            if (firestoreDomainHash(old.details.eventTime) === firestoreDomainHash(input.details.eventTime)) details.eventTime = old.details.eventTime;
            if (firestoreDomainHash(old.details.quantity) === firestoreDomainHash(input.details.quantity)) {
              details.quantity = old.details.quantity; quantity = { quantity: old.details.quantity, status: 'unchanged' };
            }
          }
          const change = await care.prepareRecord(b, receiptId, { text: input.text, details,
            source: audioSource ? '依本人預先授權，由 Agent 聽取原錄音整理的使用者陳述；非逐字文字或已確認事實' : '依本人預先授權，由 Agent 整理的使用者陳述；未逐項確認為事實' },
          { basis: 'preauthorized_user_statement', ...(input.kind === 'revise_record'
            ? { id: input.recordId, expectedVersion: input.expectedVersion, reason: input.reason } : {}) });
          prepared = change; resource = { kind: 'care_record', id: change.value.id, version: change.value.version };
          state = input.kind === 'save_record' ? 'saved' : 'updated';
        } else if (input.kind === 'save_private_note' || input.kind === 'revise_private_note') {
          if (!policy.allowPrivateNotes) domainReject('agent_policy_denied');
          const key = input.memoryKey ? domainParse(z.string().min(1).max(100), normalizedFactKey(input.memoryKey)) : undefined;
          const old = input.kind === 'revise_private_note' ? await readNote(b, input.noteId) : key ? await noteByKey(b, key) : null;
          if (input.kind === 'revise_private_note' && (!old || old.version !== input.expectedVersion)) domainReject('version_conflict');
          if (key && old?.memoryKey && key !== old.memoryKey) domainReject('instruction_key_conflict');
          if (key && old && !old.memoryKey) {
            const existing = await noteByKey(b, key);
            if (existing && existing.id !== old.id) domainReject('instruction_key_conflict');
          }
          const duplicate = old && old.title === input.title && old.text === input.text && (!key || old.memoryKey === key);
          // A matching subject does not authorize overwriting content or treating two events as the same event.
          if (input.kind === 'save_private_note' && old && !duplicate) domainReject('instruction_key_conflict');
          if (duplicate) {
            prepared = { changeSeq: b.changeSeq, commit() {} };
            resource = { kind: 'private_note', id: old.id, version: old.version }; state = 'saved'; memoryOutcome = 'duplicate';
          } else {
            const memoryKey = old?.memoryKey ?? key;
            const value: AgentPrivateNote = { id: old?.id ?? randomUUID(), childId: scope.childId, version: (old?.version ?? 0) + 1,
              title: input.title, text: input.text, sourceMessageId: run.sourceMessageId, provenance: 'user_statement',
              createdAt: old?.createdAt ?? at, updatedAt: at, ...(memoryKey ? { memoryKey } : {}) };
            const envelope = { ...data.tags(b.scope), noteId: value.id, createdAt: value.createdAt,
              ...data.seal('private-instruction', value.id, b.scope, firestorePrivateInstructionSchema, value, value.version) };
            const keyId = memoryKey ? instructionKey(b, memoryKey) : null;
            const keyEnvelope = keyId ? { ...data.tags(b.scope), ...data.seal('memory-key', keyId, b.scope, instructionKeySchema, { id: value.id }) } : null;
            const context = await prepareContextChange(data, b), change = await b.prepareChange(receiptId, 'memory', false);
            prepared = { changeSeq: change.changeSeq, commit() {
              context(); change.commit(); b.transaction.set(data.ref('private_instructions', 'private-instruction', value.id), envelope);
              if (keyId && keyEnvelope) b.transaction.set(data.ref('memory_keys', 'memory-key', keyId), keyEnvelope);
            } };
            resource = { kind: 'private_note', id: value.id, version: value.version }; state = old ? 'updated' : 'saved';
            memoryOutcome = old ? 'updated' : 'created';
          }
        } else {
          if (!policy.allowSelfTasks) domainReject('agent_policy_denied');
          let command: unknown, taskId: string | undefined;
          if (input.kind === 'create_self_task') {
            if (Date.parse(input.dueAt) <= Date.now()) domainReject('agent_due_not_future');
            command = { confirm: true, values: { kind: 'ordinary', title: input.title, details: input.details,
              assigneeUserId: scope.userId, dueAt: input.dueAt, timeZone: input.timeZone } };
          } else {
            taskId = input.taskId;
            const taskRow = await b.transaction.get(data.ref('tasks', 'task', taskId));
            if (!taskRow.exists) domainReject('not_found', 404);
            const task = open(b, 'task', taskId, firestoreTaskSchema, taskRow);
            if (task.createdBy !== scope.userId || task.assigneeUserId !== scope.userId || task.kind !== 'ordinary') domainReject('not_found', 404);
            if (task.version !== input.expectedVersion || task.occurrence.state !== 'scheduled') domainReject('version_conflict');
            if (input.action === 'reschedule' && Date.parse(input.dueAt!) <= Date.now()) domainReject('agent_due_not_future');
            command = { action: input.action, expectedVersion: input.expectedVersion, confirm: true, note: input.note,
              ...(input.action === 'reschedule' ? { dueAt: input.dueAt, timeZone: input.timeZone, assigneeUserId: scope.userId } : {}) };
          }
          const change = await online.prepareTask(b, scope.childId, taskId, command, receiptId);
          prepared = change; resource = { kind: 'task', id: change.task.id, version: change.task.version };
          state = change.task.occurrence.state === 'completed' ? 'completed' : change.task.occurrence.state === 'cancelled' ? 'cancelled' : 'scheduled';
        }
        const receipt: AgentActionReceipt = { id: receiptId, runId, kind: input.kind, resource, state, notification: 'not_authorized',
          channels: [], createdAt: at, ...(audioSource ? { sourceBasis: 'voice_interpretation' as const } : {}), ...(memoryOutcome ? { memoryOutcome } : {}), ...(quantity ? { quantityGrounding: { status: quantity.status } } : {}) };
        const value: Saved = { receipt, hash, sourceMessageId: run.sourceMessageId,
          sourceMessageIds: (input.sourceMessages ?? []).map(item => item.messageId), policyVersion: policy.version, ...(audioSource ? { voiceEvidence: audioSource } : {}) };
        const envelope = { ...data.tags(b.scope), runId, receiptId,
          ...data.seal('agent-action-receipt', receiptId, b.scope, firestoreAgentActionSavedSchema, value) };
        prepared.commit(); b.transaction.create(data.ref('agent_action_receipts', 'agent-action-receipt', receiptId), envelope);
        saveCall(receiptId);
        // A duplicate has a new operation receipt but no new business version/change sequence.
        if (memoryOutcome !== 'duplicate') runs.advance(b, run, prepared.changeSeq);
        return receipt;
      });
    },
  };
}
