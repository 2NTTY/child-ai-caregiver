import type { AgentDetailRow, AgentProposalView } from "../../agent-view-model";
import type { AppIconName } from "../AppIcon";

// Display-only, exact-schema mappings. Unrecognised rows stay visible verbatim.
const supportingLabels: Partial<Record<AgentProposalView["kind"], readonly string[]>> = {
  memory_fact_revise: ["原事實與版本", "本人原話參照"],
  memory_fact_deactivate: ["原事實與版本"],
  family_document_change: ["原文件及版本"],
  task_change: ["原任務版本"],
  private_source_change: ["來源及原版本"],
  concern_change: ["原關注與版本"],
};

export const proposalDestinationIcons: Record<AgentProposalView["kind"], AppIconName> = {
  task_create: "clipboard-check-outline", task_change: "clipboard-check-outline",
  family_document_change: "file-document-outline",
  memory_fact: "notebook-outline", memory_fact_revise: "notebook-outline", memory_fact_deactivate: "notebook-outline",
  private_source_create: "link-variant", private_source_change: "link-variant",
  concern_create: "eye", concern_change: "eye",
};

const rowIcons: Record<string, AppIconName> = {
  "操作": "pencil-outline", "種類": "clipboard-check-outline", "負責人": "account-outline",
  "負責人識別": "account-outline", "新負責人識別": "account-outline", "原任務": "clipboard-check-outline",
  "到期時間": "calendar-clock-outline", "新到期時間": "calendar-clock-outline", "時區": "clock-outline",
  "有效至": "clock-outline", "觀察時間": "calendar-clock-outline", "一次站內跟進": "calendar-clock-outline",
  "接受後可見範圍": "eye", "範圍": "shield-check-outline", "邊界": "shield-check-outline",
  "明確授權交模型的片段": "shield-check-outline", "用途": "information-outline",
  "適用性聲稱": "information-outline", "來源連結": "link-variant", "關聯": "link-variant",
  "更新後名稱": "pencil-outline", "原因": "message-text-outline", "覆核為": "clipboard-check-outline",
};

export function proposalDetailIcon(label: string): AppIconName {
  return Object.hasOwn(rowIcons, label) ? rowIcons[label] : "information-outline";
}

export function proposalDetailIsChange(kind: AgentProposalView["kind"], label: string): boolean {
  if (kind === "task_change") return ["操作", "新到期時間", "新負責人識別", "覆核為"].includes(label);
  if (kind === "concern_create" || kind === "concern_change") return label === "將共享的觀察";
  if (kind === "private_source_create" || kind === "private_source_change") return label === "將保存的原文";
  if (kind === "family_document_change") return /^[1-9]\d*\. (修改文件資料|新增／修改章節|移除章節|移動章節|新增／修改項目|移除項目|移動項目)$/u.test(label);
  return false;
}

export function proposalContextLabel(proposal: AgentProposalView): string {
  if (proposal.kind === "task_create") return `新增待辦 · ${proposal.title}`;
  if (proposal.kind === "family_document_change") return `修改文件 · ${proposal.title}`;
  if (["task_change", "memory_fact_revise", "memory_fact_deactivate", "private_source_create", "private_source_change"].includes(proposal.kind)) {
    const operation = proposal.details.find(detail => detail.label === "操作");
    if (operation) return `${operation.value} · ${proposal.title}`;
  }
  return proposal.title;
}

export function proposalPrimaryText(proposal: AgentProposalView): string {
  const changes = proposal.details.filter(detail => proposalDetailIsChange(proposal.kind, detail.label));
  return changes.length ? changes.map(detail => detail.value).join("\n\n") : proposal.content;
}

export function proposalDetailGroups(proposal: AgentProposalView): { visible: AgentDetailRow[]; supporting: AgentDetailRow[] } {
  const visible: AgentDetailRow[] = [], supporting: AgentDetailRow[] = [];
  for (const detail of proposal.details) {
    // The same visibility is already stated beside the lock/group icon. A mismatch is never hidden.
    if (proposal.kind === "memory_fact" && detail.label === "接受後可見範圍"
      && detail.value === (proposal.scope === "family" ? "家庭共享" : "只限你本人")) continue;
    if (supportingLabels[proposal.kind]?.includes(detail.label)) supporting.push(detail);
    else visible.push(detail);
  }
  return { visible, supporting };
}
