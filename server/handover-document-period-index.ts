import { createHash } from 'node:crypto';
import { z } from 'zod';
import { familyDocumentTransferSchema, documentTransferVersionSchema, documentTransferContentSchema } from './family-document-transfer.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { datedDocumentRequest, datedDocumentContent } from './handover-document-period.ts';
import type { HandoverPeriod } from './handover-period.ts';
import { canonicalJson } from './online-routing.ts';

const documentSections = ['documents', 'document_versions', 'document_content'] as const;
type DocumentSection = typeof documentSections[number];
export const isDatedDocumentSection = (section: string): section is DocumentSection =>
  documentSections.some(value => value === section);
const documentKey = (childId: string, documentId: string) => JSON.stringify([childId, documentId]);
const snapshotKey = (parent: string, snapshotId: string) => JSON.stringify([parent, snapshotId]);
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
function fail(): never { throw new HandoverArchiveError('invalid_package_period'); }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) fail();
  return result.data;
}
type Head = { currentId: string; currentVersion: number; recentIds: string[] };
type Revision = { parent: string; version: number; metadataHash: string };

/** Validate all three sections after scanning the ZIP; retain identities and hashes, never snapshot bodies. */
export class DatedDocumentPeriodIndex {
  private readonly heads = new Map<string, Head>();
  private readonly versions = new Map<string, Revision>();
  private readonly contents = new Map<string, Revision>();
  private readonly period: HandoverPeriod;

  constructor(period: HandoverPeriod) { this.period = period; }

  add(section: DocumentSection, childId: string, raw: unknown) {
    if (section === 'documents') {
      const head = parse(familyDocumentTransferSchema, raw), parent = documentKey(childId, head.id);
      if (head.childId !== childId || head.invalidated || !head.currentSnapshot?.readable
        || !datedDocumentRequest(head.request, this.period) || this.heads.has(parent)) fail();
      this.heads.set(parent, { currentId: head.currentSnapshot.id, currentVersion: head.currentSnapshot.version,
        recentIds: head.recentSnapshotIds });
      return;
    }
    const content = section === 'document_content' ? parse(documentTransferContentSchema, raw) : null;
    const metadata = content ? (({ snapshot: _snapshot, ...revision }) => revision)(content)
      : parse(documentTransferVersionSchema, raw);
    if (metadata.invalidated || content && !datedDocumentContent(content, this.period)) fail();
    const parent = documentKey(childId, metadata.documentId), identity = snapshotKey(parent, metadata.snapshotId);
    const records = content ? this.contents : this.versions;
    if (records.has(identity)) fail();
    records.set(identity, { parent, version: metadata.snapshotVersion, metadataHash: digest(metadata) });
  }

  verify() {
    for (const [identity, version] of this.versions) {
      const content = this.contents.get(identity);
      if (!this.heads.has(version.parent) || !content || content.metadataHash !== version.metadataHash) fail();
    }
    for (const [identity, content] of this.contents) {
      if (!this.heads.has(content.parent) || !this.versions.has(identity)) fail();
    }
    for (const [parent, head] of this.heads) {
      if (this.contents.get(snapshotKey(parent, head.currentId))?.version !== head.currentVersion
        || head.recentIds.some(id => !this.contents.has(snapshotKey(parent, id)))) fail();
    }
  }
}
