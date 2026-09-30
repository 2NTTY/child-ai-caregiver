import { z } from "zod";
import { growthActionSchema, growthTopicActionSchema, growthTopicSchema } from "../src/shared/growth.ts";
import type { GrowthStore } from "./growth-store.ts";
import { FamilyError } from "./family-access.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";
const uuid="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const route=new RegExp("^/api/children/("+uuid+")/growth(?:/(?:("+uuid+")/decide|topics/([a-z_]+)))?$","i");
export async function handleGrowthRequest(request:Request,userId:string|null,store:GrowthStore,isCurrentUser:(userId:string)=>Promise<boolean>):Promise<Response>{
  if(!userId) return apiError("unauthorized","請先登入。",401);
  const expected=request.headers.get("x-expected-user-id");
  if(!expected) return apiError("account_precondition_required","請重新確認登入帳號。",428);
  if(expected!==userId || !await isCurrentUser(userId)) return apiError("session_changed","登入帳號已改變。",409);
  const match=route.exec(new URL(request.url).pathname);
  if(!match) return apiError("not_found","找不到關注事項。",404);
  try{
    const childId=match[1].toLowerCase();
    if(!match[2] && !match[3]){
      if(request.method!=="GET") return apiError("method_not_allowed","不支援此操作。",405);
      const page=await store.list(userId,childId);
      return page && await isCurrentUser(userId)?jsonResponse({page}):apiError("not_found","沒有可讀取的資料。",404);
    }
    if(request.method!=="POST") return apiError("method_not_allowed","不支援此操作。",405);
    if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json") return apiError("unsupported_media_type","請以 JSON 提交。",415);
    let raw:unknown;try{raw=await request.json();}catch{return apiError("invalid_json","請檢查輸入。",400);}
    if(match[2]){
      const item=await store.decide(userId,childId,match[2].toLowerCase(),growthActionSchema.parse(raw));
      return item && await isCurrentUser(userId)?jsonResponse({item}):apiError("not_found","資料或權限已改變。",404);
    }
    const page=await store.topic(userId,childId,growthTopicSchema.parse(match[3]),growthTopicActionSchema.parse(raw));
    return page && await isCurrentUser(userId)?jsonResponse({page}):apiError("not_found","資料或權限已改變。",404);
  }catch(error){
    if(error instanceof FamilyError) return apiError(error.code,error.status===409?"關注或確認事實的版本已改變，請重新核對。":"無法處理此事項，請核對資料與權限。",error.status);
    if(error instanceof z.ZodError) return apiError("invalid_input","請核對輸入及共享確認。",400);
    return apiError("growth_unavailable","未能確認結果，請先重新讀取原事項，不要另建操作。",503);
  }
}
