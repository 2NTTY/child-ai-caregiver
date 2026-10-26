import { useEffect, useRef } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";

export default function TasksPage() {
  const { model, actions, openAgentDraft, chatDraft, setChatDraft } = useProduction();
  const workspace = useTasksWorkspace(), latest = useRef(workspace); latest.current = workspace;
  const router = useRouter(), navigate = usePreviewNavigation();
  const { taskId: routeTaskId } = useLocalSearchParams<{ taskId?: string | string[] }>();
  const taskId = Array.isArray(routeTaskId) ? routeTaskId[0] : routeTaskId;
  const requested = useRef("");
  useEffect(() => {
    if (!workspace || !taskId) return;
    const key = `${workspace.scopeKey}:${taskId}`;
    if (requested.current === key) return;
    requested.current = key; workspace.actions.selectTask(taskId);
  }, [workspace?.scopeKey, taskId, workspace]);
  useEffect(() => () => {
    const value = latest.current;
    if (value && !["saving", "unknown"].includes(value.model.operation.state)) value.actions.closePanel();
  }, []);
  return workspace ? <TasksView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions} recovery={workspace.recovery}
    onAgent={() => { if (!chatDraft.trim()) setChatDraft("想請你幫我記低一項安排："); openAgentDraft(true); }}
    onHistory={() => navigate(() => router.push("/history?category=tasks"), "workspace")} /> :
    <PageFrame density="compact" title="待辦與安排"><SectionCard><Text>{model.selectedChildId ? "正在讀取事項…" : "先選擇孩子。"}</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
