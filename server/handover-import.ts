import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HANDOVER_SECTIONS, handoverSelectionSchema } from '../src/shared/handover.ts';
import { HandoverArchiveError, handoverLimits, openHandoverArchive } from './handover-archive.ts';

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
const moduleBySection = new Map<string, keyof typeof HANDOVER_SECTIONS>(Object.entries(HANDOVER_SECTIONS)
  .flatMap(([module, sections]) => sections.map(section => [section, module as keyof typeof HANDOVER_SECTIONS] as const)));
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
      for (const section of HANDOVER_SECTIONS[module]) required.add(key(section, childId));
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
      for (const row of page.items) {
        if (page.section === 'children') {
          const child = parse(z.object({ id: uuid, displayName: z.string().min(1).max(160) }), row, 'invalid_package_data');
          if (!childIds.delete(child.id)) fail('invalid_package_scope'); children.push(child);
        } else assertScopedRow(page.section, page.childId!, row);
        if (contentSections.has(page.section)) {
          const ref = parse(z.object({ attachmentPath: z.string(), bytes: z.number().int().nonnegative(), sha256: hash,
            mimeType: z.string().min(1).max(200) }), row, 'invalid_package_attachment');
          const actual = entries.get(ref.attachmentPath);
          if (!ref.attachmentPath.startsWith('attachments/') || !ref.attachmentPath.endsWith('.bin') || !actual
            || actual.bytes !== ref.bytes || actual.sha256 !== ref.sha256 || actual.mediaType !== ref.mimeType
            || attachments.has(ref.attachmentPath)) fail('invalid_package_attachment');
          attachments.set(ref.attachmentPath, { childId: page.childId!, mimeType: ref.mimeType, bytes: ref.bytes });
        } else if (Object.hasOwn(row, 'attachmentPath')) fail('invalid_package_attachment');
      }
      pages.push({ path: entry.path, section: page.section, childId: page.childId, items: page.items.length });
    }
    if (childIds.size || [...expected].some(([id, coverage]) => !seen.has(id) || seen.get(id) !== coverage.items)) fail('invalid_package_coverage');
    if (manifest.entries.some(entry => entry.path.startsWith('attachments/') && !attachments.has(entry.path))) fail('invalid_package_attachment');

    function select(raw: HandoverImportSelection, acknowledged?: string) {
      const selection = parse(selectionSchema, raw, 'invalid_package_selection');
      if (selection.childIds.some(id => !manifest.selection.childIds.includes(id))
        || selection.modules.some(module => !manifest.selection.modules.includes(module))) fail('package_scope_unavailable');
      if (integrity !== 'trusted' && acknowledged !== manifestSha256) fail('package_trust_acknowledgement_required');
      const selectionHash = createHash('sha256').update(JSON.stringify({ childIds: [...selection.childIds].sort(), modules: [...selection.modules].sort() })).digest('hex');
      const allows = (page: PageIndex) => page.section === 'children' || selection.childIds.includes(page.childId!)
        && selection.modules.includes(moduleBySection.get(page.section)!);
      return { selection, selectionHash, allows };
    }
    return {
      manifest: structuredClone(manifest), manifestSha256, integrity, children: structuredClone(children), close: archive.close,
      async readPage(request: { selection: HandoverImportSelection; acknowledgedManifestSha256?: string; cursor?: HandoverImportCursor | null; limit?: number }) {
        const { selection, selectionHash, allows } = select(request.selection, request.acknowledgedManifestSha256);
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
      async readAttachment(path: string, selection: HandoverImportSelection, acknowledgedManifestSha256?: string) {
        const allowed = select(selection, acknowledgedManifestSha256).selection, ref = attachments.get(path);
        if (!ref || !allowed.modules.includes('attachments') || !allowed.childIds.includes(ref.childId)) fail('package_scope_unavailable');
        return { ...ref, content: await archive.readEntry(path, ref.bytes) };
      },
    };
  } catch (error) { await archive.close(); throw error; }
}
