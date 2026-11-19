import type { AgentProposal, AgentProposalValue } from "../../../src/shared/product-agent.ts";
import type {
  AgentProposalDiffView,
  AgentProposalDraftEditInput,
  AgentProposalEditableDraft,
} from "../agent-view-model.ts";

function normalizeField(value: string, maxLength: number, allowEmpty: boolean): string | null {
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/** Extract inline-editable text draft metadata for proposal kinds with simple text drafts. */
export function extractProposalEditableDraft(value: AgentProposalValue): AgentProposalEditableDraft | undefined {
  switch (value.kind) {
    case "care_record_create":
      return { content: value.text, contentLabel: "建議照護記錄內容", maxContentLength: 2000 };
    case "care_record_revise":
      return {
        content: value.text,
        reason: value.reason,
        contentLabel: "建議照護記錄內容",
        reasonLabel: "更正原因",
        maxContentLength: 2000,
        maxReasonLength: 1000,
      };
    case "private_note_create":
    case "private_note_revise":
      return {
        title: value.title,
        content: value.text,
        titleLabel: "私人備註標題",
        contentLabel: "建議私人備註內容",
        maxTitleLength: 100,
        maxContentLength: 2000,
      };
    case "task_create":
      return {
        title: value.values.title,
        content: value.values.details,
        allowEmptyContent: true,
        titleLabel: "待辦標題",
        contentLabel: "待辦詳情",
        maxTitleLength: 160,
        maxContentLength: 2000,
      };
    case "memory_fact":
      return {
        title: value.key,
        content: value.content,
        titleLabel: "記憶名稱",
        contentLabel: "建議記憶內容",
        maxTitleLength: 100,
        maxContentLength: 2000,
      };
    case "memory_fact_revise":
      return {
        title: value.key,
        content: value.content,
        reason: value.reason,
        titleLabel: "更新後名稱",
        contentLabel: "建議記憶內容",
        reasonLabel: "更正原因",
        maxTitleLength: 100,
        maxContentLength: 2000,
        maxReasonLength: 500,
      };
    case "concern_create":
      return {
        title: value.values.title,
        content: value.values.observation,
        reason: value.values.reason,
        titleLabel: "關注標題",
        contentLabel: "建議共享觀察",
        reasonLabel: "關注原因",
        maxTitleLength: 160,
        maxContentLength: 2000,
        maxReasonLength: 2000,
      };
    default:
      return undefined;
  }
}

/** Validate and apply an inline draft edit while keeping target IDs, provenance, and versions intact. */
export function applyProposalDraftEdit(
  value: AgentProposalValue,
  input: AgentProposalDraftEditInput,
): AgentProposalValue | null {
  const meta = extractProposalEditableDraft(value);
  if (!meta) return null;

  const content = normalizeField(input.content, meta.maxContentLength, Boolean(meta.allowEmptyContent));
  if (content === null) return null;

  const title = meta.title !== undefined
    ? normalizeField(input.title ?? meta.title, meta.maxTitleLength ?? 160, false)
    : undefined;
  if (meta.title !== undefined && title === null) return null;

  const reason = meta.reason !== undefined
    ? normalizeField(input.reason ?? meta.reason, meta.maxReasonLength ?? 1000, false)
    : undefined;
  if (meta.reason !== undefined && reason === null) return null;

  if (
    content === meta.content
    && (title === undefined || title === meta.title)
    && (reason === undefined || reason === meta.reason)
  ) {
    return null;
  }

  switch (value.kind) {
    case "care_record_create":
      return { ...value, text: content };
    case "care_record_revise":
      return { ...value, text: content, reason: reason! };
    case "private_note_create":
    case "private_note_revise":
      return { ...value, title: title!, text: content };
    case "task_create":
      return { ...value, values: { ...value.values, title: title!, details: content } };
    case "memory_fact":
      return { ...value, key: title!, content };
    case "memory_fact_revise":
      return { ...value, key: title!, content, reason: reason! };
    case "concern_create":
      return { ...value, values: { ...value.values, title: title!, observation: content, reason: reason! } };
    default:
      return null;
  }
}

/** Build a readable before/after summary block for pending proposals. */
export function buildProposalDiff(proposal: AgentProposal): AgentProposalDiffView | null {
  if (proposal.contentState === "invalidated") return null;
  const value = proposal.value;
  switch (value.kind) {
    case "care_record_revise":
      return {
        beforeLabel: "修改前內容",
        beforeText: value.previousText ?? "原照護記錄內容需對照原版本核對",
        afterLabel: "建議修改後內容",
        afterText: value.text,
      };
    case "private_note_revise":
      return {
        beforeLabel: "修改前內容",
        beforeText: value.previousText ?? "原私人備註內容需對照原版本核對",
        afterLabel: "建議修改後內容",
        afterText: value.text,
        ...(value.previousTitle !== undefined ? { beforeTitle: value.previousTitle } : {}),
        afterTitle: value.title,
      };
    case "care_record_create":
      return {
        beforeLabel: "目前狀態",
        beforeText: "尚未建立正式照護記錄（目前只為待確認草稿）",
        afterLabel: "建議新增內容",
        afterText: value.text,
      };
    case "private_note_create":
      return {
        beforeLabel: "目前狀態",
        beforeText: "尚未建立私人備註（目前只為待確認草稿）",
        afterLabel: "建議新增內容",
        afterText: value.text,
        afterTitle: value.title,
      };
    case "memory_fact_revise":
      return {
        beforeLabel: "修改目標",
        beforeText: proposal.targetLabel
          ? `原事實：${proposal.targetLabel}（版本 ${value.expectedVersion}）`
          : `原事實版本 ${value.expectedVersion}`,
        afterLabel: "建議更正後內容",
        afterText: value.content,
        ...(proposal.targetLabel ? { beforeTitle: proposal.targetLabel } : {}),
        afterTitle: value.key,
      };
    case "memory_fact_deactivate":
      return {
        beforeLabel: "目前狀態",
        beforeText: proposal.targetLabel
          ? `使用中事實：${proposal.targetLabel}（版本 ${value.expectedVersion}）`
          : `使用中事實（版本 ${value.expectedVersion}）`,
        afterLabel: "確認後變更",
        afterText: `停用此事實（原因：${value.reason}）；保留更正歷史，不會永久刪除。`,
      };
    case "task_create":
      return {
        beforeLabel: "目前狀態",
        beforeText: "尚未建立待辦（目前只為待確認草稿）",
        afterLabel: "建議待辦內容",
        afterText: value.values.details || value.values.title,
        afterTitle: value.values.title,
      };
    case "concern_create":
      return {
        beforeLabel: "目前狀態",
        beforeText: "尚未加入持續關注（目前只為待確認草稿）",
        afterLabel: "建議共享觀察",
        afterText: value.values.observation,
        afterTitle: value.values.title,
      };
    default:
      return null;
  }
}
