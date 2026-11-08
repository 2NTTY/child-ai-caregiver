import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HANDOVER_SECTIONS, handoverSelectionSchema } from '../src/shared/handover.ts';
import { HandoverArchiveError, handoverLimits, openHandoverArchive } from './handover-archive.ts';
import { familyDocumentTransferSchema, documentTransferVersionSchema, documentTransferContentSchema, type DocumentTransferContent } from './family-document-transfer.ts';
import { canonicalJson } from './online-routing.ts';
import { photoMetadataSchema } from '../src/shared/photos.ts';
import { voiceAttachmentSchema, voiceFileMetadataSchema } from '../src/shared/voice.ts';
import { chatFileAttachmentSchema, chatFileMetadataSchema } from '../src/shared/chat-files.ts';
import { avatarStateSchema, avatarTargetSchema, avatarAssetSchema } from '../src/shared/avatars.ts';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import { concernTransferSchema } from './firestore-concerns.ts';
import { firestoreDocumentConcernEventSchema } from './firestore-document-sources.ts';
import { datedParent, handoverPeriodMatch, supportsHandoverPeriod } from './handover-period.ts';
import { readDatedConcernHead, validDatedConcernEvent } from './handover-concern-period.ts';
import { attachmentSections, type AttachmentSection, DatedPackageMedia, isAttachmentHead, isAttachmentSupplement } from './handover-attachment-period.ts';
import { DatedDocumentPeriodIndex, isDatedDocumentSection } from './handover-document-period-index.ts';
import { HandoverDocumentChoices } from './handover-document-choices.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.uuid();
const selectionSchema = z.object({ childIds: handoverSelectionSchema.shape.childIds.min(1), modules: handoverSelectionSchema.shape.modules.min(1) }).strict()
  .refine(value => new Set(value.childIds).size === value.childIds.length && new Set(value.modules).size === value.modules.length);
export type HandoverImportSelection = z.infer<typeof selectionSchema>;
const cursorSchema = z.object({ manifestSha256: hash, selectionHash: hash,
  pageIndex: z.number().int().nonnegative(), rowIndex: z.number().int().nonnegative() }).strict();
export type HandoverImportCursor = z.infer<typeof cursorSchema>;
const pageSchema = z.object({ section: z.string().min(1).max(80), childId: uuid.nullable(), scopeVersion: hash,
  items: z.array(z.record(z.string(), z.unknown())).max(10000), notices: z.array(z.string().max(2000)).max(100).optional() }).strict();
type DataPage = z.infer<typeof pageSchema>;
type PageIndex = { path: string; section: string; childId: string | null; items: number };
const contentSections = new Set(['photo_content', 'voice_content', 'file_content', 'child_avatar_content']);
export type { AttachmentSection } from './handover-attachment-period.ts';
export interface HandoverAttachmentContent {
  section: string; sourceId: string; sourceVersion: number; attachmentPath: string; mimeType: string; bytes: number; sha256: string; content: Buffer;
}
const attachmentReferenceSchema = z.object({ attachmentPath: z.string(), bytes: z.number().int().nonnegative(), sha256: hash,
  mimeType: z.string().min(1).max(200) });
type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;
const positiveVersion = z.number().int().positive();
const retainedProvenance = { importedFrom: importProvenanceSchema.optional() };
export const voiceTransferSchema = voiceAttachmentSchema.extend(retainedProvenance);
export const fileTransferSchema = chatFileAttachmentSchema.extend(retainedProvenance);
const { canManage: ignoredAvatarCapability, ...avatarTransferFields } = avatarStateSchema.shape;
export const avatarTransferSchema = z.object({ ...avatarTransferFields, ...retainedProvenance }).strict()
  .refine(({ importedFrom, ...state }) => avatarStateSchema.safeParse({ ...state, canManage: false }).success);
export const photoTransferSchema = z.object({ id: uuid, childId: uuid, version: positiveVersion, state: z.enum(['reserved', 'ready']), metadata: photoMetadataSchema,
  ...retainedProvenance }).passthrough();
