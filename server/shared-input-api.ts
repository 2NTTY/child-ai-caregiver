import { z } from "zod";
import { sharedInputCreateSchema } from "../src/shared/shared-inputs.ts";
import { careValuesSchema,versionSchema } from "./care-validation.ts";
import { FamilyError } from "./family-access.ts";
import type { SharedInputStore } from "./shared-input-store.ts";
import type { SharedInputService } from "./shared-input-service.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";

export async function handleSharedInputRequest(request:Request,userId:string|null,store:SharedInputStore,
  options:{inReceipt?:boolean;service?:SharedInputService;isCurrentUser?:()=>Promise<boolean>}={}) {
  if(!userId)return apiError("unauthorized","請先登入。",401);
  if(request.headers.get("x-expected-user-id")!==userId)return apiError("session_changed","請重新確認登入帳號。",409);
  const match=/^\/api\/children\/([^/]+)\/inputs(?:\/([^/]+))?(?:\/(fetch|extract|confirm|delete))?$/u.exec(new URL(request.url).pathname);
  if(!match||!z.uuid().safeParse(match[1]).success||match[2]&&!z.uuid().safeParse(match[2]).success)return apiError("not_found","找不到分享輸入。",404);
  const childId=match[1].toLowerCase(),id=match[2]?.toLowerCase(),action=match[3];
  try{
    let result:unknown=null;
    if(request.method==="GET"){
      if(!id)result=await store.list(userId,childId);
      else if(!action){const input=await store.get(userId,childId,id);if(input)result={input};}
    }else if(request.method==="POST"){
      if(request.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")return apiError("unsupported_media_type","請使用 JSON。",415);
      let body:unknown;try{body=await request.json();}catch{return apiError("invalid_json","請核對輸入。",400);}
      if(!id||action==="confirm"||action==="delete"){
        if(!options.inReceipt)return apiError("operation_required","請使用原操作識別提交。",428);
        if(!id){const input=await store.create(userId,childId,sharedInputCreateSchema.parse(body));if(input)result={input};}
        else if(action==="confirm")result=await store.confirm(userId,childId,id,z.object({expectedVersion:versionSchema,confirmShared:z.literal(true),
          kind:z.enum(["reference","family_record"]),confirmChildFact:z.boolean(),values:careValuesSchema}).strict().parse(body));
        else {const parsed=z.object({expectedVersion:versionSchema,confirmDelete:z.literal(true)}).strict().parse(body);result=await store.delete(userId,childId,id,parsed.expectedVersion);}
      }else if(options.service&&options.isCurrentUser){
        let input=null;
        if(action==="fetch"){
          const parsed=z.object({expectedVersion:versionSchema,confirmFetch:z.literal(true)}).strict().parse(body);
          input=await options.service.fetch(userId,childId,id,parsed.expectedVersion,request.signal,options.isCurrentUser);
        }else if(action==="extract"){
          const parsed=z.object({expectedVersion:versionSchema,confirmModel:z.literal(true),excerpt:z.string().min(1).max(10000)}).strict().parse(body);
          input=await options.service.extract(userId,childId,id,parsed.expectedVersion,parsed.excerpt,request.signal,options.isCurrentUser);
        }
        if(input)result={input};
      }
    }
    return result===null?apiError("not_found","找不到獲授權的私人輸入。",404):jsonResponse(result);
  }catch(error){
    if(error instanceof z.ZodError)return apiError("invalid_input","請核對原文、選取範圍及確認選項。",400);
    if(error instanceof FamilyError)return apiError(error.code,error.code==="inputs_capacity"?"分享輸入已達上限，請先刪除不需要的項目。":
      error.code==="input_processing"?"正在提取，請先查核結果。":error.status===409?"資料已變更，請保留輸入並重新核對。":"輸入或權限無效。",error.status);
    throw error;
  }
}
