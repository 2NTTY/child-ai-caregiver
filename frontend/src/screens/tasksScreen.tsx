import { useState } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { PreviewWriteControls } from "../components/PreviewWritePanel";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import type { TaskPreviewCondition } from "../preview/task-fixture";
import { useTasksPreview } from "../preview/useTasksPreview";
import type { HomeChild } from "../view-model";

function TasksWorkspace({ child, online, reading }: { child: HomeChild; online: boolean; reading: boolean }) {
  const preview = useTasksPreview(child, online, reading);
  const [controlsOpen, setControlsOpen] = useState(false);
  const conditions: { value: TaskPreviewCondition; label: string }[] = [
    { value: "normal", label: "一般：含各個任務終態" }, { value: "viewer", label: "viewer 唯讀" }, { value: "access_lost", label: "權限失效及清除" },
    { value: "needs_review", label: "相反終態操作待覆核" }, { value: "assignee_revoked", label: "原負責人已撤權" },
    { value: "worker_disabled", label: "worker 停用／還原後暫停" }, { value: "metadata_missing", label: "未提供 worker metadata" },
    { value: "worker_failed", label: "worker 失敗" }, { value: "worker_unknown", label: "worker 結果未知" },
    { value: "latest_terminal", label: "衝突的最新版本已結束" },
    { value: "many_items", label: "超過 50 項／分頁" },
  ];
  return <TasksView model={preview.model} actions={preview.actions} controller={preview.controller} previewControls={<SectionCard>
    <SectionHeader density="compact" title="合成預覽情境" subtitle="只切換固定示例，沒有連接 Server 或啟動 worker。" action={<AppButton label={controlsOpen ? "收起情境工具" : "顯示情境工具"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />} />
    {controlsOpen ? <>
      <AppSelect label="任務情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} />
      <PreviewWriteControls controller={preview.controller} conflict={preview.model.draft?.mode !== "create"} />
      <Text>切換情境會清除本頁的資料及草稿。版本衝突只投影固定合成快照；沒有在前端重做 Server 的終態衝突規則。</Text>
    </> : null}
  </SectionCard>} />;
}

export default function TasksPage() {
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? <TasksWorkspace key={child.id} child={child} online={model.connection === "online"} reading={model.recordsLoad === "loading"} /> :
    <PageFrame density="compact" title="任務與預約" description="先選擇有權查看的孩子，才展示家庭共享事項。"><SectionCard><Text>尚未選擇孩子，沒有顯示其他孩子的任務、提醒或草稿。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
