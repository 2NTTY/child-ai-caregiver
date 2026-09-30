import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { CONTACT_QUEUE,CONTACT_OPTIONS,type ContactQueue } from "./contact-events.ts";
import { databaseAdapter } from "./worker-queue.ts";
import { enqueueAgentReminder } from "./product-agent-background.ts";
import type { ContactStore } from "./contact-store.ts";
import type { WebPushGateway } from "./web-push-types.ts";
import type { TelegramGateway } from "./telegram-types.ts";
const jobSchema=z.object({requestId:z.uuid(),jobId:z.uuid()}).strict();
export function contactQueue(boss:PgBoss):ContactQueue{return {
 async enqueue(client,requestId,jobId,at){
  const result=await boss.send(CONTACT_QUEUE,jobSchema.parse({requestId,jobId}),{...CONTACT_OPTIONS,id:jobId,startAfter:new Date(Math.max(Date.now(),Date.parse(at))).toISOString(),db:databaseAdapter(client)});
  if(result!==jobId)throw new Error("contact_enqueue_unconfirmed");
 },
 onGrant:(client,workId,reminderId,eventId)=>enqueueAgentReminder(boss,client,workId,reminderId,eventId),
};}
export async function startContactWorker(boss:PgBoss,store:ContactStore,gateways:{push:WebPushGateway;telegram:TelegramGateway},signal:AbortSignal){
 if(!await boss.getQueue(CONTACT_QUEUE))throw new Error("contact_queue_missing");
 await boss.work<z.infer<typeof jobSchema>>(CONTACT_QUEUE,{batchSize:1,localConcurrency:1,pollingIntervalSeconds:2},async jobs=>{
  for(const job of jobs){const input=jobSchema.safeParse(job.data);if(!input.success||input.data.jobId!==job.id)throw new Error("contact_job_invalid");
   try{await store.process(input.data.requestId,job.id,gateways,signal);}catch{throw new Error("contact_processing_failed");}
  }
 });
 let pending:Promise<void>|undefined;
 const reconcile=()=>{pending??=store.reconcile().catch(()=>console.error("contact_reconcile_failed")).finally(()=>{pending=undefined;});};
 reconcile();const timer=setInterval(reconcile,60000).unref();
 return {async stop(){clearInterval(timer);await pending;}};
}
