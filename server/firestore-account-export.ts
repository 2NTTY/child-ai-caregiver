import { FieldPath, type Query } from '@google-cloud/firestore';
import { z } from 'zod';
import type { AccountExportPage } from '../src/shared/account-service.ts';
import { createFirestoreAuthority, type FirestoreAuthorityOptions, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { FirestoreFamilyDocumentSnapshots, firestoreSnapshotManifestSchema } from './firestore-family-document-snapshots.ts';
import { firestorePhotoSchemas, type createFirestorePhotoStore } from './firestore-photos.ts';
import { createFirestoreSharedInputStore } from './firestore-shared-inputs.ts';
import { firestorePushBindingSchema, firestorePushDeliverySchema } from './firestore-web-push.ts';
import { firestoreTelegramBindingSchema, firestoreTelegramDeliverySchema } from './firestore-telegram.ts';
import { firestoreContactRequestSchema, firestoreContactConsentSchema, firestoreContactGrantSchema } from './firestore-contact.ts';

/** Product sections only. Auth credentials, model keys, protocol state and cost/admission ledgers are never exported. */
const sections = {
  children: ['children', ['child-projection']],
  profile: ['child_profiles', ['child-profile']], profile_history: ['profile_revisions', ['profile-revision']],
  care: ['care_records', ['care-record', 'care-tombstone']], care_history: ['care_revisions', ['care-revision']],
  chat: ['chat_messages', ['chat-message']], instructions: ['private_instructions', ['private-instruction']],
  agent_policy: ['agent_policies', ['agent-policy']], agent_policy_history: ['agent_policy_revisions', ['agent-policy-revision']],
  agent_work: ['agent_work_index', ['agent-work-index']], agent_runs: ['agent_runs', ['agent-run']],
  agent_receipts: ['agent_action_receipts', ['agent-action-receipt']],
  agent_proposals: ['agent_proposals', ['agent-proposal']], agent_confirmations: ['agent_confirmations', ['agent-confirmation']],
  memory_facts: ['memory_facts', ['memory-fact', 'memory-tombstone']], memory_fact_history: ['memory_fact_revisions', ['memory-fact-revision']],
  memory_topics: ['memory_topics', ['memory-topic', 'memory-tombstone']], memory_topic_history: ['memory_topic_revisions', ['memory-topic-revision']],
  visit_preparation: ['visit_preparations', ['visit-preparation']], visit_preparation_history: ['visit_preparation_revisions', ['visit-preparation-revision']],
  summary_history: ['conversation_summaries', ['conversation-summary']],
  tasks: ['tasks', ['task']], task_history: ['task_revisions', ['task-revision']],
  documents: ['documents', ['family-document']], document_versions: ['document_snapshots', ['document-snapshot']],
  document_content: ['document_snapshots', ['document-snapshot']],
  photos: ['photos', ['photo']], photo_content: ['photos', ['photo']],
  private_sources: ['shared_inputs', ['shared-input', 'shared-input-tombstone']],
  private_source_history: ['shared_input_management_revisions', ['shared-input-management']],
  concerns: ['concerns', ['concern']], concern_events: ['concern_events', ['concern-event']], concern_history: ['concern_revisions', ['concern-revision']],
  growth_attention: ['growth_attention', ['growth-attention']], growth_topics: ['growth_topics', ['growth-topic']],
  work_followups: ['work_events', ['work-event']],
  notification_preferences: ['notification_preferences', ['notification-preferences']],
  push_bindings: ['push_bindings', ['push-binding']], push_deliveries: ['push_deliveries', ['push-delivery']],
  telegram_bindings: ['telegram_bindings', ['telegram-binding']], telegram_deliveries: ['telegram_deliveries', ['telegram-delivery']],
  contact_consents: ['contact_consents', ['contact-consent']], contact_grants: ['contact_grants', ['contact-grant']], contact_requests: ['contact_requests', ['contact-request']],
} as const;
const global = new Set(['manifest', 'account', 'children', 'notification_preferences', 'push_bindings', 'push_deliveries', 'telegram_bindings', 'telegram_deliveries']);
const querySchema = z.object({ section: z.string().max(80), childId: z.uuid().optional(),
  scopeVersion: z.string().regex(/^[a-f0-9]{64}$/u).optional(), cursor: z.string().max(16000).optional() }).strict();
const cursorSchema = z.object({ userId: z.string(), section: z.string(), childId: z.uuid().nullable(), scopeVersion: z.string(), after: z.string().max(2000) }).strict();
export function createFirestoreAccountExport(options: FirestoreAuthorityOptions & {
  photos: Pick<ReturnType<typeof createFirestorePhotoStore>, 'content'>;
}) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), snapshots = new FirestoreFamilyDocumentSnapshots(options);
  function version(binding: FirestoreAuthorityTransaction) {
    return firestoreDomainHash([binding.scope.ownerUserId, binding.scope.workspaceId, binding.scope.storageEpoch, binding.authorizationVersion, binding.changeSeq]);
  }
  const aad = (owner: string) => 'firestore-account-export:1:' + owner;
  const encode = (value: z.infer<typeof cursorSchema>) => Buffer.from(options.cipher.encrypt(JSON.stringify(value), aad(value.userId))).toString('base64url');
  function decode(raw: string, owner: string) {
    try { return cursorSchema.parse(JSON.parse(options.cipher.decrypt(Buffer.from(raw, 'base64url').toString(), aad(owner)))); }
    catch { return domainReject('invalid_export_cursor', 400); }
  }
  async function page(owner: string, raw: unknown): Promise<AccountExportPage> {
    const input = domainParse(querySchema, raw), section = input.section;
    if (!global.has(section) && !Object.hasOwn(sections, section) || global.has(section) === Boolean(input.childId)
      || input.cursor && !input.scopeVersion) domainReject('invalid_export_scope', 400);
    const result = await authority.runTransaction(owner, input.childId ?? null, async binding => {
      const scopeVersion = version(binding);
      if (input.scopeVersion && input.scopeVersion !== scopeVersion) domainReject('export_scope_changed');
      const previous = input.cursor ? decode(input.cursor, owner) : null;
      if (previous && (previous.userId !== owner || previous.section !== section || previous.childId !== (input.childId ?? null)
        || previous.scopeVersion !== scopeVersion)) domainReject('invalid_export_cursor', 400);
      let items: unknown[] = [], nextCursor: string | null = null;
      const photos: { id: string; version: number }[] = [];
      if (section === 'manifest') {
        items = [{ format: 'yuban-personal-data:1', sections: ['account', ...Object.keys(sections)].map(key => ({ section: key,
          childScoped: !global.has(key), required: true })), scope: '本人可讀的業務資料；不包含憑據、模型 key 或內部協定狀態。' }];
      } else if (section === 'account') {
        items = [{ id: owner, email: binding.identityEmail, workspaceId: binding.scope.workspaceId, createdAt: binding.workspaceCreatedAt }];
      } else {
        const [suffix, kinds] = sections[section as keyof typeof sections], tags = data.tags(binding.scope);
        let query: Query = data.collection(suffix);
        if (suffix === 'photos') {
          const scopeTag = firestoreDomainHash([options.projectId, options.namespace, 'photo-scope', binding.scope]);
          query = query.where('scopeTag', '==', scopeTag).where('live', '==', true);
        } else {
          query = query.where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag);
          if (section !== 'children') query = query.where('childTag', '==', tags.childTag);
        }
        const limit = section === 'document_content' || section === 'photo_content' ? 1 : 10;
        query = query.orderBy(suffix === 'photos' ? 'sortKey' : FieldPath.documentId()).limit(limit + 1);
        if (previous) query = query.startAfter(previous.after);
        const found = await binding.transaction.get(query);
        for (const row of found.docs.slice(0, limit)) {
          const body = row.data(), opened = openRecoveryEnvelope({ ...options, locator: body.recovery,
            envelope: { family: 'domain', version: body.version, recordVersion: body.recordVersion, ciphertext: body.ciphertext } });
          const { context, value } = opened;
          const storageKind = context.kind === 'shared-input-tombstone' ? 'shared-input' : context.kind === 'care-tombstone' ? 'care-record' : context.kind === 'memory-tombstone'
            ? suffix === 'memory_facts' ? 'memory-fact' : 'memory-topic' : context.kind;
          if (!(kinds as readonly string[]).includes(context.kind) || data.ref(suffix, storageKind, context.id).path !== row.ref.path
            || context.scope.ownerUserId !== owner || context.scope.workspaceId !== binding.scope.workspaceId
            || context.scope.storageEpoch !== binding.scope.storageEpoch || input.childId && context.scope.childId !== input.childId)
            domainReject('export_scope_changed');
          if (section === 'children') {
            const child = await binding.readChild(context.scope.childId); if (child) items.push(child);
          } else if (section === 'agent_work') {
            const work = await binding.readWork(context.id); if (!work) domainReject('export_scope_changed'); items.push(work);
          } else if (section === 'document_content') {
            const manifest = firestoreSnapshotManifestSchema.parse(value);
            const snapshot = await snapshots.read(binding.transaction, binding.scope, manifest.documentId, manifest.snapshotId, manifest.snapshotVersion);
            if (!snapshot) domainReject('export_scope_changed'); items.push({ documentId: manifest.documentId, snapshot });
          } else if (suffix === 'photos') {
            const photo = firestorePhotoSchemas.photo.parse(value);
            if (!['ready', 'reserved'].includes(photo.state)) continue;
            if (section === 'photo_content') {
              if (photo.state === 'ready') photos.push({ id: photo.id, version: photo.version });
            } else items.push({ id: photo.id, childId: photo.scope.childId, metadata: photo.metadata, version: photo.version,
              state: photo.state, visibility: photo.visibility ?? 'private', recordId: photo.recordId ?? null,
              extraction: photo.extraction ? { state: photo.extraction.state, draft: photo.extraction.draft, processedAt: photo.extraction.processedAt } : null });
          } else if (section === 'private_sources' && context.kind === 'shared-input') {
            items.push(await createFirestoreSharedInputStore(options).read(binding, context.id));
          } else if (section === 'private_source_history') {
            const id = z.object({ inputId: z.uuid() }).parse(value).inputId;
            const parent = await binding.transaction.get(data.ref('shared_inputs', 'shared-input', id));
            if (parent.exists && parent.get('live') === true) {
              await createFirestoreSharedInputStore(options).read(binding, id); items.push(value);
            }
          } else if (section === 'push_bindings') items.push(firestorePushBindingSchema.parse(value).binding);
          else if (section === 'push_deliveries') items.push(firestorePushDeliverySchema.parse(value).delivery);
          else if (section === 'telegram_bindings') items.push(firestoreTelegramBindingSchema.parse(value).binding);
          else if (section === 'telegram_deliveries') items.push(firestoreTelegramDeliverySchema.parse(value).delivery);
          else if (section === 'contact_requests') items.push(firestoreContactRequestSchema.parse(value).request);
          else if (section === 'contact_consents') items.push(firestoreContactConsentSchema.parse(value).value);
          else if (section === 'contact_grants') items.push(firestoreContactGrantSchema.parse(value).value);
          else if (!context.kind.endsWith('tombstone')) items.push(value);
        }
        if (found.size > limit) nextCursor = encode({ userId: owner, section, childId: input.childId ?? null, scopeVersion,
          after: suffix === 'photos' ? found.docs[limit - 1].get('sortKey') : found.docs[limit - 1].id });
      }
      return { section, items, nextCursor, complete: nextCursor === null, scopeVersion, notices: ['歷史版本供追溯；不代表仍適用的最新建議。'], photos };
    });
    for (const photo of result.photos) {
      const content = await options.photos.content(owner, input.childId!, photo.id);
      result.items.push({ photoId: photo.id, version: photo.version, base64: content.base64, mimeType: content.mimeType });
    }
    // Storage IO or a long snapshot page cannot disclose under an identity/version that changed mid-request.
    await authority.runTransaction(owner, input.childId ?? null, binding => {
      if (version(binding) !== result.scopeVersion) domainReject('export_scope_changed'); return Promise.resolve();
    });
    const { photos: _photos, ...response } = result; return response;
  }
  return { page };
}
