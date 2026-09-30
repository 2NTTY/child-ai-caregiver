import { z } from "zod";
import { photoMetadataSchema } from "../src/shared/photos.ts";
import { careValuesSchema,versionSchema } from "./care-validation.ts";
import { FamilyError } from "./family-access.ts";
import type { PhotoStore } from "./photo-store.ts";
import type { PhotoAgent } from "./photo-agent.ts";
import { apiError,jsonResponse } from "./workspace-api.ts";

export async function handlePhotoRequest(request:Request,userId:string|null,store:PhotoStore,
  options:{inReceipt?:boolean;agent?:PhotoAgent;isCurrentUser?:()=>Promise<boolean>}={}) {
  if(!userId)return apiError("unauthorized","請先登入。",401);
  if(request.headers.get("x-expected-user-id")!==userId)return apiError("session_changed","請重新確認登入帳號。",409);
  const match=/^\/api\/children\/([^/]+)\/photos(?:\/([^/]+))?(?:\/(content|extract|confirm|delete))?$/u.exec(new URL(request.url).pathname);
  if(!match||!z.uuid().safeParse(match[1]).success||match[2]&&!z.uuid().safeParse(match[2]).success)return apiError("not_found","找不到附件。",404);
  const childId=match[1].toLowerCase(),id=match[2]?.toLowerCase(),action=match[3];
  try {
    let result:unknown=null;
    if(request.method==="GET"){
      if(!id)result=await store.list(userId,childId);
      else if(!action){const photo=await store.get(userId,childId,id);if(photo)result={photo};}
      else if(action==="content"){
        const content=await store.content(userId,childId,id);
        if(content)return new Response(new Uint8Array(content.bytes),{headers:{"content-type":content.mimeType,"cache-control":"no-store",
          "x-content-type-options":"nosniff","content-disposition":"inline; filename=photo","content-security-policy":"default-src 'none'; sandbox"}});
      }
    }else if(request.method==="POST"){
      if(request.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")return apiError("unsupported_media_type","請使用 JSON。",415);
      let input:unknown;try{input=await request.json();}catch{return apiError("invalid_json","請核對輸入。",400);}
      if(!id||action==="confirm"||action==="delete"){
        if(!options.inReceipt)return apiError("operation_required","請使用原操作識別提交。",428);
        if(!id){const photo=await store.reserve(userId,childId,photoMetadataSchema.parse(input));if(photo)result={photo};}
        else if(action==="confirm")result=await store.confirm(userId,childId,id,z.object({expectedVersion:versionSchema,confirmShared:z.literal(true),values:careValuesSchema}).strict().parse(input));
        else {const parsed=z.object({expectedVersion:versionSchema,confirmDelete:z.literal(true)}).strict().parse(input);result=await store.delete(userId,childId,id,parsed.expectedVersion);}
      }else if(action==="content"){
        const parsed=z.object({base64:z.string().max(5592408)}).strict().parse(input);
        const photo=await store.upload(userId,childId,id,parsed.base64);if(photo)result={photo};
      }else if(action==="extract"&&options.agent&&options.isCurrentUser){
        const parsed=z.object({expectedVersion:versionSchema,confirmModel:z.literal(true)}).strict().parse(input);
        const photo=await options.agent.extract(userId,childId,id,parsed.expectedVersion,request.signal,options.isCurrentUser);if(photo)result={photo};
      }
    }
    return result===null?apiError("not_found","找不到獲授權附件。",404):jsonResponse(result);
  }catch(error){
    if(error instanceof z.ZodError)return apiError("invalid_input","請核對照片、內容及確認選項。",400);
    if(error instanceof FamilyError)return apiError(error.code,error.code==="photo_capacity"?"附件容量已滿，請先刪除不需要的附件。":error.code==="photo_processing"?"照片仍在提取，請先查核結果。":error.status===409?"資料已變更，請保留輸入並重新核對。":"附件或權限無效。",error.status);
    throw error;
  }
}
