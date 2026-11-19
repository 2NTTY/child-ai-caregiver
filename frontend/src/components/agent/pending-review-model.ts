import { proposalExpired, type AgentPendingDecision, type AgentReadState } from "../../agent-view-model.ts";
import type { AgentPendingDiscovery } from "../../production/ProductAgentOwner.ts";

export interface PendingShortcutSummary {
  visible: boolean;
  denied: boolean;
  readable: boolean;
  confirmableEntries: AgentPendingDiscovery["entries"];
  confirmableCount: number;
  loadedCountLabel: string | undefined;
  badgeText: string | undefined;
  accessibilityLabel: string;
  hasAttention: boolean;
}

export function isConfirmablePendingEntry(
  entry: AgentPendingDiscovery["entries"][number],
  now = Date.now(),
): boolean {
  return entry.proposal.status === "pending"
    && entry.proposal.contentState !== "invalidated"
    && !proposalExpired(entry.proposal, now);
}

/** Shared summary used by both /care and the top-right header pending shortcut. */
export function summarizePendingShortcut(input: {
  scopeKey: string | null;
  online: boolean;
  pending: AgentPendingDiscovery;
  pendingDecision: AgentPendingDecision | null;
  readState: AgentReadState;
  sharedChildActive?: boolean;
  now?: number;
}): PendingShortcutSummary {
  const visible = Boolean(input.scopeKey && !input.sharedChildActive);
  const denied = input.pending.state === "denied" || input.readState === "denied";
  const readable = !denied && (input.pending.state === "ready" || Boolean(input.pending.hasSnapshot));
  const entries = readable ? input.pending.entries : [];
  const confirmableEntries = entries.filter(entry => isConfirmablePendingEntry(entry, input.now));
  const confirmableCount = confirmableEntries.length;

  const countReady = input.online
    && !denied
    && (input.pending.state === "ready" || (input.pending.state === "loading" && Boolean(input.pending.hasSnapshot)));
  const loadedCountLabel = countReady ? `${confirmableCount}${input.pending.nextCursor ? "+" : ""}` : undefined;
  const hasCountAttention = Boolean(loadedCountLabel && (confirmableCount > 0 || Boolean(input.pending.nextCursor)));
  const badgeText = input.pendingDecision ? "!" : hasCountAttention ? loadedCountLabel : undefined;

  const accessibilityLabel = input.pendingDecision
    ? "開啟待確認草稿，有未確認操作結果待查核"
    : hasCountAttention && loadedCountLabel
      ? `開啟待確認草稿，已載入 ${loadedCountLabel} 項`
      : !input.online || input.pending.state === "failed"
        ? "開啟待確認草稿，數量尚未核對"
        : "開啟待確認草稿";

  return {
    visible,
    denied,
    readable,
    confirmableEntries,
    confirmableCount,
    loadedCountLabel,
    badgeText,
    accessibilityLabel,
    hasAttention: Boolean(input.pendingDecision) || confirmableCount > 0 || Boolean(input.pending.nextCursor),
  };
}
