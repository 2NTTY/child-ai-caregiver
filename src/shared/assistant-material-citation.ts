import { z } from 'zod';

export const materialKind = z.enum(['memory', 'document']);
const childIndex = z.int().min(0).max(99);
const revision = z.int().min(1).max(2147483647);
export const materialQuery = z.strictObject({
  kind: materialKind, from: childIndex.default(0), query: z.string().trim().max(100).default(''),
  cursor: z.strictObject({ after: z.string().min(1).max(2048), basis: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
});
export const materialRef = z.strictObject({ kind: materialKind, from: childIndex, id: z.uuid(), version: revision, offset:z.int().min(0).max(999999999).default(0) });
export type MaterialRef = z.input<typeof materialRef>;
export type MaterialQuery = z.infer<typeof materialQuery>;

export const materialCitationPage = z.strictObject({
  citationId: z.string().max(80), childId: z.uuid(), childName: z.string().min(1).max(200),
  kind: materialKind, id: z.uuid(), version: revision, title: z.string().max(200), source: z.string().max(200),
  text: z.string().max(4000), offset: z.int().nonnegative(), nextOffset: z.int().nonnegative().nullable(),
});
export type MaterialCitationPage = z.infer<typeof materialCitationPage>;

export function materialCitationId(ref: MaterialRef) {
  return ['material', ref.kind, ref.from, ref.id, ref.version,ref.offset ?? 0].join(':');
}

export function selectedMaterialCitations(sources: readonly {citationId: string; version: string}[]) {
  return sources.flatMap(({citationId,version}) => {
    const [prefix,kind,index,id,v,offset] = citationId.split(':');
    if (prefix !== 'material' || v !== version) return [];
    const ref = materialRef.safeParse({kind,from:Number(index),id,version:Number(v),offset:Number(offset)});
    return ref.success && materialCitationId(ref.data) === citationId ? [{...ref.data,citationId}] : [];
  }).sort((a,b) => a.citationId < b.citationId ? -1 : a.citationId > b.citationId ? 1 : 0);
}
