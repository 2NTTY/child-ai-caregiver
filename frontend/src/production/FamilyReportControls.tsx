import { View } from "react-native";
import { Text } from "react-native-paper";
import { useProductionFamilyDocuments } from "./TaskKnowledgeDomains";
import { WriteRecoveryNotice } from "../components/WriteRecoveryNotice";
import { SummaryDisclosure } from "../components/summary/SummaryDisclosure";
import { DocumentCreateForm } from "../components/preparations/DocumentCreateForm";
import { AppButton } from "../components/ui";
import { growthStyles as s } from "../components/growth/growth-styles";

export function FamilyReportControls({ scopeKey, online }: { scopeKey: string; online: boolean }) {
  const owner = useProductionFamilyDocuments();
  if (!owner) return null;
  return <View style={s.smallStack}>
    <WriteRecoveryNotice operation={owner.operation} recovery={owner.recovery} online={online && !owner.busy} />
    {owner.notice ? <Text accessibilityLiveRegion="polite" style={s.meta}>{owner.notice}</Text> : null}
    {owner.standard?.report?.phase === "building" ? <Text accessibilityLiveRegion="polite" style={s.meta}>整理進度已保存，目前已掃描 {owner.standard.report.processedSources} 項來源；背景會接續，毋須重建文件。</Text> : null}
    {owner.standard?.report?.phase === "building" || owner.standard?.readState === "stale" || owner.standard?.readState === "invalidated" ? <AppButton label={owner.standard?.report?.phase === "building" ? "接續一批整理" : "按目前共享來源整理新版本"} variant="secondary" disabled={owner.locked} onPress={owner.refreshReport} /> : null}
    <AppButton label={owner.busy ? "正在處理文件…" : owner.operation.recovery === "check" ? "重讀並核對原操作" : "重新讀取報告"}
      variant="quiet" density="compact" disabled={owner.busy || owner.exportBusy || !online} onPress={owner.refresh} />
    <SummaryDisclosure label={owner.standard ? "其他用途／期間的手動備援" : "建立成長報告（手動備援）"} scopeKey={scopeKey}>
      <DocumentCreateForm owner={owner} kind="growth_report" purpose="family" />
    </SummaryDisclosure>
  </View>;
}
