import { photoDraftSchema, type PhotoDraft } from "../src/shared/photos.ts";
import type { createAgentRuntime } from "./agent-runtime.ts";
import type { PhotoStore } from "./photo-store.ts";

export function createPhotoAgent(store:Pick<PhotoStore, 'claimExtraction' | 'extractionAuthorized' | 'finishExtraction' | 'content'>,runtime:ReturnType<typeof createAgentRuntime>) {
  return {async extract(userId:string,childId:string,id:string,expectedVersion:number,signal:AbortSignal,isCurrentUser:()=>Promise<boolean>) {
    const claim=await store.claimExtraction(userId,childId,id,expectedVersion);
    if(!claim||!claim.created||!claim.scope)return claim?.photo??null;
    const runId=claim.photo.extraction.runId!;
    const authorize=async()=>!signal.aborted&&await isCurrentUser()&&await store.extractionAuthorized(userId,childId,id,runId);
    let draft:PhotoDraft|null=null;
    try {
      if(!await authorize())return null;
      const image=await store.content(userId,childId,id);if(!image)return null;
      const result=await runtime.run({runId,scope:claim.scope,trigger:{kind:"interactive",reference:id},
        recipeId:"photo-capture",availableInputs:["run","scope","conversation","context","evidence","capabilities"],
        context:{attachment:{id,sha256:claim.photo.sha256,source:claim.photo.source,visibility:"private",state:"ready"},
          purpose:"Extract visible care notes as an unconfirmed candidate; never diagnose or identify a person."},
        messages:[{role:"user",text:"請提取照片中清楚可見的文字及照護記錄候選；不清楚的字、數字、單位和時間請列為不確定。"}],
        image:{mimeType:image.mimeType,data:image.base64},authorize,signal,
        tools:[{name:"present_photo_draft",description:"Return one unconfirmed photo transcription. Preserve approximate quantities and ambiguous times; list uncertainties. This does not save shared facts or authorize action.",
          parameters:photoDraftSchema,authorize,
          execute:async args=>{if(draft)return {status:"rejected"};draft=photoDraftSchema.parse(args);return {status:"succeeded",reference:id};}}],
        finalize:async()=>draft?"照片候選已整理，尚待你核對及確認。":null});
      if(!await isCurrentUser())return null;
      return await store.finishExtraction(userId,childId,id,runId,draft,result.stopReason??null,result.provenance?.model??null);
    } catch {
      if(!await isCurrentUser())return null;
      return store.finishExtraction(userId,childId,id,runId,null,signal.aborted?"cancelled":"unavailable",null);
    }
  }};
}
export type PhotoAgent=ReturnType<typeof createPhotoAgent>;
