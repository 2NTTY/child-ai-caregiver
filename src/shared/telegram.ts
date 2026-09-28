import { z } from "zod";
const time=z.iso.datetime({offset:true});
export const telegramBindingSchema=z.object({
  id:z.uuid(),version:z.number().int().positive(),status:z.enum(["active","revoked","blocked"]),
  label:z.string().max(160),chatIdHint:z.string().max(30),createdAt:time,updatedAt:time,
}).strict();
export const telegramChallengeSchema=z.object({
  id:z.uuid(),version:z.number().int().positive(),expiresAt:time,
  state:z.enum(["waiting","seen"]),startUrl:z.url(),candidate:z.object({label:z.string().max(160),chatIdHint:z.string().max(30)}).strict().nullable(),
}).strict();
export const telegramDeliverySchema=z.object({
  id:z.uuid(),bindingId:z.uuid(),status:z.enum(["queued","sending","accepted","rejected","unknown","stopped"]),
  reason:z.string().max(64).nullable(),providerStatus:z.number().int().nullable(),messageId:z.number().int().nullable(),
  createdAt:time,attemptedAt:time.nullable(),finishedAt:time.nullable(),acknowledgedAt:time.nullable(),
}).strict();
export const telegramStatusSchema=z.object({
  configured:z.boolean(),workerEnabled:z.boolean(),botUsername:z.string().nullable(),
  binding:telegramBindingSchema.nullable(),challenge:telegramChallengeSchema.nullable(),
  deliveries:z.array(telegramDeliverySchema).max(20),
}).strict();
export const telegramBeginInput=z.object({confirmPrivateChannel:z.literal(true)}).strict();
export const telegramConfirmInput=z.object({expectedVersion:z.number().int().positive(),confirmAccount:z.literal(true)}).strict();
export const telegramVersionInput=z.object({expectedVersion:z.number().int().positive()}).strict();
export const telegramTestInput=telegramVersionInput.extend({confirmImmediate:z.literal(true)}).strict();
export type TelegramBinding=z.infer<typeof telegramBindingSchema>;
export type TelegramChallenge=z.infer<typeof telegramChallengeSchema>;
export type TelegramDelivery=z.infer<typeof telegramDeliverySchema>;
export type TelegramStatus=z.infer<typeof telegramStatusSchema>;
