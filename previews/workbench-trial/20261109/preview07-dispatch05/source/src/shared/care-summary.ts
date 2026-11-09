import { z } from "zod";
import type { CareKind, CareRecord, ChildProfile } from "./care.ts";
import type { CareTask } from "./tasks.ts";

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(v=>{const d=new Date(v+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},"Invalid calendar date");
export const summaryQuery=z.object({startDay:day,period:z.enum(["day","week"]),timeZone:z.string().min(1).max(80).refine(v=>{try{new Intl.DateTimeFormat("en",{timeZone:v});return true;}catch{return false;}})}).strict();
export type SummaryQuery=z.infer<typeof summaryQuery>;
export const preparationInput=z.object({
 expectedVersion:z.number().int().nonnegative(),basisVersion:z.string().min(3).max(128),confirmShared:z.literal(true),
 appointmentTaskId:z.uuid().nullable(),questions:z.array(z.string().trim().min(1).max(500)).max(12),
 checklist:z.array(z.object({text:z.string().trim().min(1).max(300),done:z.boolean()}).strict()).max(16),
 reviewed:z.boolean(),period:summaryQuery,
}).strict();
export type PreparationInput=z.infer<typeof preparationInput>;
export interface VisitPreparation {
 version:number; appointmentTaskId:string|null; questions:string[]; checklist:{text:string;done:boolean}[];
 reviewed:boolean; reviewedBasis:string|null; period:SummaryQuery|null; updatedBy:string|null; updatedAt:string|null;
}
export interface SummaryMetric {
 kind:CareKind;unit:string;samples:number;approximate:number;total:string|null;min:string;max:string;recordIds:string[];
}
export interface CareSummary {
 childId:string; childName:string; profile:ChildProfile; canManage:boolean;
 period:SummaryQuery; endDayExclusive:string; generatedAt:string; basisVersion:string;
 counts:Record<CareKind,number>; metrics:SummaryMetric[]; records:CareRecord[];
 missing:{unknownEventTime:number;invalidQuantities:number;emptyKinds:CareKind[]};
 appointments:CareTask[]; conflicts:CareTask[];
 preparation:VisitPreparation; reviewCurrent:boolean;
}
