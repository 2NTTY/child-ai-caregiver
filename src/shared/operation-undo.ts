/**
 * Explicit capability inventory for history reversal vs cancelling unexecuted drafts.
 * Only actually implemented actions are listed; unsupported full rollback stays explicit.
 */
export const DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY =
  "「取消」只會放棄這份尚未提交的待確認草稿，不會撤銷任何已正式保存的歷史操作。";

export type OperationResourceKind =
  | "care_record"
  | "private_note"
  | "task"
  | "memory_fact"
  | "family_document"
  | "concern"
  | "private_source";

export interface OperationUndoCapability {
  resourceKind: OperationResourceKind;
  reversible: boolean;
  mechanism: "delete" | "cancel" | "deactivate" | "archive" | "revise_only" | "unsupported";
  label: string;
  limitation: string;
}

export const OPERATION_UNDO_CAPABILITIES: Readonly<Record<OperationResourceKind, OperationUndoCapability>> = Object.freeze({
  private_note: {
    resourceKind: "private_note",
    reversible: true,
    mechanism: "delete",
    label: "可刪除原私人備註",
    limitation: "刪除會移除當前備註並保留刪除識別收據；已產生的相關摘要須重新整理，不會自動復原刪除內容。",
  },
  task: {
    resourceKind: "task",
    reversible: true,
    mechanism: "cancel",
    label: "可取消尚未完成的待辦",
    limitation: "只可把待辦標記為取消，並解除相關到期提醒授權；已完成或外發通知不會回收。",
  },
  memory_fact: {
    resourceKind: "memory_fact",
    reversible: true,
    mechanism: "deactivate",
    label: "可停用或更正記憶事實",
    limitation: "停用會使事實不再參與召回並保留更正／停用紀錄，不是物理清除歷史版本。",
  },
  family_document: {
    resourceKind: "family_document",
    reversible: true,
    mechanism: "archive",
    label: "可歸檔家庭文件",
    limitation: "歸檔或再次修改版本可收起文件，不能把先前快照從版本紀錄抹除。",
  },
  concern: {
    resourceKind: "concern",
    reversible: true,
    mechanism: "archive",
    label: "可結束持續關注",
    limitation: "結束關注只關閉後續追蹤，不會刪除先前已記錄的共享觀察或相關待辦。",
  },
  private_source: {
    resourceKind: "private_source",
    reversible: true,
    mechanism: "deactivate",
    label: "可停用私人來源",
    limitation: "停用會停止後續模型讀取與使用，但已產生的歷史回答不會自動刪除。",
  },
  care_record: {
    resourceKind: "care_record",
    reversible: false,
    mechanism: "revise_only",
    label: "無歷史一鍵撤銷（可更正）",
    limitation: "已保存的照護記錄會寫入共享修訂紀錄；可再提交更正版本，不提供全站通用撤銷。",
  },
});

export function describeOperationUndoCapability(kind: OperationResourceKind): OperationUndoCapability {
  return OPERATION_UNDO_CAPABILITIES[kind];
}
