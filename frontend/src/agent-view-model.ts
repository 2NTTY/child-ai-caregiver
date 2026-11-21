// Display projections only. Formal payloads and receipts remain owned by src/shared/product-agent.ts.
import type { ChatCitationView } from "./chat-view-model.ts";
export type AgentReadState = "idle" | "loading" | "ready" | "failed" | "denied";
export type AgentRunStatus = "running" | "completed" | "stopped" | "unknown";
export type AgentProposalStatus = "pending" | "accepted" | "dismissed" | "expired";
export type AgentDecisionKind = "accept" | "dismiss";
export interface AgentDetailRow { label: string; value: string }
export interface AgentProposalEditableDraft {
  title?: string;
  content: string;
  reason?: string;
  allowEmptyContent?: boolean;
  titleLabel?: string;
  contentLabel: string;
  reasonLabel?: string;
  maxTitleLength?: number;
  maxContentLength: number;
  maxReasonLength?: number;
}
export interface AgentProposalDraftEditInput {
  title?: string;
  content: string;
  reason?: string;
}
export interface AgentProposalDiffView {
  beforeLabel: string;
  beforeText: string;
  afterLabel: string;
  afterText: string;
  beforeTitle?: string;
  afterTitle?: string;
}
export interface AgentProposalView {
  id: string; version: number; status: AgentProposalStatus;
  kind: "care_record_create" | "care_record_revise" | "private_note_create" | "private_note_revise" | "family_document_change" | "task_create" | "task_change" | "memory_fact" | "memory_fact_revise" | "memory_fact_deactivate" | "private_source_create" | "private_source_change" | "concern_create" | "concern_change";
  contentState?: "ready" | "invalidated"; title: string; content: string; scope: "family" | "private";
  details: AgentDetailRow[]; createdAt: string; expiresAt: string;
  editableDraft?: AgentProposalEditableDraft;
  diff?: AgentProposalDiffView | null;
  result: { kind: "care_record" | "private_note" | "task" | "memory_fact" | "private_source" | "concern" | "family_document"; version: number; label: string } | null;
}
export type AgentCitationView = ChatCitationView;
export interface AgentRunView {
  discussion?: import('../../src/shared/chat-discussion.ts').DiscussionTranscript;
  sourceCardReadings?: import('../../src/shared/source-card-reading.ts').SourceReading[];
  sourceCardLinks?: { cardId: string; authorize: boolean }[];
  platformSeriesIds?: string[];
  showChildProfiles?: boolean;
  readOnlyStop?: boolean;
  id: string; childId: string; status: AgentRunStatus; createdAt: string | null;
  text: string; stopReasonLabel: string | null; stopReasonDetail: string | null;
  counts: { modelCalls: number; toolCalls: number; queryEmbeddings: number } | null;
  retrievalMode: "vector_keyword" | "keyword_degraded" | "not_used";
  tools: { id: string; nameLabel: string; status: "succeeded" | "rejected" | "conflict" | "failed" | "unknown"; savesCandidate: boolean }[];
  proposals: AgentProposalView[]; citations: AgentCitationView[];
  privateSourceCitations?:import("../../src/shared/product-agent.ts").PrivateSourceCitation[];
}
/** Undefined hides the knowledge panel; an empty list shows the result of a knowledge search. */
export function publicAnswerSources(run: Pick<AgentRunView, "retrievalMode" | "citations">) {
  if (!run.citations.length && run.retrievalMode === "not_used") return undefined;
  return run.citations;
}
export interface AgentPendingDecision {
  runId: string; proposalId: string;
  input: { expectedVersion: number; decision: AgentDecisionKind; confirmShared: boolean };
  reviewed: boolean; reconfirm: boolean; rejected?: boolean;
}
export interface AgentRunModel {
  online: boolean; writesBlocked?: boolean; readState: AgentReadState; busy: "read" | "write" | null;
  run: AgentRunView | null; loadedAt: string | null;
  sharedConfirmed: Record<string, boolean>; pendingDecision: AgentPendingDecision | null;
  notice: { tone: "neutral" | "saved" | "warning" | "error"; text: string } | null;
}
export interface AgentRunActions {
  refresh(): void; setSharedConfirmation(id: string, checked: boolean): void;
  decide(id: string, decision: AgentDecisionKind): void; retryOriginal(): void;
  editProposal?(id: string, input: AgentProposalDraftEditInput): Promise<boolean> | void;
  openSource(id: string): void;
}
export interface AgentInboxModel {
  online: boolean; locked: boolean; state: AgentReadState; loadedAt: string | null;
  entries: { runId: string; createdAt: string; label: string; status?: AgentRunStatus }[];
  selectedRunId: string | null;
}
export interface AgentInboxActions { refresh(): void; select(runId: string): void; collapse(): void }

