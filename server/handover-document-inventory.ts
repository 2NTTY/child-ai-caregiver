import { handoverDocumentKey, type HandoverDocumentPin, type HandoverHeader } from '../src/shared/handover.ts';
import { documentTransferContentSchema, familyDocumentTransferSchema, type FamilyDocumentTransfer } from './family-document-transfer.ts';
import { isAttachmentHead } from './handover-attachment-period.ts';
import { previewFamilyDocument, previewOtherDocument } from './handover-document-preview.ts';
import { HandoverArchiveError } from './handover-archive.ts';

type Entry = {title: string; from: string | null; to: string | null; canInclude: boolean};
const safeText = (text: string) => text.replace(/[\r\n\t]+/gu, ' ').replace(/[&<>]/gu, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[char]!))
  .replace(/([\\`*_{}\[\]()#+|!~])/gu, '\\$1');

/** Build summary.md from the rows actually written. Keep only labels and current snapshot identities. */
export class HandoverDocumentInventory {
  private readonly entries = new Map<string, Entry>();
  private readonly heads = new Map<string, FamilyDocumentTransfer>();
  private readonly exceptions: Set<string>;
  private readonly period: HandoverHeader['selection']['period'];
  private readonly limit: number;
  constructor(header: HandoverHeader, limit: number) {
    this.period = header.selection.period; this.limit = limit;
    this.exceptions = new Set(header.periodExceptions?.map(handoverDocumentKey));
  }
  add(section: string, childId: string, rows: unknown[]) {
    for (const row of rows) {
      let pin: Pick<HandoverDocumentPin, 'section'|'id'|'childId'>, entry: Entry;
      if (section === 'documents') {
        const head = familyDocumentTransferSchema.parse(row);
        pin = { section, childId, id: head.id };
        if (head.currentSnapshot?.readable) this.heads.set(handoverDocumentKey(pin), head);
        entry = previewFamilyDocument(head, null, this.period);
      } else if (section === 'document_content') {
        const content = documentTransferContentSchema.parse(row);
        pin = {section:'documents', childId, id:content.documentId};
        const key = handoverDocumentKey(pin), head = this.heads.get(key);
        if (!head || head.currentSnapshot?.id !== content.snapshotId) continue;
        entry = previewFamilyDocument(head, content.snapshot, this.period); this.heads.delete(key);
      } else if (section === 'visit_preparation' || isAttachmentHead(section)) {
        const item = previewOtherDocument(section, childId, row, this.period);
        if (!item) continue;
        pin = item; entry = item;
      } else return;
      this.entries.set(handoverDocumentKey(pin), {title:entry.title, from:entry.from, to:entry.to, canInclude:entry.canInclude});
      if (this.entries.size > this.limit) throw new HandoverArchiveError('package_size_exceeded');
    }
  }
  lines(children: ReadonlyMap<string, string>) {
    const lines = ['', '## 實際匯出的文件及附件'];
    for (const [key, item] of this.entries) {
      const [childId] = JSON.parse(key) as [string,string,string];
      const dates = item.from && item.to ? item.from === item.to ? item.from : item.from + ' 至 ' + item.to : '日期不明';
      const note = !item.canInclude ? '，只含資料索引' : this.exceptions.has(key) ? '，手動選入整份' : '';
      lines.push('- ' + safeText(children.get(childId) ?? childId) + '｜' + safeText(item.title) + '｜' + dates + note);
    }
    if (!this.entries.size) lines.push('此包沒有文件或附件。');
    return lines;
  }
}
