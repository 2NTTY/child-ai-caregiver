import { createHash } from 'node:crypto';
import type { AvatarPolicy } from '../src/shared/avatars.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';
import type { SharedSelection } from '../src/shared/sharing.ts';
import { avatarTransferSchema, fileTransferSchema, photoTransferSchema, voiceTransferSchema,
  type AttachmentSection, type HandoverAttachmentContent, type HandoverImportRow } from './handover-import.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { firestoreBackgroundReference } from './firestore-background-work.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { AttachmentImportStage } from './handover-attachment-stage.ts';
import type { createFirestoreChatFilesStore } from './firestore-chat-files.ts';
import type { createFirestoreVoiceStore } from './firestore-voice.ts';
import type { createFirestorePhotoStore } from './firestore-photos.ts';
import type { createFirestoreAvatarStore } from './firestore-avatars.ts';
import type { createFirestoreVoiceTranscripts } from './firestore-voice-transcripts.ts';
import { storedVoiceTranscriptSchema } from '../src/shared/voice-transcript.ts';
import { voiceMessageReferenceSchema } from '../src/shared/voice.ts';
import { z } from 'zod';

export interface HandoverAttachmentPorts {
  files?: ReturnType<typeof createFirestoreChatFilesStore>;
  voices?: ReturnType<typeof createFirestoreVoiceStore>;
  photos?: ReturnType<typeof createFirestorePhotoStore>;
  avatars?: { store: ReturnType<typeof createFirestoreAvatarStore>; policy: AvatarPolicy };
  transcripts?: ReturnType<typeof createFirestoreVoiceTranscripts>;
}
export const attachmentSupplementModules = { file_content: 'files', voice_content: 'voices', photo_content: 'photos',
  child_avatar_content: 'child_avatar', voice_transcripts: 'voices' } as const;
export function attachmentSupplementModule(section: string): AttachmentSection | undefined {
  return Object.hasOwn(attachmentSupplementModules, section) ? attachmentSupplementModules[section as keyof typeof attachmentSupplementModules] : undefined;
}
export function attachmentSupplementParent(row: HandoverImportRow) {
  const section = attachmentSupplementModule(row.section); if (!section) domainReject('invalid_package_scope', 400);
  if (row.section === 'voice_transcripts') {
    const source = domainParse(storedVoiceTranscriptSchema, row.value, 'invalid_package_data');
    return { section, id: source.voice.id, version: source.voice.version };
  }
  const id = row.section === 'file_content' ? row.value.fileId : row.section === 'voice_content' ? row.value.voiceId
    : row.section === 'photo_content' ? row.value.photoId : row.childId;
  return { section, id: domainParse(z.uuid(), id, 'invalid_package_data'), version: domainParse(z.number().int().positive(), row.value.version, 'invalid_package_data') };
}
export const handoverAttachmentSchemas = { files: fileTransferSchema, voices: voiceTransferSchema,
  photos: photoTransferSchema, child_avatar: avatarTransferSchema };
export function isHandoverAttachment(section: string): section is AttachmentSection {
  return Object.hasOwn(handoverAttachmentSchemas, section);
}

/** Bytes come only from the verified archive reader; bind them again before any domain reservation. */
export function checkHandoverAttachment(row: HandoverImportRow, content: HandoverAttachmentContent | null | undefined) {
  if (!isHandoverAttachment(row.section)) domainReject('invalid_package_scope', 400);
  const section = row.section;
  const value = section === 'files' ? domainParse(fileTransferSchema, row.value, 'invalid_package_data')
    : section === 'voices' ? domainParse(voiceTransferSchema, row.value, 'invalid_package_data')
    : section === 'photos' ? domainParse(photoTransferSchema, row.value, 'invalid_package_data')
    : domainParse(avatarTransferSchema, row.value, 'invalid_package_data');
  const metadata = section === 'photos' ? domainParse(photoTransferSchema, value).metadata
    : section === 'child_avatar' ? domainParse(avatarTransferSchema, value).asset : value as ReturnType<typeof fileTransferSchema.parse>;
  const available = section === 'child_avatar' ? metadata !== null : 'state' in value && value.state === 'ready';
  if (!available) {
    if (content !== null) domainReject('attachment_content_binding', 400);
    return null;
  }
  const id = section === 'child_avatar' ? row.childId : 'id' in value ? value.id : null;
  if (!content || content.section !== section || content.sourceId !== id || content.sourceVersion !== value.version
    || !metadata || content.mimeType !== metadata.mimeType || content.bytes !== metadata.bytes || content.sha256 !== metadata.sha256
    || !Buffer.isBuffer(content.content) || content.content.length !== content.bytes
    || createHash('sha256').update(content.content).digest('hex') !== content.sha256) domainReject('attachment_content_binding', 400);
  return content;
}

