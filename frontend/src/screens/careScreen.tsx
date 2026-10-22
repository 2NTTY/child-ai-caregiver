import { EmptyListCard } from "../components/EmptyListCard";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useLocalSearchParams, useRouter, usePathname } from "expo-router";
import { careKindOptions, type CareKind } from "../care-view-model";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { PageFrame } from "../components/PageFrame";
import { CareRecordsView } from "../components/care/CareRecordsView";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { agentRunLabels } from "../agent-view-model";
import { AgentRunView } from "../components/agent/AgentRunView";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useDomainEnvironment } from "../production/useDomainEnvironment";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { PhotoWorkspace } from "./photosScreen";
import { spacing } from "../theme";

export function AgentPendingReview() {
  const { scopeKey, selectedChildId, online, agentPending, agentModel, agentActions, readAgentPending, selectAgentRun } = useProduction();
  const workspace = useCareWorkspace(), recovery = useProductionCareProfile();
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ scope: string; runId: string } | null>(null);
  const leave = usePreviewNavigation(), trigger = useRef<View | null>(null), rowRefs = useRef(new Map<string, View>());
  const validSelection = !!scopeKey && agentModel.run?.id === selected && agentModel.run.childId === selectedChildId;
  const visible = !!opened && opened.scope === scopeKey && opened.runId === selected;
  const current = useRef({ scopeKey, selected, visible }); current.current = { scopeKey, selected, visible };
  const mounted = useRef(true), closedScope = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  usePreviewLeaveGuard(false, visible && (agentModel.busy === "write" || !!agentModel.pendingDecision), "child", undefined, true);
  const close = () => leave(() => {
    if (!mounted.current || current.current.scopeKey !== scopeKey || current.current.selected !== selected) return;
    closedScope.current = scopeKey; setOpened(null);
  });
  const closed = () => {
    if (mounted.current && !current.current.visible && closedScope.current === current.current.scopeKey && Platform.OS === "web") {
      const host = trigger.current as unknown as HTMLElement | null;
      const target = host?.matches?.('button,[role="button"]') ? host : host?.querySelector<HTMLElement>('button,[role="button"]');
      if (target?.isConnected) target.focus();
    }
    closedScope.current = null;
  };
  useEffect(() => { setSelected(null); setOpened(null); if (scopeKey && online) readAgentPending(); }, [scopeKey, online]);
  const locked = !!recovery?.pending || !!workspace?.model.draft || !!workspace?.model.deletion;
  return <SectionCard surface="plain"><SectionHeader density="compact" title="助手待確認事項"
    action={agentPending.state === "failed" ? <AppButton label="重試" variant="quiet" disabled={!online || locked} onPress={() => readAgentPending()} /> : undefined} />
    {agentPending.state === "idle" ? <Text>{online ? "待確認事項尚未讀取；等候目前操作完成後會自動讀取。" : "目前離線，待確認事項尚未核對。"}</Text>
      : agentPending.state === "loading" && !agentPending.hasSnapshot ? <ReadStateNotice state="loading" scopeKey={scopeKey ?? undefined} refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : agentPending.state === "failed" ? <Text>{agentPending.hasSnapshot ? "未能更新，仍顯示上次讀取的待確認事項。" : "未能讀取待確認事項，請重試。"}</Text>
      : agentPending.state === "denied" ? <Text>目前沒有權限查看這個孩子的待確認事項。</Text> : agentPending.state === "ready" && online && !agentPending.entries.length ? <EmptyListCard title={agentPending.nextCursor ? "已載入頁面暫無待確認提案" : "暫無待確認提案"} detail={agentPending.nextCursor ? "仍有待確認事項未載入，可繼續讀取。" : undefined} /> : null}
    {agentPending.entries.map(({ runId, proposal }) => <View key={runId + ":" + proposal.id} style={{ gap: spacing.sm }}>
      <Text>{proposal.title}</Text><Text>{proposal.scope === "family" ? "家庭共享" : "私人"} · {proposal.status === "expired" ? "原提案已過期；仍可查看及略過" : "待你核對"}</Text>
      <AppButton ref={node => { if (node) rowRefs.current.set(runId, node); else rowRefs.current.delete(runId); }} label="查看結果" accessibilityLabel="查看原提案及確認範圍" variant="secondary" disabled={locked || !!agentModel.busy || !!agentModel.pendingDecision}
        onPress={() => { trigger.current = rowRefs.current.get(runId) ?? null; setSelected(runId); setOpened({ scope: scopeKey ?? "", runId }); selectAgentRun(runId); }} />
    </View>)}
    {agentPending.nextCursor ? <AppButton label="載入較早待確認事項" variant="quiet" disabled={!online || agentPending.state === "loading" || locked} onPress={() => readAgentPending(true)} /> : null}
    {validSelection ? <View style={{ gap: spacing.sm }}>
      <Text>{agentModel.pendingDecision ? "原確認結果待查核" : agentModel.run!.status === "unknown" ? "結果未知，請查看原運行" : agentRunLabels[agentModel.run!.status]}{agentModel.run!.proposals.some(proposal => proposal.status === "pending" || proposal.status === "expired") ? " · 有待核對提案" : ""}</Text>
      <AppButton label="查看所選結果" variant="quiet" onPress={() => setOpened({ scope: scopeKey ?? "", runId: selected! })} />
    </View> : null}
    <AppDialog visible={visible} accessibilityLabel="助手運行結果" onDismiss={close} onClosed={closed} style={styles.resultDialog}>
      <AppDialog.Title>助手運行結果</AppDialog.Title>
      <AppDialog.ScrollArea style={styles.resultScroll}><AppScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultContent}>
        {visible && validSelection ? <AgentRunView model={{ ...agentModel, writesBlocked: agentModel.writesBlocked || locked }} actions={agentActions} />
          : visible ? <Text>{agentModel.readState === "failed" ? "原提案未能讀回，不能沿用清單文字提交。" : agentModel.readState === "denied" ? "目前沒有權限查看所選結果。" : agentModel.busy === "read" || agentModel.readState === "loading" ? "正在核對所選原提案。" : "所選結果尚未讀取，不能沿用清單文字提交。"}</Text> : null}
        {visible && !validSelection && agentModel.readState === "failed" ? <AppButton label="重新讀取所選結果" disabled={!online || !!agentModel.busy} onPress={() => selected && selectAgentRun(selected)} /> : null}
      </AppScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="關閉結果" variant="quiet" onPress={close} /></AppDialog.Actions>
    </AppDialog>
  </SectionCard>;
}

