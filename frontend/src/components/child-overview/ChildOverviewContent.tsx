import { useEffect, useId, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { AppButton } from "../ui";
import { AppStatusBadge, type AppStatusTone } from "../AppStatusBadge";
import { ReadTargetLink } from "../ReadTargetLink";
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
  const detailsId = `overview-profile-details-${useId().replace(/:/g, "")}`;
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
  return <View style={styles.content} testID="child-overview-content">
    <View style={styles.identity}>
      {!inaccessible && avatar ? avatar : <View style={styles.avatar} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={styles.avatarText}>{Array.from(model?.child?.name?.trim() ?? "")[0] ?? "子"}</Text></View>}
      <View style={styles.identityText}>
        <View style={styles.row}><AppStatusBadge label={reading.statusLabel} tone={tone} />{model?.access === "read_only" ? <AppStatusBadge label="唯讀" /> : null}</View>
        <Text accessibilityRole="header" aria-level={2} style={styles.childName}>{model?.child?.name ?? "孩子概況"}</Text>
        <Text style={styles.age}>{reading.state === "loading" ? "正在讀取年齡資料" : reading.state === "source_invalidated" || reading.state === "source_unavailable" || inaccessible ? "年齡資料暫不可讀" : childProfileAgeLabel(data, DateTime.now().setZone("Asia/Hong_Kong").toISODate()!)}{data?.language ? ` · ${data.language}` : ""}</Text>
      </View>
      {!inaccessible ? <ReadTargetLink href="/profile" label={model?.child ? "查看孩子檔案" : "新增孩子及檔案"} onOpen={onOpenProfile} availability={model ? "ready" : "unavailable"} style={styles.link}><Text style={styles.linkLabel}>{model?.child ? "查看孩子檔案" : "新增孩子及檔案"}</Text></ReadTargetLink> : null}
    </View>
    {reading.message ? <View style={styles.notice}><Text style={styles.noticeText}>{reading.message}</Text></View> : null}
    {model && (!model.online || model.needsRefresh) ? <View style={styles.notice}><Text style={styles.noticeText}>{!model.online ? "目前離線，以下已載入內容尚未重新核對。" : "連線已恢復，檔案尚待重新讀取及核對。"}</Text>{model.online && !inaccessible ? <AppButton label="重新讀取檔案" variant="secondary" density="compact" onPress={workspace!.actions.refresh} disabled={model.reading || pending} /> : null}</View> : null}
    {pending ? <View style={styles.notice}><AppStatusBadge label={model?.operation.state === "unknown" ? "檔案操作結果未知" : "檔案正在保存"} tone="warning" /><Text style={styles.noticeText}>畫面只顯示最後確認內容，請在原檔案查核同一操作。</Text><ReadTargetLink href="/profile" label="返回原檔案查核" onOpen={onOpenProfile} style={styles.link}><Text style={styles.linkLabel}>返回原檔案查核</Text></ReadTargetLink></View> : null}
    <View style={styles.section} testID="overview-personal">
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>日常照顧要點</Text>
      {lastKnown && data ? <Text style={styles.noticeText}>最後確認的資料，尚待核對是否仍然適用。</Text> : null}
      {data ? <View style={styles.careNote}><Text accessibilityRole="header" aria-level={3} style={styles.factLabel}>照顧時留意</Text><Text selectable style={styles.body}>{data.allergies ? `過敏資料：${data.allergies}` : "過敏資料尚未確認。"}</Text><Text selectable style={styles.body}>{data.specialNeeds ?? "特別需要尚未確認。"}</Text></View> : null}
      <View style={styles.careNote}><Text accessibilityRole="header" aria-level={3} style={styles.factLabel}>生活與相處偏好</Text>{data?.preferences ? <Text selectable style={styles.body}>{data.preferences}</Text>
        : <Text style={styles.body}>{reading.state === "loading" ? "正在讀取生活偏好…" : inaccessible || reading.state === "source_invalidated" || reading.state === "source_unavailable" ? "生活偏好來源暫不可讀。" : "尚未記下生活偏好，可到孩子檔案補充。"}</Text>}</View>
      <View style={styles.detailsControl}><AppButton label="其他檔案資料與來源" variant="quiet" density="compact" expanded={details} controls={detailsId} onPress={() => setDetails(value => !value)} disabled={!model?.child || inaccessible} /></View>
      {details && !!model?.child && !inaccessible ? <View nativeID={detailsId} style={styles.detailsContent}>
        {data?.age.kind === "birth_date" ? <Fact label="出生日期" value={data.age.date} /> : null}
        <Fact label="語言" value={profileValue(data?.language)} /><Fact label="地區" value={profileValue(data?.region)} />
        {data?.dueDate ? <Fact label="預產期" value={data.dueDate} /> : null}
        {data?.gestationalWeeksRaw ? <Fact label="出生孕週原文" value={data.gestationalWeeksRaw} /> : null}
        {data ? <View style={styles.sourceText}><Fact label="檔案來源" value={data.source || "未提供"} /><Text style={styles.meta}>最後確認：{model?.current?.confirmedAtLabel ?? "未知"}{data.validUntil ? ` · 有效至 ${data.validUntil}` : ""}</Text></View> : null}
        <ReadTargetLink href="/history?category=profile" label="查看檔案更正歷史" onOpen={onOpenProfileHistory} preserveFocusWhenDisabled={!!data && !inaccessible} availability={!model?.online || model.reading || pending ? "unavailable" : "ready"} style={styles.link}><Text style={styles.linkLabel}>查看檔案更正歷史</Text></ReadTargetLink>
      </View> : null}
    </View>
    {companion}
    <View style={styles.section}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>最近量度</Text>
      <View style={styles.measurements}><MeasurementReading label="身高" fact={projection?.height ?? null} state={projection?.state ?? "unavailable"} onOpen={onOpenMeasurement} />
        <MeasurementReading label="體重" fact={projection?.weight ?? null} state={projection?.state ?? "unavailable"} onOpen={onOpenMeasurement} /></View>
    </View>
  </View>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}
