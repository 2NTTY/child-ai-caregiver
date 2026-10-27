import { avatarBinding, type AvatarHeadRecord } from './avatar-data.ts';
import { avatarPublicState } from './avatar-policy.ts';
import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import type { FirebaseAvatarApiPort } from './firebase-avatar-api.ts';
import { firestoreChatFileRowSchema, type FirestoreChatFilesStore } from './firestore-chat-files.ts';
import { firestoreVoiceRowSchema, type FirestoreVoiceStore } from './firestore-voice.ts';
import { firestoreVoiceTranscriptSchema, type FirestoreVoiceTranscripts } from './firestore-voice-transcripts.ts';
import { createFirestoreMemoryStore } from './firestore-memory.ts';
import { createFirestoreCareStore } from './firestore-care.ts';
import { createFirestoreChatStore } from './firestore-chat.ts';
import { createFirestoreNotificationMessages } from './firestore-notification-messages.ts';
import { readNotificationHistory } from './firestore-notification-history.ts';
import { contentVisible } from './firestore-disclosure.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { FieldPath, type Query } from '@google-cloud/firestore';
import { z } from 'zod';
import type { AccountExportPage } from '../src/shared/account-service.ts';
import { createFirestoreAuthority, type FirestoreAuthorityOptions, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { firestoreSnapshotManifestSchema } from './firestore-family-document-snapshots.ts';
import { firestorePhotoSchemas, type createFirestorePhotoStore } from './firestore-photos.ts';
import { createFirestoreSharedInputStore } from './firestore-shared-inputs.ts';
import { firestoreNativeBindingSchema, firestoreNativeDeliverySchema } from './firestore-native-push.ts';
import { firestorePushBindingSchema, firestorePushDeliverySchema } from './firestore-web-push.ts';
import { firestoreTelegramBindingSchema, firestoreTelegramDeliverySchema } from './firestore-telegram.ts';
import { firestoreContactRequestSchema, firestoreContactConsentSchema, firestoreContactGrantSchema } from './firestore-contact.ts';

/** Product sections only. Auth credentials, model keys, protocol state and cost/admission ledgers are never exported. */
const sections = {
  notification_deliveries: ['notification_deliveries', []],
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
  files: ['chat_file_assets', ['chat-file-asset']], file_content: ['chat_file_assets', ['chat-file-asset']],
  voices: ['voice_assets', ['voice-asset']], voice_content: ['voice_assets', ['voice-asset']], voice_transcripts: ['voice_transcripts', ['voice-transcript']],
  photos: ['photos', ['photo']], photo_content: ['photos', ['photo']],
  self_avatar: ['avatar_heads', ['avatar-head']], self_avatar_content: ['avatar_heads', ['avatar-head']],
  child_avatar: ['avatar_heads', ['avatar-head']], child_avatar_content: ['avatar_heads', ['avatar-head']],
  private_sources: ['shared_inputs', ['shared-input', 'shared-input-tombstone']],
  private_source_history: ['shared_input_management_revisions', ['shared-input-management']],
  concerns: ['concerns', ['concern']], concern_events: ['concern_events', ['concern-event']], concern_history: ['concern_revisions', ['concern-revision']],
  growth_attention: ['growth_attention', ['growth-attention']], growth_topics: ['growth_topics', ['growth-topic']],
  work_followups: ['work_events', ['work-event']],
  notification_preferences: ['notification_preferences', ['notification-preferences']],
  native_push_bindings: ['native_push_bindings', ['native-push-binding']], native_push_deliveries: ['native_push_deliveries', ['native-push-delivery']],
  push_bindings: ['push_bindings', ['push-binding']], push_deliveries: ['push_deliveries', ['push-delivery']],
  telegram_bindings: ['telegram_bindings', ['telegram-binding']], telegram_deliveries: ['telegram_deliveries', ['telegram-delivery']],
  contact_consents: ['contact_consents', ['contact-consent']], contact_grants: ['contact_grants', ['contact-grant']], contact_requests: ['contact_requests', ['contact-request']],
} as const;
const global = new Set(['self_avatar', 'self_avatar_content', 'native_push_bindings', 'native_push_deliveries', 'notification_deliveries', 'manifest', 'account', 'children', 'notification_preferences', 'push_bindings', 'push_deliveries', 'telegram_bindings', 'telegram_deliveries']);
const querySchema = z.object({ section: z.string().max(80), childId: z.uuid().optional(),
  scopeVersion: z.string().regex(/^[a-f0-9]{64}$/u).optional(), cursor: z.string().max(16000).optional() }).strict();
const cursorSchema = z.object({ userId: z.string(), section: z.string(), childId: z.uuid().nullable(), scopeVersion: z.string(), after: z.string().max(2000) }).strict();
export function createFirestoreAccountExport(options: FirestoreAuthorityOptions & {
  photos: Pick<ReturnType<typeof createFirestorePhotoStore>, 'content'>;
  voices?: Pick<FirestoreVoiceStore,'content'|'readMetadata'>;
  files?: Pick<FirestoreChatFilesStore,'content'|'readMetadata'>;
  transcripts?: Pick<FirestoreVoiceTranscripts,'readIn'>;
  avatars?: Pick<FirebaseAvatarApiPort, 'content'>;
}) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), avatarData = createFirestoreAvatarData(options);
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
      const photos: { id: string; version: number }[] = [], voices: {id:string;version:number}[]=[], files: {id:string;version:number}[]=[];
      let avatar: AvatarHeadRecord | null = null;
      if (['self_avatar', 'self_avatar_content', 'child_avatar', 'child_avatar_content'].includes(section)) {
        if (previous) domainReject('invalid_export_cursor', 400);
        const target = input.childId ? { kind: 'child' as const, childId: input.childId } : { kind: 'self' as const };
        avatar = await avatarData.head(binding, avatarBinding(binding.scope, target));
        const { canManage: _canManage, ...current } = avatarPublicState(avatar, false);
        // Only the current normalized image/version is exportable; no uploads, raw inputs or storage descriptors.
        if (!section.endsWith('_content')) items.push(current);
      } else if (section === 'manifest') {
        items = [{ format: 'yuban-personal-data:1', sections: ['account', ...Object.keys(sections)].map(key => ({ section: key,
          childScoped: !global.has(key), required: true })), scope: '本人可讀的業務資料；不包含憑據、模型 key 或內部協定狀態。' }];
      } else if (section === 'notification_deliveries') {
        const history = await readNotificationHistory(options, binding, previous?.after);
        items = history.items;
        if (history.next) nextCursor = encode({ userId: owner, section, childId: null, scopeVersion, after: history.next });
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
        const limit = section === 'document_content' || section === 'photo_content' || section === 'voice_content' || section === 'file_content' ? 1 : 10;
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
          } else if (section === 'document_content' || section === 'document_versions') {
            const manifest = firestoreSnapshotManifestSchema.parse(value);
            const snapshot = await createFirestoreFamilyDocumentStore({ ...options, transaction: binding })
              .readExportSnapshot(owner, binding.scope.childId, manifest.documentId, manifest.snapshotId, manifest.snapshotVersion);
            items.push(section === 'document_content' ? { documentId: manifest.documentId, snapshot, invalidated: snapshot === null }
              : { documentId: manifest.documentId, snapshotId: manifest.snapshotId, snapshotVersion: manifest.snapshotVersion, invalidated: snapshot === null });
          } else if (section === 'documents') {
            const item = await createFirestoreFamilyDocumentStore({ ...options, transaction: binding }).get(owner, binding.scope.childId, context.id);
            if (item) items.push({ id: item.id, childId: item.childId, kind: item.kind, purpose: item.purpose, version: item.version,
              status: item.status, readState: item.readState, invalidated: item.readState === 'invalidated' });
          } else if (['care_history', 'profile_history', 'memory_fact_history', 'memory_topic_history'].includes(section)) {
            const item = z.object({ id: z.uuid().optional(), childId: z.uuid(), version: z.number().int().positive() }).passthrough().parse(value);
            const kind = section === 'care_history' ? 'care' : section === 'profile_history' ? 'profile' : section === 'memory_fact_history' ? 'fact' : 'topic';
            if (await contentVisible(data, binding, kind, kind === 'profile' ? item.childId : z.uuid().parse(item.id), item.version)) items.push(value);
          } else if (suffix === 'voice_assets') {
            const voice=firestoreVoiceRowSchema.parse(value);
            if (['deleting','deleted'].includes(voice.state)) continue;
            if (!options.voices) domainReject('voice_export_unavailable',503);
            const current=await options.voices.readMetadata(binding,voice.id);
            if (section==='voice_content') { if(current.state==='ready')voices.push({id:voice.id,version:current.version}); }
            else items.push(current);
          } else if (suffix === 'chat_file_assets') {
            const file=firestoreChatFileRowSchema.parse(value);
            if (['deleting','deleted'].includes(file.state)) continue;
            if (!options.files) domainReject('chat_file_export_unavailable',503);
            const current=await options.files.readMetadata(binding,file.id);
            if (section==='file_content') { if(current.state==='ready')files.push({id:file.id,version:current.version}); }
            else items.push(current);
          } else if (suffix === 'voice_transcripts') {
            const stored=firestoreVoiceTranscriptSchema.parse(value), source=await binding.transaction.get(data.ref('voice_assets','voice-asset',stored.value.voice.id));
            if (!source.exists||['deleting','deleted'].includes(source.get('state'))) continue;
            if (!options.transcripts) domainReject('voice_export_unavailable',503);
            items.push(await options.transcripts.readIn(binding,stored.value.voice.id));
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
          } else if (section === 'summary_history') {
            const memory = createFirestoreMemoryStore({ ...options, care: createFirestoreCareStore(options), chat: createFirestoreChatStore({
              database: options.database, cipher: options.cipher, projectId: options.projectId, namespace: options.namespace,
            }) });
            const summary = await memory.readSummaryRevision(binding, value);
            if (summary) items.push(summary);
          } else if (section === 'native_push_bindings') {
            const saved = firestoreNativeBindingSchema.parse(value);
            items.push(saved.apns ? { ...saved.binding, platform: 'ios', provider: 'apns' } : saved.binding);
          }
          else if (section === 'native_push_deliveries') { const saved = firestoreNativeDeliverySchema.parse(value); items.push({ ...saved.delivery, ...(saved.message ? { message: saved.message } : {}) }); }
          else if (section === 'push_bindings') items.push(firestorePushBindingSchema.parse(value).binding);
          else if (section === 'push_deliveries') { const saved = firestorePushDeliverySchema.parse(value); items.push({ ...saved.delivery, ...(saved.message ? { message: saved.message } : {}) }); }
          else if (section === 'telegram_bindings') items.push(firestoreTelegramBindingSchema.parse(value).binding);
          else if (section === 'telegram_deliveries') { const saved = firestoreTelegramDeliverySchema.parse(value); items.push({ ...saved.delivery, ...(saved.message ? { message: saved.message } : {}) }); }
          else if (section === 'contact_requests') { const saved = firestoreContactRequestSchema.parse(value); items.push({ ...saved.request, ...(saved.messages ? { messages: saved.messages.filter(message => message.recipientUserId === owner) } : {}) }); }
          else if (section === 'contact_consents') items.push(firestoreContactConsentSchema.parse(value).value);
          else if (section === 'contact_grants') items.push(firestoreContactGrantSchema.parse(value).value);
          else if (!context.kind.endsWith('tombstone')) items.push(value);
        }
        if (found.size > limit) nextCursor = encode({ userId: owner, section, childId: input.childId ?? null, scopeVersion,
          after: suffix === 'photos' ? found.docs[limit - 1].get('sortKey') : found.docs[limit - 1].id });
      }
      return { section, items, nextCursor, complete: nextCursor === null, scopeVersion, notices: ['歷史版本供追溯；不代表仍適用的最新建議。'], photos, voices, files, avatar };
    });
    for (const photo of result.photos) {
      const content = await options.photos.content(owner, input.childId!, photo.id);
      result.items.push({ photoId: photo.id, version: photo.version, base64: content.base64, mimeType: content.mimeType });
    }
    for (const voice of result.voices) {
      if (!options.voices) domainReject('voice_export_unavailable',503);
      const content=await options.voices.content(owner,input.childId!,voice.id);
      if(content.attachment.version!==voice.version)domainReject('export_scope_changed');
      result.items.push({voiceId:voice.id,version:voice.version,base64:content.base64,mimeType:content.descriptor.mimeType});
    }
    for (const file of result.files) {
      if (!options.files) domainReject('chat_file_export_unavailable',503);
      const content=await options.files.content(owner,input.childId!,file.id);
      if(content.attachment.version!==file.version)domainReject('export_scope_changed');
      result.items.push({fileId:file.id,version:file.version,base64:content.base64,mimeType:content.descriptor.mimeType});
    }
    const avatar = result.avatar;
    if (avatar?.descriptor && section.endsWith('_content')) {
      if (!options.avatars) domainReject('avatar_export_unavailable', 503);
      const descriptor = avatar.descriptor, content = await options.avatars.content(owner, avatar.binding.target, descriptor.asset.id, avatar.version);
      try { result.items.push({ target: avatar.binding.target, version: avatar.version, asset: descriptor.asset,
        base64: content.buffer.toString('base64'), mimeType: 'image/jpeg' }); } finally { content.buffer.fill(0); }
    }
    // Storage IO or a long snapshot page cannot disclose under an identity/version that changed mid-request.
    await authority.runTransaction(owner, input.childId ?? null, async binding => {
      if (version(binding) !== result.scopeVersion) domainReject('export_scope_changed');
      // Avatar commits intentionally do not enqueue child/Agent changes, so changeSeq alone is not a head fence.
      if (result.avatar) {
        const current = await avatarData.head(binding, result.avatar.binding);
        if (current.removal?.state === 'pending' || current.version !== result.avatar.version
          || firestoreDomainHash(current.descriptor) !== firestoreDomainHash(result.avatar.descriptor)) domainReject('export_scope_changed');
      }
    });
    const { photos: _photos, voices: _voices, files: _files, avatar: _avatar, ...response } = result; return response;
  }
  return { page, messages: createFirestoreNotificationMessages(options).page };
}
