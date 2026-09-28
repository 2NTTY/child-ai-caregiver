import { z } from "zod";
import type { TelegramEvent,TelegramGateway } from "./telegram-types.ts";
import type { TelegramStore } from "./telegram-store.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const user=z.object({id,is_bot:z.boolean(),first_name:z.string().max(256).optional(),last_name:z.string().max(256).optional(),username:z.string().max(64).optional()});
const chat=z.object({id,type:z.literal("private")});
const message=z.object({message_id:id,chat,from:user,text:z.string().max(4096).optional()});
const update=z.object({update_id:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
const start=z.object({message});
const callback=z.object({callback_query:z.object({id:z.string().min(1).max(256),from:user,data:z.string().max(64),message})});
const membership=z.object({my_chat_member:z.object({chat,from:user,new_chat_member:z.object({status:z.literal("kicked"),user})})});
/** Discard unrelated messages/media; only explicit private commands and bound opaque callbacks survive. */
export function parseTelegramUpdate(input:unknown,botId:string):TelegramEvent{
 const {update_id:updateId}=update.parse(input);
 const cb=callback.safeParse(input);
 if(cb.success){
  const v=cb.data.callback_query,matched=/^(ack|contact):([A-Za-z0-9_-]{32})$/u.exec(v.data),token=matched?.[2];
  if(token&&!v.from.is_bot&&v.message.from.is_bot&&String(v.message.from.id)===botId)
   return {kind:matched![1]==="contact"?"contact_ack":"ack",updateId,chatId:v.message.chat.id,senderId:v.from.id,messageId:v.message.message_id,callbackQueryId:v.id,token};
  return {kind:"ignore",updateId};
 }
 const member=membership.safeParse(input);
 if(member.success){
  const v=member.data.my_chat_member;
  if(!v.from.is_bot&&v.new_chat_member.user.is_bot&&String(v.new_chat_member.user.id)===botId)
   return {kind:"blocked",updateId,chatId:v.chat.id,senderId:v.from.id};
 }
 const text=start.safeParse(input);
 if(text.success&&!text.data.message.from.is_bot){
  const v=text.data.message,token=/^\/start ([A-Za-z0-9_-]{32})$/u.exec(v.text??"")?.[1];
  if(token){
   const label=[v.from.first_name,v.from.last_name,v.from.username?"@"+v.from.username:null].filter(Boolean).join(" ").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,"").slice(0,160)||"Telegram 帳號";
   return {kind:"start",updateId,chatId:v.chat.id,senderId:v.from.id,token,label};
  }
  if(v.text==="/stop")return {kind:"stop",updateId,chatId:v.chat.id,senderId:v.from.id};
 }
 return {kind:"ignore",updateId};
}
/** Ingress already checked the constant-time webhook secret before reading a bounded body. */
export async function handleTelegramWebhook(request:Request,store:TelegramStore,gateway:TelegramGateway,botId:string,contact?:import("./contact-store.ts").ContactStore):Promise<Response>{
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")return apiError("invalid_webhook","無效渠道請求。",400);
 let event:TelegramEvent;try{event=parseTelegramUpdate(await request.json(),botId);}catch{return apiError("invalid_webhook","無效渠道請求。",400);}
 const ack=event.kind==="contact_ack" ? await contact?.telegramAcknowledgement(event) : await store.webhook(event);
 if(ack){try{await gateway.acknowledge(ack,AbortSignal.timeout(5000));}catch{/* Durable acknowledgement is authoritative; never resend the message. */}}
 return jsonResponse({ok:true});
}