function CareWorkspace({ initialKind, initialRecordId }: { initialKind?: CareKind; initialRecordId?: string }) {
  const workspace = useCareWorkspace(), recovery = useProductionCareProfile();
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
  if (!workspace) return <PageFrame title="核對" density="compact"><ReadStateNotice state="loading" message="正在讀取記錄…" /></PageFrame>;
  const { model, actions } = workspace, panelOpen = !!model.detail || !!model.draft || !!model.deletion;
  return <CareRecordsView manualCreateFocusRef={manualCreateTrigger} model={model} actions={actions} initialRecordId={model.detail?.record.id ?? initialRecordId}
    manualCreateAction={!panelOpen && model.access === "editable" ? <AppButton ref={manualCreateTrigger} label="手動新增" accessibilityLabel="手動新增共享記錄" density="compact" variant="secondary" disabled={!model.online || !!recovery?.pending || externalLocked} onPress={() => actions.startCreate()} /> : undefined}
    onReviewHistory={() => navigate(() => router.push("/history?category=review"))}
    onOlderPending={() => navigate(() => router.push("/history?category=review&status=pending&older=1"))}
    previewControls={<AgentPendingReview />} />;
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
    : <PageFrame density="compact" title="核對" description="選擇有權查看的孩子，再核對 Agent 整理的內容。"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}

const styles = StyleSheet.create({ resultDialog: { maxWidth: 860 }, resultScroll: { paddingHorizontal: 0, flexShrink: 1 }, resultContent: { padding: spacing.lg, gap: spacing.md } });