/** Thin coordination of existing domains: reservation and publication stay in their original transactions. */
export function createHandoverAttachments(ports: HandoverAttachmentPorts = {}) {
  const required = <T>(port: T | undefined): T => { if (!port) domainReject('package_section_not_connected', 503); return port; };
  return {
    async prepareTranscript(b: Binding, row: HandoverImportRow, localId: string, provenance: ImportProvenance) {
      const voice = await required(ports.voices).readMetadata(b,localId);
      const reference = domainParse(voiceMessageReferenceSchema, { id: voice.id, version: voice.version, bytes: voice.bytes,
        sha256: voice.sha256, mimeType: voice.mimeType, durationMs: voice.durationMs });
      return required(ports.transcripts).prepareImported(b,row.value,reference,provenance);
    },
    async readState(b: Binding, section: AttachmentSection, id: string) {
      return section === 'child_avatar' ? required(ports.avatars).store.readImportState(b)
        : section === 'photos' ? required(ports.photos).readImportState(b, id)
        : section === 'voices' ? required(ports.voices).readImportState(b, id) : required(ports.files).readImportState(b, id);
    },
    async prepare(b: Binding, row: HandoverImportRow, content: HandoverAttachmentContent, stage: AttachmentImportStage,
      provenance: ImportProvenance, expectedVersion: number, uploaded: boolean, selection?: SharedSelection, signal?: AbortSignal) {
      const id = firestoreBackgroundReference({ id: firestoreDomainHash(['handover-asset',
        b.scope.ownerUserId, b.scope.workspaceId, b.scope.childId, stage.batchId, stage.operationId]) });
      const section = row.section, userId = b.actorUserId, childId = b.scope.childId;
      const finish = (value: { version: number }, prepared: { changeSeq: string | null; commit(): void }) => ({
        kind: 'publication' as const, resource: { id: section === 'child_avatar' ? childId : id, version: value.version }, ...prepared,
      });
      if (section === 'files' || section === 'voices') {
        const store = section === 'files' ? required(ports.files) : required(ports.voices);
        if (uploaded) { const plan = await store.prepareImportPublication(b, id, stage, provenance); return finish(plan.value, plan); }
        const value = domainParse(section === 'files' ? fileTransferSchema : voiceTransferSchema, row.value);
        const reservation = { opId: id, fileName: value.fileName!, mimeType: value.mimeType!, bytes: value.bytes!, sha256: value.sha256! };
        const plan = section === 'files' ? await required(ports.files).prepareImportReservation(b, reservation, stage)
          : await required(ports.voices).prepareImportReservation(b, { ...reservation, mimeType: domainParse(voiceTransferSchema, row.value).mimeType! }, stage);
        return { kind: 'reservation' as const, commit: plan.commit, upload: async () => {
          signal?.throwIfAborted();
          await store.uploadImported(userId, childId, id, plan.value.version, content.content.toString('base64'), stage, signal, selection);
        } };
      }
      if (section === 'photos') {
        const store = required(ports.photos);
        if (uploaded) { const plan = await store.prepareImportPublication(b, id, stage, provenance); return finish(plan.value, plan); }
        const plan = await store.prepareImportReservation(b, id, domainParse(photoTransferSchema, row.value).metadata, stage);
        return { kind: 'reservation' as const, commit: plan.commit, upload: async () => {
          signal?.throwIfAborted(); await store.uploadImported(userId, childId, id, content.content.toString('base64'), stage, selection);
        } };
      }
      if (section !== 'child_avatar') domainReject('invalid_package_scope', 400);
      const { store, policy } = required(ports.avatars);
      if (uploaded) { const plan = await store.prepareImportPublication(b, id, stage, provenance); return finish(plan.value, plan); }
      const plan = await store.prepareImportReservation(b, { expectedVersion, policyId: policy.policyId, mimeType: content.mimeType,
        bytes: content.bytes, sha256: content.sha256, crop: { centerX: 0.5, centerY: 0.5, zoom: 1 } },
      { uploadId: id, assetId: firestoreBackgroundReference({ id: firestoreDomainHash(['handover-avatar', id]) }) }, stage);
      return { kind: 'reservation' as const, commit: plan.commit, upload: async () => {
        signal?.throwIfAborted(); await store.uploadImported(userId, childId, id, content.content, stage, signal ?? new AbortController().signal, selection);
      } };
    },
  };
}
