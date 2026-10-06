import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { useEffect, useRef, useState } from "react";
import { PhotoWorkspace } from "./photosScreen";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useLocalSearchParams, useRouter, usePathname } from "expo-router";
import { careKindOptions, type CareKind } from "../care-view-model";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { CareRecordsView } from "../components/care/CareRecordsView";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { type CareLookupOutcome, type CarePreviewCondition, type CarePreviewOutcome } from "../preview/useCarePreview";
import { useCarePreviewWorkspace } from "../preview/CareWorkspaceProvider";

function CareWorkspace({ initialKind, initialRecordId }: { initialKind?: CareKind; initialRecordId?: string }) {
  const router = useRouter(), navigate = usePreviewNavigation();
  const preview = useCarePreviewWorkspace();
  const workspace = useCareWorkspace();
  const initialized = useRef("");
  useEffect(() => {
    if (!preview) { initialized.current = ""; return; }
    const key = `${preview.scopeKey}:${initialKind ?? ""}:${initialRecordId ?? ""}`;
    if (initialized.current === key) return;
    initialized.current = key;
    if (initialRecordId) preview.actions.openRecord(initialRecordId);
    else if (initialKind) preview.actions.startCreate(initialKind);
  }, [preview?.scopeKey, initialKind, initialRecordId]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const conditions: { value: CarePreviewCondition; label: string }[] = [
    { value: "normal", label: "一般：普通內容已記錄" }, { value: "prior_consent", label: "家長要求先確認才寫入" }, { value: "read_only", label: "唯讀角色" }, { value: "access_lost", label: "權限失效" },
    { value: "review_unavailable", label: "核對來源未接通" }, { value: "review_error", label: "核對讀取失敗" },
    { value: "review_empty", label: "沒有核對項目" }, { value: "source_changed", label: "提案來源已變更" },
    { value: "create_only", label: "只支援新增接口" }, { value: "proposal_stale", label: "更新提案基準失效" },
  ];
  if (!preview || !workspace) return <PageFrame title="記錄與核對" density="compact" description="正在準備目前孩子的核對資料。"><Text>未取得正確作用域前，不顯示舊原文或提案。</Text></PageFrame>;
  const outcomes: { value: CarePreviewOutcome; label: string }[] = [
    { value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" },
    ...(preview.model.draft?.mode === "revise" || preview.model.deletion ? [{ value: "conflict" as const, label: "版本衝突" }] : []),
  ];
  return <CareRecordsView model={workspace.model} actions={workspace.actions} initialRecordId={initialRecordId} onReviewHistory={() => navigate(() => router.push("/history?category=review"))} onOlderPending={() => navigate(() => router.push("/history?category=review&status=pending&older=1"))} previewControls={<SectionCard>
    <SectionHeader density="compact" title="預覽工具" subtitle={controlsOpen ? "這些工具只切換示例狀態，沒有呼叫 Server。" : undefined} action={<AppButton label={controlsOpen ? "收起情境工具" : "顯示情境工具"} variant="quiet" expanded={controlsOpen} onPress={() => setControlsOpen(value => !value)} />} />
    {controlsOpen ? <>
      <AppSelect label="記錄情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} />
      <AppSelect label="模擬提交結果" value={preview.outcome} options={outcomes} onChange={preview.setOutcome} />
      <AppSelect<CareLookupOutcome> label="模擬查核結果" value={preview.lookupOutcome} options={[{ value: "unknown", label: "仍未查明" }, { value: "saved", label: "已保存" }, { value: "not_applied", label: "尚無確認收據" }]} onChange={preview.setLookupOutcome} />
      {preview.model.draft?.captureId ? <AppButton label="模擬提案來源變更" variant="secondary" disabled={["saving", "unknown"].includes(preview.model.operation.state)} onPress={preview.invalidateCaptureSource} /> : null}
      <Text>切換情境會清除這頁的合成操作與草稿。處理中或結果未知時，只可模擬權限失效。提案、原文、已寫入關聯和略過狀態均是合成示例。正式保存時機由 Agent／Server 授權流程決定。</Text>
    </> : null}
  </SectionCard>} />;
}

export default function CarePage() {
  const pathname = usePathname();
  const { model, actions } = usePreview();
  const { compose, view, record } = useLocalSearchParams<{ compose?: string; view?: string; record?: string }>();
  const initialKind = careKindOptions.find(item => item.value === compose)?.value;
  const child = model.children.find(item => item.id === model.selectedChildId);
  const router = useRouter(), navigate = usePreviewNavigation();
  if (pathname !== "/care") return null;
  if (child && view === "photos") return <PhotoWorkspace key={JSON.stringify([child.id, model.caregiverName])} capturePreferred={false} onCare={() => navigate(() => router.push("/care"))} />;
  return child ? <CareWorkspace key={JSON.stringify([child.id, model.caregiverName, child.accessRole])} initialKind={initialKind} initialRecordId={record} /> :
    <PageFrame density="compact" title="記錄與核對" description="選擇有權查看的孩子，再核對 Agent 整理的內容。"><SectionCard><Text>尚未選擇孩子，不會顯示其他孩子的記錄。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
