import type { AccountExportPage } from '../src/shared/account-service.ts';
import type { DocumentRequest } from '../src/shared/family-documents.ts';
import type { HandoverDocumentChoice, HandoverDocumentPin } from '../src/shared/handover.ts';
import { familyDocumentTransferSchema, documentTransferContentSchema, type DocumentTransferContent, type FamilyDocumentTransfer } from './family-document-transfer.ts';
import { withinHandoverPeriod, type HandoverPeriod } from './handover-period.ts';
import { HandoverArchiveError } from './handover-archive.ts';

// Document reports and their input queries use Hong Kong civil dates.
function containsDays(period: HandoverPeriod, days: DocumentRequest['period'], eventDate: string | null) {
  const first = Date.parse(days.from + 'T00:00:00.000+08:00'), last = Date.parse(days.to + 'T23:59:59.999+08:00');
  const from = Date.parse(period.from), to = Date.parse(period.to);
  return first >= from && last <= to && (eventDate === null ||
    Date.parse(eventDate + 'T00:00:00.000+08:00') >= from && Date.parse(eventDate + 'T23:59:59.999+08:00') <= to);
}
export function datedDocumentRequest(request: DocumentRequest, period: HandoverPeriod) {
  return containsDays(period, request.period, request.eventDate);
}
export function datedDocumentContent(content: DocumentTransferContent, period: HandoverPeriod) {
  const snapshot = content.snapshot;
  if (!snapshot || content.invalidated || !containsDays(period, snapshot.period, snapshot.eventDate)
    || snapshot.reportCoverage?.counts.recordsUnknownTime) return false;
  // Current background without an event date belongs to the snapshot as of generation.
  // An undated observation is not proof of an event in the requested period.
  return snapshot.sources.every(source => source.at !== null ? withinHandoverPeriod(source.at, period)
    : (source.kind === 'profile' || source.kind === 'fact' || source.kind === 'concern') && withinHandoverPeriod(snapshot.generatedAt, period));
}
export type PackageDocumentFilter = (documentId: string, snapshotId: string) => boolean;
type Pages = (section: string, childId: string, filter?: PackageDocumentFilter) => AsyncIterable<AccountExportPage>;
type SelectedPage = { section: 'documents' | 'document_versions' | 'document_content'; items: unknown[] };
type SelectedHead = { head: FamilyDocumentTransfer; eligible: Map<string, number>; explicit: boolean };

export function documentHeadMatchesPin(head: FamilyDocumentTransfer, pin: HandoverDocumentPin) {
  return head.childId === pin.childId && head.id === pin.id && head.version === pin.version
    && (head.currentSnapshot?.id ?? null) === pin.snapshotId && (head.currentSnapshot?.version ?? null) === pin.snapshotVersion;
}
function scopeChanged(): never { throw new HandoverArchiveError('export_scope_changed'); }

function selectedContent(content: DocumentTransferContent, selected: SelectedHead, period: HandoverPeriod) {
  if (!selected.explicit) return datedDocumentContent(content, period);
  const current = selected.head.currentSnapshot!;
  if (content.snapshotId !== current.id) return false;
  if (content.snapshotVersion !== current.version || content.invalidated || !content.snapshot) scopeChanged();
  return true;
}

/** Index only snapshot identities, then stream selected bodies again through normal disclosure. */
export async function* datedDocumentPages(childId: string, period: HandoverPeriod, pages: Pages, limit: number,
  choices: readonly HandoverDocumentChoice[] = []): AsyncGenerator<SelectedPage> {
  const pending = new Map<string, HandoverDocumentChoice>();
  for (const choice of choices) if (choice.section === 'documents' && choice.childId === childId) {
    if (pending.has(choice.id)) scopeChanged();
    pending.set(choice.id, choice);
  }
  const heads = new Map<string, SelectedHead>();
  const seen = new Set<string>();
  for await (const page of pages('documents', childId)) for (const raw of page.items) {
    const head = familyDocumentTransferSchema.parse(raw);
    if (head.childId !== childId || seen.has(head.id)) throw new HandoverArchiveError('invalid_package_scope');
    seen.add(head.id);
    const choice = pending.get(head.id);
    if (choice) {
      if (!documentHeadMatchesPin(head, choice)) scopeChanged();
      pending.delete(head.id);
      if (!choice.include) continue;
      if (head.invalidated || !head.currentSnapshot?.readable) scopeChanged();
    } else if (head.invalidated || !head.currentSnapshot?.readable || !datedDocumentRequest(head.request, period)) continue;
    if (heads.size >= limit) throw new HandoverArchiveError('package_size_exceeded');
    heads.set(head.id, { head, eligible: new Map(), explicit: choice?.include === true });
  }
  if (pending.size) scopeChanged();
  let count = 0;
  if (heads.size) for await (const page of pages('document_content', childId, (id, snapshotId) => {
    const selected = heads.get(id);
    return !!selected && (!selected.explicit || selected.head.currentSnapshot!.id === snapshotId);
  })) for (const raw of page.items) {
    const content = documentTransferContentSchema.parse(raw), selected = heads.get(content.documentId);
    if (!selected || !selectedContent(content, selected, period)) continue;
    if (selected.eligible.has(content.snapshotId)) throw new HandoverArchiveError('invalid_package_data');
    if (++count > limit) throw new HandoverArchiveError('package_size_exceeded');
    selected.eligible.set(content.snapshotId, content.snapshotVersion);
  }
  for (const [id, { head, eligible, explicit }] of heads) {
    if (eligible.get(head.currentSnapshot!.id) !== head.currentSnapshot!.version) {
      if (explicit) scopeChanged();
      heads.delete(id); continue;
    }
    yield { section: 'documents', items: [{ ...head, recentSnapshotIds: head.recentSnapshotIds.filter(snapshotId => eligible.has(snapshotId)) }] };
  }
  if (!heads.size) yield { section: 'documents', items: [] };
  let wroteContent = false;
  if (heads.size) for await (const page of pages('document_content', childId, (id, snapshotId) => heads.get(id)?.eligible.has(snapshotId) ?? false)) {
    for (const raw of page.items) {
      const content = documentTransferContentSchema.parse(raw), selected = heads.get(content.documentId);
      if (!selected?.eligible.has(content.snapshotId)) continue;
      if (selected.eligible.get(content.snapshotId) !== content.snapshotVersion || !selectedContent(content, selected, period))
        throw new HandoverArchiveError('export_scope_changed');
      selected.eligible.delete(content.snapshotId);
      const { snapshot: _body, ...version } = content;
      yield { section: 'document_versions', items: [version] };
      yield { section: 'document_content', items: [content] };
      wroteContent = true;
    }
  }
  if ([...heads.values()].some(selected => selected.eligible.size)) throw new HandoverArchiveError('export_scope_changed');
  if (!wroteContent) {
    yield { section: 'document_versions', items: [] };
    yield { section: 'document_content', items: [] };
  }
}
