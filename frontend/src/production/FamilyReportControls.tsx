import { View } from "react-native";
import { Text } from "react-native-paper";
import { useProductionFamilyDocuments } from "./TaskKnowledgeDomains";
import { WriteRecoveryNotice } from "../components/WriteRecoveryNotice";
import { ManualFormDialog } from "../components/FormDialog";
import { DocumentCreateForm } from "../components/preparations/DocumentCreateForm";
import { AppButton } from "../components/ui";
import { growthStyles as s } from "../components/growth/growth-styles";

export function FamilyReportControls({ scopeKey, online, onRefresh }: { scopeKey: string; online: boolean; onRefresh?: () => void }) {
  const owner = useProductionFamilyDocuments();
  if (!owner) return null;
  return <View style={s.smallStack}>
    <WriteRecoveryNotice operation={owner.operation} recovery={owner.recovery} online={online && !owner.busy} />
    {owner.notice ? <Text accessibilityLiveRegion="polite" style={s.meta}>{owner.notice}</Text> : null}
    {owner.standard?.report?.phase === "building" ? <Text accessibilityLiveRegion="polite" style={s.meta}>整理進度已保存，目前已掃描 {owner.standard.report.processedSources} 項來源；背景會接續，毋須重建文件。</Text> : null}
    {owner.standard?.report?.phase === "building" || owner.standard?.readState === "stale" || owner.standard?.readState === "invalidated" ? <AppButton label={owner.standard?.report?.phase === "building" ? "接續一批整理" : "按目前共享來源整理新版本"} variant="secondary" disabled={owner.locked} onPress={owner.refreshReport} /> : null}
    <AppButton label={owner.busy ? "正在處理文件…" : owner.operation.recovery === "check" ? "重讀並核對原操作" : "重新讀取報告"}
      variant="quiet" density="compact" disabled={owner.busy || owner.exportBusy || !online} onPress={onRefresh ?? owner.refresh} />
    <ManualFormDialog label={owner.standard ? "手動建立其他報告" : "手動建立報告"} title="建立成長報告" scopeKey={scopeKey}
      recovery={<><WriteRecoveryNotice operation={owner.operation} recovery={owner.recovery} online={online && !owner.busy} />{owner.notice ? <Text accessibilityLiveRegion="polite" style={s.meta}>{owner.notice}</Text> : null}</>}>
      <DocumentCreateForm owner={owner} kind="growth_report" purpose="family" />
    </ManualFormDialog>
  </View>;
}
