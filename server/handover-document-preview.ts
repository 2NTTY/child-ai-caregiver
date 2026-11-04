import { z } from 'zod';
import type { DocumentSnapshot } from '../src/shared/family-documents.ts';
import { handoverPreviewItemSchema, handoverPreviewPageSchema, handoverPreviewQuerySchema, type HandoverPreviewItem, type HandoverPreviewQuery } from '../src/shared/handover-jobs.ts';
import type { FamilyDocumentTransfer } from './family-document-transfer.ts';
import { datedDocumentContent, datedDocumentRequest } from './handover-document-period.ts';
import { handoverPeriodMatch } from './handover-period.ts';
import type { HandoverExportSource } from './handover-export.ts';
import { domainParse } from './firestore-domain-data.ts';
import { firestorePreparationSchema } from './firestore-care-summary.ts';
import { summaryEndDay } from './care-summary-policy.ts';

type Period = HandoverPreviewQuery['period'];
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit'});
const hkDay = (at: string) => dayFormat.format(new Date(at));
function relativeRange(from: string, to: string, period: NonNullable<Period>, zone = dayFormat) {
  return to < zone.format(new Date(period.from)) || from > zone.format(new Date(period.to)) ? 'outside' : 'crosses';
}

/** Only the current readable snapshot may supply the title, source dates and eligibility. Never send its body. */
export function previewFamilyDocument(head: FamilyDocumentTransfer, current: DocumentSnapshot | null, period: Period): HandoverPreviewItem {
  const base = { section: 'documents' as const, childId: head.childId, id: head.id, version: head.version,
    snapshotId: head.currentSnapshot?.id ?? null, snapshotVersion: head.currentSnapshot?.version ?? null };
  if (!current || !head.currentSnapshot?.readable || head.invalidated) return { ...base,
    title: head.kind === 'growth_report' ? '成長報告（正文不可讀）' : '準備單（正文不可讀）',
    from: null, to: null, reason: 'metadata_only', canInclude: false, defaultIncluded: !period };
  const days = [head.request.period.from, head.request.period.to, current.period.from, current.period.to];
  for (const date of [head.request.eventDate, current.eventDate]) if (date) days.push(date);
  let uncertain = !!current.reportCoverage?.counts.recordsUnknownTime;
  for (const source of current.sources) {
    if (source.at) days.push(hkDay(source.at));
    else if (['profile', 'fact', 'concern'].includes(source.kind)) days.push(hkDay(current.generatedAt));
    else uncertain = true;
  }
  days.sort();
  const from = days[0], to = days[days.length - 1];
  const inside = !period || datedDocumentRequest(head.request, period) && datedDocumentContent({
    documentId: head.id, snapshotId: current.id, snapshotVersion: current.version, generatedAt: current.generatedAt,
    invalidated: false, snapshot: current,
  }, period);
  return { ...base, title: current.title, from, to, defaultIncluded: inside, canInclude: true,
    reason: !period ? 'all' : inside ? 'inside' : uncertain ? 'uncertain' : relativeRange(from, to, period) };
}

const mediaFields = z.object({ id: z.uuid().optional(), version: z.number().int().nonnegative(), createdAt: z.iso.datetime({offset:true}).optional(),
  updatedAt: z.iso.datetime({offset:true}).nullable().optional(), state: z.string().optional(), asset: z.object({id:z.uuid()}).nullable().optional(),
  fileName: z.string().nullable().optional(), metadata: z.object({fileName:z.string()}).nullable().optional() });

export function previewOtherDocument(section: Exclude<HandoverPreviewQuery['section'], 'documents'>, childId: string, raw: unknown, period: Period): HandoverPreviewItem | null {
  const common = { section, childId, snapshotId: null, snapshotVersion: null };
  if (section === 'visit_preparation') {
    const item = firestorePreparationSchema.parse(raw), from = item.period.startDay;
    const to = new Date(Date.parse(summaryEndDay(item.period) + 'T00:00:00Z') - 1).toISOString().slice(0,10);
    const inside = !period || handoverPeriodMatch(section, raw, period) === 'inside';
    return { ...common, id: item.childId, version: item.version, title: '到診準備單', from, to,
      canInclude: true, defaultIncluded: inside, reason: !period ? 'all' : inside ? 'inside'
        : relativeRange(from, to, period, new Intl.DateTimeFormat('en-CA', { timeZone: item.period.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })) };
  }
  const item = mediaFields.parse(raw), avatar = section === 'child_avatar';
  if (avatar && !item.asset) return null;
  const at = avatar ? item.updatedAt : item.createdAt, day = at ? hkDay(at) : null;
  const inside = !period || handoverPeriodMatch(section, raw, period) === 'inside';
  const ready = avatar || item.state === 'ready';
  const labels = { files: '附件', photos: '照片', voices: '錄音', child_avatar: '孩子頭像' };
  return { ...common, id: avatar ? childId : z.uuid().parse(item.id), version: item.version,
    title: item.fileName || item.metadata?.fileName || labels[section], from: day, to: day, defaultIncluded: inside,
    canInclude: ready, reason: !ready ? 'metadata_only' : !period ? 'all' : !day ? 'uncertain' : inside ? 'inside' : 'outside' };
}

export async function previewHandoverDocuments(exporter: HandoverExportSource, owner: string, raw: unknown) {
  const { period, ...query } = domainParse(handoverPreviewQuerySchema, raw);
  // Request dated photo metadata without granting the page reader access to attachment bytes.
  const page = await exporter.page(owner, query, () => false, { documentPreviewPeriod: period });
  const items = query.section === 'documents' ? page.items.map(item => handoverPreviewItemSchema.parse(item))
    : page.items.flatMap(row => previewOtherDocument(query.section as Exclude<typeof query.section, 'documents'>, query.childId, row, period) ?? []);
  return handoverPreviewPageSchema.parse({ scopeVersion: page.scopeVersion, nextCursor: page.nextCursor, items,
    ...(query.section === 'child_avatar' ? {avatarVersion: mediaFields.parse(page.items[0]).version} : {}) });
}
