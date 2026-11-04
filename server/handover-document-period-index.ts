import { createHash } from 'node:crypto';
import { z } from 'zod';
import { familyDocumentTransferSchema, documentTransferVersionSchema, documentTransferContentSchema } from './family-document-transfer.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { datedDocumentRequest, datedDocumentContent, documentHeadMatchesPin } from './handover-document-period.ts';
import type { HandoverPeriod } from './handover-period.ts';
import type { HandoverDocumentPin } from '../src/shared/handover.ts';
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
  private readonly exceptions = new Map<string, HandoverDocumentPin>();

  constructor(period: HandoverPeriod, exceptions: readonly HandoverDocumentPin[] = []) {
    this.period = period;
    for (const pin of exceptions) if (pin.section === 'documents') {
      const parent = documentKey(pin.childId, pin.id);
      if (this.exceptions.has(parent)) fail();
      this.exceptions.set(parent, pin);
    }
  }

  add(section: DocumentSection, childId: string, raw: unknown) {
    if (section === 'documents') {
      const head = parse(familyDocumentTransferSchema, raw), parent = documentKey(childId, head.id);
      const exception = this.exceptions.get(parent);
      if (head.childId !== childId || head.invalidated || !head.currentSnapshot?.readable
        || this.heads.has(parent)) fail();
      if (exception ? !documentHeadMatchesPin(head, exception) || head.recentSnapshotIds.length !== 0
        : !datedDocumentRequest(head.request, this.period)) fail();
      this.heads.set(parent, { currentId: head.currentSnapshot.id, currentVersion: head.currentSnapshot.version,
        recentIds: head.recentSnapshotIds });
      return;
    }
    const content = section === 'document_content' ? parse(documentTransferContentSchema, raw) : null;
    const metadata = content ? (({ snapshot: _snapshot, ...revision }) => revision)(content)
      : parse(documentTransferVersionSchema, raw);
    const parent = documentKey(childId, metadata.documentId), identity = snapshotKey(parent, metadata.snapshotId);
    const exception = this.exceptions.get(parent);
    if (metadata.invalidated || (exception
      ? metadata.snapshotId !== exception.snapshotId || metadata.snapshotVersion !== exception.snapshotVersion
      : content && !datedDocumentContent(content, this.period))) fail();
    const records = content ? this.contents : this.versions;
    if (records.has(identity)) fail();
    records.set(identity, { parent, version: metadata.snapshotVersion, metadataHash: digest(metadata) });
  }

  verify() {
    for (const parent of this.exceptions.keys()) if (!this.heads.has(parent)) fail();
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
