import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { AppButton } from "../ui";
import { AppStatusBadge, type AppStatusTone } from "../AppStatusBadge";
import { useContainerWidth } from "../useContainerWidth";
import { useProfileWorkspace } from "../../workspaces/ProfileWorkspace";
import { authorizedChildMeasurements, childProfileAgeLabel, readChildProfile, type ChildMeasurementFact, type ChildMeasurementsProjection, type ChildProfileSourceProjection } from "../../child-overview-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";

export type ChildOverviewContentProps = {
  measurements?: ChildMeasurementsProjection;
  profileSource?: ChildProfileSourceProjection;
  onOpenProfile: () => void;
  onOpenProfileHistory: () => void;
  onOpenMeasurement?: (recordId: string) => void;
};

export function ChildOverviewContent({ measurements, profileSource, onOpenProfile, onOpenProfileHistory, onOpenMeasurement }: ChildOverviewContentProps) {
  const workspace = useProfileWorkspace();
  const model = workspace?.model ?? null, scopeKey = workspace?.scopeKey ?? "";
  const layout = useContainerWidth(), wide = layout.width >= 760;
  const reading = readChildProfile(model, scopeKey, DateTime.now().setZone("Asia/Hong_Kong").toISODate()!, profileSource ?? workspace?.profileSource);
  const data = reading.data;
  const projection = authorizedChildMeasurements(measurements ?? workspace?.measurements, scopeKey, model);
  const tone: AppStatusTone = reading.state === "confirmed" ? "success" : reading.state === "loading" ? "info" : reading.state === "access_lost" || reading.state === "source_invalidated" ? "error" : "warning";
  const inaccessible = reading.state === "access_lost";
  const pending = model?.operation.state === "saving" || model?.operation.state === "unknown";
  const lastKnown = reading.state === "expired" || reading.state === "validity_unknown" || !!model?.needsRefresh || model?.online === false;
  const profileValue = (value: string | null | undefined) => value ?? (reading.state === "source_invalidated" ? "來源已失效" : reading.state === "source_unavailable" ? "來源暫不可讀" : "未知");
  return <View ref={layout.ref} onLayout={layout.onLayout} style={styles.content} testID="child-overview-content">
    <View style={styles.identity}>
      <View style={styles.identityText}>
        <View style={styles.row}><AppStatusBadge label={reading.statusLabel} tone={tone} />{model?.access === "read_only" ? <AppStatusBadge label="唯讀" /> : null}</View>
        <Text accessibilityRole="header" style={styles.childName}>{model?.child?.name ?? "孩子概況"}</Text>
        <Text style={styles.age}>{reading.state === "loading" ? "正在讀取年齡資料" : reading.state === "source_invalidated" || reading.state === "source_unavailable" || inaccessible ? "年齡資料暫不可讀" : childProfileAgeLabel(data)}</Text>
      </View>
      {!inaccessible ? <AppButton label={model?.access === "read_only" ? "查看原檔案" : model?.child ? "查看／更正檔案" : "新增孩子及檔案"} variant="secondary" density="compact" onPress={onOpenProfile} disabled={!model} /> : null}
    </View>
    {reading.message ? <View style={styles.notice}><Text style={styles.noticeText}>{reading.message}</Text></View> : null}
    {model && (!model.online || model.needsRefresh) ? <View style={styles.notice}><Text style={styles.noticeText}>{!model.online ? "目前離線，以下已載入內容尚未重新核對。" : "連線已恢復，檔案尚待重新讀取及核對。"}</Text>{model.online && !inaccessible ? <AppButton label="重新讀取檔案" variant="secondary" density="compact" onPress={workspace!.actions.refresh} disabled={model.reading || pending} /> : null}</View> : null}
    {pending ? <View style={styles.notice}><AppStatusBadge label={model?.operation.state === "unknown" ? "檔案操作結果未知" : "檔案正在保存"} tone="warning" /><Text style={styles.noticeText}>畫面只顯示最後確認內容，請在原檔案查核同一操作。</Text><AppButton label="返回原檔案查核" variant="secondary" density="compact" onPress={onOpenProfile} /></View> : null}
    {!inaccessible && model?.child ? <>
      <View style={styles.measurements}>
        <MeasurementCard label="身高" fact={projection?.height ?? null} state={projection?.state ?? "unavailable"} onOpen={onOpenMeasurement} />
        <MeasurementCard label="體重" fact={projection?.weight ?? null} state={projection?.state ?? "unavailable"} onOpen={onOpenMeasurement} />
      </View>
      <View style={[styles.sections, wide && styles.sectionsWide]}>
        <View style={[styles.section, wide && styles.interests]}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>興趣與生活偏好</Text>
          {data?.preferences ? <>
            {lastKnown ? <Text style={styles.meta}>最後確認的資料</Text> : null}
            <Text selectable style={styles.preference}>{data.preferences}</Text>
          </> : <Text style={styles.body}>{reading.state === "source_invalidated" || reading.state === "source_unavailable" ? profileValue(null) : reading.state === "loading" ? "正在讀取興趣與生活偏好" : "暫無興趣與生活偏好資料"}</Text>}
        </View>
        <View style={[styles.section, wide && styles.careFacts]}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>日常照顧要點</Text>
          <Fact label="過敏資料" value={profileValue(data?.allergies)} />
          <Fact label="特別需要" value={profileValue(data?.specialNeeds)} />
          <Fact label="語言" value={profileValue(data?.language)} />
          <Fact label="地區" value={profileValue(data?.region)} />
          {data?.dueDate ? <Fact label="預產期" value={data.dueDate} /> : null}
          {data?.gestationalWeeksRaw ? <Fact label="出生孕週原文" value={data.gestationalWeeksRaw} /> : null}
        </View>
      </View>
      <View style={styles.source}>
        {data ? <View style={styles.sourceText}>
          <Text style={styles.meta}>檔案來源：{data.source || "未提供"}</Text>
          <Text style={styles.meta}>最後確認：{model.current?.confirmedAtLabel ?? "未知"}{data.validUntil ? ` · 有效至 ${data.validUntil}` : ""}</Text>
        </View> : null}
        <AppButton label="查看檔案更正歷史" variant="quiet" density="compact" onPress={onOpenProfileHistory} disabled={!model.online || model.reading || pending} />
      </View>
    </> : null}
  </View>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}
