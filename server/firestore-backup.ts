import { createHash } from 'node:crypto';
import { FieldPath, Timestamp, VectorValue, type Firestore, type DocumentData } from '@google-cloud/firestore';
import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import { canonical } from './firestore-session-codec.ts';
import { workRecoveryAad, workRecoveryDocumentId, workRecoverySchemas } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope, sealRecoveryLocator } from './firestore-recovery-envelope.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const scope = { ownerUserId: 'control', workspaceId: NIL, childId: NIL, storageEpoch: NIL };
const MAX_DOCUMENTS = 2000, MAX_BYTES = 32 * 1024 * 1024;
export const FIREBASE_BACKUP_COLLECTION_SUFFIXES = Object.freeze(['', '_sessions', '_children', '_tasks', '_task_revisions', '_changes',
  '_task_outbox', '_online_operations', '_documents', '_document_snapshots', '_document_chunks', '_document_operations',
  '_photos', '_photo_ops', '_photo_quota', '_photo_cleanup', '_task_reminders', '_task_reminder_batches', '_notification_preferences',
  '_notification_outbox', '_task_dispatches', '_knowledge_sources', '_knowledge_versions', '_knowledge_chunks', '_knowledge_lexical', '_knowledge_vectors',
  '_knowledge_watches', '_knowledge_observations', '_knowledge_observation_parts', '_knowledge_checks',
  '_shared_inputs', '_shared_input_parts', '_shared_input_management_revisions',
  '_chat_messages', '_chat_replies', '_chat_reply_leases', '_care_records', '_care_revisions', '_child_profiles', '_profile_revisions',
  '_context_versions', '_memory_facts', '_memory_topics', '_memory_keys', '_memory_reopened', '_memory_fact_revisions', '_memory_topic_revisions',
  '_conversation_summary_heads', '_conversation_summaries', '_agent_runs', '_agent_claims', '_agent_proposals',
  '_agent_confirmations', '_agent_confirmation_slots', '_agent_confirmation_responses', '_agent_work_index', '_agent_work_operations',
  '_agent_work_calls', '_agent_policies', '_agent_policy_revisions', '_private_instructions', '_agent_action_receipts', '_agent_action_calls',
  '_agent_manual_operations', '_agent_document_links', '_concerns', '_concern_events', '_erasures', '_erasure_receipts', '_model_settings', '_model_key_checks', '_agent_admission', '_adk', '_root_budget', '_ai_usage',
  // Append only: existing erasure cursors use stable stage ordinals.
  '_concern_revisions', '_concern_operations', '_concern_followups', '_growth_attention', '_growth_revisions', '_growth_topics', '_growth_topic_revisions', '_growth_checks',
  '_background_work', '_background_references', '_maintenance_state', '_work_watches', '_work_events', '_work_daily_slots',
  '_push_bindings', '_push_deliveries', '_push_endpoints', '_telegram_state', '_telegram_bindings', '_telegram_challenges', '_telegram_deliveries', '_telegram_pointers', '_telegram_meta', '_telegram_updates',
  '_contact_consents', '_contact_consent_revisions', '_contact_grants', '_contact_grant_revisions', '_contact_requests', '_contact_callbacks', '_contact_updates', '_contact_daily_slots', '_visit_preparations', '_visit_preparation_revisions', '_content_erasures', '_admin_policy', '_admin_invitations', '_admin_operations', '_voice_assets', '_chat_file_assets', '_voice_transcripts', '_native_push_bindings', '_native_push_deliveries', '_native_push_tokens', '_model_settings_operations', '_avatar_heads', '_avatar_uploads', '_avatar_cleanup',
  '_shared_spaces', '_shared_memberships', '_resource_shares', '_shared_invitations', '_shared_operations', '_handover_exports',
  '_handover_import_items', '_handover_import_mappings', '_handover_import_batches', '_handover_import_controls']);
