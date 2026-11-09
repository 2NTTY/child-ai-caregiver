import { z } from "zod";
import type { PhotoDraft } from "./photos.ts";
import type { CareValues } from "./care.ts";
const text=(max:number)=>z.string().max(max).refine(value=>!/[\u0000\uD800-\uDFFF]/u.test(value));
const sourceUrl=z.string().max(1000).refine(value=>{try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password;}catch{return false;}});
export const sharedInputCreateSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("personal_source"),sourceLabel:text(200).refine(value=>!!value.trim()),
    sourceUrl:sourceUrl.nullable(),sourceDateText:text(200).nullable(),sourceNotes:text(1000),text:text(10000)
  }).strict().refine(value=>value.sourceUrl!==null||!!value.text.trim(),{message:"A source URL or supplied text is required"}),
  z.object({kind:z.literal("paste"),text:text(10000).refine(value=>!!value.trim()),sourceLabel:text(200).min(1),
    sourceUrl:sourceUrl.nullable(),sourceDateText:text(200).nullable()}).strict(),
  z.object({kind:z.literal("public_source"),sourceId:z.string().regex(/^[a-z0-9-]{1,80}$/u)}).strict(),
]);
export type SharedInputCreate=z.infer<typeof sharedInputCreateSchema>;
export const sourceManagementSchema=z.object({
  intention:text(1000), purpose:z.enum(["answer_reference","record_candidate","track_topic"]),
  nature:z.enum(["unspecified","external_material","claimed_official","personal_observation"]),
  timeScope:z.enum(["unspecified","long_reference","recent","specific_period"]), validityText:text(300),
  enabled:z.boolean(), modelExcerpt:text(6000).nullable(),
}).strict().refine(value=>value.timeScope!=="specific_period"||!!value.validityText.trim(),{message:"Specific conditions are required"});
export type SourceManagement=z.infer<typeof sourceManagementSchema>;
export const sourceManagementChangeSchema=z.object({
  expectedVersion:z.number().int().min(1), management:sourceManagementSchema,
  content:sharedInputCreateSchema.options[0].nullable(), reason:text(500).refine(value=>!!value.trim()),
}).strict();
export type SourceManagementChange=z.infer<typeof sourceManagementChangeSchema>;
export interface SourceManagementRevision {version:number;changedAt:string;reason:string;management:SourceManagement|null}
export interface PublicInputSource {id:string;url:string;publisher:string}
export interface SharedInput {
  id:string;childId:string;ownerUserId:string;version:number;createdAt:string;canManage:boolean;
  kind:"paste"|"public_source"|"personal_source";sourceNotes:string;sourceId:string|null;sourceLabel:string;sourceUrl:string|null;sourceDateText:string|null;
  text:string;sha256:string|null;retrievedAt:string|null;
  fetchState:"not_requested"|"running"|"ready"|"failed"|"unknown";
  extraction:{state:"not_requested"|"running"|"available"|"failed"|"unknown";runId:string|null;excerpt:string|null;
    draft:PhotoDraft|null;stopReason:string|null;processedAt:string|null;model:string|null};
  recordId:string|null;confirmationKind:"reference"|"family_record"|null;
  /** Null means no permission to send stored source text to the conversation model. */
  management?:SourceManagement|null;
}
export interface SharedInputConfirmation {
  expectedVersion:number;confirmShared:true;kind:"reference"|"family_record";confirmChildFact:boolean;values:CareValues;
}
