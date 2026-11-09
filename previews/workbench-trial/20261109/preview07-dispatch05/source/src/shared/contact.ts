import { z } from "zod";
import type { CareTask,TaskAssignee } from "./tasks.ts";
export const contactChannelSchema=z.enum(["web_push","telegram","native_push"]);
export const contactBindingSchema=z.object({channel:contactChannelSchema,bindingId:z.uuid(),bindingVersion:z.number().int().positive()}).strict();
export type ContactBinding=z.infer<typeof contactBindingSchema>;
export const contactConsentInput=z.object({
 expectedVersion:z.number().int().min(0).max(2147483646),enabled:z.boolean(),allowBackup:z.boolean(),
 bindings:z.array(contactBindingSchema).max(3).refine(values=>new Set(values.map(value=>value.channel)).size===values.length),
 confirm:z.literal(true),
}).strict().refine(value=>!value.enabled||value.bindings.length>0);
export type ContactConsentInput=z.infer<typeof contactConsentInput>;
export interface ContactConsent {userId:string;version:number;enabled:boolean;allowBackup:boolean;bindings:ContactBinding[]}
export const contactGrantInput=z.object({
 expectedVersion:z.number().int().min(0).max(2147483646),expectedTaskVersion:z.number().int().positive(),
 enabled:z.boolean(),allowFollowUp:z.boolean(),allowFallback:z.boolean(),backupUserId:z.string().min(1).max(128).nullable(),
 validUntil:z.iso.datetime({offset:true}),confirm:z.literal(true),
 content:z.literal("generic_notice"),trigger:z.literal("task_due"),
}).strict().refine(value=>value.allowFallback||value.backupUserId===null);
export type ContactGrantInput=z.infer<typeof contactGrantInput>;
export interface ContactGrant {
 taskId:string;version:number;taskVersion:number;enabled:boolean;primaryUserId:string;backupUserId:string|null;
 allowFollowUp:boolean;allowFallback:boolean;validUntil:string;authorizedBy:string;
 content:"generic_notice";trigger:"task_due";updatedAt:string;
}
export interface ContactAttempt {
 id:string;recipientUserId:string;channel:ContactBinding["channel"];grantVersion:number;taskVersion:number;
 status:"sending"|"accepted"|"rejected"|"unknown"|"stopped";reason:string|null;
 providerStatus:number|null;messageId:number|null;attemptedAt:string;finishedAt:string|null;acknowledgedAt:string|null;
}
export interface ContactRequest {
 id:string;taskId:string;taskVersion:number;occurrenceId:string;phase:"initial"|"follow_up";
 state:"pending"|"accepted"|"rejected"|"unknown"|"stopped"|"coalesced";reason:string|null;nextAt:string;
 groupedTo:string|null;createdAt:string;attempts:ContactAttempt[];
}
export interface ContactPage {
 canManage:boolean;workerEnabled:boolean;consent:ContactConsent;
 availableBindings:(ContactBinding&{label:string})[];
 recipients:(TaskAssignee&{enabled:boolean;allowBackup:boolean;channels:ContactBinding["channel"][]})[];
 tasks:CareTask[];tasksHaveMore:boolean;grants:ContactGrant[];requests:ContactRequest[];historyLimited:boolean;
}
export const contactAcknowledgeInput=z.object({confirmReceived:z.literal(true)}).strict();
