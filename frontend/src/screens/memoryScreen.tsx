import { BackgroundSurface } from "../components/appearance/BackgroundSurface";
import { Text } from "react-native-paper";
import { MemoryReferenceView } from "../components/memory/MemoryReferenceView";
import { PageFrame } from "../components/PageFrame";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppButton } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { useProductionSettingsDomains } from "../production/SettingsDomains";
import { TaskKnowledgeMemoryManagement } from "../production/TaskKnowledgeMemoryManagement";
import { useProductionTaskKnowledgeMemory } from "../production/TaskKnowledgeDomains";

export default function MemoryPage() {
  const { model, actions, online, recordsState, auth, userId, scopeKey } = useProduction(), memory = useProductionTaskKnowledgeMemory();
  const { family } = useProductionSettingsDomains();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const selectedChild = recordsState.children.find(item => item.id === child?.id);
  const confirmerDisplay = auth === "signedIn" && userId && scopeKey && selectedChild ? {
    scopeKey, childId: selectedChild.id, userId,
    members: family.model.selfUserId === userId && family.model.loadState !== "lost"
      ? family.model.families.find(item => item.id === selectedChild.workspaceId)?.members ?? [] : [],
  } : undefined;
  const tabActions = child && memory ? <AppButton label={memory.busy ? "讀取中…" : "重讀"} accessibilityLabel={memory.busy ? "正在讀取記憶" : "重新讀取記憶"} variant="secondary" density="compact" disabled={!online || memory.busy || memory.lost} onPress={memory.refresh} /> : undefined;
  return <PageFrame density="compact" title="記憶">
    {child ? <><MemoryReferenceView tabActions={tabActions} confirmerDisplay={confirmerDisplay} onPrepareQuestion={actions.prepareQuestion} /><TaskKnowledgeMemoryManagement key={memory?.value.scopeKey ?? "no-memory-scope"} />
      {memory?.lost ? <BackgroundSurface padded><Text>孩子存取已失效，舊記憶及私人摘要已清除。</Text></BackgroundSurface> : memory?.failed ? <BackgroundSurface padded><Text>最新記憶未能核對；已載入內容可能過時。</Text></BackgroundSurface> : null}
    </> : <ReadStateNotice state="empty" title="先選擇孩子" message="選擇孩子後才可查看對應記憶與參考。"><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></ReadStateNotice>}
  </PageFrame>;
}
