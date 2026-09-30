import type { Pool,PoolClient } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import { withChildAccess,READ_ROLES,WRITE_ROLES,FamilyError } from "./family-access.ts";
import { createCareStore } from "./care.ts";
import { transactionPool } from "./transaction-pool.ts";
import { taskSelection,decodeTask,type TaskRow } from "./tasks.ts";
import { appendOnlineChange } from "./online-change.ts";
import { summaryQuery,preparationInput,type SummaryQuery,type PreparationInput,type CareSummary,type VisitPreparation } from "../src/shared/care-summary.ts";
import { summarizeCare } from "./care-summary-policy.ts";

const aad=(child:string,version:number)=>"visit-preparation:"+child+":"+version;
const empty=():VisitPreparation=>({version:0,appointmentTaskId:null,questions:[],checklist:[],reviewed:false,reviewedBasis:null,period:null,updatedBy:null,updatedAt:null});
export function createCareSummaryStore(pool:Pool,cipher:StorageCipher){
 async function basis(c:PoolClient,workspace:string){const row=(await c.query<{value:string}>("SELECT storage_epoch::text||':'||change_seq::text AS value FROM workspaces WHERE id=$1",[workspace])).rows[0];return row.value;}
 async function preparation(c:PoolClient,child:string):Promise<VisitPreparation>{
  const row=(await c.query<{version:number;payload_encrypted:string}>("SELECT version,payload_encrypted FROM visit_preparations WHERE child_id=$1",[child])).rows[0];
  return row?JSON.parse(cipher.decrypt(row.payload_encrypted,aad(child,row.version))):empty();
 }
 async function snapshot(c:PoolClient,workspace:string,user:string,child:string,query:SummaryQuery,canManage:boolean):Promise<CareSummary>{
  const borrowed=transactionPool(c),care=await createCareStore(borrowed.pool,cipher).reportSource(user,child);borrowed.assertReleased();
  if(!care)throw new FamilyError(404,"not_found");
  const source=(await c.query<{display_name:string;owner_user_id:string}>("SELECT ch.display_name_encrypted AS display_name,w.owner_user_id FROM children ch JOIN workspaces w ON w.id=ch.workspace_id WHERE ch.id=$1",[child])).rows[0];
  const rows=(await c.query<TaskRow>(taskSelection+" WHERE t.child_id=$1 ORDER BY t.id LIMIT 501",[child])).rows;
  if(rows.length>500)throw new FamilyError(409,"summary_scope_too_large");
  const tasks=rows.map(r=>decodeTask(r,cipher)),prep=await preparation(c,child),version=await basis(c,workspace);
  let summary:ReturnType<typeof summarizeCare>;
  try{summary=summarizeCare(care.records,query);}catch(error){if(error instanceof Error&&error.message==="summary_range_too_large")throw new FamilyError(409,"summary_range_too_large");throw error;}
  return {childId:child,childName:cipher.decrypt(source.display_name,"children:"+child+":"+source.owner_user_id+":display_name"),profile:care.profile,canManage,
   period:query,...summary,generatedAt:new Date().toISOString(),basisVersion:version,
   appointments:tasks.filter(t=>t.kind==="appointment"&&t.occurrence.state==="scheduled"),
   conflicts:tasks.filter(t=>t.occurrence.state==="needs_review"),preparation:prep,
   reviewCurrent:prep.reviewed&&prep.reviewedBasis===version&&JSON.stringify(prep.period)===JSON.stringify(query)};
 }
 return {
  get(user:string,child:string,raw:SummaryQuery){const query=summaryQuery.parse(raw);
   // Serialize a coherent snapshot with writes/revocation, without model/network work.
   return withChildAccess(pool,user,child,READ_ROLES,(c,role,workspace)=>snapshot(c,workspace,user,child,query,role!=="viewer"),true);
  },
  save(user:string,child:string,raw:PreparationInput){const input=preparationInput.parse(raw);
   return withChildAccess(pool,user,child,WRITE_ROLES,async(c,_role,workspace)=>{
    const old=await preparation(c,child);
    if(old.version!==input.expectedVersion||input.basisVersion!==await basis(c,workspace))throw new FamilyError(409,"summary_basis_changed");
    if(old.version>=2147483646)throw new FamilyError(409,"version_conflict");
    const report=await snapshot(c,workspace,user,child,input.period,true);
    if(input.appointmentTaskId&&!report.appointments.some(t=>t.id===input.appointmentTaskId))throw new FamilyError(409,"appointment_changed");
    await appendOnlineChange(c,workspace,"care",child);
    const value:VisitPreparation={version:old.version+1,appointmentTaskId:input.appointmentTaskId,questions:input.questions,checklist:input.checklist,
     reviewed:input.reviewed,reviewedBasis:input.reviewed?await basis(c,workspace):null,period:input.period,updatedBy:user,updatedAt:new Date().toISOString()};
    const encrypted=cipher.encrypt(JSON.stringify(value),aad(child,value.version));
    await c.query("INSERT INTO visit_preparations(child_id,version,payload_encrypted) VALUES($1,$2,$3) ON CONFLICT(child_id) DO UPDATE SET version=$2,payload_encrypted=$3",[child,value.version,encrypted]);
    await c.query("INSERT INTO visit_preparation_revisions(child_id,version,payload_encrypted) VALUES($1,$2,$3)",[child,value.version,encrypted]);
    return value;
   },true);
  },
 };
}
export type CareSummaryStore=ReturnType<typeof createCareSummaryStore>;
