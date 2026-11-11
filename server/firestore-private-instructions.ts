import { randomUUID } from 'node:crypto';
import { memoryUpdateDate } from './handover-memory-dates.ts';
import { z } from 'zod';
import { agentPrivateNoteSchema, type AgentPrivateNote } from '../src/shared/agent-actions.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject } from './firestore-domain-data.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
import { normalizedFactKey } from './memory-policy.ts';
import { makeImportProvenance } from './handover-provenance.ts';
import { privateInstructionErasureOperationId } from './firebase-erasure-journal.ts';
import type { HandoverImportRow } from './handover-import.ts';
import { readPrivateInstructionDeletion } from './firestore-content-erasure.ts';
import { readImportMapping, type HandoverImportResolution } from './handover-import-records.ts';

export const firestorePrivateInstructionSchema = agentPrivateNoteSchema;
const keySchema = z.object({ id: z.uuid() }).strict();

/** The same encrypted records and subject index serve ordinary Agent writes and explicit imports. */
export function createFirestorePrivateInstructions(data: FirestoreDomainData) {
  const ref = (id: string) => data.ref('private_instructions', 'private-instruction', id);
  const keyId = (b: Binding, key: string) => JSON.stringify([b.scope.ownerUserId, b.scope.childId, 'instructions', 'private', normalizedFactKey(key)]);
  function checkScope(b: Binding, row: { get(name: string): unknown }) {
    if (b.sharedAccess || b.scope.ownerUserId !== b.actorUserId) domainReject('private_scope_unavailable', 403);
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
  }
  async function read(b: Binding, id: string): Promise<AgentPrivateNote | null> {
    domainParse(z.uuid(), id);
    const row = await b.transaction.get(ref(id)); if (!row.exists) return null;
    checkScope(b, row);
    const value = data.open('private-instruction', id, b.scope, firestorePrivateInstructionSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('instruction_binding', 500);
    return value;
  }
  async function readImportState(b: Binding, id: string) {
    if (b.sharedAccess || b.scope.ownerUserId !== b.actorUserId) domainReject('private_scope_unavailable', 403);
    const value = await read(b, id);
    const deletion = value ? null : await readPrivateInstructionDeletion(data, b, id);
    return { value, version: value?.version ?? deletion?.version ?? 0 };
  }
  async function byKey(b: Binding, key: string) {
    const id = keyId(b, key), row = await b.transaction.get(data.ref('memory_keys', 'memory-key', id));
    if (!row.exists) return null;
    checkScope(b, row);
    const pointer = data.open('memory-key', id, b.scope, keySchema, row), note = await read(b, pointer.id);
    if (note && note.memoryKey !== normalizedFactKey(key)) domainReject('instruction_key_binding', 500);
    return note;
  }
  async function prepareWrite(b: Binding, operationId: string, value: AgentPrivateNote, previous: AgentPrivateNote | null) {
    if (b.sharedAccess || b.scope.ownerUserId !== b.actorUserId) domainReject('private_scope_unavailable', 403);
    domainParse(z.uuid(), operationId);
    const next = domainParse(firestorePrivateInstructionSchema, value);
    if (next.childId !== b.scope.childId || next.version !== (previous?.version ?? 0) + 1 || previous && next.id !== previous.id)
      domainReject('instruction_binding', 500);
    if (!previous) {
      const deletion = data.ref('content_erasures', 'content-erasure', privateInstructionErasureOperationId(b.scope, next.id));
      const [current, retired] = await Promise.all([b.transaction.get(ref(next.id)), b.transaction.get(deletion)]);
      if (current.exists || retired.exists) domainReject('version_conflict');
    }
    if (previous?.memoryKey && next.memoryKey !== previous.memoryKey) domainReject('instruction_key_conflict');
    if (next.memoryKey) {
      if (normalizedFactKey(next.memoryKey) !== next.memoryKey) domainReject('invalid_package_data', 400);
      const other = await byKey(b, next.memoryKey);
      if (other && other.id !== next.id) domainReject('instruction_key_conflict');
    }
    const envelope = { ...data.tags(b.scope), noteId: next.id, createdAt: next.createdAt,
      ...data.seal('private-instruction', next.id, b.scope, firestorePrivateInstructionSchema, next, next.version) };
    const key = next.memoryKey ? keyId(b, next.memoryKey) : null;
    const keyEnvelope = key ? { ...data.tags(b.scope), ...data.seal('memory-key', key, b.scope, keySchema, { id: next.id }) } : null;
    const context = await prepareContextChange(data, b, { resource: { domain: 'private_note', id: next.id } }), change = await b.prepareChange(operationId, 'memory', false);
    return { value: next, changeSeq: change.changeSeq, commit() {
      context(); change.commit(); b.transaction.set(ref(next.id), envelope);
      if (key && keyEnvelope) b.transaction.set(data.ref('memory_keys', 'memory-key', key), keyEnvelope);
    } };
  }
  async function prepareValue(b: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    previous: AgentPrivateNote | null, restoreOriginal?: true) {
    const source = domainParse(firestorePrivateInstructionSchema, row.value, 'invalid_package_data', 400);
    const at = new Date().toISOString(), importedFrom = makeImportProvenance(row, integrity, b.actorUserId, at);
    return prepareWrite(b, operationId, { ...source, id: previous?.id ?? randomUUID(), childId: b.scope.childId,
      version: (previous?.version ?? 0) + 1, sourceMessageId: null, provenance: 'imported_source', importedFrom,
      createdAt: previous?.createdAt ?? source.createdAt, updatedAt: restoreOriginal ? at : memoryUpdateDate('instructions', source) ?? at }, previous);
  }
  return { read, readImportState, byKey, keyId, prepareWrite,
    async prepareOriginal(b: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity, resolution: HandoverImportResolution) {
      if (row.section !== 'instructions') domainReject('invalid_package_data', 400);
      const source = domainParse(firestorePrivateInstructionSchema, row.value, 'invalid_package_data', 400);
      if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || row.source.accountId !== b.actorUserId
        || row.childId !== b.scope.childId || source.childId !== b.scope.childId) domainReject('invalid_import_target', 403);
      const { mapping } = await readImportMapping(data, b, { serverId: row.source.serverId, accountId: row.source.accountId, childId: row.childId, section: row.section, resourceId: source.id }, true);
      const targetId = mapping?.target.id ?? source.id, state = await readImportState(b, targetId);
      if (resolution.mode === 'preserve' || resolution.targetId !== targetId || resolution.expectedVersion !== state.version
        || state.version === 0 || (resolution.mode === 'restore_deleted') !== (state.value === null)) domainReject('version_conflict');
      return prepareValue(b, operationId, row, integrity, state.value, true);
    },
    async prepareImported(b: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
      current?: { id: string; expectedVersion: number }, restoreOriginal?: true) {
      if (row.section !== 'instructions') domainReject('invalid_package_data', 400);
      const source = domainParse(firestorePrivateInstructionSchema, row.value, 'invalid_package_data', 400);
      if (restoreOriginal && (!current || current.id !== source.id || source.childId !== b.scope.childId
        || row.source.accountId !== b.actorUserId || b.scope.ownerUserId !== b.actorUserId || b.sharedAccess))
        domainReject('invalid_import_target', 403);
      const previous = current ? await read(b, current.id) : null;
      if (current && (!previous || previous.version !== current.expectedVersion)) domainReject('version_conflict');
      return prepareValue(b, operationId, row, integrity, previous, restoreOriginal);
    },
  };
}
