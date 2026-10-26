import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { AppButton } from "../ui";
import { AppDialog } from "../AppDialog";
import { AppScrollView } from "../AppScrollView";
import { AppStatusBadge, type AppStatusTone } from "../AppStatusBadge";
import { useContainerWidth } from "../useContainerWidth";
import { useProfileWorkspace } from "../../workspaces/ProfileWorkspace";
import { authorizedChildMeasurements, childProfileAgeLabel, readChildProfile, type ChildMeasurementFact, type ChildMeasurementsProjection, type ChildProfileSourceProjection } from "../../child-overview-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";

export type ChildOverviewContentProps = {
  companion?: ReactNode;
  avatar?: ReactNode;
  measurements?: ChildMeasurementsProjection;
  profileSource?: ChildProfileSourceProjection;
  onOpenProfile: () => void;
  onOpenProfileHistory: () => void;
  onOpenMeasurement?: (recordId: string) => void;
};

export function ChildOverviewContent({ avatar, companion, measurements, profileSource, onOpenProfile, onOpenProfileHistory, onOpenMeasurement }: ChildOverviewContentProps) {
  const workspace = useProfileWorkspace();
  const model = workspace?.model ?? null, scopeKey = workspace?.scopeKey ?? "";
  const layout = useContainerWidth(), wide = layout.width >= 760;
  const [details, setDetails] = useState(false);
  useEffect(() => { setDetails(false); }, [scopeKey, model?.child?.id, model?.access === "lost"]);
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
      {!inaccessible && avatar ? avatar : <View style={styles.avatar} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={styles.avatarText}>{Array.from(model?.child?.name?.trim() ?? "")[0] ?? "子"}</Text></View>}
      <View style={styles.identityText}>
        <View style={styles.row}><AppStatusBadge label={reading.statusLabel} tone={tone} />{model?.access === "read_only" ? <AppStatusBadge label="唯讀" /> : null}</View>
        <Text accessibilityRole="header" aria-level={2} style={styles.childName}>{model?.child?.name ?? "孩子概況"}</Text>
        <Text style={styles.age}>{reading.state === "loading" ? "正在讀取年齡資料" : reading.state === "source_invalidated" || reading.state === "source_unavailable" || inaccessible ? "年齡資料暫不可讀" : childProfileAgeLabel(data, DateTime.now().setZone("Asia/Hong_Kong").toISODate()!)}{data?.language ? ` · ${data.language}` : ""}</Text>
      </View>
      {!inaccessible ? <AppButton label={model?.child ? "查看孩子檔案" : "新增孩子及檔案"} variant="secondary" density="compact" onPress={onOpenProfile} disabled={!model} /> : null}
    </View>
    {reading.message ? <View style={styles.notice}><Text style={styles.noticeText}>{reading.message}</Text></View> : null}
    {model && (!model.online || model.needsRefresh) ? <View style={styles.notice}><Text style={styles.noticeText}>{!model.online ? "目前離線，以下已載入內容尚未重新核對。" : "連線已恢復，檔案尚待重新讀取及核對。"}</Text>{model.online && !inaccessible ? <AppButton label="重新讀取檔案" variant="secondary" density="compact" onPress={workspace!.actions.refresh} disabled={model.reading || pending} /> : null}</View> : null}
    {pending ? <View style={styles.notice}><AppStatusBadge label={model?.operation.state === "unknown" ? "檔案操作結果未知" : "檔案正在保存"} tone="warning" /><Text style={styles.noticeText}>畫面只顯示最後確認內容，請在原檔案查核同一操作。</Text><AppButton label="返回原檔案查核" variant="secondary" density="compact" onPress={onOpenProfile} /></View> : null}
    <View style={styles.measurementSection} testID="overview-measurement-band">
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>最近確認的量度</Text>
      <View style={styles.measurements}><MeasurementCard label="身高" fact={projection?.height ?? null} state={projection?.state ?? "unavailable"} onOpen={onOpenMeasurement} />
        <MeasurementCard label="體重" fact={projection?.weight ?? null} state={projection?.state ?? "unavailable"} onOpen={onOpenMeasurement} /></View>
    </View>
    <View style={[styles.sections, wide && styles.sectionsWide]}>
      <View style={[styles.personal, wide && styles.interests]} testID="overview-personal">
        <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.cardTitle}>日常照顧要點</Text><Text style={styles.meta}>偏好、過敏與特別需要</Text></View>
        {lastKnown && data ? <Text style={styles.meta}>最後確認的資料</Text> : null}
        {data?.preferences ? <Text selectable numberOfLines={4} style={styles.preference}>{data.preferences}</Text>
          : <Text style={styles.body}>{reading.state === "loading" ? "正在讀取生活偏好…" : inaccessible || reading.state === "source_invalidated" || reading.state === "source_unavailable" ? "生活偏好來源暫不可讀。" : "還未記下生活偏好。可在孩子檔案留下喜歡的事物與相處方式。"}</Text>}
        {data ? <View style={styles.careNote}><Text style={styles.factLabel}>照顧時留意</Text><Text style={styles.body}>{data.allergies ? `過敏資料：${data.allergies}` : "過敏資料尚未確認。"}</Text>{data.specialNeeds ? <Text style={styles.body}>{data.specialNeeds}</Text> : null}</View> : null}
        <View style={styles.cardFooter}><Text style={styles.meta}>{data ? "來自孩子檔案，由家人確認。" : "生活偏好與照顧資料，以孩子檔案為準。"}</Text><AppButton label="查看照顧資料與來源" variant="quiet" density="compact" onPress={() => setDetails(true)} disabled={!model?.child || inaccessible} /></View>
      </View>
      {companion ? <View style={[styles.companion, wide && styles.careFacts]}>{companion}</View> : null}
    </View>
    <AppDialog visible={details && !!model?.child && !inaccessible} onDismiss={() => setDetails(false)} accessibilityLabel="照顧資料與來源" style={styles.details}>
      <AppDialog.Title>照顧資料與來源</AppDialog.Title>
      <AppDialog.ScrollArea><AppScrollView contentContainerStyle={styles.detailsContent}>
        {reading.message ? <Text style={styles.noticeText}>{reading.message}</Text> : null}
        {lastKnown ? <Text style={styles.noticeText}>以下為最後確認內容，尚待核對是否仍然適用。</Text> : null}
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>興趣與生活偏好</Text>
        <Text selectable style={styles.body}>{data?.preferences ?? profileValue(null)}</Text>
        <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>日常照顧要點</Text>
        <Fact label="過敏資料" value={profileValue(data?.allergies)} /><Fact label="特別需要" value={profileValue(data?.specialNeeds)} />
        {data?.age.kind === "birth_date" ? <Fact label="出生日期" value={data.age.date} /> : null}
        <Fact label="語言" value={profileValue(data?.language)} /><Fact label="地區" value={profileValue(data?.region)} />
        {data?.dueDate ? <Fact label="預產期" value={data.dueDate} /> : null}
        {data?.gestationalWeeksRaw ? <Fact label="出生孕週原文" value={data.gestationalWeeksRaw} /> : null}
        {data ? <View style={styles.sourceText}><Text selectable style={styles.meta}>檔案來源：{data.source || "未提供"}</Text><Text style={styles.meta}>最後確認：{model?.current?.confirmedAtLabel ?? "未知"}{data.validUntil ? ` · 有效至 ${data.validUntil}` : ""}</Text></View> : null}
        <AppButton label="查看檔案更正歷史" variant="quiet" density="compact" onPress={onOpenProfileHistory} disabled={!model?.online || model.reading || pending} />
      </AppScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="關閉照顧資料" variant="quiet" onPress={() => setDetails(false)} /></AppDialog.Actions>
    </AppDialog>
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
  identity: { paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  identityText: { flex: 1, minWidth: 150, gap: spacing.sm },
  avatar: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.paleTeal, borderWidth: 1, borderColor: colors.sage, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: chineseFont, fontSize: typeScale.heading, lineHeight: 36, fontWeight: "700", color: colors.ink },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  childName: { fontFamily: chineseFont, fontSize: typeScale.heading, lineHeight: 36, fontWeight: "700", color: colors.ink },
  age: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink },
  notice: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.sm },
  noticeText: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk },
  measurementSection: { gap: spacing.md },
  measurements: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  measurement: { flex: 1, flexBasis: 140, minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.white },
  measurementEmpty: { borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: spacing.sm },
  measurementValue: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 32, fontWeight: "700", color: colors.ink },
  sections: { gap: spacing.xl }, sectionsWide: { flexDirection: "row", alignItems: "stretch" },
  personal: { minWidth: 0, gap: spacing.lg, padding: spacing.lg, borderRadius: radius.medium, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  companion: { minWidth: 0 }, heading: { gap: spacing.xs },
  cardTitle: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", color: colors.ink },
  cardFooter: { marginTop: "auto", gap: spacing.sm, alignItems: "flex-start", borderTopWidth: 1, borderTopColor: colors.sage, paddingTop: spacing.md },
  careNote: { gap: spacing.sm, padding: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.teal, backgroundColor: colors.paleTeal },
  details: { maxWidth: 720 }, detailsContent: { paddingVertical: spacing.lg, gap: spacing.lg, minWidth: 0 },
  interests: { flex: 1.2 }, careFacts: { flex: 1 },
  sectionTitle: { fontFamily: chineseFont, fontSize: typeScale.body, lineHeight: 26, fontWeight: "700", color: colors.ink },
  preference: { fontFamily: chineseFont, ...readingType.body, color: colors.ink },
  fact: { gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingBottom: spacing.sm },
  factLabel: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, fontWeight: "700" },
  body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink, flexShrink: 1 },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1 },
  source: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  sourceText: { flex: 1, minWidth: 180, gap: spacing.xs },
});
