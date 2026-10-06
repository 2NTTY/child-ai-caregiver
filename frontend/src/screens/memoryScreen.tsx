import { Text } from "react-native-paper";
import { brand } from "../branding";
import { MemoryReferenceView } from "../components/memory/MemoryReferenceView";
import { PageFrame } from "../components/PageFrame";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppButton } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeMemoryManagement } from "../production/TaskKnowledgeMemoryManagement";
import { useProductionTaskKnowledgeMemory } from "../production/TaskKnowledgeDomains";

export default function MemoryPage() {
  const { model, actions, online } = useProduction(), memory = useProductionTaskKnowledgeMemory();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return <PageFrame density="compact" title="記憶與參考" description="查閱對話脈絡、已保存記憶與參考來源" eyebrow={`${brand.name} · 資料查閱`}
    headerActions={child && memory ? <AppButton label={memory.busy ? "正在讀取…" : "重新讀取記憶"} variant="secondary" density="compact" disabled={!online || memory.busy || memory.lost} onPress={memory.refresh} /> : undefined}>
    {child ? <><MemoryReferenceView onPrepareQuestion={actions.prepareQuestion} /><TaskKnowledgeMemoryManagement key={memory?.value.scopeKey ?? "no-memory-scope"} />
      {memory?.lost ? <Text>孩子存取已失效，舊記憶及私人摘要已清除。</Text> : memory?.failed ? <Text>最新記憶未能核對；已載入內容可能過時。</Text> : null}
    </> : <ReadStateNotice state="empty" title="先選擇孩子" message="選擇孩子後才可查看對應記憶與參考。"><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></ReadStateNotice>}
  </PageFrame>;
}