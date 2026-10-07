import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { growthActionSchema, growthTopicActionSchema, growthTopicSchema } from "../src/shared/growth.ts";
import type { GrowthAction, GrowthAttention, GrowthPage, GrowthTopicAction, GrowthTopicId } from "../src/shared/growth.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, withChildAccess } from "./family-access.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { transactionPool } from "./transaction-pool.ts";
import { canonicalJson } from "./online-routing.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore, type TaskScheduling } from "./tasks.ts";
import { createKnowledgeStore } from "./knowledge-store.ts";
import { agentKnowledgeFilter } from "./product-agent-tools.ts";
import { parseKnowledgeFilter } from "./knowledge-inputs.ts";
import { GROWTH_CATALOG_REVISION, GROWTH_RULES, growthBasisChanged, growthInputs, growthProposals, nextGrowthCheck } from "./growth-rules.ts";
import { appendOnlineChange } from "./online-change.ts";

interface Row { id: string; child_id: string; topic_id: GrowthTopicId; version: number; state: GrowthAttention["state"]; payload_encrypted: string }
interface Saved { item: GrowthAttention; lastRequest: GrowthAction | null }
interface TopicRow { topic_id: GrowthTopicId; version: number; disabled: boolean; payload_encrypted: string }
const missing = () => new FamilyError(404, "not_found");
const conflict = () => new FamilyError(409, "growth_changed");
const aad = (childId: string, id: string, version: number) => "growth:" + childId + ":" + id + ":" + version;
const topicAad = (childId: string, id: string, version: number) => "growth-topic:" + childId + ":" + id + ":" + version;
export interface GrowthWorkerScope { workerGeneration: string; storageEpoch: string }
export type GrowthEnqueue = (client: PoolClient, userId: string, item: GrowthAttention, scope: GrowthWorkerScope) => Promise<void>;

