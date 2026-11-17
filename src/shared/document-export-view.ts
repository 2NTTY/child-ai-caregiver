import { z } from 'zod';
import type { DocumentExport, DocumentSnapshot } from './family-documents.ts';

export const documentExportViewSchema = z.strictObject({
  snapshotId: z.uuid(), snapshotVersion: z.int().positive(), title: z.string(), subtitle: z.string(),
  metadata: z.string(), coverageNote: z.string(), summary: z.string(),
  sections: z.array(z.strictObject({ title: z.string(), items: z.array(z.string()) })),
  changes: z.array(z.string()).nullable(), sources: z.array(z.strictObject({ label: z.string(), text: z.string() })).nullable(),
});
export type DocumentExportView = z.infer<typeof documentExportViewSchema>;
const purposes = { family: '家庭成長', appointment: '就診溝通', handoff: '照護交接', school: '入園認識' };

export function projectDocumentExport(snapshot: DocumentSnapshot, options: DocumentExport): DocumentExportView {
  if (snapshot.id !== options.snapshotId || snapshot.version !== options.snapshotVersion) throw new Error('document_snapshot_changed');
  return {
    snapshotId: snapshot.id, snapshotVersion: snapshot.version, title: snapshot.title,
    subtitle: `${purposes[options.purpose]} · 版本 ${snapshot.version} · ${snapshot.period.from} 至 ${snapshot.period.to}`,
    metadata: `${snapshot.ageLabel} · 整理時間 ${snapshot.generatedAt}`, coverageNote: snapshot.coverageNote, summary: snapshot.summary,
    sections: snapshot.sections.map(section => ({ title: section.title, items: section.items.map(item => {
      if (section.kind !== 'checklist') return item.text;
      return (item.checked ? '[已核對] ' : '[待核對] ') + item.text;
    }) })),
    changes: options.includeRevision ? snapshot.changes : null,
    sources: options.includeSources ? snapshot.sources.map(source => ({
      label: `${source.label} · 版本 ${source.version} · ${source.at ?? '事件時間未知'}`, text: source.text,
    })) : null,
  };
}
