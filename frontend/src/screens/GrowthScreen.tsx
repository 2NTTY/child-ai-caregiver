import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeGrowthCandidates } from "../production/TaskKnowledgeGrowthCandidates";
import { useProductionFamilyDocuments } from "../production/TaskKnowledgeDomains";
import { FamilyReportControls } from "../production/FamilyReportControls";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { GrowthView } from "../components/growth/GrowthView";
import { AppButton, SectionCard } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

export function GrowthScreen() {
  const { model, actions } = useProduction(), workspace = useGrowthWorkspace(), tasks = useTasksWorkspace();
  const documents = useProductionFamilyDocuments();
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const router = useRouter(), navigate = usePreviewNavigation();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const openTask = (id: string) => navigate(() => { tasks?.actions.selectTask(id); router.push("/tasks"); });
  if (!child || !workspace) return <PageFrame density="compact" title="成長與關注"><SectionCard>
    <Text>{child ? "正在讀取關注…" : "先選擇孩子。"}</Text>
    <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
  </SectionCard></PageFrame>;
  return <GrowthView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions}
    initialTab={(Array.isArray(tab) ? tab[0] : tab) === "archive" ? "archive" : "concerns"}
    onTask={openTask}
    onRecord={id => navigate(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))}
    onHistory={() => navigate(() => router.push("/history?category=growth"))}
    onExportReport={documents && typeof document !== "undefined" ? documents.exportReport : undefined}
    exportBusy={documents?.exportBusy}
    reportTools={<FamilyReportControls scopeKey={workspace.scopeKey} online={workspace.model.online} />}
    previewTools={<TaskKnowledgeGrowthCandidates model={workspace.model} actions={workspace.actions} onTask={openTask} />} />;
}