export const agentRunLabels: Record<AgentRunStatus, string> = { running: "處理中", completed: "已結束", stopped: "已停止", unknown: "結果未知" };
export const agentProposalLabels: Record<AgentProposalStatus, string> = { pending: "待你確認", accepted: "已接受", dismissed: "已略過", expired: "已過期" };
export const agentToolLabels: Record<AgentRunView["tools"][number]["status"], string> = { succeeded: "成功", rejected: "已拒絕", conflict: "出現衝突", failed: "失敗", unknown: "結果未知" };
export function agentTime(value: string, timeZone = "Asia/Hong_Kong"): string {
  return new Date(value).toLocaleString("zh-HK", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function proposalExpired(proposal: AgentProposalView, now = Date.now()): boolean {
  const expires = Date.parse(proposal.expiresAt);
  return !Number.isFinite(expires) || expires <= now;
}
export function proposalDisplayStatus(proposal: AgentProposalView): string {
  if (proposal.status === "pending") {
    if (proposalExpired(proposal)) return "已過期";
    if (proposal.contentState === "invalidated") return "已失效";
  }
  return agentProposalLabels[proposal.status];
}
export function proposalNeedsConfirmation(proposal: AgentProposalView): boolean {
  return proposal.status === "pending" && proposal.contentState !== "invalidated" && !proposalExpired(proposal);
}
export function mayDecide(model: AgentRunModel, proposal: AgentProposalView, decision: AgentDecisionKind): boolean {
  return model.readState === "ready" && model.online && !model.busy && !model.pendingDecision
    && !model.writesBlocked && (decision === "dismiss" ? proposal.status === "pending" || proposal.status === "expired" : proposal.status === "pending" && proposal.contentState !== "invalidated" && !proposalExpired(proposal))
    && (decision !== "accept" || proposal.scope === "private" || !!model.sharedConfirmed[proposal.id]);
}
export function mayEditProposal(model: AgentRunModel, proposal: AgentProposalView): boolean {
  return model.readState === "ready" && model.online && !model.busy && !model.pendingDecision
    && !model.writesBlocked && proposalNeedsConfirmation(proposal) && !!proposal.editableDraft;
}
export function mayCheckShared(model: AgentRunModel, proposal: AgentProposalView): boolean {
  const pending = model.pendingDecision;
  return model.readState === "ready" && model.online && !model.busy && !model.writesBlocked
    && proposal.status === "pending" && proposal.contentState !== "invalidated" && !proposalExpired(proposal)
    && (!pending || pending.reviewed && pending.runId === model.run?.id && pending.proposalId === proposal.id
      && pending.input.decision === "accept" && pending.input.expectedVersion === proposal.version);
}
export function mayRetryOriginal(model: AgentRunModel): boolean {
  const pending = model.pendingDecision;
  const proposal = model.run?.proposals.find(item => item.id === pending?.proposalId);
  return !!pending && !!proposal && pending.runId === model.run?.id && pending.reviewed && !pending.reconfirm
    && model.readState === "ready" && model.online && !model.busy
    && !model.writesBlocked && (pending.input.decision === "dismiss" ? proposal.status === "pending" || proposal.status === "expired" : proposal.status === "pending" && proposal.contentState !== "invalidated" && !proposalExpired(proposal)) && proposal.version === pending.input.expectedVersion
    && (pending.input.decision !== "accept" || proposal.scope === "private" || !!model.sharedConfirmed[proposal.id]);
}