const attachmentContentSchemas = {
  photos: attachmentReferenceSchema.extend({ photoId: uuid, version: positiveVersion }).strict(),
  voices: attachmentReferenceSchema.extend({ voiceId: uuid, version: positiveVersion }).strict(),
  files: attachmentReferenceSchema.extend({ fileId: uuid, version: positiveVersion }).strict(),
  child_avatar: attachmentReferenceSchema.extend({ target: avatarTargetSchema, version: z.number().int().nonnegative(), asset: avatarAssetSchema }).strict(),
};
const moduleBySection = new Map<string, keyof typeof HANDOVER_SECTIONS>(Object.entries(HANDOVER_SECTIONS)
  .flatMap(([module, sections]) => sections.map(section => [section, module as keyof typeof HANDOVER_SECTIONS] as const)));
const sectionFilterSchema = z.array(z.string().min(1).max(80)).min(1).max(moduleBySection.size)
  .refine(value => new Set(value).size === value.length);
const key = (section: string, childId: string | null) => JSON.stringify([section, childId]);
function fail(code: string): never { throw new HandoverArchiveError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: string): T {
  const parsed = schema.safeParse(raw); if (!parsed.success) fail(code); return parsed.data;
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function assertScopedRow(section: string, childId: string, value: Record<string, unknown>) {
  // Domain-specific references can name other resources. Only the owning scope is constrained here.
  const scoped = [value, section === 'task_history' ? value.task : null,
    section === 'growth_attention' || section === 'growth_history' ? value.item : null, section === 'document_content' ? value.snapshot : null];
  for (const row of scoped) if (object(row) && Object.hasOwn(row, 'childId') && row.childId !== childId) fail('invalid_package_scope');
  if (section === 'child_avatar' || section === 'child_avatar_content') {
    if (!object(value.target) || value.target.kind !== 'child' || value.target.childId !== childId) fail('invalid_package_scope');
  }
}

export interface HandoverImportRow {
  section: string; childId: string | null; value: Record<string, unknown>;
  source: { serverId: string; accountId: string; packageId: string; packageVersion: number;
    manifestSha256: string; path: string; rowIndex: number };
}

/** Format/scope validation only. Content accuracy, target authorization and durable writes belong to domain services. */
export async function openHandoverImport(input: Parameters<typeof openHandoverArchive>[0]) {
  const limits = handoverLimits(input.limits), archive = await openHandoverArchive(input);
  const { manifest, manifestSha256, integrity } = archive;
  const pages: PageIndex[] = [], children: { id: string; displayName: string }[] = [];
  const attachments = new Map<string, { childId: string | null; mimeType: string; bytes: number }>();
  let accountHead: z.infer<typeof avatarTransferSchema> | null = null;
  let accountImage: z.infer<typeof attachmentContentSchemas.child_avatar> | null = null;
  const documentRows = new Set<string>(), documentContent = new Map<string, { path: string; rowIndex: number } | null>();
  const attachmentRows = new Set<string>(), attachmentContent = new Map<string, Map<string, { path: string; rowIndex: number } | null>>();
  const concernRows = new Set<string>(), concernEvents = new Map<string, { path: string; rowIndex: number } | null>();
  const voiceTranscripts = new Map<string, { pageIndex: number; rowIndex: number } | null>();
  const requiredDatedEvents = new Set<string>();
  const datedParents = new Set<string>(), datedRevisionParents = new Set<string>();
  const datedMedia = manifest.selection.period && manifest.selection.modules.includes('attachments') ? new DatedPackageMedia() : null;
  const datedDocuments = manifest.selection.period && manifest.selection.modules.includes('documents')
    ? new DatedDocumentPeriodIndex(manifest.selection.period, manifest.periodExceptions) : null;
  const overrides = new HandoverDocumentChoices((manifest.periodExceptions ?? []).filter(pin => pin.section !== 'documents')
    .map(pin => ({ ...pin, include: true })), 'invalid_package_period');
  const concernEventIdentity = (childId: string, concernId: string, timelineId: unknown, sequence: number) =>
    JSON.stringify([childId, concernId, timelineId ?? null, sequence]);
  const attachmentIdentity = (childId: string, section: AttachmentSection, id: string) => JSON.stringify([childId, section, id]);
  const transcriptIdentity = (childId: string, voiceId: string) => JSON.stringify([childId, voiceId]);
  const attachmentVersion = (version: unknown, assetId: unknown = null) => JSON.stringify([typeof version === 'number' ? version : null, typeof assetId === 'string' ? assetId : null]);
  const documentIdentity = (childId: string, documentId: string, snapshotId: string, version: number) => JSON.stringify([childId, documentId, snapshotId, version]);
  const documentRowBinding = (section: string, childId: string | null, path: string, rowIndex: number, value: Record<string, unknown>) =>
    createHash('sha256').update(canonicalJson({ section, childId, path, rowIndex, value })).digest('hex');
  const entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  function bindAttachment(row: Record<string, unknown>, childId: string | null) {
    const ref = parse(attachmentReferenceSchema, row, 'invalid_package_attachment');
    const actual = entries.get(ref.attachmentPath);
    if (!ref.attachmentPath.startsWith('attachments/') || !ref.attachmentPath.endsWith('.bin') || !actual
      || actual.bytes !== ref.bytes || actual.sha256 !== ref.sha256 || actual.mediaType !== ref.mimeType
      || attachments.has(ref.attachmentPath)) fail('invalid_package_attachment');
    attachments.set(ref.attachmentPath, { childId, mimeType: ref.mimeType, bytes: ref.bytes });
  }
  const expected = new Map(manifest.coverage.map(row => [key(row.section, row.childId), row]));
  const seen = new Map<string, number>(), childIds = new Set(manifest.selection.childIds);
  async function read(path: string): Promise<DataPage> {
    const bytes = await archive.readEntry(path, limits.maxEntryBytes);
    try { return parse(pageSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'invalid_package_data'); }
    catch (error) { if (error instanceof HandoverArchiveError) throw error; fail('invalid_package_data'); }
    finally { bytes.fill(0); }
  }
  try {
    if (!supportsHandoverPeriod(manifest.selection)) fail('package_period_not_connected');
    const required = new Set([key('children', null)]);
    if (manifest.selection.accountAvatar) {
      required.add(key('self_avatar', null));
      required.add(key('self_avatar_content', null));
    }
    for (const childId of childIds) for (const module of manifest.selection.modules)
      for (const section of HANDOVER_SECTIONS[module]) {
        // Earlier version-one exports predate these separately exported history sections.
        // An undeclared data page still fails the required-scope check below.
        if (['chat_imports', 'growth_history', 'growth_topic_history'].includes(section) && !expected.has(key(section, childId))) continue;
        required.add(key(section, childId));
      }
    if (required.size !== expected.size || [...required].some(id => !expected.has(id))) fail('invalid_package_coverage');
    const scopeVersion = expected.get(key('children', null))!.scopeVersion;
    if ([...expected.values()].some(row => row.scopeVersion !== scopeVersion)) fail('invalid_package_coverage');
    for (const entry of manifest.entries) {
      if (entry.path === 'summary.md' || entry.path.startsWith('attachments/')) continue;
      if (!entry.path.startsWith('data/') || !entry.path.endsWith('.json') || entry.mediaType !== 'application/json') fail('invalid_package_data');
      const page = await read(entry.path), pageKey = key(page.section, page.childId);
      if (!required.has(pageKey) || page.scopeVersion !== scopeVersion) fail('invalid_package_scope');
      const count = (seen.get(pageKey) ?? 0) + page.items.length;
      if (count > expected.get(pageKey)!.items) fail('invalid_package_coverage');
      seen.set(pageKey, count);
      for (const [rowIndex, row] of page.items.entries()) {
        if (page.section === 'self_avatar') {
          const head = parse(avatarTransferSchema, row, 'invalid_package_attachment');
          if (accountHead || head.target.kind !== 'self' || head.version !== manifest.selection.accountAvatar?.version)
            fail('invalid_package_attachment');
          accountHead = head;
          continue;
        }
        if (page.section === 'self_avatar_content') {
          const image = parse(attachmentContentSchemas.child_avatar, row, 'invalid_package_attachment');
          if (accountImage || image.target.kind !== 'self' || image.mimeType !== image.asset.mimeType
            || image.bytes !== image.asset.bytes || image.sha256 !== image.asset.sha256) fail('invalid_package_attachment');
          bindAttachment(row, null);
          accountImage = image;
          continue;
        }
        if (page.section === 'children') {
          const child = parse(z.object({ id: uuid, displayName: z.string().min(1).max(160) }), row, 'invalid_package_data');
          if (!childIds.delete(child.id)) fail('invalid_package_scope'); children.push(child);
        } else {
          if (!datedDocuments || !isDatedDocumentSection(page.section)) assertScopedRow(page.section, page.childId!, row);
          const period = manifest.selection.period;
          if (period && page.section === 'concerns') {
            const { head, sequences } = readDatedConcernHead(row, period);
            for (const sequence of sequences) {
              const id = concernEventIdentity(head.childId, head.id, head.timelineId, sequence);
              if (requiredDatedEvents.has(id)) fail('invalid_package_period');
              requiredDatedEvents.add(id);
            }
          } else if (period && page.section === 'concern_events') {
            const event = parse(firestoreDocumentConcernEventSchema, row, 'invalid_package_concern_event');
            if (!validDatedConcernEvent(event, period)) fail('invalid_package_period');
          } else if (datedDocuments && isDatedDocumentSection(page.section)) {
            datedDocuments.add(page.section, page.childId!, row);
          } else if (datedMedia && isAttachmentSupplement(page.section)) {
            datedMedia.addSupplement(page.section, page.childId!, row);
          } else if (period) {
            const chosen = overrides.decide(page.childId!, page.section, row);
            if (chosen === false || !chosen && handoverPeriodMatch(page.section, row, period) !== 'inside') fail('invalid_package_period');
            if (datedMedia && isAttachmentHead(page.section)) datedMedia.addHead(page.section, page.childId!, row);
            const parent = datedParent(page.section, row, page.childId!);
            if (parent) (parent.revision ? datedRevisionParents : datedParents).add(key(parent.key, page.childId));
          } else if (page.section === 'concerns' && Object.hasOwn(row, 'periodSource')
            || page.section === 'concern_events' && Object.hasOwn(row, 'periodConcernId')) fail('invalid_package_period');
        }
        // Index only identities and locators. Document business validation remains on demand.
        if (page.section === 'documents' || page.section === 'document_versions')
          documentRows.add(documentRowBinding(page.section, page.childId, entry.path, rowIndex, row));
        if (page.section === 'concerns' || page.section === 'concern_history')
          concernRows.add(documentRowBinding(page.section, page.childId, entry.path, rowIndex, row));
        if (page.section === 'concern_events' && typeof row.concernId === 'string' && typeof row.sequence === 'number'
          && (row.timelineId === undefined || typeof row.timelineId === 'string')) {
          const identity = concernEventIdentity(page.childId!, row.concernId, row.timelineId, row.sequence);
          concernEvents.set(identity, concernEvents.has(identity) ? null : { path: entry.path, rowIndex });
        }
        if (Object.hasOwn(attachmentSections, page.section)) attachmentRows.add(documentRowBinding(page.section, page.childId, entry.path, rowIndex, row));
        if (page.section === 'voice_transcripts' && object(row.voice) && typeof row.voice.id === 'string') {
          const identity = transcriptIdentity(page.childId!, row.voice.id);
          voiceTranscripts.set(identity, voiceTranscripts.has(identity) ? null : { pageIndex: pages.length, rowIndex });
        }
        if (page.section === 'document_content' && typeof row.documentId === 'string' && typeof row.snapshotId === 'string'
          && typeof row.snapshotVersion === 'number') {
          const identity = documentIdentity(page.childId!, row.documentId, row.snapshotId, row.snapshotVersion);
          documentContent.set(identity, documentContent.has(identity) ? null : { path: entry.path, rowIndex });
        }
        if (contentSections.has(page.section)) {
          bindAttachment(row, page.childId);
          const section = (Object.keys(attachmentSections) as AttachmentSection[]).find(section => attachmentSections[section][0] === page.section)!;
          const id = section === 'child_avatar' ? page.childId : row[attachmentSections[section][1]];
          if (typeof id === 'string') {
            const identity = attachmentIdentity(page.childId!, section, id), versions = attachmentContent.get(identity) ?? new Map<string, { path: string; rowIndex: number } | null>();
            const version = attachmentVersion(row.version, section === 'child_avatar' && object(row.asset) ? row.asset.id : null);
            versions.set(version, versions.has(version) ? null : { path: entry.path, rowIndex }); attachmentContent.set(identity, versions);
          }
        } else if (Object.hasOwn(row, 'attachmentPath')) fail('invalid_package_attachment');
      }
      pages.push({ path: entry.path, section: page.section, childId: page.childId, items: page.items.length });
    }
    if (childIds.size || [...expected].some(([id, coverage]) => !seen.has(id) || seen.get(id) !== coverage.items)) fail('invalid_package_coverage');
    if (manifest.selection.accountAvatar && (!accountHead || Boolean(accountHead.asset) !== Boolean(accountImage)
      || accountImage && (accountImage.version !== accountHead.version || canonicalJson(accountImage.asset) !== canonicalJson(accountHead.asset))))
      fail('invalid_package_attachment');
    if (manifest.selection.period && (requiredDatedEvents.size !== concernEvents.size
      || [...requiredDatedEvents].some(identity => !concernEvents.get(identity)))) fail('invalid_package_period');
    if ([...datedRevisionParents].some(identity => !datedParents.has(identity))) fail('invalid_package_period');
    datedMedia?.verify();
    datedDocuments?.verify();
    overrides.verify();
    if (manifest.entries.some(entry => entry.path.startsWith('attachments/') && !attachments.has(entry.path))) fail('invalid_package_attachment');

    function select(raw: HandoverImportSelection, acknowledged?: string, rawSections?: string[]) {
      const selection = parse(selectionSchema, raw, 'invalid_package_selection');
      if (selection.childIds.some(id => !manifest.selection.childIds.includes(id))
        || selection.modules.some(module => !manifest.selection.modules.includes(module))) fail('package_scope_unavailable');
      if (integrity !== 'trusted' && acknowledged !== manifestSha256) fail('package_trust_acknowledgement_required');
      const sections = rawSections === undefined ? undefined : parse(sectionFilterSchema, rawSections, 'invalid_package_selection').sort();
      if (sections?.some(section => {
        const module = moduleBySection.get(section); return module === undefined || !selection.modules.includes(module);
      })) fail('package_scope_unavailable');
      const selectionHash = createHash('sha256').update(JSON.stringify({ childIds: [...selection.childIds].sort(), modules: [...selection.modules].sort(),
        ...(sections === undefined ? {} : { sections }) })).digest('hex');
      const allows = (page: PageIndex) => page.section === 'children' ? sections === undefined : selection.childIds.includes(page.childId!)
        && selection.modules.includes(moduleBySection.get(page.section)!) && (sections === undefined || sections.includes(page.section));
      return { selection, selectionHash, allows };
    }
    async function readAttachment(path: string, selection: HandoverImportSelection, acknowledgedManifestSha256?: string) {
      const allowed = select(selection, acknowledgedManifestSha256).selection, ref = attachments.get(path);
      if (!ref || ref.childId === null || !allowed.modules.includes('attachments') || !allowed.childIds.includes(ref.childId)) fail('package_scope_unavailable');
      return { ...ref, content: await archive.readEntry(path, ref.bytes) };
    }
    function selectedVoiceTranscripts(childId: string, voiceIds: readonly string[], acknowledgedManifestSha256?: string) {
      select({ childIds: [childId], modules: ['attachments'] }, acknowledgedManifestSha256, ['voice_transcripts']);
      const ids = parse(z.array(uuid).max(10000), voiceIds, 'invalid_package_selection');
      const locations = new Map<number, Set<number>>();
      let count = 0;
      for (const id of new Set(ids)) {
        const location = voiceTranscripts.get(transcriptIdentity(childId, id));
        if (location === null) fail('package_voice_transcript_duplicate');
        if (!location) continue;
        const rows = locations.get(location.pageIndex) ?? new Set<number>();
        rows.add(location.rowIndex); locations.set(location.pageIndex, rows); count++;
      }
      return { locations, count, ids: [...new Set(ids)].sort() };
    }
    return {
      manifest: structuredClone(manifest), manifestSha256, integrity, children: structuredClone(children), close: archive.close,
      countVoiceTranscripts(childId: string, voiceIds: readonly string[], acknowledgedManifestSha256?: string) {
        return selectedVoiceTranscripts(childId, voiceIds, acknowledgedManifestSha256).count;
      },
      async readAccountAvatar(acknowledgedManifestSha256: string, includeContent = false) {
        if (!accountHead || manifest.purpose !== 'backup' || acknowledgedManifestSha256 !== manifestSha256) fail('package_scope_unavailable');
        return { head: structuredClone(accountHead),
          content: includeContent && accountImage ? await archive.readEntry(accountImage.attachmentPath, accountImage.bytes) : null };
      },
      async readAttachmentContent(row: HandoverImportRow, acknowledgedManifestSha256?: string): Promise<HandoverAttachmentContent | null> {
        if (!Object.hasOwn(attachmentSections, row.section) || !row.childId) fail('invalid_package_scope');
        const section = row.section as AttachmentSection;
        select({ childIds: [row.childId], modules: ['attachments'] }, acknowledgedManifestSha256, [section]);
        const source = row.source;
        if (source.serverId !== manifest.source.serverId || source.accountId !== manifest.source.accountId || source.packageId !== manifest.packageId
          || source.packageVersion !== manifest.packageVersion || source.manifestSha256 !== manifestSha256
          || !attachmentRows.has(documentRowBinding(section, row.childId, source.path, source.rowIndex, row.value))) fail('invalid_package_scope');
        let sourceId: string, sourceVersion: number, ready: boolean, metadata: { mimeType: string; bytes: number; sha256: string } | null = null;
        let asset: z.infer<typeof avatarAssetSchema> | null = null;
        if (section === 'child_avatar') {
          const head = parse(avatarTransferSchema, row.value, 'invalid_package_attachment_metadata');
          if (head.target.kind !== 'child' || head.target.childId !== row.childId) fail('invalid_package_scope');
          sourceId = head.target.childId; sourceVersion = head.version; asset = head.asset; ready = asset !== null; metadata = asset;
        } else if (section === 'photos') {
          const photo = parse(photoTransferSchema, row.value, 'invalid_package_attachment_metadata');
          if (photo.childId !== row.childId) fail('invalid_package_scope');
          sourceId = photo.id; sourceVersion = photo.version; ready = photo.state === 'ready'; metadata = photo.metadata;
        } else if (section === 'voices') {
          const voice = parse(voiceTransferSchema, row.value, 'invalid_package_attachment_metadata');
          if (voice.childId !== row.childId) fail('invalid_package_scope');
          if (!['ready', 'reserved', 'uploading', 'unknown'].includes(voice.state)) fail('invalid_package_attachment_metadata');
          sourceId = voice.id; sourceVersion = voice.version; ready = voice.state === 'ready';
          if (ready) metadata = parse(voiceFileMetadataSchema, { mimeType: voice.mimeType, bytes: voice.bytes, sha256: voice.sha256, durationMs: voice.durationMs }, 'invalid_package_attachment_metadata');
        } else {
          const file = parse(fileTransferSchema, row.value, 'invalid_package_attachment_metadata');
          if (file.childId !== row.childId) fail('invalid_package_scope');
          if (!['ready', 'reserved', 'uploading', 'unknown'].includes(file.state)) fail('invalid_package_attachment_metadata');
          sourceId = file.id; sourceVersion = file.version; ready = file.state === 'ready';
          if (ready) metadata = parse(chatFileMetadataSchema, { mimeType: file.mimeType, bytes: file.bytes, sha256: file.sha256 }, 'invalid_package_attachment_metadata');
        }
        const versions = attachmentContent.get(attachmentIdentity(row.childId, section, sourceId));
        if (!ready) { if (versions?.size) fail('package_attachment_content_unexpected'); return null; }
        if (!versions) fail('package_attachment_content_missing');
        if (versions.size !== 1) fail('package_attachment_content_mismatch');
        const location = versions.get(attachmentVersion(sourceVersion, asset?.id));
        if (location === undefined) fail('package_attachment_content_mismatch');
        if (location === null) fail('package_attachment_content_duplicate');
        const page = await read(location.path), value = page.items[location.rowIndex];
        if (page.section !== attachmentSections[section][0] || page.childId !== row.childId) fail('invalid_package_scope');
        const ref = parse(attachmentContentSchemas[section] as z.ZodType<AttachmentReference>, value, 'invalid_package_attachment_content');
        if (ref.bytes !== metadata!.bytes || ref.mimeType !== metadata!.mimeType || ref.sha256 !== metadata!.sha256 || value.version !== sourceVersion
          || (section === 'child_avatar' ? !object(value.target) || value.target.kind !== 'child' || value.target.childId !== row.childId
            || canonicalJson(value.asset) !== canonicalJson(asset) : value[attachmentSections[section][1]] !== sourceId)) fail('package_attachment_content_mismatch');
        const result = await readAttachment(ref.attachmentPath, { childIds: [row.childId], modules: ['attachments'] }, acknowledgedManifestSha256);
        if (result.content.length !== metadata!.bytes || createHash('sha256').update(result.content).digest('hex') !== metadata!.sha256) {
          result.content.fill(0); fail('package_attachment_content_mismatch');
        }
        const { attachmentPath, mimeType, bytes, sha256 } = ref;
        return { section, sourceId, sourceVersion, attachmentPath, mimeType, bytes, sha256, content: result.content };
      },
      async readConcernEvents(row: HandoverImportRow, acknowledgedManifestSha256?: string) {
        if ((row.section !== 'concerns' && row.section !== 'concern_history') || !row.childId) fail('invalid_package_scope');
        select({ childIds: [row.childId], modules: ['concerns'] }, acknowledgedManifestSha256, [row.section]);
        const source = row.source;
        if (source.serverId !== manifest.source.serverId || source.accountId !== manifest.source.accountId
          || source.packageId !== manifest.packageId || source.packageVersion !== manifest.packageVersion || source.manifestSha256 !== manifestSha256
          || !concernRows.has(documentRowBinding(row.section, row.childId, source.path, source.rowIndex, row.value))) fail('invalid_package_scope');
        const head = parse(concernTransferSchema, row.value, 'invalid_package_concern');
        if (head.childId !== row.childId) fail('invalid_package_scope');
        const events: z.infer<typeof firestoreDocumentConcernEventSchema>[] = [];
        const cache: { path: string | null; page: DataPage | null } = { path: null, page: null };
        for (let index = 0; index < head.eventCount; index++) {
          const sequence = head.periodSource?.sequences[index] ?? index + 1;
          const location = concernEvents.get(concernEventIdentity(row.childId, head.id, head.timelineId, sequence));
          if (location === undefined) fail('package_concern_event_missing');
          if (location === null) fail('package_concern_event_duplicate');
          if (cache.path !== location.path || !cache.page) { cache.path = location.path; cache.page = await read(location.path); }
          if (cache.page.section !== 'concern_events' || cache.page.childId !== row.childId) fail('invalid_package_scope');
          const event = parse(firestoreDocumentConcernEventSchema, cache.page.items[location.rowIndex], 'invalid_package_concern_event');
          if (event.concernId !== head.id || event.childId !== row.childId || event.timelineId !== head.timelineId
            || event.sequence !== sequence || events.some(previous => previous.id === event.id)) fail('package_concern_event_mismatch');
          events.push(event);
        }
        return events;
      },
      async readDocumentContent(row: HandoverImportRow, acknowledgedManifestSha256?: string): Promise<DocumentTransferContent | null> {
        if ((row.section !== 'documents' && row.section !== 'document_versions') || !row.childId) fail('invalid_package_scope');
        select({ childIds: [row.childId], modules: ['documents'] }, acknowledgedManifestSha256, [row.section]);
        const source = row.source;
        if (source.serverId !== manifest.source.serverId || source.accountId !== manifest.source.accountId
          || source.packageId !== manifest.packageId || source.packageVersion !== manifest.packageVersion || source.manifestSha256 !== manifestSha256
          || !documentRows.has(documentRowBinding(row.section, row.childId, source.path, source.rowIndex, row.value))) fail('invalid_package_scope');
        const document = row.section === 'documents' ? parse(familyDocumentTransferSchema, row.value, 'invalid_package_document_metadata') : null;
        const revision = document ? null : parse(documentTransferVersionSchema, row.value, 'invalid_package_document_metadata');
        if (document && document.currentSnapshot === null) return null;
        const identity = document ? { documentId: document.id, snapshotId: document.currentSnapshot!.id, snapshotVersion: document.currentSnapshot!.version } : revision!;
        const location = documentContent.get(documentIdentity(row.childId, identity.documentId, identity.snapshotId, identity.snapshotVersion));
        if (location === undefined) fail('package_document_content_missing');
        if (location === null) fail('package_document_content_duplicate');
        const page = await read(location.path);
        if (page.section !== 'document_content' || page.childId !== row.childId) fail('invalid_package_scope');
        const content = parse(documentTransferContentSchema, page.items[location.rowIndex], 'invalid_package_document_content');
        if (content.documentId !== identity.documentId || content.snapshotId !== identity.snapshotId || content.snapshotVersion !== identity.snapshotVersion)
          fail('package_document_content_mismatch');
        const { snapshot: _snapshot, ...version } = content;
        if (document ? document.childId !== row.childId || document.currentSnapshot!.readable === content.invalidated
          : canonicalJson(version) !== canonicalJson(revision)) fail('package_document_content_mismatch');
        return content;
      },
      async readPage(request: { selection: HandoverImportSelection; acknowledgedManifestSha256?: string; sections?: string[]; voiceTranscriptIds?: string[]; cursor?: HandoverImportCursor | null; limit?: number }) {
        const { selection, selectionHash: baseSelectionHash, allows } = select(request.selection, request.acknowledgedManifestSha256, request.sections);
        if (request.voiceTranscriptIds !== undefined && (selection.childIds.length !== 1
          || request.sections?.length !== 1 || request.sections[0] !== 'voice_transcripts')) fail('invalid_package_selection');
        const transcripts = request.voiceTranscriptIds === undefined ? null
          : selectedVoiceTranscripts(selection.childIds[0], request.voiceTranscriptIds, request.acknowledgedManifestSha256);
        const selectionHash = transcripts ? createHash('sha256').update(JSON.stringify({ baseSelectionHash, voiceTranscriptIds: transcripts.ids })).digest('hex') : baseSelectionHash;
        const limit = parse(z.number().int().min(1).max(100), request.limit ?? 50, 'invalid_package_limit');
        const cursor = request.cursor ? parse(cursorSchema, request.cursor, 'invalid_package_cursor') : null;
        if (cursor && (cursor.manifestSha256 !== manifestSha256 || cursor.selectionHash !== selectionHash
          || cursor.pageIndex >= pages.length || cursor.rowIndex >= pages[cursor.pageIndex].items || !allows(pages[cursor.pageIndex])
          || transcripts && !transcripts.locations.get(cursor.pageIndex)?.has(cursor.rowIndex))) fail('invalid_package_cursor');
        const rows: HandoverImportRow[] = [];
        for (let i = cursor?.pageIndex ?? 0; i < pages.length; i++) {
          if (transcripts && !transcripts.locations.has(i)) continue;
          const index = pages[i]; if (!allows(index) || !index.items) continue;
          const page = await read(index.path);
          for (let j = i === cursor?.pageIndex ? cursor.rowIndex : 0; j < page.items.length; j++) {
            if (transcripts && !transcripts.locations.get(i)!.has(j)) continue;
            if (page.section === 'children' && !selection.childIds.includes(page.items[j].id as string)) continue;
            if (rows.length === limit) return { rows, nextCursor: { manifestSha256, selectionHash, pageIndex: i, rowIndex: j } };
            rows.push({ section: page.section, childId: page.childId, value: page.items[j], source: { ...manifest.source,
              packageId: manifest.packageId, packageVersion: manifest.packageVersion, manifestSha256, path: index.path, rowIndex: j } });
          }
        }
        return { rows, nextCursor: null };
      },
      readAttachment,
    };
  } catch (error) { await archive.close(); throw error; }
}
