import { z } from "zod";
import { contactConsentInput,contactGrantInput,contactAcknowledgeInput } from "../src/shared/contact.ts";
import { FamilyError } from "./family-access.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";
import type { ContactStore } from "./contact-store.ts";
export async function handleContactRequest(request:Request,userId:string|null,store:ContactStore,inReceipt=false):Promise<Response>{
 if(!userId)return apiError("unauthorized","請先登入。",401);
 const expected=request.headers.get("x-expected-user-id");
 if(expected&&expected!==userId)return apiError("session_changed","登入帳號已改變。",409);
 if(request.method==="POST"&&(!expected||!inReceipt))return apiError("account_precondition_required","請使用原操作識別提交。",428);
 const path=new URL(request.url).pathname,match=/^\/api\/children\/([^/]+)\/contact(?:\/(consent|tasks|attempts)(?:\/([^/]+)\/(authorization|acknowledge))?)?$/u.exec(path);
 if(!match||!z.uuid().safeParse(match[1]).success||match[3]&&!z.uuid().safeParse(match[3]).success)return apiError("not_found","找不到聯絡設定。",404);
 const childId=match[1].toLowerCase();
 try{
  if(request.method==="GET"&&!match[2]){const value=await store.page(userId,childId);return value?jsonResponse(value):apiError("not_found","找不到獲授權孩子。",404);}
  if(request.method!=="POST")return apiError("method_not_allowed","不支援此操作。",405);
  if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")return apiError("unsupported_media_type","請以 JSON 提交。",415);
  let body:unknown;try{body=await request.json();}catch{return apiError("invalid_json","請核對輸入。",400);}
  let value:unknown=null;
  if(match[2]==="consent"&&!match[3]){const consent=await store.saveConsent(userId,childId,contactConsentInput.parse(body));if(consent)value={consent};}
  else if(match[2]==="tasks"&&match[4]==="authorization"){const grant=await store.saveGrant(userId,childId,match[3].toLowerCase(),contactGrantInput.parse(body));if(grant)value={grant};}
  else if(match[2]==="attempts"&&match[4]==="acknowledge"){contactAcknowledgeInput.parse(body);value=await store.acknowledge(userId,childId,match[3].toLowerCase());}
  return value?jsonResponse(value):apiError("not_found","找不到獲授權事項。",404);
 }catch(error){
  if(error instanceof z.ZodError)return apiError("invalid_input","請核對對象、渠道、期限及明確授權。",400);
  if(error instanceof FamilyError)return apiError(error.code,error.status===409?"授權、版本或渠道已改變，請重讀後確認。":"找不到獲授權事項。",error.status);
  throw error;
 }
}
