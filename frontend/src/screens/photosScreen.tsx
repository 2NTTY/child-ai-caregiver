import { useState } from "react";
import { useLocalSearchParams, usePathname } from "expo-router";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { PhotosView } from "../components/photos/PhotosView";
import { photoStyles } from "../components/photos/photo-styles";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { usePhotosWorkspace } from "../preview/PhotosWorkspaceProvider";
import { type PhotoPreviewCondition, type PhotoPreviewLookup, type PhotoPreviewOutcome } from "../preview/usePhotosPreview";
import { photoPreviewOriginal } from "../preview/photoFixture";
import type { PhotoPhase } from "../photo-view-model";

export function PhotoWorkspace({ onCare, capturePreferred }: { onCare: () => void; capturePreferred: boolean }) {
  const preview = usePhotosWorkspace();
  const [controlsOpen, setControlsOpen] = useState(false);
  if (!preview) return <PageFrame density="compact" title="記錄 · 原始照片" description="目前沒有可用的照片範圍。"><Text>先選擇有權存取的孩子。</Text></PageFrame>;
  const conditions: { value: PhotoPreviewCondition; label: string }[] = [{ value: "normal", label: "一般" }, { value: "empty", label: "沒有照片" }, { value: "loading", label: "載入中" }, { value: "read_error", label: "讀取失敗" }, { value: "read_only", label: "唯讀角色" }, { value: "capacity", label: "新增容量限制" }, { value: "access_lost", label: "權限失效" }];
  const phases: { value: PhotoPhase; label: string }[] = [{ value: "reserve", label: "私人附件建立" }, { value: "upload", label: "原檔上傳" }, { value: "extract", label: "AI 提取" }, { value: "confirm", label: "家庭共享確認" }, { value: "delete", label: "照片刪除" }];
  const outcomes: { value: PhotoPreviewOutcome; label: string }[] = [{ value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" },
    ...(preview.faultPhase === "reserve" || preview.faultPhase === "upload" ? [{ value: "capacity" as const, label: "容量拒絕" }] : []),
    ...(preview.faultPhase === "confirm" || preview.faultPhase === "delete" ? [{ value: "conflict" as const, label: "版本衝突" }] : []),
    ...(!["upload", "extract"].includes(preview.faultPhase) ? [{ value: "confirmed_unavailable" as const, label: "已確認但結果不可讀" }] : []),
  ];
  return <PhotosView model={preview.model} actions={preview.actions} onCare={onCare} capturePreferred={capturePreferred} scopeKey={preview.scopeKey} previewControls={<SectionCard>
    <SectionHeader density="compact" title="預覽工具" subtitle={controlsOpen ? "不呼叫 Server、Gemini 或裝置權限。" : undefined} action={<AppButton expanded={controlsOpen} label={controlsOpen ? "收起照片情境" : "顯示照片情境"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />} />
    {controlsOpen ? <><AppButton label="使用品牌示例原圖" variant="secondary" disabled={!preview.model.canPick} onPress={() => preview.actions.pickOriginal({ ...photoPreviewOriginal })} />
      <AppSelect label="照片情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} />
      <AppSelect label="模擬問題階段" value={preview.faultPhase} options={phases} onChange={value => { preview.setFaultPhase(value); preview.setOutcome("success"); }} />
      <AppSelect label="模擬照片結果" value={preview.outcome} options={outcomes} onChange={preview.setOutcome} />
      <AppSelect<PhotoPreviewLookup> label="模擬照片查核" value={preview.lookup} options={[{ value: "applied", label: "已查回結果" }, { value: "unconfirmed", label: "仍無確認結果" }, { value: "unknown", label: "仍未查明" }, ...(!["upload", "extract"].includes(preview.model.operation.phase ?? preview.faultPhase) ? [{ value: "confirmed_unavailable" as const, label: "已確認但不可讀" }] : [])]} onChange={preview.setLookup} />
      <Text style={photoStyles.meta}>切換情境會清除合成原檔及草稿。處理中／結果未知時只可模擬權限失效；查核上傳不新建附件，查核未知提取不重送模型。示例圖沿用品牌美術，候選屬合成文字。</Text></> : null}
  </SectionCard>} />;
}
export default function PhotosPage() {
  const pathname = usePathname();
  const { input } = useLocalSearchParams<{ input?: string }>();
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (pathname !== "/photos") return null;
  return child ? <PhotoWorkspace key={JSON.stringify([child.id, model.caregiverName])} capturePreferred={input === "camera"} onCare={() => actions.open("care")} /> :
    <PageFrame density="compact" title="照片與記錄" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不會顯示其他孩子的照片。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
