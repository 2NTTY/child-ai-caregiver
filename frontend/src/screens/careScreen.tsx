import { EmptyListCard } from "../components/EmptyListCard";
import { useEffect, useRef, useState, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useLocalSearchParams, useRouter, usePathname } from "expo-router";
import { careKindOptions, type CareKind } from "../care-view-model";
import { useQuietReadFocus } from "../components/useQuietReadFocus";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { PageFrame } from "../components/PageFrame";
import { CareRecordsView } from "../components/care/CareRecordsView";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { agentTime, proposalExpired, type AgentProposalView } from "../agent-view-model";
import type { AgentPendingDiscovery } from "../production/ProductAgentOwner";
import { AppIcon } from "../components/AppIcon";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { proposalContextLabel, proposalPrimaryText } from "../components/agent/proposal-presentation";
import { AgentRunView, type ActivityProposalTarget } from "../components/agent/AgentRunView";
import { AppButton, SectionCard } from "../components/ui";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useDomainEnvironment } from "../production/useDomainEnvironment";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { PhotoWorkspace } from "./photosScreen";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";

function confirmablePending(entry: AgentPendingDiscovery["entries"][number]) {
  return entry.proposal.status === "pending" && entry.proposal.contentState !== "invalidated" && !proposalExpired(entry.proposal);
}

function CareCreateButton({ buttonRef, disabled, onPress }: { buttonRef: Ref<View>; disabled: boolean; onPress(): void }) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  return <Pressable ref={buttonRef} testID="care-manual-create" accessibilityRole="button" accessibilityLabel="手動新增共享記錄"
    accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.manualCreate, focused && styles.manualCreateFocused, (hovered || pressed) && !disabled && styles.manualCreateFocused, disabled && styles.cardDisabled]}>
    <Text style={styles.manualCreateLabel}>新增記錄</Text>
  </Pressable>;
}

function PendingCard({ runId, proposal, disabled, quietRefresh, onPress, cardRef }: { runId: string; proposal: AgentProposalView; disabled: boolean; quietRefresh: boolean; onPress(): void; cardRef(node: View | null): void }) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const readFocus = useQuietReadFocus(disabled, quietRefresh);
  const status = proposal.status === "expired" || proposalExpired(proposal) ? "已過期" : proposal.contentState === "invalidated" ? "內容需重新核對" : "待你確認";
  return <Pressable ref={node => { readFocus.host.current = node; cardRef(node); }} testID={`care-pending-card-${runId}-${proposal.id}`} accessibilityRole="button"
    accessibilityLabel={`核對：${proposalPrimaryText(proposal)}；${proposalContextLabel(proposal)}；${status}`}
    accessibilityState={{ disabled }} aria-disabled={disabled} disabled={readFocus.nativeDisabled} onPress={() => { if (!disabled) onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.proposalCard, hovered && !disabled && styles.cardHighlighted, focused && styles.cardFocused, pressed && !disabled && styles.cardHighlighted, disabled && !readFocus.preserveWebFocus && styles.cardDisabled]}>
    <View style={styles.proposalCopy}><View style={styles.cardLabels}><Text style={[styles.meta, styles.cardKind]}>{proposalContextLabel(proposal)}</Text><AppStatusBadge label={status} tone="warning" /></View>
      <Text numberOfLines={3} style={styles.cardContent}>{proposalPrimaryText(proposal)}</Text>
      <View style={styles.cardMeta}><AppIcon name="clock-outline" size={14} /><Text style={[styles.meta, styles.cardTime]}>{Number.isFinite(Date.parse(proposal.createdAt)) ? `提出於 ${agentTime(proposal.createdAt)}` : "提出時間未知"} · {proposal.scope === "family" ? "家庭共享" : "本人"}</Text></View>
    </View><AppIcon name="chevron-right" size={20} color={colors.teal} />
  </Pressable>;
}

