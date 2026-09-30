import { z } from "zod";
import { summaryQuery,preparationInput } from "../src/shared/care-summary.ts";
import { FamilyError } from "./family-access.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";
import type { CareSummaryStore } from "./care-summary-store.ts";
export async function handleCareSummaryRequest(request:Request,userId:string|null,store:CareSummaryStore,inReceipt=false):Promise<Response>{
 if(!userId)return apiError("unauthorized","請先登入。",401);
 if(request.headers.get("x-expected-user-id")!==userId)return apiError("session_changed","登入帳號已改變，請重新讀取。",409);
 const url=new URL(request.url),match=/^\/api\/children\/([^/]+)\/(summary|visit-preparation)$/u.exec(url.pathname);
 if(!match||!z.uuid().safeParse(match[1]).success)return apiError("not_found","找不到摘要。",404);
 const childId=match[1].toLowerCase();
 try{
  if(request.method==="GET"&&match[2]==="summary"){
   const input=summaryQuery.parse(Object.fromEntries(url.searchParams)),value=await store.get(userId,childId,input);
   return value?jsonResponse(value):apiError("not_found","找不到獲授權孩子。",404);
  }
  if(request.method==="POST"&&match[2]==="visit-preparation"){
   if(!inReceipt)return apiError("operation_required","請使用原操作識別提交。",428);
   let raw:unknown;try{raw=await request.json();}catch{return apiError("invalid_json","請核對輸入。",400);}
   const value=await store.save(userId,childId,preparationInput.parse(raw));
   return value?jsonResponse({preparation:value}):apiError("not_found","找不到獲授權孩子。",404);
  }
  return apiError("method_not_allowed","不支援此操作。",405);
 }catch(error){
  if(error instanceof z.ZodError)return apiError("invalid_input","請核對日期、時區及確認內容。",400);
  if(error instanceof FamilyError)return apiError(error.code,error.code==="summary_range_too_large"?"期間記錄太多，請改用單日摘要。":error.code==="summary_scope_too_large"?"孩子記錄超出此摘要入口上限，未產生部分總計。":error.status===409?"來源、預約或準備版本已改變，請重新核對。":"找不到獲授權資料。",error.status);
  throw error;
 }
}