export interface FirebaseBackupOptions { database: Firestore; cipher: StorageCipher; projectId: string; namespace: string }
export interface FirebaseBackupDocument { path: string; data: DocumentData }
export interface FirebaseBackupInventory {
  schema: 'yuban-firestore-backup-inventory/v1'; projectId: string; databaseId: string; namespace: string; snapshotTime: string;
  documents: { path: string; sha256: string }[]; documentCount: number; bytes: number; sha256: string;
}
export class FirebaseBackupError extends Error {
  readonly code: string;
  constructor(code: string) { super('Firebase backup rejected'); this.name = 'FirebaseBackupError'; this.code = code; }
}
function reject(code: string): never { throw new FirebaseBackupError(code); }
function optionsChecked(options: FirebaseBackupOptions) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(options.projectId) || !/^[a-z][a-z0-9_]{0,47}$/u.test(options.namespace)
    || !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u.test(options.database.databaseId)) reject('configuration');
}
function control(options: FirebaseBackupOptions, raw: unknown) {
  const envelope = z.object({ format: z.literal('yuban-work-recovery'), version: z.literal(1), ciphertext: z.string(), recovery: z.unknown() }).strict().parse(raw);
  const opened = openRecoveryEnvelope({ ...options, envelope: { family: 'authority', version: 1, ciphertext: envelope.ciphertext }, locator: envelope.recovery });
  if (opened.context.kind !== 'control' || opened.context.id !== 'current' || canonical(opened.context.scope) !== canonical(scope)) reject('control_binding');
  return workRecoverySchemas.control.parse(opened.value);
}
/** Operator-only compare-and-set. Never attached to an HTTP handler. */
export async function setFirebaseBackupControl(options: FirebaseBackupOptions,
  input: { expectedGeneration: string; generation: string; enabled: boolean }) {
  optionsChecked(options); z.object({ expectedGeneration: z.uuid(), generation: z.uuid(), enabled: z.boolean() }).strict().parse(input);
  if (input.expectedGeneration === input.generation) reject('generation_not_rotated');
  const ref = options.database.collection(options.namespace).doc(workRecoveryDocumentId('control', 'current'));
  await options.database.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref); if (!snapshot.exists) reject('control_missing');
    const current = control(options, snapshot.data());
    if (current.generation !== input.expectedGeneration) {
      if (current.generation === input.generation && current.enabled === input.enabled) return;
      reject('control_changed');
    }
    const value = { enabled: input.enabled, generation: input.generation }, aad = workRecoveryAad(options.projectId, options.namespace, 'control', 'current', scope);
    const ciphertext = options.cipher.encrypt(canonical(value), aad);
    const recovery = sealRecoveryLocator({ ...options, ciphertext, context: { family: 'authority', kind: 'control', id: 'current', scope, envelopeVersion: 1, aad } });
    transaction.set(ref, { format: 'yuban-work-recovery', version: 1, ciphertext, recovery });
  });
  const readback = await ref.get(), current = control(options, readback.data());
  if (current.generation !== input.generation || current.enabled !== input.enabled || !readback.updateTime) reject('control_readback');
  return { ...current, updatedAt: readback.updateTime.toDate().toISOString(),
    earliestSnapshotTime: new Date(Math.ceil(readback.updateTime.toMillis() / 60_000) * 60_000).toISOString() };
}
function normalized(value: unknown): unknown {
  if (value instanceof VectorValue) return ['firestore-vector', value.toArray()];
  if (value instanceof Timestamp) return ['firestore-timestamp', value.seconds, value.nanoseconds];
  if (Buffer.isBuffer(value)) return ['firestore-bytes', value.toString('base64')];
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', value];
  if (Array.isArray(value)) return ['array', value.map(normalized)];
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return ['map', Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, normalized(child)])];
  reject('unsupported_field');
}