export function AgentPendingReview() {
  const { scopeKey, selectedChildId, online, agentPending, agentModel, agentActions, readAgentPending, selectAgentRun } = useProduction();
  const workspace = useCareWorkspace(), recovery = useProductionCareProfile();
  const [opened, setOpened] = useState<{ scope: string; runId: string; cardKey: string; target?: ActivityProposalTarget } | null>(null);
  const leave = usePreviewNavigation(), listRef = useRef<View | null>(null), rowRefs = useRef(new Map<string, View>());
  const visible = !!opened && opened.scope === scopeKey;
  const validSelection = visible && agentModel.run?.id === opened.runId && agentModel.run.childId === selectedChildId;
  const current = useRef({ scopeKey, opened, visible }); current.current = { scopeKey, opened, visible };
  const mounted = useRef(true), returnAnchor = useRef<{ scope: string; cardKey: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The app-level owner retains unresolved decisions across closing and navigation.
  usePreviewLeaveGuard(false, visible && agentModel.busy === "write", "child", undefined, true);
  const close = () => leave(() => {
    if (!mounted.current || current.current.scopeKey !== scopeKey || current.current.opened !== opened) return;
    returnAnchor.current = opened; setOpened(null);
  });
  const closed = () => {
    const anchor = returnAnchor.current; returnAnchor.current = null;
    if (mounted.current && !current.current.visible && anchor?.scope === current.current.scopeKey && Platform.OS === "web") {
      const host = rowRefs.current.get(anchor.cardKey) as unknown as HTMLElement | undefined;
      const target = host?.matches?.('button,[role="button"]') ? host : host?.querySelector<HTMLElement>('button,[role="button"]');
      if (target?.isConnected) target.focus();
      else (listRef.current as unknown as HTMLElement | null)?.focus?.();
    }
  };
  useEffect(() => { returnAnchor.current = null; setOpened(null); if (scopeKey && online) readAgentPending(); }, [scopeKey, online]);
  const careLocked = !!recovery?.pending || !!workspace?.model.draft || !!workspace?.model.deletion;
  const locked = careLocked || !!agentModel.writesBlocked;
  const denied = agentPending.state === "denied" || agentModel.readState === "denied";
  const readable = !denied && (agentPending.state === "ready" || !!agentPending.hasSnapshot);
  const entries = readable ? agentPending.entries : [];
  const pending = entries.filter(confirmablePending);
  const original = agentModel.pendingDecision;
  const canOpen = (runId: string, proposalId: string) => !!scopeKey && online && !denied && !agentModel.busy && !careLocked
    && (original ? original.runId === runId && original.proposalId === proposalId : !locked);
  const ref = (key: string, node: View | null) => { if (node) rowRefs.current.set(key, node); else rowRefs.current.delete(key); };
  const open = (runId: string, proposalId: string, cardKey: string, proposal?: AgentProposalView) => {
    if (!canOpen(runId, proposalId)) return;
    setOpened({ scope: scopeKey!, runId, cardKey, target: proposal ? { runId, id: proposal.id, version: proposal.version, kind: proposal.kind, scope: proposal.scope } : undefined });
    if (original) agentActions.refresh();
    else selectAgentRun(runId);
  };
  const quietRefresh = online && !!agentPending.hasSnapshot && agentModel.busy === "read" && !denied && !locked && !original;
  const cards = (items: typeof entries) => items.map(({ runId, proposal }) => {
    const key = `${runId}:${proposal.id}`;
    return <PendingCard key={key} runId={runId} proposal={proposal} disabled={!canOpen(runId, proposal.id)} quietRefresh={quietRefresh} cardRef={node => ref(key, node)} onPress={() => open(runId, proposal.id, key, proposal)} />;
  });
  const recoveryKey = original ? `recovery:${original.runId}:${original.proposalId}` : "";
  return <View ref={listRef} tabIndex={-1} accessibilityLabel="待確認事項" testID="care-agent-pending" style={styles.pendingList}>
    {agentPending.state === "idle" ? <Text style={styles.meta}>{online ? "待確認事項尚未讀取。" : "目前離線，待確認事項尚未核對。"}</Text> : null}
    {agentPending.state === "loading" ? <ReadStateNotice state="loading" scopeKey={scopeKey ?? undefined} refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : null}
    {agentPending.state === "failed" ? <><Text style={styles.meta}>{agentPending.hasSnapshot ? "未能更新；顯示上次資料，數量尚未核對。" : "未能讀取待確認事項，請重試。"}</Text><AppButton label="重試讀取待確認事項" variant="quiet" disabled={!online || locked || !!agentModel.busy || !!original} onPress={() => readAgentPending()} /></> : null}
    {denied ? <Text style={styles.meta}>目前沒有權限查看這個孩子的待確認事項。</Text> : null}
    {!online && readable ? <Text style={styles.meta}>目前離線；以下只代表上次載入的資料，待確認數量尚未核對。</Text> : null}
    {agentPending.nextCursor && !denied ? <Text testID="care-pending-more" style={styles.meta}>只計已載入可確認項；還有更多。</Text> : null}
    {pending.length ? <View testID="care-pending-grid" style={styles.cardGrid}>{cards(pending)}</View> : null}
    {(agentPending.state === "ready" || agentPending.state === "loading" && agentPending.hasSnapshot) && online && !denied && !pending.length && !original ? <EmptyListCard title={agentPending.nextCursor ? "已載入頁面暫無可確認事項" : "暫無可確認事項"} /> : null}
    {original && !denied ? <View style={styles.pendingList}><Text style={styles.meta}>結果待查</Text>
      {!pending.some(entry => entry.runId === original.runId && entry.proposal.id === original.proposalId) ? <AppButton ref={node => ref(recoveryKey, node)}
        label="查核原決定" variant="secondary" disabled={!canOpen(original.runId, original.proposalId)} onPress={() => open(original.runId, original.proposalId, recoveryKey, agentModel.run?.id === original.runId ? agentModel.run.proposals.find(proposal => proposal.id === original.proposalId) : undefined)} /> : null}
    </View> : null}
    {agentPending.nextCursor && !denied ? <AppButton label="載入較早待確認事項" variant="quiet" disabled={!online || !!agentModel.busy || !!original || locked} onPress={() => readAgentPending(true)} /> : null}
    <AppDialog visible={visible} accessibilityLabel="核對事項詳情" onDismiss={close} onClosed={closed} style={styles.resultDialog}>
      <AppDialog.Title>核對事項詳情</AppDialog.Title>
      <AppDialog.ScrollArea style={styles.resultScroll}><AppScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultContent}>
        {visible && (validSelection || original?.runId === opened.runId) ? <AgentRunView model={{ ...agentModel, writesBlocked: agentModel.writesBlocked || locked }} actions={agentActions} proposalTarget={opened.target} proposalOnly preserveDecisionFocusOnRead={quietRefresh && agentPending.state === "loading"} />
          : visible ? <Text>{agentModel.readState === "failed" ? "原提案未能讀回，不能沿用清單文字提交。" : agentModel.readState === "denied" ? "目前沒有權限查看所選結果。" : agentModel.busy === "read" || agentModel.readState === "loading" ? "正在核對所選原提案。" : "所選結果尚未讀取，不能沿用清單文字提交。"}</Text> : null}
        {visible && !validSelection && agentModel.readState === "failed" && !original ? <AppButton label="重新讀取所選結果" disabled={!online || !!agentModel.busy} onPress={() => selectAgentRun(opened.runId)} /> : null}
      </AppScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="關閉結果" variant="quiet" onPress={close} /></AppDialog.Actions>
    </AppDialog>
  </View>;
}

