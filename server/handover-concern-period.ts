import type { z } from 'zod';
import type { AccountExportPage } from '../src/shared/account-service.ts';
import { CONCERN_STORED_EVENT_LIMIT } from '../src/shared/concerns.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';
import { firestoreDomainUuid } from './firestore-domain-data.ts';
import { firestoreConcernSchema, concernTransferSchema } from './firestore-concerns.ts';
import { firestoreDocumentConcernEventSchema } from './firestore-document-sources.ts';
import { withinHandoverPeriod, type HandoverPeriod } from './handover-period.ts';
import { HandoverArchiveError } from './handover-archive.ts';

type Head = z.infer<typeof firestoreConcernSchema>;
type Event = z.infer<typeof firestoreDocumentConcernEventSchema>;
type SelectedPage = { section: 'concerns' | 'concern_events' | 'concern_history'; items: unknown[] };
const normalizedPeriod = ({ from, to }: HandoverPeriod) => ({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
const sliceId = (childId: string, concernId: string, period: HandoverPeriod) =>
  firestoreDomainUuid(['concern-period:1', childId, concernId, normalizedPeriod(period)]);
function fail(): never { throw new HandoverArchiveError('invalid_package_period'); }

// Retain original identities across handovers, without bringing an earlier head's follow-up or other domain payload into this window.
export function handoverIdentityLinks(origin?: ImportProvenance): ImportProvenance | undefined {
  if (!origin) return undefined;
  function identity(link: ImportProvenance['current']) {
    const { serverId, accountId, childId, section, resourceId, resourceVersion, authorUserId, createdAt,
      confirmedBy, confirmedAt, confirmationBasis, assigneeUserId } = link.source;
    const { concern, concernEvent } = link.source;
    const reference = link.source.concernReference ?? (concernEvent ? { id: concernEvent.concernId, sequence: concernEvent.sequence }
      : concern?.periodSource ? { id: concern.periodSource.concernId } : undefined);
    return { ...link, source: { serverId, accountId, childId, section, resourceId, resourceVersion, authorUserId, createdAt,
      confirmedBy, confirmedAt, confirmationBasis, assigneeUserId, ...(reference ? { concernReference: reference } : {}) } };
  }
  return { current: identity(origin.current), previous: origin.previous.map(identity) };
}

/** Stream selected events once. Hold only bounded sequence identities per live timeline, never the child's event bodies. */
export async function* datedConcernPages(childId: string, rawPeriod: HandoverPeriod,
  pages: (section: string, childId: string) => AsyncIterable<AccountExportPage>): AsyncGenerator<SelectedPage> {
  const period = normalizedPeriod(rawPeriod);
  const heads = new Map<string, { head: Head; id: string; seen: Set<number>; sequences: number[]; first?: string; last?: string }>();
  for await (const page of pages('concerns', childId)) for (const raw of page.items) {
    const head = firestoreConcernSchema.parse(raw);
    if (head.childId !== childId || heads.has(head.id) || heads.size >= 200) fail();
    heads.set(head.id, { head, id: sliceId(childId, head.id, period), seen: new Set(), sequences: [] });
  }
  let emitted = false;
  for await (const page of pages('concern_events', childId)) {
    const items: Event[] = [];
    for (const raw of page.items) {
      // Imported source-evidence rows and superseded timelines do not belong to the current concern's event stream.
      if (raw && typeof raw === 'object' && 'format' in raw && raw.format === 'yuyoufang-source-revision:1') continue;
      const event = firestoreDocumentConcernEventSchema.parse(raw), entry = heads.get(event.concernId);
      if (event.childId !== childId) fail();
      if (!entry || entry.head.timelineId !== event.timelineId) continue;
      if (event.sequence > entry.head.eventCount || entry.seen.has(event.sequence)) fail();
      entry.seen.add(event.sequence);
      if (!withinHandoverPeriod(event.at, period)) continue;
      entry.sequences.push(event.sequence);
      if (!entry.first || Date.parse(event.at) < Date.parse(entry.first)) entry.first = event.at;
      if (!entry.last || Date.parse(event.at) > Date.parse(entry.last)) entry.last = event.at;
      items.push({ ...event, concernId: entry.id, periodConcernId: entry.head.id, importedFrom: handoverIdentityLinks(event.importedFrom) });
    }
    if (items.length) { emitted = true; yield { section: 'concern_events', items }; }
  }
  if (!emitted) yield { section: 'concern_events', items: [] };
  const items = [];
  for (const { head, id, seen, sequences, first, last } of heads.values()) {
    if (head.eventCount !== seen.size) fail();
    if (!sequences.length || !first || !last) continue;
    const selectedHead = sequences.length === head.eventCount && withinHandoverPeriod(head.createdAt, period)
      && withinHandoverPeriod(head.updatedAt, period);
    const archivedAt = head.archivedAt && withinHandoverPeriod(head.archivedAt, period) ? head.archivedAt : null;
    items.push({ id, childId, version: head.version, timelineId: head.timelineId, eventCount: sequences.length,
      title: selectedHead ? head.title : '持續關注紀錄', reason: selectedHead ? head.reason : '所選期間的觀察及行動',
      createdAt: first, updatedAt: last, status: archivedAt ? 'closed' : 'following', archivedAt, attentionIds: [], followUp: null,
      importedFrom: handoverIdentityLinks(head.importedFrom),
      periodSource: { concernId: head.id, ...period, sequences: sequences.sort((a, b) => a - b) } });
  }
  yield { section: 'concerns', items };
  yield { section: 'concern_history', items: [] };
}

export function readDatedConcernHead(raw: unknown, period: HandoverPeriod) {
  const result = concernTransferSchema.safeParse(raw);
  if (!result.success) fail();
  const head = result.data, ref = head.periodSource, canonical = normalizedPeriod(period);
  if (!ref || ref.from !== canonical.from || ref.to !== canonical.to || head.id !== sliceId(head.childId, ref.concernId, period)
    || head.eventCount !== ref.sequences.length || head.eventCount > CONCERN_STORED_EVENT_LIMIT || head.followUp || head.attentionIds.length
    || !withinHandoverPeriod(head.createdAt, period) || !withinHandoverPeriod(head.updatedAt, period)
    || head.archivedAt && !withinHandoverPeriod(head.archivedAt, period)) fail();
  return { head, sequences: ref.sequences };
}

export function validDatedConcernEvent(event: Event, period: HandoverPeriod) {
  return !!event.periodConcernId && event.concernId === sliceId(event.childId, event.periodConcernId, period)
    && withinHandoverPeriod(event.at, period);
}
