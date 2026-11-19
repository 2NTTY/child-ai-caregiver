import { z } from "zod";
import type { CareRecord } from "../src/shared/care.ts";
import type { AgentPrivateNote } from "../src/shared/agent-actions.ts";
import { agentDirectActionSchema, agentActionToolNames, allowsDirectActionByPolicy, type AgentDirectAction } from "../src/shared/agent-actions.ts";
import type { AgentTool, AgentRunContext } from "./agent-runtime.ts";
import type { AgentActionsStore } from "./agent-actions-store.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import { prepareProposalConfirmation } from "./agent-work-tools.ts";
import { agentProposalSchema, type AgentProposalValue } from "../src/shared/product-agent.ts";
import { FamilyError } from "./family-access.ts";
import { FirestoreDomainError } from './firestore-domain-data.ts';
import { AgentStopped } from "./agent-budget.ts";
import { groundedRecordTime } from "./agent-record-time.ts";

export type AgentActionReaders = Pick<AgentActionsStore, "records" | "notes" | "notesByKeys" | "recordById" | "noteById">;

type ExactHouseholdItem = AgentPrivateNote | CareRecord;
export type RegisterHouseholdRead = (kind: "note" | "record", item: ExactHouseholdItem,
  reread: () => Promise<ExactHouseholdItem | null>) => string;

