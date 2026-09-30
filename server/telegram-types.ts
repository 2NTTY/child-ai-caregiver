import type { PoolClient } from "pg";
export interface TelegramConfig {
  token:string;botId:string;botUsername:string;webhookSecret:string;
}
export interface TelegramSendInput { chatId:number; callbackToken:string; kind?:"test"|"care" }
export interface TelegramSendResult {
  status:"accepted"|"rejected"|"unknown"|"stopped";
  reason:"blocked"|"rate_limited"|"provider_rejected"|"transport_unknown"|"configuration_unavailable"|"revoked"|"worker_interrupted"|null;
  providerStatus:number|null;messageId:number|null;
}
export interface TelegramGateway {
  send(input:TelegramSendInput,signal:AbortSignal,stillAuthorized:()=>Promise<boolean>):Promise<TelegramSendResult>;
  acknowledge(callbackQueryId:string,signal:AbortSignal):Promise<void>;
}
export interface TelegramQueue { enqueue(client:PoolClient,deliveryId:string):Promise<void> }
export interface TelegramServices { config:TelegramConfig|null; queue?:TelegramQueue }
export type TelegramEvent =
 | {kind:"start";updateId:number;chatId:number;senderId:number;token:string;label:string}
 | {kind:"stop";updateId:number;chatId:number;senderId:number}
 | {kind:"contact_ack";updateId:number;chatId:number;senderId:number;messageId:number;callbackQueryId:string;token:string}
 | {kind:"ack";updateId:number;chatId:number;senderId:number;messageId:number;callbackQueryId:string;token:string}
 | {kind:"blocked";updateId:number;chatId:number;senderId:number}
 | {kind:"ignore";updateId:number};