function CareWorkspace({ initialKind, initialRecordId }: { initialKind?: CareKind; initialRecordId?: string }) {
  const workspace = useCareWorkspace(), recovery = useProductionCareProfile();
  const { agentPending, online } = useProduction();
  const env = useDomainEnvironment(), externalLocked = !env.canStartWrite();
  const router = useRouter(), navigate = usePreviewNavigation(), initialized = useRef(""), manualCreateTrigger = useRef<View>(null);
  useEffect(() => {
    if (!workspace) { initialized.current = ""; return; }
    if (recovery?.pending || initialKind && (!workspace.model.online || workspace.model.access !== "editable" || externalLocked)) return;
    if (initialRecordId && ["loading", "loading_more"].includes(workspace.model.list.state)) return;
    const key = workspace.scopeKey + ":" + (initialKind ?? "") + ":" + (initialRecordId ?? "");
    if (initialized.current === key) return;
    initialized.current = key;
    if (initialRecordId) workspace.actions.openRecord(initialRecordId);
    else if (initialKind) workspace.actions.startCreate(initialKind);
  }, [workspace?.scopeKey, workspace?.model.list.state, workspace?.model.online, workspace?.model.access, recovery?.pending, externalLocked, initialKind, initialRecordId]);
  if (!workspace) return <PageFrame title="核對與記錄" density="compact"><ReadStateNotice state="loading" message="正在讀取記錄…" /></PageFrame>;
  const { model, actions } = workspace, panelOpen = !!model.detail || !!model.draft || !!model.deletion;
  return <CareRecordsView manualCreateFocusRef={manualCreateTrigger} model={model} actions={actions} initialRecordId={model.detail?.record.id ?? initialRecordId}
    manualCreateAction={!panelOpen && model.access === "editable" ? <CareCreateButton buttonRef={manualCreateTrigger} disabled={!model.online || !!recovery?.pending || externalLocked} onPress={() => actions.startCreate()} /> : undefined}
    onReviewHistory={() => navigate(() => router.push("/history?category=review"))}
    onOlderPending={() => navigate(() => router.push("/history?category=review&status=pending&older=1"))}
    pendingReview={{ content: <AgentPendingReview />, loadedCount: online && (agentPending.state === "ready" || agentPending.state === "loading" && agentPending.hasSnapshot) ? `${agentPending.entries.filter(confirmablePending).length}${agentPending.nextCursor ? "+" : ""}` : undefined }} />;
}

