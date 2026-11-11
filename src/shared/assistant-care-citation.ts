import { z } from 'zod';

// Only record citations carry locators. Coverage and older hash-only evidence do not.
export function careRecordCitationId(childIndex: number, recordId: string, version: number) {
  return `care-record:${childIndex}:${recordId}:${version}`;
}

export function selectedCareRecordCitations(sources: readonly { citationId: string; version: string }[]) {
  const result = [];
  for (const { citationId, version } of sources) {
    const parts = citationId.split(':');
    if (parts.length !== 4 || parts[0] !== 'care-record' || !/^(?:0|[1-9]\d?)$/.test(parts[1])
      || !z.uuid().safeParse(parts[2]).success || !/^[1-9]\d{0,9}$/.test(parts[3])
      || parts[3] !== version || Number(version) > 2147483647) continue;
    result.push({ citationId, childIndex: Number(parts[1]), recordId: parts[2], version: Number(version) });
  }
  // Review bindings persist sources in citation-ID order, independent of paragraph order.
  return result.sort((a,b) => a.citationId < b.citationId ? -1 : a.citationId > b.citationId ? 1 : 0);
}

export const selectedCareCitationReplySchema = z.strictObject({
  citation: z.strictObject({
    citationId:z.string().max(80), childId:z.uuid(), childName:z.string().min(1).max(200),
    recordId:z.uuid(), version:z.int().min(1).max(2147483647),
    text:z.string().min(1).max(10000), source:z.string().min(1).max(500), eventTimeLabel:z.string().max(300).nullable(),
  }),
});
export type SelectedCareCitation = z.infer<typeof selectedCareCitationReplySchema>['citation'];
