import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { databaseAdapter } from "./worker-queue.ts";
import { TELEGRAM_QUEUE,TELEGRAM_JOB_OPTIONS } from "./telegram-events.ts";
import type { TelegramQueue,TelegramGateway } from "./telegram-types.ts";
import type { TelegramStore } from "./telegram-store.ts";
const jobSchema=z.object({deliveryId:z.uuid()}).strict();
export function telegramQueue(boss:PgBoss):TelegramQueue{return {async enqueue(client,deliveryId){
 const value=await boss.send(TELEGRAM_QUEUE,jobSchema.parse({deliveryId}),{...TELEGRAM_JOB_OPTIONS,id:deliveryId,db:databaseAdapter(client)});
 if(value!==deliveryId)throw new Error("telegram_enqueue_unconfirmed");
}};}
export async function startTelegramWorker(boss:PgBoss,store:TelegramStore,gateway:TelegramGateway,signal:AbortSignal){
 if(!await boss.getQueue(TELEGRAM_QUEUE))throw new Error("telegram_queue_missing");
 await boss.work<z.infer<typeof jobSchema>>(TELEGRAM_QUEUE,{batchSize:1,localConcurrency:1,pollingIntervalSeconds:2},async jobs=>{
  for(const job of jobs){const data=jobSchema.safeParse(job.data);if(!data.success)throw new Error("telegram_job_invalid");
   try{await store.send(data.data.deliveryId,gateway,signal);}catch{throw new Error("telegram_send_record_failed");}
  }
 });
 let pending:Promise<void>|undefined;
 const reconcile=()=>{pending??=store.reconcile().catch(()=>console.error("telegram_reconcile_failed")).finally(()=>{pending=undefined;});};
 reconcile();const timer=setInterval(reconcile,60000).unref();
 return {async stop(){clearInterval(timer);await pending;}};
}