export default function CarePage() {
  const pathname = usePathname(), { model, actions, scopeKey } = useProduction();
  const { compose, view, record, recordId } = useLocalSearchParams<{ compose?: string; view?: string | string[]; record?: string; recordId?: string }>();
  const requestedView = Array.isArray(view) ? view[0] : view;
  const initialKind = careKindOptions.find(item => item.value === compose)?.value;
  const child = model.children.find(item => item.id === model.selectedChildId);
  const router = useRouter(), navigate = usePreviewNavigation();
  if (pathname !== "/care") return null;
  if (child && requestedView === "photos") return <PhotoWorkspace key={scopeKey ?? "no-child"} capturePreferred={false} onCare={() => navigate(() => router.push("/care"))} />;
  const initialRecordId = typeof recordId === "string" ? recordId : typeof record === "string" ? record : undefined;
  return child && scopeKey ? <CareWorkspace key={scopeKey} initialKind={initialKind} initialRecordId={initialRecordId} />
    : <PageFrame density="compact" title="核對與記錄" description="選擇有權查看的孩子，再核對 Agent 整理的內容。"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}

const styles = StyleSheet.create({
  manualCreate: { minHeight: 48, minWidth: 112, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.ink, borderRadius: radius.small, backgroundColor: colors.ink },
  manualCreateLabel: { fontFamily: chineseFont, fontSize: 14, lineHeight: 20, fontWeight: "700", color: colors.paper }, manualCreateFocused: { borderColor: colors.teal, backgroundColor: colors.teal },
  resultDialog: { maxWidth: 860 }, resultScroll: { paddingHorizontal: 0, flexShrink: 1 }, resultContent: { padding: spacing.lg, gap: spacing.md },
  pendingList: { gap: spacing.md, minWidth: 0 }, cardGrid: { minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line },
  proposalCard: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: 3, borderLeftColor: "transparent", backgroundColor: colors.paper },
  proposalCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  cardLabels: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }, cardKind: { flex: 1, minWidth: 0 },
  cardContent: { fontFamily: chineseFont, ...readingType.body, color: colors.ink, minWidth: 0 },
  cardMeta: { flexDirection: "row", gap: spacing.sm, alignItems: "center" }, cardTime: { flex: 1 }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, minWidth: 0, flexShrink: 1 },
  cardHighlighted: { backgroundColor: colors.paleTeal }, cardFocused: { borderLeftColor: colors.teal }, cardDisabled: { opacity: 0.6 },
});
