import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { RegisteredSourceJob } from './firestore-registered-source-cards.ts';
import {
  scanItemSchema, sourceCardDocumentRecord, sourceDocumentUrl, sourceDocumentKey, sourceDocumentRecordId,
  type SourceCardDocumentRecord, type SourceScanItem
} from './source-card-document-record.ts';

type Receipt = Extract<SourceCardDocumentRecord, { kind: 'receipt' }>;
export type SourceScanBatch = { sequence: number; items: SourceScanItem[]; consumed: number; next: SourceScanItem[]; issue?: 'file_too_large' | 'listing_changed' };
const corrupt = () => domainReject('source_frontier_integrity', 503);
const invalid = () => domainReject('source_document_invalid', 400);
export function scanCounts(row: Receipt | null) {
  return {
    status: row?.status ?? 'unchanged' as const, documentCount: (row?.savedDocumentCount ?? 0) + (row?.oversizedCount ?? 0),
    savedDocumentCount: row?.savedDocumentCount ?? 0, indexedDocumentCount: row?.indexedDocumentCount ?? 0
  };
}
function normalized(job: RegisteredSourceJob, raw: SourceScanItem): SourceScanItem {
  const result = scanItemSchema.safeParse(raw);
  if (!result.success) return invalid();
  return { ...result.data, url: sourceDocumentUrl(job, result.data.url).href };
}

/** A private, per-check FIFO with durable visited identities. One batch never loads the whole directory. */
export function sourceCardFrontier(data: FirestoreDomainData) {
  const suffix = 'source_card_documents', family = 'source-card-document';
  function open(b: FirestoreAuthorityTransaction, id: string, snap: DocumentSnapshot) {
    const row = data.open(family, id, b.scope, sourceCardDocumentRecord, snap);
    if (row.kind !== 'frontier' || sourceDocumentRecordId(b.scope, row) !== id || data.ref(suffix, family, id).path !== snap.ref.path) return corrupt();
    return row;
  }
  async function pending(b: FirestoreAuthorityTransaction, job: RegisteredSourceJob, grant: string, prior: Receipt | null) {
    if (!prior) return [{ url: job.url }];
    if (!prior.pending) return [];
    const tag = sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'scan', job.revision, job.checkId) + '-';
    const query = data.collection(suffix).where('sortKey', '>=', tag).where('sortKey', '<', tag + '~').orderBy('sortKey').limit(8);
    const snapshots = await b.transaction.get(query);
    if (snapshots.size !== Math.min(8, prior.pending)) return corrupt();
    return snapshots.docs.map(snap => {
      const row = open(b, snap.get('id'), snap);
      if (!row.pending || row.checkId !== job.checkId || row.revision !== job.revision || row.grant !== grant || row.cardId !== job.cardId ||
        snap.get('sortKey') !== tag + String(row.ordinal).padStart(16, '0')) return corrupt();
      return row.item;
    });
  }
  async function plan(b: FirestoreAuthorityTransaction, job: RegisteredSourceJob, grant: string, prior: Receipt | null, batch: SourceScanBatch) {
    const limit = prior?.pending ?? 1;
    if (batch.sequence !== (prior?.sequence ?? 0) || !Number.isSafeInteger(batch.consumed) || batch.consumed < 1 || batch.consumed > batch.items.length
      || batch.items.length > 8 || batch.consumed > limit || batch.next.length > 256) return invalid();
    const selected = await pending(b, job, grant, prior);
    if (firestoreDomainHash(selected) !== firestoreDomainHash(batch.items)) return invalid();
    const next = new Map(batch.next.map(raw => { const item = normalized(job, raw); return [firestoreDomainHash(item), item]; }));
    const multi = !!prior || next.size > 0 || !!batch.issue;
    const updates: SourceCardDocumentRecord[] = [];
    let discovered = prior?.discovered ?? 1, remaining = limit - batch.consumed;
    if (multi) {
      const consumed = batch.items.slice(0, batch.consumed);
      for (const item of consumed) next.delete(firestoreDomainHash(item));
      const items = [...consumed, ...next.values()];
      const ids = items.map(item => sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'frontier', job.revision, job.checkId, firestoreDomainHash(item)));
      const snaps = await b.transaction.getAll(...ids.map(id => data.ref(suffix, family, id)));
      items.forEach((item, i) => {
        const previous = snaps[i]!.exists ? open(b, ids[i]!, snaps[i]!) : null;
        const fields = { kind: 'frontier' as const, cardId: job.cardId, grant, revision: job.revision, checkId: job.checkId, item };
        if (i < consumed.length) {
          if (prior && !previous?.pending) return corrupt();
          updates.push({ ...fields, ordinal: previous?.ordinal ?? 0, pending: false, ...(batch.issue ? { issue: batch.issue } : {}) });
        } else if (!previous) { updates.push({ ...fields, ordinal: discovered++, pending: true }); remaining++; }
      });
    }
    return { updates, discovered, pending: remaining, multi };
  }
  return { pending, plan };
}
