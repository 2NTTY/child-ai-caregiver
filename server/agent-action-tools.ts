import { z } from "zod";
import { agentDirectActionSchema, agentActionToolNames } from "../src/shared/agent-actions.ts";
import type { AgentTool, AgentRunContext } from "./agent-runtime.ts";
import type { AgentActionsStore } from "./agent-actions-store.ts";
import { FamilyError } from "./family-access.ts";
import { FirestoreDomainError } from './firestore-domain-data.ts';
import { AgentStopped } from "./agent-budget.ts";
import { groundedRecordTime } from "./agent-record-time.ts";

export function createAgentActionTools(actions: AgentActionsStore, run: AgentRunContext,
  authorize: () => Promise<boolean>): AgentTool[] {
  const { userId, childId } = run.scope;
  return [
    { name: "read_care_records", description: "搜尋目前孩子的已保存照護記錄及原版本；query 可為空。更正前以結果核對 id、version、authorUserId及種類，不猜是哪一筆。moreAvailable=true 時請縮窄查詢，不宣稱已讀完。記錄是家庭共享資料，confirmationBasis 區分預授權陳述與逐項確認。",
      parameters: z.object({ query: z.string().max(200) }), authorize,
      execute: async args => {
        const page = await actions.records(userId, childId, args.query as string);
        if (!page) throw new AgentStopped("unauthorized");
        const records = []; let size = 0;
        for (const item of page.records) { const length = JSON.stringify(item).length; if (size + length > 6000) break; records.push(item); size += length; }
        return { status: "succeeded", data: { records, moreAvailable: records.length < page.records.length || page.nextCursor !== null } };
      } },
    { name: "read_private_instructions",
      description: "已知主題鍵時用 memoryKeys 直接讀原項（query 空、afterId=null）；未命中只代表該鍵，舊無鍵資料及同義可用 query 有界搜尋。按主題搜尋本人預授權保存的普通交代，query 可為空；這些是使用者陳述，不是已確認健康事實。只有本人可讀，不得用於家庭背景通知或披露給其他人。按 nextAfterId 續讀，不宣稱已讀未提供內容。",
      parameters: z.object({ query: z.string().max(200), afterId: z.uuid().nullable(), memoryKeys: z.array(z.string().min(1).max(100)).min(1).max(4).optional() }), authorize,
      execute: async args => {
        if (args.memoryKeys) {
          if (!actions.notesByKeys) return { status: "failed", data: { code: "memory_lookup_unavailable" } };
          if (args.afterId || args.query) return { status: "rejected", data: { code: "invalid_input" } };
          const result = await actions.notesByKeys(userId, childId, args.memoryKeys as string[]);
          if (JSON.stringify(result).length > Math.min(6000, run.budget.toolResponseCharacters - 900))
            return { status: "rejected", data: { code: "response_limit", nextAction: "縮窄主題鍵再讀，不把未回傳內容當作不存在。" } };
          return { status: "succeeded", data: { ...result, lookup: "exact_current_keys", nextAfterId: null } };
        }
        const page = await actions.notes(userId, childId, args.query as string, args.afterId as string | undefined ?? undefined);
        if (!page) throw new AgentStopped("unauthorized");
        const items = []; let size = 0;
        for (const note of page.items) {
          const length = JSON.stringify(note).length;
          if (size + length > 6000) break;
          items.push(note); size += length;
        }
        return { status: "succeeded", data: { items,
          nextAfterId: items.length < page.items.length ? items.at(-1)?.id ?? null : page.nextAfterId,
          incomplete: items.length < page.items.length || page.nextAfterId !== null } };
      } },
    ...agentDirectActionSchema.options.map(schema => {
      const { kind, ...shape } = schema.shape;
      const actionKind = kind.value;
      return { name: agentActionToolNames[actionKind],
      description: ({ save_record: "保存目前政策允許類別的普通照護記錄；details 不含推斷。只有當前或 sourceMessages 引用的本人原文明確數量才填 quantity，quantityEvidence 逐字引用數量片語；未提供均填 null，不把一句敘述算成一次，不換算或求和，保留約數。相對日期保留 approximate 與原文；回報以 Server 實際保存欄位為準。",
        revise_record: "更正本人原有、相同普通類別的照護記錄。先 read_care_records 查原 id/version；明確說明 reason，保留未更改內容，不能變更其他人記錄或重要健康資料。",
        save_private_note: "保存本人明確交代的普通私人備註，屬 user_statement，不是已確認健康事實。先查原項；穩定偏好／事情用 memoryKey（沿已讀原鍵，同義不另開）。不同時期事件使用各自事情鍵或照護記錄，不為湊鍵捏造日期。相同鍵及正文返回 memoryOutcome=duplicate／原版本，不新增；同鍵不同內容須讀回後 revise_private_instruction，不能換鍵繞過衝突。",
        revise_private_note: "更正指定本人私人備註，先查原 ID 與版本並保留未更改內容；舊無鍵交代可同次補 memoryKey，已有鍵保持不變，不另建相似副本。",
        create_self_task: "建立本人清楚指定、時間明確的普通提醒；醫療預約及其他人的任務用候選。",
        change_self_task: "完成、取消或改期指定本人普通提醒；先查原 ID 與版本，收到不等於完成。" }[actionKind])
        + " 僅有效 operationPolicy 涵蓋的本次指令；sourceQuote 逐字引用本次使用者訊息；sourceMessages 可附最多六項已讀本人原訊息的 ID／逐字 quote 補資料，不能充當新的執行授權，遵從最新改口。expectedPolicyVersion 取 Server 政策。參數直接放最外層，不加 action 包裝或 kind。結果只按 receipt 回報，未授權外發不能稱已通知。",
      // Each native tool has one concrete shape; the shared business union retains all refinements.
      parameters: z.object(shape), authorize,
      execute: async (args, call) => {
        try {
          const action = agentDirectActionSchema.parse({ ...args, kind: actionKind });
          const receipt = await actions.execute(run.scope, run.runId, call.callId, action);
          if (!receipt) throw new AgentStopped("unauthorized");
          return { status: "succeeded", reference: receipt.id, data: { receipt,
            ...(action.kind === "save_record" ? { savedEventTime: groundedRecordTime(action.details, [action.sourceQuote, ...(action.sourceMessages ?? []).map(item => item.quote)].join("\n")).eventTime } : {}) } };
        } catch (error) {
          if (error instanceof z.ZodError) return { status: "rejected", data: { code: "invalid_input" } };
          if (error instanceof FamilyError || error instanceof FirestoreDomainError) return { status: error.status === 409 ? "conflict" : error.status >= 500 ? "failed" : "rejected",
            data: { code: error.code, nextAction: "重新核對目前授權及原操作；不要換 ID 重複執行，不把拒絕寫成成功。" } };
          throw error;
        }
      } } satisfies AgentTool;
    }),
  ];
}
