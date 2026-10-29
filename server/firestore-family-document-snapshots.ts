import { createHash } from 'node:crypto';
import type { Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { documentPeriodSchema, reportCoverageSchema, type DocumentSnapshot } from '../src/shared/family-documents.ts';
import { assertDocumentCapacity } from './family-document-edits.ts';
import { FirestoreDomainData, domainParse, domainReject, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { documentCopySchema, documentSourceRevisionSchema, retainDocumentCopy, IMPORTED_DOCUMENT_NOTE,
  type DocumentCopy, type DocumentSourceRevision } from './family-document-copy.ts';

const version = z.number().int().positive().max(2147483647), uuid = z.uuid(), text = z.string().max(240000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const firestoreDocumentSourceSchema = z.object({ id: z.string().min(1).max(160), resourceId: uuid,
  kind: z.enum(['profile', 'record', 'fact', 'task', 'concern']), version: z.number().int().nonnegative().max(2147483647),
  label: text, text, at: z.iso.datetime({ offset: true }).nullable() }).strict();
export const firestoreDocumentSnapshotSchema: z.ZodType<DocumentSnapshot> = z.object({ id: uuid, version, generatedAt: z.iso.datetime({ offset: true }),
  sourceBasis: z.string().regex(/^[a-f0-9]{64}$/u), title: text, summary: text, ageLabel: text, period: documentPeriodSchema,
  eventDate: day.nullable(), coverageNote: text,
  sections: z.array(z.object({ id: z.string().min(1).max(80), title: text, kind: z.enum(['notes', 'questions', 'checklist']),
    domain: z.enum(['profile', 'body_life', 'abilities_interests', 'concerns', 'changes_support']).nullable(),
    items: z.array(z.object({ id: z.string().min(1).max(100), text, sourceIds: z.array(z.string().min(1).max(160)).max(140), checked: z.boolean().optional() }).strict()).max(500) }).strict()).max(50),
  sources: z.array(firestoreDocumentSourceSchema),
  changes: z.array(text).max(30), reportCoverage: reportCoverageSchema.optional(), editProtection: z.object({
    sectionIds: z.array(z.string()).max(50), removedSectionIds: z.array(z.string()),
    metadataFields: z.array(z.enum(['title', 'summary', 'eventDate'])).max(3) }).strict().optional() }).strict();
const CHUNK_BYTES = 48 * 1024, MAX_CHUNKS = 20;
const chunkSchema = z.object({ index: z.number().int().nonnegative().max(MAX_CHUNKS - 1), text }).strict();
export const firestoreSnapshotManifestSchema = z.object({ documentId: uuid, childId: uuid, snapshotId: uuid, snapshotVersion: version,
  generatedAt: z.iso.datetime({ offset: true }), totalBytes: z.number().int().nonnegative().max(960000), totalCharacters: z.number().int().nonnegative().max(240000),
  count: z.number().int().nonnegative().max(MAX_CHUNKS), hash: z.string().regex(/^[a-f0-9]{64}$/u), copy: documentCopySchema.optional(),
  sourceRevision: documentSourceRevisionSchema.optional(),
}).strict().refine(value => value.sourceRevision?.invalidated
  ? value.count === 0 && value.totalBytes === 0 && value.totalCharacters === 0 && value.hash === hash('') && !value.copy
  : value.count > 0 && value.totalBytes > 0 && value.totalCharacters > 0)
  .refine(value => !value.sourceRevision || value.generatedAt === value.sourceRevision.sourceSnapshot.generatedAt);
export type FirestoreSnapshotManifest = z.infer<typeof firestoreSnapshotManifestSchema>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Zero is only a query projection for source history; the manifest retains its actual local binding version. */
export const documentSnapshotIndexVersion = (value: FirestoreSnapshotManifest) => value.sourceRevision ? 0 : value.snapshotVersion;
const chunkId = (snapshotId: string, index: number) => JSON.stringify([snapshotId, index]);

/** Immutable bounded encrypted chunks preserve the full existing 240000-character snapshot capacity. */
export class FirestoreFamilyDocumentSnapshots {
  private readonly data: FirestoreDomainData;
  private readonly copies = new WeakMap<DocumentSnapshot, DocumentCopy>();
  constructor(options: FirestoreDomainOptions) { this.data = new FirestoreDomainData(options); }
  copy(snapshot: DocumentSnapshot) { return this.copies.get(snapshot); }
  bindCopy(snapshot: DocumentSnapshot, raw: DocumentCopy) { this.copies.set(snapshot, documentCopySchema.parse(raw)); }
  inheritCopy(snapshot: DocumentSnapshot, previous: DocumentSnapshot | null, refresh = false) {
    const copy = previous ? this.copy(previous) : undefined;
    if (copy) {
      const retained = retainDocumentCopy(copy, snapshot);
      if (refresh) retained.detached = false;
      this.bindCopy(snapshot, retained);
      if (Object.keys(retained.sourceHashes).length && !snapshot.coverageNote.includes(IMPORTED_DOCUMENT_NOTE))
        snapshot.coverageNote += '\n' + IMPORTED_DOCUMENT_NOTE;
    }
  }
  prepare(scope: WorkRecoveryScope, documentId: string, raw: DocumentSnapshot, sourceRevision?: DocumentSourceRevision) {
    const snapshot = domainParse(firestoreDocumentSnapshotSchema, raw, 'invalid_document', 500); assertDocumentCapacity(snapshot);
    const serialized = JSON.stringify(snapshot), parts: string[] = []; let part = '', bytes = 0;
    for (const char of serialized) {
      const length = Buffer.byteLength(char);
      if (bytes + length > CHUNK_BYTES) { parts.push(part); part = ''; bytes = 0; }
      part += char; bytes += length;
    }
    if (part) parts.push(part);
    const manifest = domainParse(firestoreSnapshotManifestSchema, { documentId, childId: scope.childId, snapshotId: snapshot.id,
      snapshotVersion: snapshot.version, generatedAt: snapshot.generatedAt, totalBytes: Buffer.byteLength(serialized), totalCharacters: serialized.length,
      count: parts.length, hash: hash(serialized), ...(this.copy(raw) ? { copy: this.copy(raw) } : {}),
      ...(sourceRevision ? { sourceRevision } : {}) }, 'invalid_document', 500);
    const manifestEnvelope = { ...this.data.tags(scope), documentId, snapshotId: snapshot.id, snapshotVersion: documentSnapshotIndexVersion(manifest),
      ...this.data.seal('document-snapshot', snapshot.id, scope, firestoreSnapshotManifestSchema, manifest, snapshot.version) };
    const chunks = parts.map((value, index) => this.data.seal('document-snapshot-chunk', chunkId(snapshot.id, index), scope,
      chunkSchema, { index, text: value }, snapshot.version));
    return { manifest, commit: (transaction: Transaction) => {
      transaction.create(this.data.ref('document_snapshots', 'document-snapshot', snapshot.id), manifestEnvelope);
      chunks.forEach((value, index) => transaction.create(this.data.ref('document_chunks', 'document-snapshot-chunk', chunkId(snapshot.id, index)), value));
    } };
  }
  prepareRedacted(scope: WorkRecoveryScope, documentId: string, snapshotId: string, snapshotVersion: number, sourceRevision: DocumentSourceRevision) {
    if (!sourceRevision.invalidated) domainReject('invalid_document', 500);
    const manifest = domainParse(firestoreSnapshotManifestSchema, { documentId, childId: scope.childId, snapshotId, snapshotVersion,
      generatedAt: sourceRevision.sourceSnapshot.generatedAt, count: 0, totalBytes: 0, totalCharacters: 0, hash: hash(''), sourceRevision }, 'invalid_document', 500);
    const envelope = { ...this.data.tags(scope), documentId, snapshotId, snapshotVersion: documentSnapshotIndexVersion(manifest),
      ...this.data.seal('document-snapshot', snapshotId, scope, firestoreSnapshotManifestSchema, manifest, snapshotVersion) };
    return { manifest, commit: (transaction: Transaction) => transaction.create(this.data.ref('document_snapshots', 'document-snapshot', snapshotId), envelope) };
  }
  async manifest(transaction: Transaction, scope: WorkRecoveryScope, documentId: string, snapshotId: string): Promise<FirestoreSnapshotManifest | null> {
    const ref = this.data.ref('document_snapshots', 'document-snapshot', snapshotId), row = await transaction.get(ref); if (!row.exists) return null;
    const manifest = this.data.open('document-snapshot', snapshotId, scope, firestoreSnapshotManifestSchema, row);
    if (manifest.documentId !== documentId || manifest.childId !== scope.childId || manifest.snapshotId !== snapshotId
      || manifest.snapshotVersion !== row.get('recordVersion') || documentSnapshotIndexVersion(manifest) !== row.get('snapshotVersion')) domainReject('snapshot_binding', 500);
    return manifest;
  }
  async read(transaction: Transaction, scope: WorkRecoveryScope, documentId: string, snapshotId: string, snapshotVersion?: number): Promise<DocumentSnapshot | null> {
    const manifest = await this.manifest(transaction, scope, documentId, snapshotId); if (!manifest || manifest.sourceRevision?.invalidated) return null;
    if (snapshotVersion !== undefined && manifest.snapshotVersion !== snapshotVersion) return null;
    const rows = await transaction.getAll(...Array.from({ length: manifest.count }, (_, index) => this.data.ref('document_chunks', 'document-snapshot-chunk', chunkId(snapshotId, index))));
    const parts = rows.map((row, index) => {
      const chunk = this.data.open('document-snapshot-chunk', chunkId(snapshotId, index), scope, chunkSchema, row);
      if (chunk.index !== index || row.get('recordVersion') !== manifest.snapshotVersion || Buffer.byteLength(chunk.text) > CHUNK_BYTES) domainReject('snapshot_binding', 500);
      return chunk.text;
    });
    const serialized = parts.join('');
    if (Buffer.byteLength(serialized) !== manifest.totalBytes || serialized.length !== manifest.totalCharacters || hash(serialized) !== manifest.hash) domainReject('snapshot_binding', 500);
    let parsed: unknown; try { parsed = JSON.parse(serialized); } catch { domainReject('invalid_document', 500); }
    const snapshot = domainParse(firestoreDocumentSnapshotSchema, parsed, 'invalid_document', 500); assertDocumentCapacity(snapshot);
    if (snapshot.id !== snapshotId || snapshot.version !== manifest.snapshotVersion || snapshot.generatedAt !== manifest.generatedAt) domainReject('snapshot_binding', 500);
    if (manifest.copy) this.bindCopy(snapshot, manifest.copy);
    return snapshot;
  }
}

export const firestoreFamilyDocumentSnapshotSchemas = { manifest: firestoreSnapshotManifestSchema, chunk: chunkSchema } as const;