function MeasurementReading({ label, fact, state, onOpen }: { label: string; fact: ChildMeasurementFact | null; state: ChildMeasurementsProjection["state"]; onOpen?: (recordId: string) => void }) {
  const invalid = fact?.state === "source_invalidated";
  const available = state === "ready" && fact && !invalid;
  const emptyLabel = invalid ? `${label}量度來源已失效` : state === "ready" ? `暫無${label}量度` : state === "loading" ? `正在讀取${label}量度` : state === "error" ? `${label}量度未能讀取` : `${label}量度暫不可用`;
  return <View style={[styles.measurement, !available && styles.measurementEmpty]} testID={`child-overview-${label === "身高" ? "height" : "weight"}`}>
    {available ? <>
      <Text style={styles.factLabel}>{label}</Text>
      <Text selectable style={styles.measurementValue}>{fact.valueLabel}</Text>
      {fact.state === "expired" ? <AppStatusBadge label="量度資料已過期" tone="warning" /> : null}
      <Text style={styles.meta}>量度日期：{fact.measuredAtLabel ?? "未知"}</Text><Text style={styles.meta}>來源：{fact.sourceLabel ?? "未提供"}</Text>
      {onOpen ? <ReadTargetLink href={`/care?tab=records&recordId=${encodeURIComponent(fact.recordId)}`} label={`查看${label}量度原記錄`} onOpen={() => onOpen(fact.recordId)} style={styles.link}><Text style={styles.linkLabel}>查看量度原記錄</Text></ReadTargetLink> : null}
    </> : <Text style={styles.body}>{emptyLabel}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, minWidth: 0, width: "100%", maxWidth: 760 },
  identity: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  identityText: { flex: 1, minWidth: 150, gap: spacing.sm },
  avatar: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.paleTeal, borderWidth: 1, borderColor: colors.sage, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: chineseFont, fontSize: typeScale.heading, lineHeight: 36, fontWeight: "700", color: colors.ink },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  childName: { fontFamily: chineseFont, fontSize: typeScale.heading, lineHeight: 36, fontWeight: "700", color: colors.ink },
  age: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink },
  notice: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: spacing.md, gap: spacing.sm },
  noticeText: { fontFamily: chineseFont, ...readingType.body, color: colors.warningInk },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", color: colors.ink },
  careNote: { gap: spacing.sm },
  detailsControl: { alignItems: "flex-start" },
  detailsContent: { gap: spacing.md, paddingLeft: spacing.md, borderLeftWidth: 1, borderLeftColor: colors.line },
  measurements: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.xl, rowGap: spacing.md },
  measurement: { flex: 1, flexBasis: 240, minWidth: 0, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md },
  measurementEmpty: { paddingVertical: spacing.sm },
  measurementValue: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 32, fontWeight: "700", color: colors.ink },
  fact: { gap: spacing.xs },
  factLabel: { fontFamily: chineseFont, ...readingType.body, color: colors.ink, fontWeight: "700" },
  body: { fontFamily: chineseFont, ...readingType.body, color: colors.ink, flexShrink: 1 },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1 },
  sourceText: { gap: spacing.sm },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.small, maxWidth: "100%" },
  linkLabel: { fontFamily: chineseFont, ...readingType.body, color: colors.teal, fontWeight: "600", textDecorationLine: "underline" },
});
