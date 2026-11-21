import { createHash } from 'node:crypto';
import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { CHAT_FILE_LIMITS } from '../src/shared/chat-files.ts';
import { sourceAccessGate } from '../src/shared/registered-source-card.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction, type FirestoreAuthorityOptions } from './firestore-authority.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreRegisteredSourceCards, RegisteredSourceJob } from './firestore-registered-source-cards.ts';
import { sourceCardRecord, sourceRecordId, sourceRevision } from './registered-source-records.ts';
import { prepareFirestoreBackgroundWork } from './firestore-background-work.ts';
import { readChatFile } from './chat-file-reader.ts';
import { extractKnowledgePdf, KNOWLEDGE_PDF_MAX_BYTES } from './knowledge-pdf.ts';
import { knowledgeIndexTokens } from './knowledge-ranking.ts';
import { sourceCardFrontier, scanCounts, type SourceScanBatch } from './source-card-frontier.ts';
import { observeMethods, readingReport } from './source-reading-evidence.ts';
import { parsePersonalPage } from './personal-source-fetch.ts';
import {
  SOURCE_CARD_PART_BYTES, sourceCardDocumentRecord, sourceDocumentKey, sourceDocumentUrl, sourceDocumentMetadata,
  sourceDocumentRecordId, type SourceCardDocumentRecord, type SourceCardEdition, type SourceCardHead
} from './source-card-document-record.ts';

type CardAccess = Pick<RegisteredSourceJob, 'cardId' | 'kind' | 'url' | 'allowedPath' | 'credentialRef'>;
interface Original { url: string; mimeType: string; bytes: Buffer; sha256: string; preview?: string | null }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const grantFor = (card: CardAccess) => firestoreDomainHash([card.kind, card.url, card.allowedPath ?? null, card.credentialRef]);
const authorityTagFor = (b: FirestoreAuthorityTransaction) => firestoreDomainHash([b.scope, b.generation, b.authorizationVersion]);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const rangeSchema = z.strictObject({ offset: z.int().nonnegative().optional(), page: z.int().positive().optional(), nativePdf: z.boolean().optional(), byteOffset: z.int().nonnegative().optional() })
  .refine(r => r.byteOffset === undefined || r.page === undefined && r.offset === undefined && r.nativePdf === undefined);