function MeasurementCard({ label, fact, state, onOpen }: { label: string; fact: ChildMeasurementFact | null; state: ChildMeasurementsProjection["state"]; onOpen?: (recordId: string) => void }) {
  const invalid = fact?.state === "source_invalidated";
  const available = state === "ready" && fact && !invalid;
  const emptyLabel = invalid ? `${label}量度來源已失效` : state === "ready" ? `暫無${label}量度` : state === "loading" ? `正在讀取${label}量度` : state === "error" ? `${label}量度未能讀取` : `${label}量度暫不可用`;
  return <View style={[styles.measurement, !available && styles.measurementEmpty]} testID={`child-overview-${label === "身高" ? "height" : "weight"}`}>
    {available ? <>
      <Text style={styles.factLabel}>{label}</Text>
      <Text selectable style={styles.measurementValue}>{fact.valueLabel}</Text>
      {fact.state === "expired" ? <AppStatusBadge label="量度資料已過期" tone="warning" /> : null}
      <Text style={styles.meta}>量度日期：{fact.measuredAtLabel ?? "未知"}</Text><Text style={styles.meta}>來源：{fact.sourceLabel ?? "未提供"}</Text>
      {onOpen ? <AppButton label="查看量度原記錄" accessibilityLabel={`查看${label}量度原記錄`} variant="quiet" density="compact" onPress={() => onOpen(fact.recordId)} /> : null}
    </> : <Text style={styles.body}>{emptyLabel}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, minWidth: 0 },
  identity: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  identityText: { flex: 1, minWidth: 150, gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  childName: { fontFamily: chineseFont, fontSize: typeScale.heading, lineHeight: 36, fontWeight: "700", color: colors.ink },
  age: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink },
  notice: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.sm },
  noticeText: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk },
  measurements: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  measurement: { flex: 1, flexBasis: 140, minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.white },
  measurementEmpty: { borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: spacing.sm },
  measurementValue: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 32, fontWeight: "700", color: colors.ink },
  sections: { gap: spacing.xl }, sectionsWide: { flexDirection: "row", alignItems: "flex-start" },
  section: { minWidth: 0, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  interests: { flex: 1.2 }, careFacts: { flex: 1 },
  sectionTitle: { fontFamily: chineseFont, fontSize: typeScale.body, lineHeight: 26, fontWeight: "700", color: colors.ink },
  preference: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink, borderLeftWidth: 3, borderLeftColor: colors.sage, paddingLeft: spacing.md },
  fact: { gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingBottom: spacing.sm },
  factLabel: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, fontWeight: "700" },
  body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink, flexShrink: 1 },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1 },
  source: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  sourceText: { flex: 1, minWidth: 180, gap: spacing.xs },
});
