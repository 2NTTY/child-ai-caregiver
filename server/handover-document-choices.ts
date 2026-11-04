import { handoverDocumentKey, type HandoverDocumentChoice, type HandoverDocumentPin } from '../src/shared/handover.ts';
import { documentHeadMatchesPin } from './handover-document-period.ts';
import { familyDocumentTransferSchema } from './family-document-transfer.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { isAttachmentHead } from './handover-attachment-period.ts';

/** Apply one exact parent choice to its stored version and its companions, independently of page/ZIP order. */
export class HandoverDocumentChoices {
  private readonly choices: Map<string, HandoverDocumentChoice>;
  private readonly seen = new Set<string>();
  private readonly currentVersions = new Set<string>();
  private readonly currentBodies = new Set<string>();
  private readonly error: string;
  constructor(choices: readonly HandoverDocumentChoice[], error: string) {
    this.error = error;
    this.choices = new Map(choices.map(pin => [handoverDocumentKey(pin), pin]));
  }
  lookup(childId: string, section: HandoverDocumentPin['section'], id: string) {
    return this.choices.get(handoverDocumentKey({ childId, section, id }));
  }
  decide(childId: string, section: string, raw: unknown): boolean | undefined {
    if (!this.choices.size || !raw || typeof raw !== 'object') return;
    const row = raw as Record<string, unknown>;
    if (section === 'visit_preparation_history')
      return this.lookup(childId, 'visit_preparation', childId) ? false : undefined;
    if (section === 'document_versions' || section === 'document_content') {
      const choice = this.lookup(childId, 'documents', String(row.documentId));
      if (!choice) return;
      if (!choice.include || row.snapshotId !== choice.snapshotId) return false;
      const key = handoverDocumentKey(choice), seen = section === 'document_versions' ? this.currentVersions : this.currentBodies;
      if (row.snapshotVersion !== choice.snapshotVersion || row.invalidated !== false || section === 'document_content' && !row.snapshot || seen.has(key))
        throw new HandoverArchiveError(this.error);
      seen.add(key);
      return true;
    }
    if (section !== 'documents' && section !== 'visit_preparation' && !isAttachmentHead(section)) return;
    const id = section === 'visit_preparation' || section === 'child_avatar' ? childId : String(row.id);
    const pin = this.lookup(childId, section, id);
    if (!pin) return;
    const key = handoverDocumentKey(pin);
    if (this.seen.has(key) || pin.version !== row.version) throw new HandoverArchiveError(this.error);
    if (section === 'documents') {
      const head = familyDocumentTransferSchema.parse(raw);
      if (!documentHeadMatchesPin(head, pin) || pin.include && !head.currentSnapshot?.readable) throw new HandoverArchiveError(this.error);
    } else if (pin.include && isAttachmentHead(section) && (section === 'child_avatar' ? !row.asset : row.state !== 'ready'))
      throw new HandoverArchiveError(this.error);
    this.seen.add(key);
    return pin.include;
  }
  verify() {
    if (this.seen.size !== this.choices.size) throw new HandoverArchiveError(this.error);
    for (const [key, pin] of this.choices) if (pin.section === 'documents' && pin.include &&
      (!this.currentVersions.has(key) || !this.currentBodies.has(key))) throw new HandoverArchiveError(this.error);
  }
}