export function firebaseBackupDocumentDigest(document: FirebaseBackupDocument): { sha256: string; bytes: number } {
  const body = canonical({ path: document.path, data: normalized(document.data) });
  return { sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
}
/** Matches the exact whole-minute snapshotTime passed to the native Firestore export. It does not create a backup. */
export async function inspectFirebaseBackupSnapshot(options: FirebaseBackupOptions, input: { snapshotTime: string; generation: string }) {
  optionsChecked(options); z.object({ snapshotTime: z.iso.datetime({ precision: 3 }), generation: z.uuid() }).strict().parse(input);
  const at = Date.parse(input.snapshotTime);
  // A completed export may be finalized after an operator interruption. Firestore validates the actual
  // PITR retention window for this exact minute; starting a new export still has its separate 55-minute gate.
  if (at % 60_000 !== 0 || at > Date.now() || Date.now() - at > 7 * 24 * 60 * 60_000) reject('snapshot_time');
  const allowed = new Set(FIREBASE_BACKUP_COLLECTION_SUFFIXES.map(suffix => options.namespace + suffix));
  const collections = await options.database.listCollections();
  if (collections.some(collection => !allowed.has(collection.id))) reject('unsupported_collection');
  const docs = await options.database.runTransaction(async transaction => {
    const values: FirebaseBackupDocument[] = []; let bytes = 0;
    async function collect(collection: ReturnType<Firestore['collection']>, nativeDepth?: number): Promise<void> {
      let cursor: string | undefined;
      while (true) {
        let query = collection.orderBy(FieldPath.documentId()).limit(100);
        if (cursor !== undefined) query = query.startAfter(cursor);
        const page = await transaction.get(query);
        for (const row of page.docs) {
          const document = { path: row.ref.path, data: row.data() }; bytes += firebaseBackupDocumentDigest(document).bytes; values.push(document);
          if (values.length > MAX_DOCUMENTS || bytes > MAX_BYTES) reject('snapshot_limit');
          // Native ADK protocol state has a fixed hierarchy. Count every encrypted event, not just the app header.
          const childCollection = nativeDepth === undefined ? undefined : ['users', 'sessions', 'events'][nativeDepth];
          if (childCollection) await collect(row.ref.collection(childCollection), nativeDepth! + 1);
        }
        if (page.size < 100) break; cursor = page.docs.at(-1)!.id;
      }
    }
    for (const collection of collections.sort((a, b) => a.id.localeCompare(b.id)))
      await collect(collection, collection.id === options.namespace + '_adk' ? 0 : undefined);
    return values;
  }, { readOnly: true, readTime: Timestamp.fromMillis(at) });
  const point = options.namespace + '/' + workRecoveryDocumentId('control', 'current');
  const current = control(options, docs.find(row => row.path === point)?.data);
  if (current.enabled || current.generation !== input.generation) reject('source_not_paused');
  const entries = docs.map(row => ({ path: row.path, ...firebaseBackupDocumentDigest(row) })).sort((a, b) => a.path.localeCompare(b.path));
  const documents = entries.map(({ path, sha256 }) => ({ path, sha256 }));
  const inventory: FirebaseBackupInventory = { schema: 'yuban-firestore-backup-inventory/v1', projectId: options.projectId,
    databaseId: options.database.databaseId, namespace: options.namespace, snapshotTime: input.snapshotTime, documents,
    documentCount: documents.length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    sha256: createHash('sha256').update(canonical(documents)).digest('hex') };
  return { inventory, documents: docs };
}
/** Compare the native import before any epoch or erasure rewrite; no missing or extra documents are accepted. */
export function assertFirebaseBackupInventory(expected: FirebaseBackupInventory, documents: FirebaseBackupDocument[]) {
  if (expected.schema !== 'yuban-firestore-backup-inventory/v1' || documents.length !== expected.documentCount
    || expected.documentCount > MAX_DOCUMENTS || expected.bytes > MAX_BYTES) reject('inventory_invalid');
  const rows = documents.map(row => ({ path: row.path, ...firebaseBackupDocumentDigest(row) })).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(rows.map(row => row.path)).size !== rows.length || rows.reduce((sum, row) => sum + row.bytes, 0) !== expected.bytes
    || canonical(rows.map(({ path, sha256 }) => ({ path, sha256 }))) !== canonical(expected.documents)
    || createHash('sha256').update(canonical(expected.documents)).digest('hex') !== expected.sha256) reject('inventory_mismatch');
}

/** A completed native export must account for every document, including otherwise invisible subcollections. */
export function assertFirebaseNativeExport(inventory: FirebaseBackupInventory, value: unknown, expectedPrefix: string) {
  const progress = z.object({ completedWork: z.string().regex(/^(0|[1-9][0-9]*)$/u) }).passthrough();
  const parsed = z.object({ done: z.literal(true), error: z.never().optional(),
    metadata: z.object({ operationState: z.literal('SUCCESSFUL'), snapshotTime: z.string(), progressDocuments: progress }).passthrough(),
    response: z.object({ outputUriPrefix: z.string() }).passthrough() }).passthrough().safeParse(value);
  if (!parsed.success || !expectedPrefix.startsWith('gs://') || expectedPrefix.endsWith('/') || expectedPrefix.includes('..')) reject('native_export_invalid');
  const result = parsed.data, prefix = result.response.outputUriPrefix;
  if ((prefix !== expectedPrefix && !prefix.startsWith(expectedPrefix + '/')) || Date.parse(result.metadata.snapshotTime) !== Date.parse(inventory.snapshotTime)
    || BigInt(result.metadata.progressDocuments.completedWork) !== BigInt(inventory.documentCount)) reject('native_export_mismatch');
  return { outputUriPrefix: prefix, documentCount: inventory.documentCount, snapshotTime: inventory.snapshotTime };
}
