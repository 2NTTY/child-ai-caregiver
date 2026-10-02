import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { careKindOptions, type CareKind } from "../care-view-model";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { CareRecordsView } from "../components/care/CareRecordsView";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { useCarePreview, type CareLookupOutcome, type CarePreviewCondition, type CarePreviewOutcome } from "../preview/useCarePreview";
import type { HomeChild } from "../view-model";

function CareWorkspace({ child, online, reading, initialKind }: { child: HomeChild; online: boolean; reading: boolean; initialKind?: CareKind }) {
  const { actions } = usePreview();
  const preview = useCarePreview(child, online, reading, initialKind);
  const [controlsOpen, setControlsOpen] = useState(false);
  const conditions: { value: CarePreviewCondition; label: string }[] = [
    { value: "normal", label: "一般" }, { value: "read_only", label: "唯讀角色" }, { value: "access_lost", label: "權限失效" },
    { value: "search_error", label: "搜尋失敗" }, { value: "stale_page", label: "搜尋頁面失效" },
  ];
  const outcomes: { value: CarePreviewOutcome; label: string }[] = [
    { value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" },
    ...(preview.model.draft?.mode === "revise" || preview.model.deletion ? [{ value: "conflict" as const, label: "版本衝突" }] : []),
  ];
  return <CareRecordsView model={preview.model} actions={preview.actions} onPhotos={() => actions.open("photos")} previewControls={<SectionCard>
    <SectionHeader title="合成預覽情境" subtitle="這些工具只切換示例狀態，沒有呼叫 Server。" action={<AppButton label={controlsOpen ? "收起情境工具" : "顯示情境工具"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />} />
    {controlsOpen ? <>
      <AppSelect label="記錄情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} />
      <AppSelect label="模擬提交結果" value={preview.outcome} options={outcomes} onChange={preview.setOutcome} />
      <AppSelect<CareLookupOutcome> label="模擬查核結果" value={preview.lookupOutcome} options={[{ value: "unknown", label: "仍未查明" }, { value: "saved", label: "已保存" }, { value: "not_applied", label: "確認未保存" }]} onChange={preview.setLookupOutcome} />
      <Text>切換情境會清除這頁的合成操作與草稿。處理中或結果未知時，只可模擬權限失效。搜尋「公園」可比較空頁仍有下一頁的情況。</Text>
    </> : null}
  </SectionCard>} />;
}

export default function CarePage() {
  const { model, actions } = usePreview();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const initialKind = careKindOptions.find(item => item.value === compose)?.value;
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? <CareWorkspace key={`${child.id}:${initialKind ?? "list"}`} child={child} online={model.connection === "online"} reading={model.recordsLoad === "loading"} initialKind={initialKind} /> :
    <PageFrame title="照顧記錄" description="選擇有權查看的孩子，再整理日常觀察。"><SectionCard><Text>尚未選擇孩子，不會顯示其他孩子的記錄。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
