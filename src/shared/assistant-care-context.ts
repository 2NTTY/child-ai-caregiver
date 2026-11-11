import { z } from 'zod';
import { assistantTaskScopeSchema } from './assistant-task-context.ts';
import { CARE_KINDS, type CareDetails } from './care.ts';

export const selectedCareCursorSchema = z.strictObject({
  createdAt:z.iso.datetime({offset:true}), id:z.uuid(), basis:z.string().regex(/^[a-f0-9]{64}$/u),
});
export const selectedCareFiltersSchema = z.strictObject({
  query:z.string().trim().min(1).max(200).optional(), kind:z.enum(CARE_KINDS).optional(),
  eventFrom:z.iso.datetime({offset:true}).optional(), eventTo:z.iso.datetime({offset:true}).optional(),
});
export const selectedCareRequestSchema = z.strictObject({
  scope:assistantTaskScopeSchema, childId:z.uuid(), filters:selectedCareFiltersSchema,
  cursor:selectedCareCursorSchema.optional(),
}).refine(({filters})=>!filters.eventFrom || !filters.eventTo || Date.parse(filters.eventFrom)<=Date.parse(filters.eventTo));
export type SelectedCareRequest = z.infer<typeof selectedCareRequestSchema>;
export interface SelectedCarePage {
  childId:string;
  childName:string;
  records:{id:string; version:number; text:string; textComplete:boolean; details:CareDetails; createdAt:string}[];
  scanned:number;
  undatedMatches:number;
  nextCursor:z.infer<typeof selectedCareCursorSchema>|null;
}