export function createAgentActionReadTools(actions: AgentActionReaders, run: AgentRunContext,
  authorize: () => Promise<boolean>, register?: RegisterHouseholdRead): AgentTool[] {
  const { userId, childId } = run.scope;
  return [
    { name: "read_care_records", effect: "read", description: "搜尋目前孩子的已保存照護記錄及原版本；query 可為空。更正前以結果核對 id、version、authorUserId及種類，不猜是哪一筆。moreAvailable=true 時請縮窄查詢，不宣稱已讀完。記錄是家庭共享資料，confirmationBasis 區分預授權陳述與逐項確認。",
      parameters: z.object({ query: z.string().max(200).optional(), id: z.uuid().optional().describe("已知的 care_record id，可直接讀取該筆。") }), authorize,
      execute: async args => {
        if (args.id) {
          if (args.query) return { status: "rejected", data: { code: "invalid_input" } };
          if (!actions.recordById) return { status: "failed", data: { code: "record_lookup_unavailable" } };
          const record = await actions.recordById(userId, childId, args.id as string);
          if (record && JSON.stringify(record).length > Math.min(6000, run.budget.toolResponseCharacters - 900))
            return { status: "rejected", data: { code: "response_limit" } };
          const citationId = record && register?.("record", record, () => actions.recordById!(userId, childId, record.id));
          return { status: "succeeded", data: { records: record ? [record] : [], ...(citationId ? { citationId } : {}), moreAvailable: false, lookup: "exact_id" } };
        }
        const page = await actions.records(userId, childId, (args.query ?? "") as string);
        if (!page) throw new AgentStopped("unauthorized");
        const records = []; let size = 0;
        for (const item of page.records) { const length = JSON.stringify(item).length; if (size + length > 6000) break; records.push(item); size += length; }
        return { status: "succeeded", data: { records, moreAvailable: records.length < page.records.length || page.nextCursor !== null } };
      } },
    { name: "read_private_instructions",
      effect: "read",
      description: "已知 private_note 的 id 時直接讀該筆；已知主題鍵時用 memoryKeys 查原項。也可用 query 搜尋並按 nextAfterId 續讀。交代是使用者陳述，只供該家長的私人主聊天和已授權巡查使用。不可在共享家庭背景或向其他人披露。",
      parameters: z.object({ query: z.string().max(200).optional(), afterId: z.uuid().nullish(), id: z.uuid().optional(), memoryKeys: z.array(z.string().min(1).max(100)).min(1).max(4).optional() }), authorize,
      execute: async args => {
        if (args.id) {
          if (args.query || args.afterId || args.memoryKeys) return { status: "rejected", data: { code: "invalid_input" } };
          if (!actions.noteById) return { status: "failed", data: { code: "note_lookup_unavailable" } };
          const note = await actions.noteById(userId, childId, args.id as string);
          if (note && JSON.stringify(note).length > Math.min(6000, run.budget.toolResponseCharacters - 900))
            return { status: "rejected", data: { code: "response_limit" } };
          const citationId = note && register?.("note", note, () => actions.noteById!(userId, childId, note.id));
          return { status: "succeeded", data: { items: note ? [note] : [], ...(citationId ? { citationId } : {}), nextAfterId: null, incomplete: false, lookup: "exact_id" } };
        }
        if (args.memoryKeys) {
          if (!actions.notesByKeys) return { status: "failed", data: { code: "memory_lookup_unavailable" } };
          if (args.afterId || args.query) return { status: "rejected", data: { code: "invalid_input" } };
          const result = await actions.notesByKeys(userId, childId, args.memoryKeys as string[]);
          if (JSON.stringify(result).length > Math.min(6000, run.budget.toolResponseCharacters - 900))
            return { status: "rejected", data: { code: "response_limit", nextAction: "縮窄主題鍵再讀，不把未回傳內容當作不存在。" } };
          return { status: "succeeded", data: { ...result, lookup: "exact_current_keys", nextAfterId: null } };
        }
        const page = await actions.notes(userId, childId, (args.query ?? "") as string, args.afterId as string | undefined ?? undefined);
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
  ];
}

async function mapDirectActionToProposal(
  action: AgentDirectAction,
  actions: AgentActionsStore,
  run: AgentRunContext,
): Promise<AgentProposalValue> {
  switch (action.kind) {
    case "save_record":
      return {
        kind: "care_record_create",
        text: action.text,
        details: action.details,
        sourceQuote: action.sourceQuote,
        ...(action.sourceBasis ? { sourceBasis: action.sourceBasis } : {}),
        ...(action.quantityEvidence !== undefined ? { quantityEvidence: action.quantityEvidence } : {}),
      };
    case "revise_record": {
      const prior = await actions.recordById?.(run.scope.userId, run.scope.childId, action.recordId).catch(() => null);
      return {
        kind: "care_record_revise",
        recordId: action.recordId,
        expectedVersion: action.expectedVersion,
        text: action.text,
        details: action.details,
        reason: action.reason,
        sourceQuote: action.sourceQuote,
        ...(action.sourceBasis ? { sourceBasis: action.sourceBasis } : {}),
        ...(action.quantityEvidence !== undefined ? { quantityEvidence: action.quantityEvidence } : {}),
        ...(prior?.text ? { previousText: prior.text } : {}),
      };
    }
    case "save_private_note":
      return {
        kind: "private_note_create",
        title: action.title,
        text: action.text,
        ...(action.memoryKey ? { memoryKey: action.memoryKey } : {}),
        sourceQuote: action.sourceQuote,
      };
    case "revise_private_note": {
      const prior = await actions.noteById?.(run.scope.userId, run.scope.childId, action.noteId).catch(() => null);
      return {
        kind: "private_note_revise",
        noteId: action.noteId,
        expectedVersion: action.expectedVersion,
        title: action.title,
        text: action.text,
        ...(action.memoryKey ? { memoryKey: action.memoryKey } : {}),
        sourceQuote: action.sourceQuote,
        ...(prior?.title ? { previousTitle: prior.title } : {}),
        ...(prior?.text ? { previousText: prior.text } : {}),
      };
    }
    case "create_self_task":
      return {
        kind: "task_create",
        values: {
          title: action.title,
          details: action.details,
          kind: "ordinary",
          assigneeUserId: run.scope.userId,
          dueAt: action.dueAt,
          timeZone: action.timeZone,
        },
      };
    case "change_self_task":
      return {
        kind: "task_change",
        taskId: action.taskId,
        change: action.action === "reschedule"
          ? {
            action: "reschedule",
            expectedVersion: action.expectedVersion,
            confirm: true,
            dueAt: action.dueAt!,
            timeZone: action.timeZone!,
            assigneeUserId: run.scope.userId,
            note: action.note,
          }
          : {
            action: action.action,
            expectedVersion: action.expectedVersion,
            confirm: true,
            note: action.note,
          },
      };
  }
}

export function createAgentActionTools(
  actions: AgentActionsStore,
  run: AgentRunContext,
  authorize: () => Promise<boolean>,
  proposals?: Pick<ProductAgentStore, "propose" | "requestConfirmation">,
): AgentTool[] {
  return [
    ...createAgentActionReadTools(actions, run, authorize),
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
        + " 僅有效 operationPolicy 涵蓋的本次指令；sourceQuote 逐字引用本次使用者文字訊息；本次附有原錄音時可填 sourceBasis=voice_interpretation，sourceQuote 寫清楚聽到的片語（AI 辨識，非文字原文），聽不清不能猜；sourceMessages 可附最多六項已讀本人原訊息的 ID／逐字 quote 補資料，不能充當新的執行授權，遵從最新改口。expectedPolicyVersion 取 Server 政策；若目前政策為先確認或未涵蓋該動作，Server 會先建立待確認草稿，不會直接正式保存。參數直接放最外層，不加 action 包裝或 kind。結果只按 receipt 或 proposal 回報，未授權外發不能稱已通知。",
      // Each native tool has one concrete shape; the shared business union retains all refinements.
      parameters: z.object(shape), authorize,
      execute: async (args, call) => {
        try {
          const action = agentDirectActionSchema.parse({ ...args, kind: actionKind });
          if (typeof proposals?.propose === "function" && typeof actions.policy === "function") {
            const currentPolicy = await actions.policy(run.scope.userId, run.scope.childId);
            if (!currentPolicy) throw new AgentStopped("unauthorized");
            if (action.expectedPolicyVersion !== currentPolicy.version) {
              return {
                status: "conflict",
                data: {
                  code: "agent_policy_changed",
                  formalSave: false,
                  nextAction: "重新讀取目前授權及版本；不要沿用舊版本寫入或繞過核對。",
                },
              };
            }
            const gate = allowsDirectActionByPolicy(currentPolicy, action);
            if (!gate.allowed) {
              if (gate.reason === "policy_inactive") {
                return {
                  status: "conflict",
                  data: {
                    code: "agent_policy_changed",
                    formalSave: false,
                    nextAction: "目前授權設定已因權限或環境改變而失效；停止自動保存並重新核對授權。",
                  },
                };
              }
              const proposalValue = agentProposalSchema.parse(await mapDirectActionToProposal(action, actions, run));
              const proposal = await proposals.propose(run.scope, run.runId, call.callId, proposalValue);
              if (!proposal) throw new AgentStopped("unauthorized");
              const preparedProposal = await prepareProposalConfirmation(proposals as ProductAgentStore, run, proposal);
              return {
                status: "succeeded",
                reference: preparedProposal.id,
                data: {
                  mode: "confirm_first_draft",
                  formalSave: false,
                  confirmationRequired: true,
                  confirmationPrepared: preparedProposal.confirmationPrepared === true,
                  reason: gate.reason,
                  proposal: preparedProposal,
                },
              };
            }
          }
          const receipt = await actions.execute(run.scope, run.runId, call.callId, action);
          if (!receipt) throw new AgentStopped("unauthorized");
          return { status: "succeeded", reference: receipt.id, data: { mode: "auto_saved", formalSave: true, receipt,
            ...(action.kind === "save_record" ? { savedEventTime: groundedRecordTime(action.details, [action.sourceQuote, ...(action.sourceMessages ?? []).map(item => item.quote)].join("\n")).eventTime } : {}) } };
        } catch (error) {
          if (error instanceof z.ZodError) return { status: "rejected", data: { code: "invalid_input" } };
          if (error instanceof FamilyError || error instanceof FirestoreDomainError) return { status: error.status === 409 ? "conflict" : error.status >= 500 ? "failed" : "rejected",
            data: { code: error.code, formalSave: false, nextAction: "重新核對目前授權及原操作；不要換 ID 重複執行，不把拒絕寫成成功。" } };
          throw error;
        }
      } } satisfies AgentTool;
    }),
  ];
}
