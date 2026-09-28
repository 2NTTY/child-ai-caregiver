import { z } from "zod";
import { telegramBeginInput,telegramConfirmInput,telegramVersionInput,telegramTestInput } from "../src/shared/telegram.ts";
import { FamilyError } from "./family-access.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";
import type { TelegramStore } from "./telegram-store.ts";
export async function handleTelegramRequest(request:Request,userId:string|null,store:TelegramStore,inReceipt=false):Promise<Response>{
 if(!userId)return apiError("unauthorized","請先登入。",401);
 if(!request.headers.get("x-expected-user-id"))return apiError("account_precondition_required","請重新確認登入帳號。",428);
 if(request.headers.get("x-expected-user-id")!==userId)return apiError("session_changed","登入帳號已改變。",409);
 const path=new URL(request.url).pathname;
 try{
  if(request.method==="GET"&&path==="/api/telegram")return jsonResponse(await store.status(userId));
  if(request.method!=="POST")return apiError("not_found","找不到資料。",404);
  if(!inReceipt)return apiError("operation_required","請透過原操作收據提交。",428);
  if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")return apiError("unsupported_media_type","請以 JSON 提交。",415);
  let body:unknown;try{body=await request.json();}catch{return apiError("invalid_json","請檢查輸入。",400);}
  if(path==="/api/telegram/challenges"){telegramBeginInput.parse(body);return jsonResponse({challenge:await store.begin(userId)});}
  const action=/^\/api\/telegram\/(challenges|bindings)\/([^/]+)\/(confirm|revoke|test)$/u.exec(path);
  if(action){const id=z.uuid().parse(action[2]);
   if(action[1]==="challenges"&&action[3]==="confirm"){const v=telegramConfirmInput.parse(body);return jsonResponse({binding:await store.confirm(userId,id,v.expectedVersion)});}
   if(action[1]==="bindings"&&action[3]==="revoke"){const v=telegramVersionInput.parse(body);return jsonResponse({binding:await store.revoke(userId,id,v.expectedVersion)});}
   if(action[1]==="bindings"&&action[3]==="test"){const v=telegramTestInput.parse(body);return jsonResponse({delivery:await store.test(userId,id,v.expectedVersion)});}
  }
  return apiError("not_found","找不到資料。",404);
 }catch(error){
  if(error instanceof z.ZodError)return apiError("invalid_input","請核對確認項目及版本。",400);
  if(error instanceof FamilyError)return apiError(error.code,error.status===409?"綁定或操作已改變，請刷新並核對；未知結果先查原操作。":"找不到獲授權資料。",error.status);
  throw error;
 }
}
