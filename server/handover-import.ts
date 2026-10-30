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

const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.uuid();
const selectionSchema = z.object({ childIds: handoverSelectionSchema.shape.childIds, modules: handoverSelectionSchema.shape.modules }).strict()
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
const attachmentSections = { photos: ['photo_content', 'photoId'], voices: ['voice_content', 'voiceId'], files: ['file_content', 'fileId'],
  child_avatar: ['child_avatar_content', 'childId'] } as const;
export type AttachmentSection = keyof typeof attachmentSections;
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
    section === 'growth_attention' ? value.item : null, section === 'document_content' ? value.snapshot : null];
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
  const attachments = new Map<string, { childId: string; mimeType: string; bytes: number }>();
  const documentRows = new Set<string>(), documentContent = new Map<string, { path: string; rowIndex: number } | null>();
  const attachmentRows = new Set<string>(), attachmentContent = new Map<string, Map<string, { path: string; rowIndex: number } | null>>();
  const attachmentIdentity = (childId: string, section: AttachmentSection, id: string) => JSON.stringify([childId, section, id]);
  const attachmentVersion = (version: unknown, assetId: unknown = null) => JSON.stringify([typeof version === 'number' ? version : null, typeof assetId === 'string' ? assetId : null]);
  const documentIdentity = (childId: string, documentId: string, snapshotId: string, version: number) => JSON.stringify([childId, documentId, snapshotId, version]);
  const documentRowBinding = (section: string, childId: string | null, path: string, rowIndex: number, value: Record<string, unknown>) =>
    createHash('sha256').update(canonicalJson({ section, childId, path, rowIndex, value })).digest('hex');
  const entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  const expected = new Map(manifest.coverage.map(row => [key(row.section, row.childId), row]));
  const seen = new Map<string, number>(), childIds = new Set(manifest.selection.childIds);
  async function read(path: string): Promise<DataPage> {
    const bytes = await archive.readEntry(path, limits.maxEntryBytes);
    try { return parse(pageSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'invalid_package_data'); }
    catch (error) { if (error instanceof HandoverArchiveError) throw error; fail('invalid_package_data'); }
    finally { bytes.fill(0); }
  }
  try {
    if (manifest.selection.period) fail('package_period_not_connected');
    const required = new Set([key('children', null)]);
    for (const childId of childIds) for (const module of manifest.selection.modules)
      for (const section of HANDOVER_SECTIONS[module]) {
        // Version-one exports predating imported history legitimately contain only the live chat section.
        // An undeclared data page still fails the required-scope check below.
        if (section === 'chat_imports' && !expected.has(key(section, childId))) continue;
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
        if (page.section === 'children') {
          const child = parse(z.object({ id: uuid, displayName: z.string().min(1).max(160) }), row, 'invalid_package_data');
          if (!childIds.delete(child.id)) fail('invalid_package_scope'); children.push(child);
        } else assertScopedRow(page.section, page.childId!, row);
        // Index only identities and locators. Document business validation remains on demand.
        if (page.section === 'documents' || page.section === 'document_versions')
          documentRows.add(documentRowBinding(page.section, page.childId, entry.path, rowIndex, row));
        if (Object.hasOwn(attachmentSections, page.section)) attachmentRows.add(documentRowBinding(page.section, page.childId, entry.path, rowIndex, row));
        if (page.section === 'document_content' && typeof row.documentId === 'string' && typeof row.snapshotId === 'string'
          && typeof row.snapshotVersion === 'number') {
          const identity = documentIdentity(page.childId!, row.documentId, row.snapshotId, row.snapshotVersion);
          documentContent.set(identity, documentContent.has(identity) ? null : { path: entry.path, rowIndex });
        }
        if (contentSections.has(page.section)) {
          const ref = parse(attachmentReferenceSchema, row, 'invalid_package_attachment');
          const actual = entries.get(ref.attachmentPath);
          if (!ref.attachmentPath.startsWith('attachments/') || !ref.attachmentPath.endsWith('.bin') || !actual
            || actual.bytes !== ref.bytes || actual.sha256 !== ref.sha256 || actual.mediaType !== ref.mimeType
            || attachments.has(ref.attachmentPath)) fail('invalid_package_attachment');
          attachments.set(ref.attachmentPath, { childId: page.childId!, mimeType: ref.mimeType, bytes: ref.bytes });
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
      if (!ref || !allowed.modules.includes('attachments') || !allowed.childIds.includes(ref.childId)) fail('package_scope_unavailable');
      return { ...ref, content: await archive.readEntry(path, ref.bytes) };
    }
    return {
      manifest: structuredClone(manifest), manifestSha256, integrity, children: structuredClone(children), close: archive.close,
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
      async readPage(request: { selection: HandoverImportSelection; acknowledgedManifestSha256?: string; sections?: string[]; cursor?: HandoverImportCursor | null; limit?: number }) {
        const { selection, selectionHash, allows } = select(request.selection, request.acknowledgedManifestSha256, request.sections);
        const limit = parse(z.number().int().min(1).max(100), request.limit ?? 50, 'invalid_package_limit');
        const cursor = request.cursor ? parse(cursorSchema, request.cursor, 'invalid_package_cursor') : null;
        if (cursor && (cursor.manifestSha256 !== manifestSha256 || cursor.selectionHash !== selectionHash
          || cursor.pageIndex >= pages.length || cursor.rowIndex >= pages[cursor.pageIndex].items || !allows(pages[cursor.pageIndex]))) fail('invalid_package_cursor');
        const rows: HandoverImportRow[] = [];
        for (let i = cursor?.pageIndex ?? 0; i < pages.length; i++) {
          const index = pages[i]; if (!allows(index) || !index.items) continue;
          const page = await read(index.path);
          for (let j = i === cursor?.pageIndex ? cursor.rowIndex : 0; j < page.items.length; j++) {
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