const invalid = () => domainReject('source_document_invalid', 400);
const missing = () => domainReject('source_document_unavailable', 404);
const corrupt = () => domainReject('source_document_integrity', 503);
const collection = 'source_card_documents', family = 'source-card-document';
function itemView(row: SourceCardEdition | Extract<SourceCardDocumentRecord, { kind: 'head' }>) {
  const { cardId, documentId, version, title, url, mimeType, preview, capturedAt, originalHash, indexCoverage } = row;
  return { cardId, documentId, version, title, url, mimeType, preview: preview.slice(0, 360), capturedAt, originalHash, indexCoverage };
}
function materialize(job: RegisteredSourceJob, original: Original) {
  if (!Buffer.isBuffer(original.bytes) || !original.bytes.length || original.bytes.length > KNOWLEDGE_PDF_MAX_BYTES
    || hash(original.bytes) !== original.sha256) return invalid();
  const locator = sourceDocumentUrl(job, original.url);
  let bytes = original.bytes, preview = original.preview ?? '', title = locator.pathname.split('/').filter(Boolean).at(-1) ?? locator.hostname;
  if (original.mimeType === 'text/html') {
    // Save the visible notice. Authenticated page markup can contain one-time tokens and download URLs.
    const page = parsePersonalPage(bytes.toString('utf8'), locator.href);
    bytes = Buffer.from(page.text); preview = page.text; title = page.title;
  }
  const storedHash = hash(bytes), grant = grantFor(job), documentId = sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'url', locator.href);
  const version = original.mimeType === 'text/html' ? firestoreDomainHash([original.mimeType, title, storedHash]) : original.sha256;
  const edition: SourceCardEdition = {
    kind: 'edition', cardId: job.cardId, grant, documentId, version,
    url: locator.href, title: title.slice(0, 300), mimeType: original.mimeType, originalHash: original.sha256,
    bytes: bytes.length, storedHash, preview: preview.slice(0, 2400), indexText: preview.slice(0, 12000), indexTerms: [],
    indexCoverage: 'original_only', capturedAt: new Date().toISOString()
  };
  sourceCardDocumentRecord.parse(edition);
  return { bytes, edition };
}
async function indexEdition(edition: SourceCardEdition, bytes: Buffer, signal: AbortSignal) {
  const html = edition.mimeType === 'text/html', pdf = edition.mimeType === 'application/pdf';
  if (!html && !pdf && !edition.mimeType.startsWith('text/') &&
    edition.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    edition.indexText = ''; return;
  }
  if (!pdf && bytes.length > CHAT_FILE_LIMITS.bytes) { edition.indexText = ''; return; }
  let text = edition.indexText, complete = false;
  if (html) complete = Buffer.byteLength(text) === bytes.length;
  else if (!text) {
    if (pdf && bytes.length > CHAT_FILE_LIMITS.bytes) {
      const page = await extractKnowledgePdf(bytes, { expectedHash: edition.storedHash, startPage: 1, pageLimit: 1, signal });
      text = page.pages[0]?.text ?? '';
    } else {
      const range = await readChatFile({ buffer: bytes, sha256: edition.storedHash, mimeType: edition.mimeType, fileName: edition.title }, {}, signal);
      if (range.state === 'read') { text = range.text; complete = range.complete; }
    }
  }
  signal.throwIfAborted();
  edition.indexText = text.slice(0, 12000);
  if (!edition.indexText.trim()) return;
  edition.indexCoverage = pdf ? 'page_one_excerpt' : complete && text.length <= 12000 ? 'full_text' : 'text_excerpt';
  edition.indexTerms = [...knowledgeIndexTokens(edition.indexText)].filter(term => term.length <= 64).slice(0, 512);
  edition.preview = edition.indexText.slice(0, 2400);
}

