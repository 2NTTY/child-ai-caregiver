import { z } from "zod";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { ProductAgent } from "./product-agent.ts";
import type { GrowthEnqueue,GrowthStore } from "./growth-store.ts";
import { GROWTH_CATALOG_REVISION } from "./growth-rules.ts";
import { databaseAdapter } from "./worker-queue.ts";
import { GROWTH_CHECK_QUEUE,GROWTH_AGENT_QUEUE,GROWTH_JOB_OPTIONS } from "./growth-events.ts";
const checkSchema=z.object({generation:z.uuid()}).strict();
const agentSchema=z.object({userId:z.string().min(1).max(128),childId:z.uuid(),id:z.uuid(),version:z.number().int().positive(),workerGeneration:z.uuid(),storageEpoch:z.uuid()}).strict();
/** Cron checks persisted due work only. Inference is queued atomically for a new attention basis. */
export function createGrowthWorker(pool:Pool,boss:PgBoss,store:GrowthStore,agent:ProductAgent){
  const controller=new AbortController();
  let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined,stopping=false;
  const enqueue:GrowthEnqueue=async(client,userId,item,scope)=>{
    const data=agentSchema.parse({userId,childId:item.childId,id:item.id,version:item.version,...scope});
    if(!await boss.send(GROWTH_AGENT_QUEUE,data,{...GROWTH_JOB_OPTIONS,db:databaseAdapter(client)})) throw new Error("growth_enqueue_unconfirmed");
  };
  const reconcile=async()=>{
    const control=(await pool.query<{enabled:boolean;generation:string}>("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    if(stopping) return;
    if(!control?.enabled){await boss.unschedule(GROWTH_CHECK_QUEUE,"due");return;}
    const existing=(await boss.getSchedules(GROWTH_CHECK_QUEUE)).find(schedule=>schedule.key==="due");
    const parsed=checkSchema.safeParse(existing?.data);
    if(!parsed.success || parsed.data.generation!==control.generation)
      await boss.schedule(GROWTH_CHECK_QUEUE,"* * * * *",{generation:control.generation},{...GROWTH_JOB_OPTIONS,key:"due",tz:"Asia/Hong_Kong",missed:"once",singletonKey:"due"});
  };
  const sync=()=>pending??=reconcile().finally(()=>{pending=undefined;});
  return{
    async start(){
      if(!await boss.getQueue(GROWTH_CHECK_QUEUE) || !await boss.getQueue(GROWTH_AGENT_QUEUE)) throw new Error("growth_queue_missing");
      await sync();
      await boss.work<z.infer<typeof checkSchema>>(GROWTH_CHECK_QUEUE,{batchSize:1,localConcurrency:1,pollingIntervalSeconds:2},async jobs=>{
        for(const job of jobs){
          const parsed=checkSchema.safeParse(job.data);if(!parsed.success)throw new Error("growth_job_invalid");
          try{
            const rows=(await pool.query<{child_id:string;owner_user_id:string;storage_epoch:string}>(`
              SELECT g.child_id,w.owner_user_id,w.storage_epoch FROM growth_checks g
              JOIN children ch ON ch.id=g.child_id JOIN workspaces w ON w.id=ch.workspace_id
              JOIN worker_control ctl ON ctl.id=1 AND ctl.enabled AND ctl.generation=$1
              WHERE g.next_check_at<=now() OR g.catalog_revision<>$2
              ORDER BY g.next_check_at NULLS FIRST,g.child_id LIMIT 10`,[parsed.data.generation,GROWTH_CATALOG_REVISION])).rows;
            for(const row of rows){
              if(stopping)break;
              const scope={workerGeneration:parsed.data.generation,storageEpoch:row.storage_epoch};
              try{await store.evaluate(row.owner_user_id,row.child_id,scope,enqueue);}
              catch{await store.failed(row.owner_user_id,row.child_id,scope);console.error("growth_child_check_failed");}
            }
          }catch{throw new Error("growth_check_failed");}
        }
      });
      await boss.work<z.infer<typeof agentSchema>>(GROWTH_AGENT_QUEUE,{batchSize:1,localConcurrency:1,pollingIntervalSeconds:2},async jobs=>{
        for(const job of jobs){
          const parsed=agentSchema.safeParse(job.data);if(!parsed.success)throw new Error("growth_job_invalid");
          const data=parsed.data;
          try{
            const current=()=>store.backgroundInput(data.userId,data.childId,data.id,data);
            const item=await current();if(!item || item.version!==data.version || stopping)continue;
            await agent.background({userId:data.userId,childId:data.childId,reference:item.id,
              context:{eventType:"growth_attention",attention:item,policy:"Server-reviewed applicability; no medical rule generation, task execution or external notification"},
              authorize:async()=>!stopping&&(await current())?.version===data.version,signal:controller.signal});
          }catch{throw new Error("growth_agent_failed");}
        }
      });
      timer=setInterval(()=>{void sync().catch(()=>console.error("growth_schedule_sync_failed"));},60000).unref();
    },
    async stop(){stopping=true;clearInterval(timer);controller.abort();await pending;},
  };
}
