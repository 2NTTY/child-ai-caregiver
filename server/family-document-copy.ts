import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DocumentSnapshot, DocumentSource } from '../src/shared/family-documents.ts';
import { importProvenanceSchema, type ImportProvenance } from '../src/shared/import-provenance.ts';
import { canonicalJson } from './online-routing.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
/** Encrypted, server-authored manifest evidence. Never accepted from ordinary document commands. */
export const documentCopySchema = z.object({
  importedFrom: importProvenanceSchema,
  detached: z.boolean(),
  sourceSnapshot: z.object({ id: z.uuid(), version: z.number().int().positive().max(2147483647) }).strict(),
  sourceHashes: z.record(z.string().min(1).max(160), hash), reportCoverageHash: hash.nullable(),
}).strict().refine(value => value.importedFrom.current.source.section === 'documents'
  && value.sourceSnapshot.version <= value.importedFrom.current.source.resourceVersion);
export type DocumentCopy = z.infer<typeof documentCopySchema>;
/** Immutable source history, separate from the recipient's local revision counter. */
export const documentSourceRevisionSchema = z.object({ importedFrom: importProvenanceSchema,
  sourceSnapshot: z.object({ id: z.uuid(), version: z.number().int().positive().max(2147483647),
    generatedAt: z.iso.datetime({ offset: true }) }).strict(), invalidated: z.boolean(), inputHash: hash,
}).strict().refine(value => value.importedFrom.current.source.section === 'documents'
  && value.sourceSnapshot.id === value.importedFrom.current.source.snapshotId
  && value.sourceSnapshot.version === value.importedFrom.current.source.resourceVersion
  && value.inputHash === value.importedFrom.current.sourceHash);
export type DocumentSourceRevision = z.infer<typeof documentSourceRevisionSchema>;
export const IMPORTED_DOCUMENT_NOTE = '匯入副本：引用及完整度描述原資料包的資料，不代表收件帳戶已核對或目前孩子的完整資料。';
export const documentCopyHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const copiedDocumentSource = (copy: DocumentCopy | undefined, source: DocumentSource) =>
  copy?.sourceHashes[source.id] === documentCopyHash(source);
export const copiedDocumentCoverage = (copy: DocumentCopy | undefined, snapshot: DocumentSnapshot) =>
  snapshot.reportCoverage !== undefined && copy?.reportCoverageHash === documentCopyHash(snapshot.reportCoverage);

export function newDocumentCopy(snapshot: DocumentSnapshot, importedFrom: ImportProvenance): DocumentCopy {
  return documentCopySchema.parse({ importedFrom, detached: true, sourceSnapshot: { id: snapshot.id, version: snapshot.version },
    sourceHashes: Object.fromEntries(snapshot.sources.map(source => [source.id, documentCopyHash(source)])),
    reportCoverageHash: snapshot.reportCoverage ? documentCopyHash(snapshot.reportCoverage) : null });
}

/** Edits may retain accepted evidence, but cannot authorize newly introduced local sources. */
export function retainDocumentCopy(copy: DocumentCopy, snapshot: DocumentSnapshot): DocumentCopy {
  return { ...copy, sourceHashes: Object.fromEntries(snapshot.sources.filter(source => copiedDocumentSource(copy, source))
    .map(source => [source.id, copy.sourceHashes[source.id]])),
    reportCoverageHash: copiedDocumentCoverage(copy, snapshot) ? copy.reportCoverageHash : null };
}
