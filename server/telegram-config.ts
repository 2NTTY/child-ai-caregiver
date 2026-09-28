import { readFile,stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TelegramConfig } from "./telegram-types.ts";
const configSchema=z.object({
 token:z.string().regex(/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{30,100}$/u),
 botId:z.string().regex(/^[1-9][0-9]{0,15}$/u),
 botUsername:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,28}bot$/iu),
 webhookSecret:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
}).strict().refine(v=>v.token.split(":")[0]===v.botId);
export async function readTelegramConfig(env:Record<string,string|undefined>):Promise<TelegramConfig|null>{
 if(env.TELEGRAM_ENABLED===undefined||env.TELEGRAM_ENABLED==="false")return null;
 try{
  if(env.TELEGRAM_ENABLED!=="true"||!env.TELEGRAM_CONFIG_FILE)throw Error();
  const info=await stat(env.TELEGRAM_CONFIG_FILE);
  if(!info.isFile()||info.size>2048||(process.platform!=="win32"&&(info.mode&0o077)))throw Error();
  return configSchema.parse(JSON.parse(await readFile(env.TELEGRAM_CONFIG_FILE,"utf8")));
 }catch{throw new Error("telegram_config_invalid");}
}
export function telegramWebhookAuthorized(value:string|null,config:TelegramConfig|null):boolean{
 if(!config||!value||value.length>128)return false;
 const expected=Buffer.from(config.webhookSecret),received=Buffer.from(value);
 return expected.length===received.length&&timingSafeEqual(expected,received);
}