export function createGrowthStore(pool: Pool, cipher: StorageCipher, scheduling?: TaskScheduling) {
  const access = <T>(userId: string, childId: string, write: boolean, action: (client: PoolClient, workspaceId: string, canManage: boolean) => Promise<T>) =>
    withChildAccess(pool, userId, childId, write ? WRITE_ROLES : READ_ROLES,
      (client, role, workspaceId) => action(client, workspaceId, WRITE_ROLES.includes(role)), write);
  const decode = (row: Row): Saved => JSON.parse(cipher.decrypt(row.payload_encrypted, aad(row.child_id, row.id, row.version)));
  async function all(client: PoolClient, childId: string) {
    const rows = (await client.query<Row>("SELECT * FROM growth_attention WHERE child_id=$1 ORDER BY created_at,id LIMIT 501", [childId])).rows;
    if (rows.length > 500) throw new FamilyError(400, "growth_history_requires_review");
    return rows.map(decode);
  }
  async function save(client: PoolClient, value: Saved, insert = false) {
    const item = value.item, payload = cipher.encrypt(JSON.stringify(value), aad(item.childId, item.id, item.version));
    if (insert) await client.query("INSERT INTO growth_attention(id,child_id,topic_id,version,state,payload_encrypted,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [item.id,item.childId,item.topicId,item.version,item.state,payload,item.createdAt,item.updatedAt]);
    else await client.query("UPDATE growth_attention SET version=$2,state=$3,payload_encrypted=$4,updated_at=$5 WHERE id=$1",
      [item.id,item.version,item.state,payload,item.updatedAt]);
    await client.query("INSERT INTO growth_revisions(attention_id,version,payload_encrypted) VALUES($1,$2,$3)", [item.id,item.version,payload]);
  }
  async function load(client: PoolClient, userId: string, childId: string, lockSources = false, readOnly = false) {
    const borrowed = transactionPool(client), memory = createMemoryStore(borrowed.pool, cipher, true);
    const context = await memory.context(userId, childId, "family"); borrowed.assertReleased();
    if (!context) throw missing();
    if (lockSources) {
      const ids = GROWTH_RULES.map(rule => rule.sourceId);
      await client.query("SELECT id FROM knowledge_sources WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE", [ids]);
      await client.query("SELECT id FROM knowledge_watches WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE", [ids]);
      await client.query("SELECT source_id FROM knowledge_observations WHERE source_id=ANY($1::text[]) ORDER BY source_id FOR SHARE", [ids]);
    }
    const now = new Date(), filter = agentKnowledgeFilter(context, now);
    let knowledgeNotice: string | null = null;
    if (readOnly) {
      const profile = context.profileApplicable ? context.profile.data : null;
      const regionNotice = "尚未能把已確認地域轉為知識篩選；原地域資料已保留，沒有假定香港。現有關注仍可查閱，來源適用性尚未能確認。";
      const ageNotice = "知識及成長規則目前只覆蓋 0–10 歲；原出生日期已保留，沒有套用其他年齡的來源。現有關注仍可查閱，來源適用性尚未能確認。";
      // The Agent's broader age calculation can return null beyond 216 months.
      // An out-of-scope exact birth date must not become an unrestricted-age query.
      const beyondAgeScope = profile?.age.kind === "birth_date" &&
        (now.getUTCFullYear() - Number(profile.age.date.slice(0, 4)) > 10 || (filter.age?.maxMonths ?? 0) > 120);
      if (beyondAgeScope) knowledgeNotice = ageNotice;
      else if (!profile?.region?.trim()) knowledgeNotice = regionNotice;
      else {
        // Catch only this local conversion boundary, never a query/decryption failure.
        try { parseKnowledgeFilter(filter); }
        catch (error) { if (!(error instanceof z.ZodError)) throw error; knowledgeNotice = regionNotice; }
      }
    }
    const sources = knowledgeNotice ? [] : await createKnowledgeStore(borrowed.pool).candidates(filter, null);
    borrowed.assertReleased();
    return { context, sources, knowledgeNotice, memory, borrowed, tasks: createTaskStore(borrowed.pool, cipher, scheduling) };
  }
  async function visible(item: GrowthAttention, loaded: Awaited<ReturnType<typeof load>>, userId: string): Promise<GrowthAttention> {
    const applicable = growthProposals(loaded.context, loaded.sources, new Date()).proposals.find(value => value.topicId === item.topicId);
    const available = Boolean(applicable && canonicalJson(applicable.basis) === canonicalJson(item.basis));
    const task = item.taskId ? await loaded.tasks.get(userId, item.childId, item.taskId) : null; loaded.borrowed.assertReleased();
    return { ...item, sourceAvailable: available, taskState: task?.occurrence.state ?? null };
  }
  async function page(client: PoolClient, userId: string, childId: string, canManage: boolean, readOnly = false): Promise<GrowthPage> {
    const loaded = await load(client, userId, childId, false, readOnly), records = await all(client, childId);
    const states = (await client.query<TopicRow>("SELECT * FROM growth_topics WHERE child_id=$1", [childId])).rows;
    const items: GrowthAttention[] = [], active = records.filter(value => ["proposed","snoozed"].includes(value.item.state));
    const history = records.filter(value => !["proposed","snoozed"].includes(value.item.state)).reverse();
    for (const { item } of [...active, ...history.slice(0, 30)]) items.push(await visible(item, loaded, userId));
    const failure=(await client.query<{failures:number}>("SELECT failures FROM growth_checks WHERE child_id=$1",[childId])).rows[0];
    const taskPage = await loaded.tasks.list(userId, childId); loaded.borrowed.assertReleased();
    const workspace=(await client.query<{workspace_id:string}>("SELECT workspace_id FROM children WHERE id=$1",[childId])).rows[0];
    return { authorityVersion:await authority(client,workspace.workspace_id), items, historyHasMore: history.length > 30, canManage, eligibleAssignees: taskPage?.eligibleAssignees ?? [],
      notices: [...(loaded.knowledgeNotice ? [loaded.knowledgeNotice] : growthProposals(loaded.context, loaded.sources, new Date()).notices),...(failure?.failures===3?["背景評估已達有限重試上限，需核查故障；沒有假稱已完成。"]:[])],
      topics: GROWTH_RULES.map(rule => { const state = states.find(value => value.topic_id === rule.id);
        return { id: rule.id, title: rule.title, version: state?.version ?? 1, disabled: state?.disabled ?? false, inputs: growthInputs(rule, loaded.context) }; }) };
  }
  async function authority(client:PoolClient,workspaceId:string){
    const row=(await client.query<{storage_epoch:string;access_version:string}>("SELECT storage_epoch,access_version::text FROM workspaces WHERE id=$1",[workspaceId])).rows[0];
    return row.storage_epoch+":"+row.access_version;
  }
  async function control(client: PoolClient, workspaceId: string, scope: GrowthWorkerScope) {
    const row = (await client.query<{ enabled: boolean; generation: string; storage_epoch: string }>(
      "SELECT c.enabled,c.generation,w.storage_epoch FROM worker_control c CROSS JOIN workspaces w WHERE c.id=1 AND w.id=$1 FOR SHARE OF c", [workspaceId])).rows[0];
    return row?.enabled && row.generation === scope.workerGeneration && row.storage_epoch === scope.storageEpoch;
  }
  return {
    async failed(userId:string,childId:string,scope:GrowthWorkerScope){
      return access(userId,childId,true,async(client,workspaceId)=>{
        if(!await control(client,workspaceId,scope))return;
        await client.query("UPDATE growth_checks SET failures=CASE WHEN catalog_revision=$2 THEN LEAST(3,failures+1) ELSE 1 END,next_check_at=CASE WHEN catalog_revision=$2 AND failures>=2 THEN NULL ELSE now()+interval '1 minute' END,catalog_revision=$2,last_failure_code='evaluation_failed' WHERE child_id=$1",[childId,GROWTH_CATALOG_REVISION]);
      });
    },
    list(userId: string, childId: string) { return access(userId, childId, false, (client, _workspaceId, canManage) => page(client,userId,childId,canManage,true)); },
    async decide(userId: string, childId: string, id: string, raw: GrowthAction) {
      const input = growthActionSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        if(await authority(client,workspaceId)!==input.authorityVersion) throw conflict();
        const row = (await client.query<Row>("SELECT * FROM growth_attention WHERE id=$1 AND child_id=$2", [id,childId])).rows[0];
        if (!row) throw missing();
        const saved = decode(row), current = saved.item;
        if (current.version === input.expectedVersion + 1 && current.actorUserId === userId && canonicalJson(saved.lastRequest) === canonicalJson(input))
          return visible(current, await load(client,userId,childId),userId);
        if (current.version !== input.expectedVersion || !["proposed","snoozed"].includes(current.state)) throw conflict();
        const disabled = (await client.query<TopicRow>("SELECT * FROM growth_topics WHERE child_id=$1 AND topic_id=$2", [childId,current.topicId])).rows[0]?.disabled;
        const loaded = await load(client,userId,childId,true), shown = await visible(current,loaded,userId);
        if (disabled || !shown.sourceAvailable) throw conflict();
        const now = new Date().toISOString(), item = { ...current, version: current.version+1, updatedAt: now, actorUserId: userId, lastAction: input.action };
        if (input.action === "dismiss") { item.state = "dismissed"; item.note = input.note; item.snoozeUntil = null; }
        else if (input.action === "snooze") {
          if (Date.parse(input.until) <= Date.now() || Date.parse(input.until) > Date.now()+366*86400000) throw new FamilyError(400,"invalid_input");
          item.state = "snoozed"; item.snoozeUntil = input.until;
        } else {
          item.state = "accepted"; item.snoozeUntil = null;
          if (input.task.kind === "create") {
            const linked=current.taskId?await loaded.tasks.get(userId,childId,current.taskId):null; loaded.borrowed.assertReleased();
            if(linked && ["scheduled","needs_review"].includes(linked.occurrence.state)) throw new FamilyError(409,"growth_existing_task_requires_review");
            const task = await loaded.tasks.create(userId,childId,{values: input.task.values,confirm:true}); loaded.borrowed.assertReleased();
            if (!task) throw missing(); item.taskId=task.id; item.taskState=task.occurrence.state;
          } else if (input.task.kind === "existing") {
            const task = await loaded.tasks.get(userId,childId,input.task.id); loaded.borrowed.assertReleased();
            if (!task || task.version !== input.task.expectedVersion) throw conflict(); item.taskId=task.id; item.taskState=task.occurrence.state;
          }
        }
        await save(client,{item,lastRequest:input});
        await client.query("INSERT INTO growth_checks(child_id,next_check_at) VALUES($1,now()) ON CONFLICT(child_id) DO UPDATE SET next_check_at=now()",[childId]);
        await appendOnlineChange(client,workspaceId,"growth",childId);
        return item;
      });
    },
    async topic(userId: string, childId: string, rawTopic: GrowthTopicId, raw: GrowthTopicAction) {
      const topicId=growthTopicSchema.parse(rawTopic), input=growthTopicActionSchema.parse(raw);
      return access(userId,childId,true,async(client,workspaceId,canManage)=>{
        if(await authority(client,workspaceId)!==input.authorityVersion) throw conflict();
        const rule=GROWTH_RULES.find(value=>value.id===topicId)!;
        const old=(await client.query<TopicRow>("SELECT * FROM growth_topics WHERE child_id=$1 AND topic_id=$2",[childId,topicId])).rows[0];
        const version=old?.version??1;
        if(old && version===input.expectedVersion+1){
          const previous=JSON.parse(cipher.decrypt(old.payload_encrypted,topicAad(childId,topicId,version)));
          if(previous.actor===userId && canonicalJson(previous.request)===canonicalJson(input)) return page(client,userId,childId,canManage);
        }
        if(version!==input.expectedVersion) throw conflict();
        const loaded=await load(client,userId,childId), now=new Date().toISOString();
        if(input.action==="confirm_context"){
          const references=loaded.context.facts.filter(fact=>fact.visibility==="family" && fact.status==="confirmed" && rule.inputs.some(definition=>definition.key===fact.key.trim().toLowerCase())).map(({id,version})=>({id,version})).sort((a,b)=>a.id.localeCompare(b.id));
          const expected=[...input.expectedFacts].sort((a,b)=>a.id.localeCompare(b.id));
          if(canonicalJson(references)!==canonicalJson(expected)) throw conflict();
          const entries=Object.entries(input.values);
          if(!entries.length || entries.some(([key,value])=>!rule.inputs.some(definition=>definition.key===key && definition.choices.some(choice=>choice.value===value))))
            throw new FamilyError(400,"invalid_input");
          for(const [key,value]of entries){
            // Only reuse a single visible, confirmed, manual family fact. Ambiguity is resolved in memory history.
            const facts=loaded.context.facts.filter(fact=>fact.visibility==="family" && fact.status==="confirmed" && fact.key.trim().toLowerCase()===key);
            if(facts.length>1 || loaded.context.unavailableFactKeys.includes(key)) throw new FamilyError(409,"growth_fact_requires_review");
            const values={key,content:value,source:{kind:"manual" as const,description:"家長在成長關注中明確確認，供家庭共同照護使用。"},validUntil:null};
            if(facts.length){
              if(facts[0].content!==value){
                const revised=await loaded.memory.reviseFact(userId,childId,facts[0].id,{values,expectedVersion:facts[0].version,confirm:true,confirmShared:true,reason:"家長更新成長關注近況。"});
                loaded.borrowed.assertReleased(); if(!revised) throw conflict();
              }
            }else{
              const candidate=await loaded.memory.createFact(userId,childId,{values,intendedVisibility:"family"}); loaded.borrowed.assertReleased();
              if(!candidate) throw missing();
              const confirmed=await loaded.memory.confirmFact(userId,childId,candidate.id,{expectedVersion:candidate.version,confirm:true,confirmShared:true});
              loaded.borrowed.assertReleased(); if(!confirmed) throw missing();
            }
          }
        }
        const disabled=input.action==="set_enabled" ? !input.enabled : old?.disabled??false;
        const payload=cipher.encrypt(JSON.stringify({request:input,actor:userId,at:now,disabled}),topicAad(childId,topicId,version+1));
        await client.query("INSERT INTO growth_topics(child_id,topic_id,version,disabled,payload_encrypted) VALUES($1,$2,$3,$4,$5) ON CONFLICT(child_id,topic_id) DO UPDATE SET version=$3,disabled=$4,payload_encrypted=$5",[childId,topicId,version+1,disabled,payload]);
        await client.query("INSERT INTO growth_topic_revisions(child_id,topic_id,version,payload_encrypted) VALUES($1,$2,$3,$4)",[childId,topicId,version+1,payload]);
        if(disabled) for(const saved of await all(client,childId)){
          if(saved.item.topicId!==topicId || !["proposed","snoozed"].includes(saved.item.state)) continue;
          await save(client,{item:{...saved.item,version:saved.item.version+1,state:"dismissed",snoozeUntil:null,updatedAt:now,actorUserId:userId,lastAction:"topic_disabled",note:"已永久停用此主題；只有明確重新啟用才可再評估。"},lastRequest:null});
        }
        await client.query("INSERT INTO growth_checks(child_id,next_check_at) VALUES($1,now()) ON CONFLICT(child_id) DO UPDATE SET next_check_at=now()",[childId]);
        await appendOnlineChange(client,workspaceId,"growth",childId);
        return page(client,userId,childId,canManage);
      });
    },
    async evaluate(userId: string, childId: string, scope: GrowthWorkerScope, enqueue?: GrowthEnqueue) {
      return access(userId,childId,true,async(client,workspaceId)=>{
        if(!await control(client,workspaceId,scope)) return;
        const due=(await client.query<{next_check_at:Date|null;catalog_revision:string}>("SELECT next_check_at,catalog_revision FROM growth_checks WHERE child_id=$1",[childId])).rows[0];
        if(due && due.catalog_revision===GROWTH_CATALOG_REVISION && (!due.next_check_at || due.next_check_at.getTime()>Date.now())) return;
        const loaded=await load(client,userId,childId,true), now=new Date(), at=now.toISOString();
        const {proposals}=growthProposals(loaded.context,loaded.sources,now), history=await all(client,childId);
        const topics=(await client.query<TopicRow>("SELECT * FROM growth_topics WHERE child_id=$1",[childId])).rows;
        let changed=false;
        const checks=[nextGrowthCheck(loaded.context,now),...loaded.sources.map(source=>source.validUntil??null)];
        for(const rule of GROWTH_RULES){
          const saved=history.filter(value=>value.item.topicId===rule.id), latest=saved.at(-1);
          const disabled=topics.some(value=>value.topic_id===rule.id && value.disabled);
          const next=disabled?undefined:proposals.find(value=>value.topicId===rule.id);
          for(const record of saved.filter(value=>["proposed","snoozed"].includes(value.item.state))){
            if(!next || canonicalJson(record.item.basis)!==canonicalJson(next.basis)){
              await save(client,{item:{...record.item,version:record.item.version+1,state:"inapplicable",updatedAt:at,lastAction:"basis_unavailable",actorUserId:null,note:"適用條件或已核對來源已改變。"},lastRequest:null}); changed=true;
            }else if(record.item.state==="snoozed" && record.item.snoozeUntil){
              if(Date.parse(record.item.snoozeUntil)<=now.getTime()){
                await save(client,{item:{...record.item,version:record.item.version+1,state:"proposed",snoozeUntil:null,updatedAt:at,lastAction:"snooze_due",actorUserId:null},lastRequest:null}); changed=true;
              }else checks.push(record.item.snoozeUntil);
            }
          }
          // Any historical basis remains consumed, including dismissed, accepted and withdrawn candidates.
          if(!next || saved.some(value=>canonicalJson(value.item.basis)===canonicalJson(next.basis))) continue;
          if(latest && !growthBasisChanged(latest.item.basis,next.basis)) continue;
          const related=saved.toReversed().find(value=>value.item.taskId && value.item.basis.stage===next.basis.stage)?.item.taskId;
          const linked=related?await loaded.tasks.get(userId,childId,related):null; loaded.borrowed.assertReleased();
          const reasons:string[]=[];
          if(latest){
            if(latest.item.basis.stage!==next.basis.stage) reasons.push("孩子已進入此規則的新適用階段");
            if(latest.item.basis.ruleRevision!==next.basis.ruleRevision || latest.item.basis.sourceHash!==next.basis.sourceHash) reasons.push("此主題的官方依據或規則已重新核對並實質更新");
            for(const definition of rule.inputs){
              const value=next.basis.values[definition.key];
              if(value!=="unknown" && latest.item.basis.values[definition.key]!==value)
                reasons.push("新確認近況："+definition.label+" — "+(definition.choices.find(choice=>choice.value===value)?.label??value));
            }
          }
          const item:GrowthAttention={...next,whyNow:next.whyNow+(linked?" 另有已確認的相關任務，請先核對其實際狀態；這不是尚未安排的判定。":""),id:randomUUID(),childId,version:1,state:"proposed",createdAt:at,updatedAt:at,snoozeUntil:null,
            previousId:latest?.item.id??null,newReason:latest?reasons.join("；")+"。舊事項的處理結果保留。":"首次符合這項有限規則。",
            taskId:linked?.id??null,taskState:linked?.occurrence.state??null,lastAction:"proposed",actorUserId:null,note:""};
          await save(client,{item,lastRequest:null},true); changed=true;
          await enqueue?.(client,userId,item,scope);
        }
        const next=checks.filter((value):value is string=>Boolean(value)&&Date.parse(value!)>now.getTime()).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]??null;
        await client.query("INSERT INTO growth_checks(child_id,next_check_at,catalog_revision,last_checked_at) VALUES($1,$2,$3,$4) ON CONFLICT(child_id) DO UPDATE SET next_check_at=$2,catalog_revision=$3,last_checked_at=$4,failures=0,last_failure_code=NULL",[childId,next,GROWTH_CATALOG_REVISION,at]);
        if(changed) await appendOnlineChange(client,workspaceId,"growth",childId);
      });
    },
    async taskAllowed(userId:string,childId:string,taskId:string){
      return access(userId,childId,false,async(client)=>{
        const linked=(await all(client,childId)).filter(value=>value.item.taskId===taskId);
        if(!linked.length)return true;
        const loaded=await load(client,userId,childId);
        for(const {item} of linked){
          const disabled=(await client.query<TopicRow>("SELECT * FROM growth_topics WHERE child_id=$1 AND topic_id=$2",[childId,item.topicId])).rows[0]?.disabled;
          if(disabled || ["dismissed","snoozed","inapplicable"].includes(item.state) || !(await visible(item,loaded,userId)).sourceAvailable)return false;
        }return true;
      });
    },
    async backgroundInput(userId: string,childId: string,id: string,scope:GrowthWorkerScope){
      return access(userId,childId,false,async(client,workspaceId)=>{
        if(!await control(client,workspaceId,scope)) return null;
        const saved=(await all(client,childId)).find(value=>value.item.id===id);
        if(!saved || saved.item.state!=="proposed") return null;
        if((await client.query<TopicRow>("SELECT * FROM growth_topics WHERE child_id=$1 AND topic_id=$2",[childId,saved.item.topicId])).rows[0]?.disabled) return null;
        const item=await visible(saved.item,await load(client,userId,childId),userId);
        return item.sourceAvailable?item:null;
      });
    },
  };
}
export type GrowthStore=ReturnType<typeof createGrowthStore>;
