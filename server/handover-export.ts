import type { KeyObject } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { AccountExportPage } from '../src/shared/account-service.ts';
import { HANDOVER_SECTIONS, handoverHeaderSchema, type HandoverHeader, type HandoverCoverage } from '../src/shared/handover.ts';
import { HandoverArchiveError, writeHandoverArchive, waitForHandoverStep, handoverLimits, type HandoverEntryInput, type HandoverLimits } from './handover-archive.ts';
import { avatarTransferSchema } from './handover-import.ts';
import { canonicalJson } from './online-routing.ts';
import { datedParent, handoverPeriodMatch, supportsHandoverPeriod } from './handover-period.ts';
import { datedConcernPages } from './handover-concern-period.ts';
import { datedDocumentPages, type PackageDocumentFilter } from './handover-document-period.ts';
import { DatedPackageMedia, isAttachmentHead, isAttachmentSupplement, type PackageMediaFilter } from './handover-attachment-period.ts';

const contentSections = new Set(['photo_content', 'voice_content', 'file_content', 'child_avatar_content']);
type PageQuery = { section: string; childId?: string; scopeVersion?: string; cursor?: string };
export interface PackagePageOptions { includeSummaryPeriod?: boolean; documentFilter?: PackageDocumentFilter }
export interface HandoverExportSource { page(userId: string, query: PageQuery, packageMedia?: PackageMediaFilter, options?: PackagePageOptions): Promise<AccountExportPage> }
function fail(code: string): never { throw new HandoverArchiveError(code); }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Only ordinary authorized product reads feed this format; restoration envelopes are not accepted. */
export async function writePersonalHandoverPackage(input: {
  exporter: HandoverExportSource; directory: string; ownerUserId: string; serverId: string; packageId: string;
  createdAt: string; purpose: HandoverHeader['purpose']; selection: HandoverHeader['selection'];
  signingKey?: KeyObject; signal?: AbortSignal; limits?: Partial<HandoverLimits>; expectedScopeVersion?: string;
}) {
  const limits = handoverLimits(input.limits);
  const signal = AbortSignal.any([AbortSignal.timeout(limits.maxDurationMs), ...(input.signal ? [input.signal] : [])]);
  const header = handoverHeaderSchema.parse({ format: 'yuyoufang-data', version: 1, packageId: input.packageId, packageVersion: 1,
    createdAt: input.createdAt, purpose: input.purpose, source: { serverId: input.serverId, accountId: input.ownerUserId }, selection: input.selection });
  if (!supportsHandoverPeriod(header.selection)) fail('package_period_not_connected');
  signal.throwIfAborted();
  const initial = await waitForHandoverStep(input.exporter.page(input.ownerUserId, { section: 'manifest' }), signal);
  const scopeVersion = initial.scopeVersion, coverage: HandoverCoverage[] = [];
  if (input.expectedScopeVersion && input.expectedScopeVersion !== scopeVersion) fail('export_scope_changed');
  const avatars = new Map<string, { version: number; asset: unknown; fingerprint: string }>();
  const datedMedia = header.selection.period && header.selection.modules.includes('attachments') ? new DatedPackageMedia() : null;
  let ordinal = 0, pageCount = 0;
  const path = (kind: 'data' | 'attachments') => `${kind}/${String(++ordinal).padStart(8, '0')}.${kind === 'data' ? 'json' : 'bin'}`;
  async function* pages(section: string, childId?: string, documentFilter?: PackageDocumentFilter) {
    let cursor: string | undefined;
    const mediaFilter: PackageMediaFilter | undefined = datedMedia && childId && (isAttachmentHead(section) || isAttachmentSupplement(section))
      ? (kind, id) => datedMedia.permitsBytes(childId, kind, id) : undefined;
    do {
      signal.throwIfAborted(); if (++pageCount > 10000) fail('package_size_exceeded');
      const page = await waitForHandoverStep(input.exporter.page(input.ownerUserId, { section, ...(childId ? { childId } : {}), scopeVersion, ...(cursor ? { cursor } : {}) }, mediaFilter,
        { includeSummaryPeriod: section === 'summary_history' && Boolean(header.selection.period), documentFilter }), signal);
      if (page.scopeVersion !== scopeVersion || page.section !== section || page.complete !== (page.nextCursor === null)
        || page.nextCursor && page.nextCursor === cursor) fail('export_scope_changed');
      yield page;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  async function* entries(): AsyncGenerator<HandoverEntryInput> {
    const children: unknown[] = [], wanted = new Set(header.selection.childIds);
    for await (const page of pages('children')) {
      for (const child of page.items) {
        if (child && typeof child === 'object' && 'id' in child && typeof child.id === 'string' && wanted.delete(child.id))
          children.push(header.selection.period && 'displayName' in child ? { id: child.id, displayName: child.displayName } : child);
      }
    }
    if (wanted.size) fail('package_scope_unavailable');
    coverage.push({ section: 'children', childId: null, scopeVersion, items: children.length, complete: true });
    yield { path: path('data'), mediaType: 'application/json', content: Buffer.from(JSON.stringify({ section: 'children', childId: null, scopeVersion, items: children })) };
    for (const childId of header.selection.childIds) {
      for (const module of header.selection.modules) {
        if (module === 'documents' && header.selection.period) {
          const counts = new Map<string, number>();
          for await (const page of datedDocumentPages(childId, header.selection.period, pages, limits.maxEntries)) {
            counts.set(page.section, (counts.get(page.section) ?? 0) + page.items.length);
            yield { path: path('data'), mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...page, childId, scopeVersion })) };
          }
          for (const [section, items] of counts) coverage.push({ section, childId, scopeVersion, items, complete: true });
        }
        if (module === 'concerns' && header.selection.period) {
          const counts = new Map<string, number>();
          for await (const page of datedConcernPages(childId, header.selection.period, pages)) {
            counts.set(page.section, (counts.get(page.section) ?? 0) + page.items.length);
            yield { path: path('data'), mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...page, childId, scopeVersion })) };
          }
          for (const [section, items] of counts) coverage.push({ section, childId, scopeVersion, items, complete: true });
          continue;
        }
        const selectedParents = new Set<string>();
        for (const section of HANDOVER_SECTIONS[module]) {
          if (module === 'documents' && header.selection.period && !section.startsWith('visit_preparation')) continue;
          let items = 0;
          for await (const page of pages(section, childId)) {
            if (section === 'child_avatar') {
              if (page.items.length !== 1 || !page.complete) fail('invalid_package_source');
              const value = page.items[0]; if (!value || typeof value !== 'object') fail('invalid_package_source');
              const head = avatarTransferSchema.parse(value);
              avatars.set(childId, { version: head.version, asset: head.asset, fingerprint: canonicalJson(head) });
            }
            if (section === 'child_avatar_content') {
              const head = avatars.get(childId);
              const expected = head?.asset && (!datedMedia || datedMedia.permitsBytes(childId, 'child_avatar', childId)) ? 1 : 0;
              if (!head || !page.complete || page.items.length !== expected) fail('export_scope_changed');
              for (const row of page.items) if (!row || typeof row !== 'object' || !('version' in row) || row.version !== head.version
                || !('asset' in row) || canonicalJson(row.asset) !== canonicalJson(head.asset)) fail('export_scope_changed');
            }
            const rows: unknown[] = [];
            for (const item of page.items) {
              if (datedMedia && isAttachmentSupplement(section)) {
                if (!datedMedia.hasParent(section, childId, item)) continue;
                if (section === 'voice_transcripts') datedMedia.addSupplement(section, childId, item);
              } else if (header.selection.period) {
                const match = handoverPeriodMatch(section, item, header.selection.period);
                if (match !== 'inside') continue;
                if (datedMedia && isAttachmentHead(section)) datedMedia.addHead(section, childId, item);
                const parent = datedParent(section, item, childId);
                if (parent?.revision && !selectedParents.has(parent.key)) continue;
                if (parent && !parent.revision) selectedParents.add(parent.key);
              }
              if (contentSections.has(section)) {
                if (!item || typeof item !== 'object' || !('base64' in item) || typeof item.base64 !== 'string'
                  || !('mimeType' in item) || typeof item.mimeType !== 'string') fail('invalid_package_source');
                const { base64, ...metadata } = item;
                const bytes = Buffer.from(base64, 'base64');
                if (bytes.toString('base64') !== base64) fail('invalid_package_source');
                const attachmentPath = path('attachments');
                try {
                  const pointer = { ...metadata, attachmentPath, bytes: bytes.length, sha256: hash(bytes) };
                  if (datedMedia && isAttachmentSupplement(section)) datedMedia.addSupplement(section, childId, pointer);
                  rows.push(pointer);
                  yield { path: attachmentPath, mediaType: item.mimeType, content: bytes };
                } finally { bytes.fill(0); }
              } else rows.push(item);
            }
            items += rows.length;
            // Empty pages still describe the selected scope rather than implying a missing section.
            yield { path: path('data'), mediaType: 'application/json', content: Buffer.from(JSON.stringify({ section, childId, scopeVersion,
              items: rows, ...(header.selection.period ? {} : { notices: page.notices }) })) };
          }
          coverage.push({ section, childId, scopeVersion, items, complete: true });
        }
      }
    }
    signal.throwIfAborted();
    datedMedia?.verify();
    // Avatar swaps intentionally do not increment workspace changeSeq. Fence them separately across the entire export.
    for (const [childId, head] of avatars) {
      const current = await waitForHandoverStep(input.exporter.page(input.ownerUserId, { section: 'child_avatar', childId, scopeVersion }), signal);
      if (current.scopeVersion !== scopeVersion || current.items.length !== 1 || !current.complete
        || canonicalJson(current.items[0]) !== head.fingerprint) fail('export_scope_changed');
    }
    // Recheck the same authority/version after the last attachment IO before signing the result.
    const final = await waitForHandoverStep(input.exporter.page(input.ownerUserId, { section: 'manifest', scopeVersion }), signal);
    if (final.scopeVersion !== scopeVersion) fail('export_scope_changed');
    const summary = ['# 育有方資料包', '', `用途：${header.purpose === 'backup' ? '本人備份' : '交接副本'}`, `包 ID：${header.packageId}`,
      `建立時間：${header.createdAt}`, ...(header.selection.period ? [`所選期間：${header.selection.period.from} 至 ${header.selection.period.to}（含首尾）`] : []),
      '', '此包只包含已選模組。來源確認與內容正確性須分開理解；匯入不重播執行授權或舊投遞。', '',
      '| 資料區段 | 孩子 ID | 項數 |', '|---|---|---:|', ...coverage.map(row => `| ${row.section} | ${row.childId ?? '名冊'} | ${row.items} |`), ''].join('\n');
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from(summary) };
  }
  return writeHandoverArchive({ directory: input.directory, header, entries: entries(), coverage: () => coverage,
    signingKey: input.signingKey, limits, signal });
}
