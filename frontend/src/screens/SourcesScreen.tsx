import { useState } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { SourcesView } from "../components/shared-inputs/SourcesView";
import { sourceStyles as s } from "../components/shared-inputs/source-styles";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { useSourcesPreview, type SourceCondition, type SourceLookup, type SourceOutcome } from "../preview/useSourcesPreview";
import type { SourcePhase } from "../shared-input-view-model";
import type { HomeChild } from "../view-model";

function SourceWorkspace({ child, online, identity, server, onIdentity, onServer, onPhotos, onRecord }: {
  child: HomeChild; online: boolean; identity: { id: string; name: string }; server: string;
  onIdentity: () => void; onServer: () => void; onPhotos: () => void; onRecord: (id: string) => void;
}) {
  const preview = useSourcesPreview(child, online, identity, server);
  const [controlsOpen, setControlsOpen] = useState(false);
  const receiptPhase = ["create", "confirm", "delete"].includes(preview.model.operation.phase ?? preview.faultPhase);
  const conditions: { value: SourceCondition; label: string }[] = [{ value: "normal", label: "一般" }, { value: "empty", label: "沒有來源" }, { value: "loading", label: "載入中" }, { value: "read_error", label: "讀取失敗" }, { value: "read_only", label: "唯讀角色" }, { value: "capacity", label: "新增容量限制" }, { value: "lost", label: "權限失效" }];
  const phases: { value: SourcePhase; label: string }[] = [{ value: "create", label: "私人來源保存" }, { value: "fetch", label: "取得網頁正文" }, { value: "extract", label: "AI 提取" }, { value: "confirm", label: "家庭共享確認" }, { value: "delete", label: "來源刪除" }];
  const outcomes: { value: SourceOutcome; label: string }[] = [{ value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" },
    ...(preview.faultPhase !== "create" ? [{ value: "conflict" as const, label: "版本衝突" }] : []),
    ...(["create", "fetch"].includes(preview.faultPhase) ? [{ value: "capacity" as const, label: "容量拒絕" }] : []),
    ...(["create", "confirm", "delete"].includes(preview.faultPhase) ? [{ value: "confirmed_unavailable" as const, label: "已確認但結果不可讀" }] : []),
  ];
  const lookups: { value: SourceLookup; label: string }[] = [{ value: "applied", label: "已查回結果" }, { value: "unknown", label: "仍未查明" },
    ...(receiptPhase ? [{ value: "unconfirmed" as const, label: "仍無確認收據" }, { value: "confirmed_unavailable" as const, label: "已確認但不可讀" }]
      : [{ value: "running" as const, label: "仍在處理" }, { value: "failed" as const, label: "原次已失敗" }, { value: "not_requested" as const, label: "尚未開始處理" }]),
  ];
  return <SourcesView model={preview.model} actions={preview.actions} onPhotos={onPhotos} onRecord={onRecord} previewControls={<SectionCard>
    <SectionHeader density="compact" title="合成來源情境" subtitle="不連 Server、網頁或模型；不是系統分享或檔案上傳。" action={<AppButton label={controlsOpen ? "收起來源情境" : "顯示來源情境"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />} />
    {controlsOpen ? <><AppSelect label="來源情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} />
      <AppSelect label="來源問題階段" value={preview.faultPhase} options={phases} onChange={value => { preview.setFaultPhase(value); preview.setOutcome("success"); }} />
      <AppSelect label="模擬來源結果" value={preview.outcome} options={outcomes} onChange={preview.setOutcome} />
      <AppSelect label="模擬來源查核" value={preview.lookup} options={lookups} onChange={preview.setLookup} />
      <AppSelect label="助手查看來源結果（合成）" value={preview.intakeReadOutcome} onChange={preview.setIntakeReadOutcome} options={[{ value: "ready", label: "可進入用途討論" }, { value: "unavailable", label: "來源不可讀" }, { value: "unknown", label: "原次結果未知" }]} />
      <AppSelect label="用途確認後狀態（合成）" value={preview.intakeConnectionOutcome} onChange={preview.setIntakeConnectionOutcome} options={[{ value: "not_connected", label: "確認意向，正式接入未連線" }, { value: "unknown", label: "接入結果未知" }]} />
      <AppButton label={`切換來源帳戶，目前${identity.name}`} variant="secondary" onPress={onIdentity} />
      <AppButton label={`切換來源 Server，目前${server}`} variant="secondary" onPress={onServer} />
      <Text style={s.meta}>帳戶／Server／孩子切換清除本頁私人資料及舊回應。離線保留本頁草稿；其他情境切換重設資料。公開清單 ID、hash 及正文都是示例，正式接線須採用 Server 回應。</Text>
    </> : null}
  </SectionCard>} />;
}
export default function SourcesPage() {
  const { model, actions } = usePreview();
  const [account, setAccount] = useState<"mom" | "dad">("mom"), [server, setServer] = useState("合成 A");
  const identity = { id: `preview-source-${account}`, name: account === "mom" ? model.caregiverName : "爸爸" };
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? <SourceWorkspace key={JSON.stringify([child.id, identity.id, identity.name, server])} child={child} online={model.connection === "online"} identity={identity} server={server}
    onIdentity={() => setAccount(value => value === "mom" ? "dad" : "mom")} onServer={() => setServer(value => value === "合成 A" ? "合成 B" : "合成 A")}
    onPhotos={() => actions.open("photos")} onRecord={() => actions.open("care")} /> :
    <PageFrame density="compact" title="資料來源" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不會顯示其他孩子的私人來源。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
