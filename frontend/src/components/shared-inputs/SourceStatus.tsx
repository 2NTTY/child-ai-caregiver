import { View } from "react-native";
import { Text } from "react-native-paper";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { AppStatusBadge } from "../AppStatusBadge";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, OperationPill, SectionCard, SectionHeader } from "../ui";
import { sourceStyles as s } from "./source-styles";

export function SourceStatus({ model, actions, production }: { model: SourcesViewModel; actions: SourcesActions; production: boolean }) {
  const op = model.operation;
  const pill = op.state === "saved" && op.phase === "extract" ? "needs_confirmation" : op.state === "unconfirmed" ? "unknown" : op.state === "conflict" ? "needs_confirmation"
    : op.state === "confirmed_unavailable" ? "saved" : op.state;
  return <><StatusAnnouncement eventKey={`${op.state}:${op.phase}:${op.reference}:${op.message}:${model.notice}`} message={[op.message, model.notice].filter(Boolean).join(" ")} urgent={op.state === "failed"} />
    {op.state === "none" && !model.notice ? null : <SectionCard surface="plain" style={s.operationBanner} testID="source-operation"><SectionHeader density="compact" title="這次來源操作" />
    {op.state === "confirmed_unavailable" ? <AppStatusBadge label="原操作已確認 · 結果不可讀" tone="warning" /> : op.state === "saved" && op.phase === "delete" ? <AppStatusBadge label={production ? "已刪除" : "已刪除（合成預覽）"} tone="success" /> : op.state === "conflict" ? <AppStatusBadge label="版本衝突 · 待核對" tone="warning" /> : op.state !== "none" ? <OperationPill state={pill} /> : null}
    {op.reference && op.state !== "saved" ? <Text selectable style={s.meta}>{production ? "原操作參考：" : "合成原操作參考："}{op.reference}</Text> : null}
    {op.message ? <Text style={s.body}>{op.message}</Text> : null}
    {model.notice ? <Text style={s.body}>{model.notice}</Text> : null}
    {op.state === "unknown" || op.state === "unconfirmed" || op.state === "confirmed_unavailable" ? <AppButton label="查核原次結果" disabled={!model.online || model.busy || model.access === "lost"} variant="secondary" onPress={actions.checkOriginal} /> : null}
    {op.state === "unconfirmed" && op.checked ? <AppButton label="沿原內容及參考重試" disabled={!model.online || model.busy || model.load !== "ready" || model.access !== "editable"} variant="secondary" onPress={actions.retryOriginal} /> : null}
    {op.state === "confirmed_unavailable" ? <AppButton label="結束已確認操作" disabled={!op.checked || !model.online || model.load !== "ready" || model.busy || model.access === "lost"} variant="secondary" onPress={actions.finishUnavailable} /> : null}
    {op.state === "conflict" ? <><Text style={s.warning}>編輯基準版本 {model.selected?.version ?? "未知"}；{model.latest ? `目前版本 ${model.latest.version}` : "請先重新讀取目前版本"}。草稿沒有被覆蓋。</Text>
      <AppButton label="明確使用目前版本" disabled={!model.latest || !model.online || model.load !== "ready" || model.busy || model.access !== "editable"} variant="secondary" onPress={actions.useLatest} />
    </> : null}
  </SectionCard>}</>;
}
