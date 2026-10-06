import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { usePreview } from "../preview/PreviewContext";
import { useGrowthPreviewTools } from "../preview/GrowthWorkspaceProvider";
import type { GrowthCondition, GrowthOutcome, GrowthRead } from "../preview/useGrowthPreview";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { GrowthView } from "../components/growth/GrowthView";
import { growthStyles as s } from "../components/growth/growth-styles";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

function GrowthPreviewTools() {
  const preview = useGrowthPreviewTools(), [tools, setTools] = useState(false);
  if (!preview) return null;
  return <SectionCard>
    <SectionHeader density="compact" title="預覽工具" subtitle={tools ? "不執行正式規則、背景處理或外發。" : undefined} icon="information-outline" />
    <AppButton expanded={tools} label={tools ? "收起關注情境" : "顯示關注情境"} variant="quiet" onPress={() => setTools(value => !value)} />
    {tools ? <>
      {preview.concernLabel ? <Text style={s.meta}>{preview.concernLabel}</Text> : null}
      <AppSelect label="關注資料情境" value={preview.condition} options={([{ value: "normal", label: "一般" }, { value: "empty", label: "沒有關注" }, { value: "loading", label: "載入中" }, { value: "read_error", label: "讀取失敗" }, { value: "read_only", label: "唯讀" }, { value: "lost", label: "失去存取" }, { value: "source_unavailable", label: "來源或依據不可用" }, { value: "fact_conflict", label: "近況衝突" }, { value: "linked_task", label: "已有待覆核任務" }, { value: "no_assignee", label: "沒有合資格負責人" }] as { value: GrowthCondition; label: string }[])} onChange={preview.changeCondition} />
      <AppSelect label="關注提交結果" value={preview.outcome} options={([{ value: "success", label: "成功" }, { value: "failed", label: "這次提交未獲接受" }, { value: "unknown", label: "結果未知" }, { value: "conflict", label: "版本衝突" }] as { value: GrowthOutcome; label: string }[])} onChange={preview.setOutcome} />
      <AppSelect label="關注重讀結果" value={preview.readScenario} options={([{ value: "same", label: "同一對象仍可讀" }, { value: "changed", label: "基準或授權版本已變" }, { value: "missing", label: "最新頁面沒有原對象" }, { value: "source_unavailable", label: "來源或依據已失效" }] as { value: GrowthRead; label: string }[])} onChange={preview.setReadScenario} />
      <Text style={s.meta}>預覽身份：{preview.identity} · Server：{preview.server}。切換會清理草稿及舊操作。</Text>
      <AppButton label="切換關注預覽帳戶" variant="secondary" onPress={preview.changeIdentity} />
      <AppButton label="切換關注預覽 Server" variant="secondary" onPress={preview.changeServer} />
    </> : null}
  </SectionCard>;
}

export function GrowthScreen() {
  const { model, actions } = usePreview(), workspace = useGrowthWorkspace();
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const router = useRouter(), navigate = usePreviewNavigation();
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (!child || !workspace) return <PageFrame density="compact" title="成長與關注" description="先選擇有權存取的孩子。"><SectionCard>
    <Text>{child ? "正在準備目前孩子的關注；未取得正確作用域前不顯示舊內容。" : "沒有選擇孩子，不顯示其他孩子的關注。"}</Text>
    <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
  </SectionCard></PageFrame>;
  return <GrowthView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions}
    initialTab={(Array.isArray(tab) ? tab[0] : tab) === "archive" ? "archive" : "concerns"}
    onTask={() => actions.open("tasks")} onMemory={() => actions.open("memory")} onSource={() => {}}
    onRecord={id => navigate(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))}
    onHistory={() => navigate(() => router.push("/history?category=growth"))} previewTools={<GrowthPreviewTools key={workspace.scopeKey} />} />;
}