/** Owner-only original versions. The protected card and private data share each authority transaction. */
export function createFirestoreSourceCardDocuments(options: FirestoreAuthorityOptions,
  cards: Pick<FirestoreRegisteredSourceCards, 'withCurrentCheck'>) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const now = options.serverClock ?? Date.now, frontier = sourceCardFrontier(data);
  const ref = (id: string) => data.ref(collection, family, id);
  function open(b: FirestoreAuthorityTransaction, id: string, snap: DocumentSnapshot) {
    if (!snap.exists) return null;
    const row = data.open(family, id, b.scope, sourceCardDocumentRecord, snap);
    if (sourceDocumentRecordId(b.scope, row) !== id || snap.ref.path !== ref(id).path) return corrupt();
    if (row.kind === 'head' && (snap.get('id') !== id || snap.get('targetTag') !== sourceDocumentKey(b.scope.ownerUserId, row.cardId, row.grant, 'list'))) return corrupt();
    return row;
  }
  function save(b: FirestoreAuthorityTransaction, row: SourceCardDocumentRecord) {
    const id = sourceDocumentRecordId(b.scope, row);
    b.transaction.set(ref(id), { ...data.tags(b.scope), ...sourceDocumentMetadata(b.scope, row), ...data.seal(family, id, b.scope, sourceCardDocumentRecord, row) });
  }
  function readable<T>(owner: string, cardId: string, fn: (b: FirestoreAuthorityTransaction, grant: string, accessRevision: number) => Promise<T>, index = false) {
    z.uuid().parse(cardId);
    return authority.runTransaction(owner, null, async b => {
      const id = sourceRecordId(owner, cardId), snap = await b.transaction.get(data.ref('source_cards', 'registered-source-card', id));
      if (!snap.exists) return missing();
      const row = data.open('registered-source-card', id, b.scope, sourceCardRecord, snap);
      if (snap.ref.path !== data.ref('source_cards', 'registered-source-card', id).path || snap.get('recordVersion') !== sourceRevision(row)) return corrupt();
      if (row.removed || !row.card.enabled || row.card.cardId !== cardId) return missing();
      if (index && row.card.nextCheckAt === null && row.card.lastResult &&
        ['needs_login', 'payment_required', 'mfa_required', 'captcha_required'].includes(row.card.lastResult.status)) return missing();
      return fn(b, grantFor(row.card), row.accessRevision ?? 1);
    });
  }
  function withIndexCard<T>(owner: string, cardId: string, fn: (b: FirestoreAuthorityTransaction, grant: string, accessRevision: number) => Promise<T>) {
    return readable(owner, cardId, fn, true);
  }
  async function readIndexHeadIn(b: FirestoreAuthorityTransaction, cardId: string, grant: string, accessRevision: number, documentId: string): Promise<SourceCardHead | null> {
    z.uuid().parse(cardId); digest.parse(grant); digest.parse(documentId); z.int().positive().max(2147483647).parse(accessRevision);
    const id = sourceDocumentKey(b.scope.ownerUserId, cardId, grant, 'head', documentId);
    const head = open(b, id, await b.transaction.get(ref(id)));
    if (head && (head.kind !== 'head' || head.cardId !== cardId || head.grant !== grant || head.documentId !== documentId)) return corrupt();
    return head?.kind === 'head' && head.rag?.accessRevision === accessRevision && head.rag.authorityTag === authorityTagFor(b) ? head : null;
  }
  function withIndexHead<T>(owner: string, cardId: string, documentId: string, fn: (b: FirestoreAuthorityTransaction, head: SourceCardHead) => Promise<T>) {
    return withIndexCard(owner, cardId, async (b, grant, accessRevision) => {
      const head = await readIndexHeadIn(b, cardId, grant, accessRevision, documentId);
      if (!head) return missing();
      return fn(b, head);
    });
  }
  async function checkResult(job: RegisteredSourceJob, startUrl?: string) {
    return cards.withCurrentCheck(job, async b => {
      const grant = grantFor(job), id = sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'receipt');
      const raw = open(b, id, await b.transaction.get(ref(id)));
      if (raw && raw.kind !== 'receipt') return corrupt();
      const row = raw?.checkId === job.checkId && raw.revision === job.revision ? raw : null;
      return { sequence: row?.sequence ?? 0, items: await frontier.pending(b, job, grant, row, startUrl), result: scanCounts(row), reading: readingReport(row) };
    });
  }
  async function retryBatch(job: RegisteredSourceJob, sequence: number, startUrl = job.url) {
    return cards.withCurrentCheck(job, async b => {
      const id = sourceDocumentKey(job.ownerUserId, job.cardId, grantFor(job), 'receipt');
      const row = open(b, id, await b.transaction.get(ref(id)));
      if (row?.kind !== 'receipt' || row.checkId !== job.checkId || row.revision !== job.revision) {
        if (sequence) return false;
        const grant = grantFor(job), fields = { cardId: job.cardId, grant, checkId: job.checkId, revision: job.revision };
        save(b, { ...fields, kind: 'frontier', ordinal: 0, pending: true, item: { url: sourceDocumentUrl(job, startUrl).href } });
        save(b, { ...fields, kind: 'scan-cleanup', cleanupAt: new Date(now() + 86400_000).toISOString() });
        save(b, { ...fields, kind: 'receipt', status: 'unchanged', sequence: 0, pending: 1, discovered: 1,
          transientFailures: 1, issueCount: 0, issueExamples: [], savedDocumentCount: 0, indexedDocumentCount: 0, oversizedCount: 0 });
        return true;
      }
      if (row.sequence !== sequence || !row.pending) return false;
      const tries = row.transientFailures ?? 0;
      if (tries >= 2) return false;
      save(b, { ...row, transientFailures: tries + 1 });
      return true;
    });
  }
  async function ingest(job: RegisteredSourceJob, originals: Original[], signal: AbortSignal,
    batch: SourceScanBatch = { sequence: 0, items: [{ url: job.url }], consumed: 1, next: [] }) {
    signal.throwIfAborted();
    if (batch.issue && (originals.length || batch.next.length || batch.consumed !== 1)) return invalid();
    if (originals.length > 16 || job.kind === 'document' && !batch.issue && originals.length !== 1
      || originals.reduce((n, item) => n + item.bytes.length, 0) > 40 * 1024 * 1024) return invalid();
    let ready: ReturnType<typeof materialize>[];
    try { ready = originals.map(item => materialize(job, item)); }
    catch { return invalid(); }
    if (new Set(ready.map(item => item.edition.documentId)).size !== ready.length) return invalid();
    if (batch.candidate) {
      const candidate = batch.candidate, observed = new Set([...batch.next.filter(i => !i.offset).map(i => i.url), ...ready.map(r => r.edition.url)]);
      if (!batch.items.slice(0, batch.consumed).some(i => i.url === candidate.url) || !candidate.samples.length ||
          candidate.samples.some(url => !observed.has(sourceDocumentUrl(job, url).href))) return invalid();
      if (candidate.covers) sourceDocumentUrl(job, candidate.covers);
      if (candidate.feedUrl) sourceDocumentUrl(job, candidate.feedUrl);
    }
    for (const { bytes, edition } of ready) {
      const exists = await cards.withCurrentCheck(job, async b => {
        const id = sourceDocumentRecordId(b.scope, edition), prior = open(b, id, await b.transaction.get(ref(id)));
        if (prior && (prior.kind !== 'edition' || prior.storedHash !== edition.storedHash || prior.mimeType !== edition.mimeType)) return corrupt();
        if (!prior) save(b, {
          kind: 'staging', cardId: job.cardId, grant: edition.grant, documentId: edition.documentId, version: edition.version,
          next: 0, count: Math.ceil(bytes.length / SOURCE_CARD_PART_BYTES), cleanupAt: new Date(now() + 24 * 3600_000).toISOString()
        });
        return !!prior;
      });
      if (exists) continue;
      try {
        await indexEdition(edition, bytes, signal);
      } catch {
        signal.throwIfAborted();
        edition.indexCoverage = 'original_only';
        edition.indexText = '';
        edition.indexTerms = [];
      }
      // Stage bounded batches. Only the later atomic head update makes an edition available.
      for (let start = 0; start < bytes.length; start += 8 * SOURCE_CARD_PART_BYTES) {
        signal.throwIfAborted();
        await cards.withCurrentCheck(job, async b => {
          signal.throwIfAborted();
          for (let at = start; at < Math.min(start + 8 * SOURCE_CARD_PART_BYTES, bytes.length); at += SOURCE_CARD_PART_BYTES)
            save(b, {
              kind: 'part', cardId: job.cardId, grant: edition.grant, documentId: edition.documentId, version: edition.version,
              part: at / SOURCE_CARD_PART_BYTES, base64: bytes.subarray(at, at + SOURCE_CARD_PART_BYTES).toString('base64')
            });
        });
      }
    }
    return cards.withCurrentCheck(job, async (b, accessRevision) => {
      const grant = grantFor(job), receiptId = sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'receipt');
      const recorded = open(b, receiptId, await b.transaction.get(ref(receiptId)));
      if (recorded && recorded.kind !== 'receipt') return corrupt();
      const prior = recorded?.checkId === job.checkId && recorded.revision === job.revision ? recorded : null;
      if (prior && prior.sequence > batch.sequence) return { pending: prior.pending, result: scanCounts(prior), reading: readingReport(prior) };
      const queue = await frontier.plan(b, job, grant, prior, batch);
      const authorityTag = authorityTagFor(b);
      const rows = await Promise.all(ready.map(async ({ edition }) => {
        const id = sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'head', edition.documentId), editionId = sourceDocumentRecordId(b.scope, edition);
        const counterId = sourceDocumentKey(job.ownerUserId, job.cardId, grant, 'scan-document', job.revision, job.checkId, edition.documentId);
        const [h, v, counter] = await b.transaction.getAll(ref(id), ref(editionId), ...(queue.multi ? [ref(counterId)] : []));
        const previous = open(b, id, h!), saved = open(b, editionId, v!), counted = counter ? open(b, counterId, counter) : null;
        if (previous && previous.kind !== 'head' || saved && saved.kind !== 'edition' || counted && counted.kind !== 'scan-document') return corrupt();
        const current = saved ?? edition;
        const head: SourceCardHead = { ...current, kind: 'head', rag: previous?.version === edition.version && previous.rag?.accessRevision === accessRevision && previous.rag.authorityTag === authorityTag
          ? previous.rag : { accessRevision, incarnation: job.checkId, authorityTag } };
        const work = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'source-card-index', scope: b.scope,
          resourceId: job.cardId, basis: JSON.stringify([head.documentId, head.version, head.rag!.incarnation, accessRevision]),
          generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date(now()).toISOString());
        return { previous, edition, saved, counted, head, work };
      }));
      signal.throwIfAborted();
      let changed = prior?.contentChanged ?? (prior?.status === 'changed'), savedDocumentCount = prior?.savedDocumentCount ?? 0, indexedDocumentCount = prior?.indexedDocumentCount ?? 0;
      for (const { previous, edition, saved, counted, head, work } of rows) {
        if (!saved) {
          save(b, edition);
          b.transaction.delete(ref(sourceDocumentKey(job.ownerUserId, job.cardId, edition.grant, 'staging', edition.documentId, edition.version)));
        }
        const current = saved ?? edition, indexed = current.indexCoverage !== 'original_only';
        if (!counted) savedDocumentCount++;
        indexedDocumentCount += Number(indexed) - Number(counted?.indexed === true);
        if (previous?.version !== edition.version) changed = true;
        if (previous?.version !== edition.version || previous.rag?.accessRevision !== accessRevision || previous.rag.authorityTag !== authorityTag) save(b, head);
        work.commit();
        if (queue.multi && counted?.indexed !== indexed)
          save(b, { kind: 'scan-document', cardId: job.cardId, grant, revision: job.revision, checkId: job.checkId, documentId: edition.documentId, indexed });
      }
      for (const row of queue.updates) save(b, row);
      if (queue.multi) save(b, {
        kind: 'scan-cleanup', cardId: job.cardId, grant, checkId: job.checkId, revision: job.revision,
        cleanupAt: new Date(now() + (queue.pending ? 86400_000 : 0)).toISOString()
      });
      const status = prior?.status === 'failed' || batch.issue ? 'failed' : changed ? 'changed' : 'unchanged';
      const issueExamples = prior?.issueExamples.slice() ?? [];
      if (batch.issue && issueExamples.length < 8)
        issueExamples.push({ url: sourceDocumentUrl(job, batch.items[0]!.url).href, reason: batch.issue });
      const prospects = observeMethods(prior, batch, rows.map(r => r.saved ?? r.edition), new Date(now()).toISOString());
      const gate = sourceAccessGate.safeParse(batch.issue);
      const accessGate = prior?.accessGate ?? (gate.success ? { url: batch.items[0]!.url, reason: gate.data } : undefined);
      const receipt: Extract<SourceCardDocumentRecord, { kind: 'receipt' }> = {
        kind: 'receipt' as const, cardId: job.cardId, grant, checkId: job.checkId, revision: job.revision, sequence: batch.sequence + 1,
        discovered: queue.discovered, pending: queue.pending, status, contentChanged: changed, savedDocumentCount, indexedDocumentCount,
        issueCount: (prior?.issueCount ?? 0) + Number(!!batch.issue), issueExamples, ...(prospects.length ? { prospects } : {}), ...(accessGate ? { accessGate } : {}),
        oversizedCount: (prior?.oversizedCount ?? 0) + Number(batch.issue === 'file_too_large')
      };
      save(b, receipt);
      return { pending: receipt.pending, result: scanCounts(receipt), reading: readingReport(receipt) };
    });
  }
  // Expired staging rows can outlive their owner lease, including after a card was removed.
  // Recheck the encrypted address, expiry and absence of the published edition in each cleanup transaction.
  async function pruneStaging() {
    const at = new Date(now()).toISOString();
    const query = data.collection(collection).where('cleanupAt', '<=', at).orderBy('cleanupAt').limit(2);
    const due = await options.database.runTransaction(tx => tx.get(query), { readOnly: true });
    for (const candidate of due.docs) await options.database.runTransaction(async tx => {
      const snap = await tx.get(candidate.ref);
      if (!snap.exists || typeof snap.get('cleanupAt') !== 'string' || snap.get('cleanupAt') > at) return;
      const raw = snap.data()!;
      const { context, value } = openRecoveryEnvelope({
        ...options, locator: raw.recovery,
        envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext }
      });
      const row = sourceCardDocumentRecord.parse(value), scope = context.scope;
      if ((row.kind !== 'staging' && row.kind !== 'scan-cleanup') || context.kind !== family || row.cleanupAt !== raw.cleanupAt || context.recordVersion !== 1 ||
        sourceDocumentRecordId(scope, row) !== context.id || ref(context.id).path !== snap.ref.path) return corrupt();
      if (row.kind === 'scan-cleanup') {
        const owner = scope.ownerUserId, cardKey = sourceRecordId(owner, row.cardId);
        const receiptId = sourceDocumentKey(owner, row.cardId, row.grant, 'receipt');
        const [r, c] = await tx.getAll(ref(receiptId), data.ref('source_cards', 'registered-source-card', cardKey));
        const receipt = r?.exists ? data.open(family, receiptId, scope, sourceCardDocumentRecord, r) : null;
        const card = c?.exists && c.get('epochTag') === data.tags(scope).epochTag
          ? data.open('registered-source-card', cardKey, scope, sourceCardRecord, c) : null;
        if (receipt?.kind === 'receipt' && receipt.checkId === row.checkId && receipt.pending > 0 && card && !card.removed &&
          card.card.enabled && card.card.revision === row.revision && card.lease?.checkId === row.checkId) {
          const next = { ...row, cleanupAt: new Date(now() + 86400_000).toISOString() };
          tx.set(snap.ref, { ...data.tags(scope), ...sourceDocumentMetadata(scope, next), ...data.seal(family, context.id, scope, sourceCardDocumentRecord, next) });
          return;
        }
        const tag = sourceDocumentKey(owner, row.cardId, row.grant, 'scan', row.revision, row.checkId);
        const items = await tx.get(data.collection(collection).where('targetTag', '==', tag).limit(64));
        for (const doc of items.docs) {
          const id = digest.parse(doc.get('id')), item = data.open(family, id, scope, sourceCardDocumentRecord, doc);
          if ((item.kind !== 'frontier' && item.kind !== 'scan-document') || item.cardId !== row.cardId || item.grant !== row.grant || item.checkId !== row.checkId || item.revision !== row.revision ||
            sourceDocumentRecordId(scope, item) !== id || ref(id).path !== doc.ref.path) return corrupt();
          tx.delete(doc.ref);
        }
        if (items.size < 64) tx.delete(snap.ref);
        return;
      }
      const key = (kind: string, ...extra: number[]) => sourceDocumentKey(scope.ownerUserId, row.cardId, row.grant, kind, row.documentId, row.version, ...extra);
      const edition = await tx.get(ref(key('edition')));
      if (edition.exists) { tx.delete(snap.ref); return; }
      const end = Math.min(row.next + 32, row.count);
      for (let n = row.next; n < end; n++) tx.delete(ref(key('part', n)));
      if (end === row.count) tx.delete(snap.ref);
      else {
        const next = { ...row, next: end };
        tx.set(snap.ref, { ...data.tags(scope), ...sourceDocumentMetadata(scope, next), ...data.seal(family, context.id, scope, sourceCardDocumentRecord, next) });
      }
    });
  }
  async function heads(owner: string, cardId: string, after: string | null, includeIssues = false) {
    if (after !== null) digest.parse(after);
    return readable(owner, cardId, async (b, grant) => {
      let q = data.collection(collection).where('targetTag', '==', sourceDocumentKey(owner, cardId, grant, 'list')).orderBy(FieldPath.documentId()).limit(21);
      if (after) q = q.startAfter(after);
      const page = await b.transaction.get(q);
      const items = page.docs.slice(0, 20).map(snap => {
        const row = open(b, digest.parse(snap.get('id')), snap);
        if (row?.kind !== 'head' || row.cardId !== cardId || row.grant !== grant || ref(sourceDocumentRecordId(b.scope, row)).path !== snap.ref.path) return corrupt();
        return row;
      });
      let issues = null;
      if (includeIssues) {
        const receiptId = sourceDocumentKey(owner, cardId, grant, 'receipt');
        const receipt = open(b, receiptId, await b.transaction.get(ref(receiptId)));
        if (receipt && receipt.kind !== 'receipt') return corrupt();
        if (receipt?.issueCount) issues = { revision: receipt.revision, checkId: receipt.checkId, count: receipt.issueCount, examples: receipt.issueExamples };
      }
      return { items, nextCursor: page.size > 20 ? page.docs[19]!.id : null, issues };
    });
  }
  async function list(owner: string, cardId: string, after: string | null = null) {
    const { items, nextCursor, issues } = await heads(owner, cardId, after, after === null);
    return { items: items.map(itemView), nextCursor, issues };
  }
  async function search(owner: string, cardId: string, query: string, after: string | null = null) {
    const phrase = z.string().trim().min(1).max(160).parse(query);
    const tokens = knowledgeIndexTokens(phrase, true), page = await heads(owner, cardId, after);
    const hits = page.items.flatMap(row => {
      if (row.indexCoverage === 'original_only') return [];
      const literal = row.indexText.toLowerCase().indexOf(phrase.toLowerCase());
      const matching = row.indexTerms.filter(term => tokens.has(term));
      if (literal < 0 && !matching.length) return [];
      const at = literal >= 0 ? literal : Math.max(0, row.indexText.toLowerCase().indexOf(matching[0]!));
      const start = Math.max(0, at - 100);
      return [{
        source: itemView(row), score: (literal >= 0 ? tokens.size + 1 : 0) + matching.length,
        excerpt: row.indexText.slice(start, start + 360), start, page: row.indexCoverage === 'page_one_excerpt' ? 1 : null
      }];
    }).sort((a, b) => b.score - a.score || a.source.documentId.localeCompare(b.source.documentId));
    return { items: hits, nextCursor: page.nextCursor };
  }
  async function readStored(owner: string, cardId: string, documentId: string, version: string, rawRange: z.infer<typeof rangeSchema>, signal: AbortSignal | undefined, forIndex: boolean) {
    digest.parse(documentId); digest.parse(version);
    const range = rangeSchema.parse(rawRange);
    const selected = await readable(owner, cardId, async (b, grant) => {
      const id = sourceDocumentKey(owner, cardId, grant, 'edition', documentId, version), row = open(b, id, await b.transaction.get(ref(id)));
      if (row?.kind !== 'edition') return missing();
      return { edition: row, generation: b.generation, authorizationVersion: b.authorizationVersion, epoch: b.scope.storageEpoch };
    });
    const edition = selected.edition;
    function sameGrant(b: FirestoreAuthorityTransaction, grant: string) {
      if (grant !== edition.grant || b.generation !== selected.generation || b.authorizationVersion !== selected.authorizationVersion
        || b.scope.storageEpoch !== selected.epoch) return missing();
    }
    const offset = range.byteOffset ?? 0;
    if (offset >= edition.bytes) return invalid();
    const end = range.byteOffset === undefined ? edition.bytes : Math.min(edition.bytes, offset + 64 * 1024);
    const first = Math.floor(offset / SOURCE_CARD_PART_BYTES), count = Math.ceil(end / SOURCE_CARD_PART_BYTES);
    const pieces: Buffer[] = [];
    for (let n = first; n < count; n += 8) {
      signal?.throwIfAborted();
      pieces.push(...await readable(owner, cardId, async (b, grant) => {
        sameGrant(b, grant);
        const ids = Array.from({ length: Math.min(8, count - n) }, (_, i) => sourceDocumentKey(owner, cardId, grant, 'part', documentId, version, n + i));
        const docs = await b.transaction.getAll(...ids.map(ref));
        return docs.map((snap, i) => {
          const row = open(b, ids[i]!, snap);
          if (row?.kind !== 'part') return corrupt();
          const bytes = Buffer.from(row.base64, 'base64');
          if (bytes.length !== Math.min(SOURCE_CARD_PART_BYTES, edition.bytes - (n + i) * SOURCE_CARD_PART_BYTES)) return corrupt();
          return bytes;
        });
      }));
    }
    const bytes = Buffer.concat(pieces).subarray(offset - first * SOURCE_CARD_PART_BYTES, end - first * SOURCE_CARD_PART_BYTES);
    if (range.byteOffset === undefined && (bytes.length !== edition.bytes || hash(bytes) !== edition.storedHash)) return corrupt();
    const content = range.byteOffset === undefined ? await readOriginal(edition, bytes, range, signal, forIndex)
      : {
        state: 'read' as const, representation: edition.mimeType === 'text/html' ? 'saved_text_bytes' as const : 'original_bytes' as const,
        mimeType: edition.mimeType === 'text/html' ? 'text/plain' : edition.mimeType, data: bytes, offset, totalBytes: edition.bytes, nextOffset: end < edition.bytes ? end : null
      };
    return readable(owner, cardId, async (b, grant) => {
      signal?.throwIfAborted();
      sameGrant(b, grant);
      const id = sourceDocumentKey(owner, cardId, grant, 'head', documentId), head = open(b, id, await b.transaction.get(ref(id)));
      if (head?.kind !== 'head') return missing();
      return { source: itemView(edition), currentVersion: head.version, content };
    });
  }
  function read(owner: string, cardId: string, documentId: string, version: string, range: z.infer<typeof rangeSchema> = {}, signal?: AbortSignal) {
    return readStored(owner, cardId, documentId, version, range, signal, false);
  }
  function readIndexRange(owner: string, cardId: string, documentId: string, version: string, range: z.infer<typeof rangeSchema>, signal: AbortSignal) {
    return readStored(owner, cardId, documentId, version, range, signal, true);
  }
  return { list, search, read, readIndexRange, ingest, checkResult, retryBatch, pruneStaging, withIndexCard, withIndexHead, readIndexHeadIn };
}

