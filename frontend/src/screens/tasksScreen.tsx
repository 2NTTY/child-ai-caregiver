import { useState } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { PreviewWriteControls } from "../components/PreviewWritePanel";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import type { TaskPreviewCondition } from "../preview/task-fixture";
import { useTasksPreviewWorkspace } from "../preview/TasksWorkspaceProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useRouter } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";

export function TasksPreviewControls() {
  const preview = useTasksPreviewWorkspace();
  const [controlsOpen, setControlsOpen] = useState(false);
  if (!preview) return null;
  const conditions: { value: TaskPreviewCondition; label: string }[] = [
    { value: "normal", label: "一般：含各個任務終態" }, { value: "viewer", label: "viewer 唯讀" }, { value: "access_lost", label: "權限失效及清除" },
    { value: "needs_review", label: "相反終態操作待覆核" }, { value: "assignee_revoked", label: "原負責人已撤權" },
    { value: "worker_disabled", label: "worker 停用／還原後暫停" }, { value: "metadata_missing", label: "未提供 worker metadata" },
    { value: "worker_failed", label: "worker 失敗" }, { value: "worker_unknown", label: "worker 結果未知" },
    { value: "latest_terminal", label: "衝突的最新版本已結束" },
    { value: "many_items", label: "超過 50 項／分頁" },
    { value: "completed_history", label: "超過 10 項完成／事項歷史" },
  ];
  return <SectionCard>
    <SectionHeader density="compact" title="預覽工具" subtitle={controlsOpen ? "固定合成快照：2026年10月4日 16:00 香港時間；不是即時安排。" : undefined} action={<AppButton label={controlsOpen ? "收起情境工具" : "顯示情境工具"} variant="quiet" expanded={controlsOpen} onPress={() => setControlsOpen(value => !value)} />} />
    {controlsOpen ? <>
      <AppSelect label="任務情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} />
      <PreviewWriteControls controller={preview.controller} conflict={preview.model.draft?.mode !== "create"} />
      <Text>切換情境會重置待辦及事項歷史的共同資料；處理中或結果未知只可模擬權限失效。助手建議、正式保存及通知均未接駁。本資料沒有未排期事項來源，未展示假的「待安排」。</Text>
    </> : null}
  </SectionCard>;
}

export default function TasksPage() {
  const { actions, openAgentDraft, chatDraft, setChatDraft } = usePreview();
  const preview = useTasksWorkspace();
  const router = useRouter(), navigate = usePreviewNavigation();
  return preview ? <TasksView key={preview.scopeKey} model={preview.model} actions={preview.actions} recovery={preview.recovery}
    onAgent={() => { if (!chatDraft.trim()) setChatDraft("想請你幫我記低一項安排："); openAgentDraft(true); }}
    onHistory={() => navigate(() => router.push("/history?category=tasks"))} previewControls={<TasksPreviewControls />} /> :
    <PageFrame density="compact" title="待辦與預約" description="先選擇有權查看的孩子，才展示家庭共享事項。"><SectionCard><Text>尚未選擇孩子，沒有顯示其他孩子的任務、提醒或草稿。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
