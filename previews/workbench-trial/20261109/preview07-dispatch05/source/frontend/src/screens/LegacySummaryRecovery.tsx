import { useState } from "react";
import { Text } from "react-native-paper";
import type { HomeChild } from "../view-model";
import { usePreview } from "../preview/PreviewContext";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useSummaryPreview, type SummaryCondition, type SummaryOutcome, type SummaryLookup, type SummaryRead } from "../preview/useSummaryPreview";
import { SummaryView } from "../components/summary/SummaryView";
import { summaryStyles as s } from "../components/summary/summary-styles";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";

function LegacyWorkspace({ child, online, identity, server, onIdentity, onServer, onReturn }: {
  child: HomeChild; online: boolean; identity: string; server: string; onIdentity(): void; onServer(): void; onReturn(): void;
}) {
  const { actions } = usePreview();
  const preview = useSummaryPreview(child, online, identity, server), [tools, setTools] = useState(false);
  return <SummaryView model={preview.model} actions={preview.actions} mode="recovery" onReturn={onReturn}
    onRecord={() => actions.open("care")} onTask={() => actions.open("tasks")}
    onAgent={() => actions.prepareQuestion(`想請你幫我整理或更新${child.displayName}的到診準備：先核對預約、要問的問題、原始觀察和攜帶清單；未確認的內容請先讓我核對。`)}
    previewTools={<SectionCard><SectionHeader density="compact" title="預覽工具" subtitle={tools ? "保留原保存及查核流程；不遷移至新版準備單、不呼叫 Server 或外發。" : undefined} icon="information-outline" />
      <AppButton expanded={tools} label={tools ? "收起原操作情境" : "顯示原操作情境"} variant="quiet" onPress={() => setTools(value => !value)} />
      {tools ? <>
        <AppSelect label="摘要資料情境" value={preview.condition} options={([{ value: "normal", label: "一般" }, { value: "empty", label: "沒有期間記錄" }, { value: "loading", label: "載入中" }, { value: "read_error", label: "讀取失敗" }, { value: "read_only", label: "唯讀" }, { value: "range_limit", label: "期間超限" }, { value: "scope_limit", label: "孩子記錄超限" }, { value: "lost", label: "失去存取" }] as { value: SummaryCondition; label: string }[])} onChange={preview.changeCondition} />
        <AppSelect label="摘要保存結果" value={preview.outcome} options={([{ value: "success", label: "成功" }, { value: "failed", label: "未獲接受" }, { value: "unknown", label: "結果未知" }, { value: "conflict", label: "版本衝突" }, { value: "confirmed_unread", label: "保存已確認但摘要未讀回" }] as { value: SummaryOutcome; label: string }[])} onChange={preview.setOutcome} />
        <AppSelect label="摘要原收據查核結果" value={preview.lookup} options={([{ value: "unknown", label: "仍未知" }, { value: "unconfirmed", label: "尚無確認收據" }, { value: "confirmed", label: "已確認並讀回" }, { value: "confirmed_unread", label: "已確認但摘要未讀回" }] as { value: SummaryLookup; label: string }[])} onChange={preview.setLookup} />
        <AppSelect label="摘要重讀資料" value={preview.read} options={([{ value: "same", label: "同一來源及準備" }, { value: "changed", label: "來源及家庭準備已改變" }, { value: "appointment_missing", label: "原預約已不在清單" }] as { value: SummaryRead; label: string }[])} onChange={preview.setRead} />
        <Text style={s.meta}>預覽帳戶：{identity} · Server：{server}；切換前先保護草稿及原操作。</Text>
        <AppButton label="切換摘要預覽帳戶" variant="secondary" onPress={onIdentity} /><AppButton label="切換摘要預覽 Server" variant="secondary" onPress={onServer} />
      </> : null}
    </SectionCard>} />;
}

// Compatibility entry retains the original controller; it is not a second preparation-document owner.
export function LegacySummaryRecovery({ child, online, onReturn }: { child: HomeChild; online: boolean; onReturn(): void }) {
  const navigate = usePreviewNavigation();
  const [identity, setIdentity] = useState("合成媽媽"), [server, setServer] = useState("合成 A");
  return <LegacyWorkspace key={JSON.stringify([child.id, child.accessRole, identity, server])} child={child} online={online} identity={identity} server={server} onReturn={onReturn}
    onIdentity={() => navigate(() => setIdentity(value => value === "合成媽媽" ? "合成爸爸" : "合成媽媽"))}
    onServer={() => navigate(() => setServer(value => value === "合成 A" ? "合成 B" : "合成 A"))} />;
}