/** Chat callers derive the owner from the authenticated session and receive only these read methods. */
export type RegisteredSourceDocumentReader = Pick<ReturnType<typeof createFirestoreSourceCardDocuments>, 'list' | 'search' | 'read'>;

async function readOriginal(edition: SourceCardEdition, bytes: Buffer, range: z.infer<typeof rangeSchema>, signal: AbortSignal | undefined, forIndex: boolean) {
  signal?.throwIfAborted();
  if (['image/png', 'image/jpeg', 'image/webp'].includes(edition.mimeType)) {
    const { default: sharp } = await import('sharp');
    const original = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
    const view = forIndex ? original.png() : original.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 });
    const { data, info } = await view.toBuffer({ resolveWithObject: true });
    if (data.length > (forIndex ? KNOWLEDGE_PDF_MAX_BYTES : 1024 * 1024)) return { state: 'cannot_read' as const, reason: 'extraction_limit' };
    return { state: 'read' as const, representation: 'image' as const, mimeType: forIndex ? 'image/png' : 'image/webp', data, width: info.width, height: info.height };
  }
  const html = edition.mimeType === 'text/html';
  if (edition.mimeType !== 'application/pdf' && bytes.length > CHAT_FILE_LIMITS.bytes) return { state: 'cannot_read' as const, reason: 'extraction_limit' };
  const text = edition.mimeType !== 'application/pdf' || !range.nativePdf && bytes.length <= CHAT_FILE_LIMITS.bytes
    ? await readChatFile({ buffer: bytes, fileName: html ? 'notice.txt' : edition.title, mimeType: html ? 'text/plain' : edition.mimeType, sha256: edition.storedHash }, range, signal)
    : null;
  if (text && (edition.mimeType !== 'application/pdf' || text.state === 'read' || text.reason !== 'no_readable_text')) return text;
  const page = range.page ?? 1;
  const pdf = await extractKnowledgePdf(bytes, { expectedHash: edition.storedHash, startPage: page, pageLimit: 1, includePagePdf: true, signal });
  if (!pdf.pagePdf || pdf.pagePdf.length > (forIndex ? KNOWLEDGE_PDF_MAX_BYTES : 2 * 1024 * 1024))
    return { state: 'cannot_read' as const, reason: 'extraction_limit', page, totalPages: pdf.totalPages };
  return { state: 'read' as const, representation: 'pdf_page' as const, mimeType: 'application/pdf', data: Buffer.from(pdf.pagePdf), page, totalPages: pdf.totalPages };
}
