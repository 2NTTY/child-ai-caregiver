import { z } from "zod";
import { concernValuesSchema, concernChangeSchema } from "../src/shared/concerns.ts";
import type { ConcernStore } from "./concern-store.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import { FamilyError } from "./family-access.ts";
import { concernAgentContext } from "./concern-context.ts";

export function createAgentConcernTools(concerns:ConcernStore, store:ProductAgentStore, run:AgentRunContext, authorize:()=>Promise<boolean>, background=false):AgentTool[] {
  const {scope,runId}=run;
  const guarded=async(action:()=>Promise<unknown>):Promise<AgentToolResult>=>{
    try { if(!await authorize())return {status:"rejected"}; return {status:"succeeded",data:{result:await action()}}; }
    catch(error) { if(error instanceof z.ZodError)return {status:"rejected",data:{code:"invalid_input"}};
      if(error instanceof FamilyError)return {status:error.status===409?"conflict":"rejected",data:{code:error.code}}; throw error; }
  };
  const tools:AgentTool[]=[{
    name:"read_concerns",description:"讀取這名孩子的共享持續關注。concernId=null 按 searchText（或 null）列最多 20 項，hasMore 表示未讀齊；指定 ID 讀有界完整事件及 historyComplete。關注不是診斷，與成長候選、任務及私人記憶分開。",
    parameters:z.object({concernId:z.uuid().nullable(),searchText:z.string().max(100).nullable()}).strict(),authorize,
    execute:args=>guarded(async()=>{
      const page=await concerns.list(scope.userId,scope.childId);
      if(!page)throw new FamilyError(404,"not_found");
      if(!args.concernId) {
        const query=(args.searchText as string|null)?.trim().toLocaleLowerCase("zh-HK");
        const items=page.items.filter(item=>!query||(item.title+" "+item.reason).toLocaleLowerCase("zh-HK").includes(query));
        return {authorityVersion:page.authorityVersion,hasMore:items.length>20,items:items.slice(0,20).map(({id,title,version,status,followUp})=>({id,title,version,status,followUp}))};
      }
      const item=page.items.find(value=>value.id===args.concernId);
      if(!item)throw new FamilyError(404,"not_found");
      return {authorityVersion:page.authorityVersion,concern:concernAgentContext(item)};
    }),
  }];
  if(!background)tools.push(
    {name:"propose_concern",description:"按家長交代提出共享持續關注候選，列出將共享的整理內容，待確認後才建立。observation 是家長陳述，不是診斷。followUpAt 只在家長明確指定時填具體未來時間，否則 null；到期只提供站內回饋，不外發通知。",
      parameters:concernValuesSchema,authorize,execute:(args,context)=>guarded(()=>store.propose(scope,runId,context.callId,{kind:"concern_create",values:concernValuesSchema.parse(args)}))},
    {name:"propose_concern_change",description:"先 read_concerns 核對原 ID／版本／authorityVersion，再提出追加觀察、結束、恢復或一次站內跟進的候選。結束不完成／取消關聯任務；恢復不重啟舊跟進；改時間使用 schedule_followup，null 表示撤回。不得複製私人原文或擴大共享。",
      parameters:z.object({concernId:z.uuid(),change:concernChangeSchema}).strict(),authorize,
      execute:(args,context)=>guarded(()=>store.propose(scope,runId,context.callId,{kind:"concern_change",concernId:args.concernId as string,change:concernChangeSchema.parse(args.change)}))}
  );
  return tools;
}
