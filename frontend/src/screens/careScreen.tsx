import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useLocalSearchParams, useRouter, usePathname } from "expo-router";
import { careKindOptions, type CareKind } from "../care-view-model";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { PageFrame } from "../components/PageFrame";
import { CareRecordsView } from "../components/care/CareRecordsView";
import { CareSavedRecordsView } from "../components/care/CareSavedRecordsView";
import { AgentRunView } from "../components/agent/AgentRunView";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useDomainEnvironment } from "../production/useDomainEnvironment";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { PhotoWorkspace } from "./photosScreen";
import { spacing } from "../theme";

function AgentPendingReview() {
  const { scopeKey, selectedChildId, online, agentPending, agentModel, agentActions, readAgentPending, selectAgentRun } = useProduction();
  const workspace = useCareWorkspace(), recovery = useProductionCareProfile();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); if (scopeKey && online) readAgentPending(); }, [scopeKey, online]);
  const locked = !!recovery?.pending || !!workspace?.model.draft || !!workspace?.model.deletion;
  return <SectionCard surface="plain"><SectionHeader density="compact" title="助手待確認事項"
    action={agentPending.state === "failed" ? <AppButton label="重試" variant="quiet" disabled={!online || locked} onPress={() => readAgentPending()} /> : undefined} />
    {agentPending.state === "idle" ? <Text>{online ? "待確認事項尚未讀取；等候目前操作完成後會自動讀取。" : "目前離線，待確認事項尚未核對。"}</Text>
      : agentPending.state === "loading" && !agentPending.hasSnapshot ? <ReadStateNotice state="loading" scopeKey={scopeKey ?? undefined} refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : agentPending.state === "failed" ? <Text>{agentPending.hasSnapshot ? "未能更新，仍顯示上次讀取的待確認事項。" : "未能讀取待確認事項，請重試。"}</Text>
      : agentPending.state === "denied" ? <Text>目前沒有權限查看這個孩子的待確認事項。</Text> : (agentPending.state === "ready" || agentPending.state === "loading" && agentPending.hasSnapshot) && !agentPending.entries.length ? <Text>{agentPending.nextCursor ? "此頁暫無待確認提案" : "暫無待確認提案"}</Text> : null}
    {agentPending.entries.map(({ runId, proposal }) => <View key={runId + ":" + proposal.id} style={{ gap: spacing.sm }}>
      <Text>{proposal.title}</Text><Text>{proposal.scope === "family" ? "家庭共享" : "私人"} · {proposal.status === "expired" ? "原提案已過期；仍可查看及略過" : "待你核對"}</Text>
      <AppButton label="查看原提案及確認範圍" variant="secondary" disabled={locked || !!agentModel.busy || !!agentModel.pendingDecision}
        onPress={() => { setSelected(runId); selectAgentRun(runId); }} />
    </View>)}
    {agentPending.nextCursor ? <AppButton label="載入較早待確認事項" variant="quiet" disabled={!online || agentPending.state === "loading" || locked} onPress={() => readAgentPending(true)} /> : null}
    {selected && agentModel.run?.id === selected && agentModel.run.childId === selectedChildId
      ? <AgentRunView model={{ ...agentModel, writesBlocked: agentModel.writesBlocked || locked }} actions={agentActions} />
      : selected && agentModel.readState === "loading" ? <Text>正在核對所選原提案。</Text> : selected && agentModel.readState === "failed" ? <Text>原提案未能讀回，不能沿用清單文字提交。</Text> : null}
  </SectionCard>;
}

function CareWorkspace({ initialKind, initialRecordId }: { initialKind?: CareKind; initialRecordId?: string }) {
  const workspace = useCareWorkspace(), recovery = useProductionCareProfile();
  const env = useDomainEnvironment(), externalLocked = !env.canStartWrite();
  const router = useRouter(), navigate = usePreviewNavigation(), initialized = useRef("");
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
  if (!workspace) return <PageFrame title="記錄與核對" density="compact"><ReadStateNotice state="loading" message="正在讀取記錄…" /></PageFrame>;
  const { model, actions } = workspace, panelOpen = !!model.detail || !!model.draft || !!model.deletion;
  return <CareRecordsView model={model} actions={actions} initialRecordId={model.detail?.record.id ?? initialRecordId}
    onReviewHistory={() => navigate(() => router.push("/history?category=review"))}
    onOlderPending={() => navigate(() => router.push("/history?category=review&status=pending&older=1"))}
    previewControls={<>
      {!panelOpen ? <SectionCard surface="plain"><SectionHeader density="compact" title="查找已保存記錄"
        action={model.access === "editable" ? <AppButton label="手動新增共享記錄" disabled={!model.online || !!recovery?.pending || externalLocked} onPress={() => actions.startCreate()} /> : undefined} />
        <CareSavedRecordsView model={model} actions={actions} />
      </SectionCard> : null}
      <AgentPendingReview />
    </>} />;
}

export default function CarePage() {
  const pathname = usePathname(), { model, actions, scopeKey } = useProduction();
  const { compose, view, record, recordId } = useLocalSearchParams<{ compose?: string; view?: string; record?: string; recordId?: string }>();
  const initialKind = careKindOptions.find(item => item.value === compose)?.value;
  const child = model.children.find(item => item.id === model.selectedChildId);
  const router = useRouter(), navigate = usePreviewNavigation();
  if (pathname !== "/care") return null;
  if (child && view === "photos") return <PhotoWorkspace key={scopeKey ?? "no-child"} capturePreferred={false} onCare={() => navigate(() => router.push("/care"))} />;
  const initialRecordId = typeof recordId === "string" ? recordId : typeof record === "string" ? record : undefined;
  return child && scopeKey ? <CareWorkspace key={scopeKey} initialKind={initialKind} initialRecordId={initialRecordId} />
    : <PageFrame density="compact" title="記錄與核對" description="選擇有權查看的孩子，再核對 Agent 整理的內容。"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
