import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { SectionCard, SectionHeader } from "../ui";
import { profileAgeUnitOptions, type ProfileDataView, type ProfileRevisionView } from "../../profile-view-model";
import { chineseFont, colors, spacing, typeScale , readingType } from "../../theme";


export function ProfileKeyFacts({ revision }: { revision: ProfileRevisionView | null }) {
  const data = revision?.data;
  const age = data?.age;
  const ageLabel = !age || age.kind === "unknown" ? "未知" : age.kind === "birth_date" ? `出生於 ${age.date}` : `約 ${age.rawValue} ${profileAgeUnitOptions.find(item => item.value === age.unit)?.label ?? age.unit}（截至 ${age.asOf}）`;
  return <View style={styles.keyFacts}>
    {[
      { label: "年齡基準", value: ageLabel },
      { label: "過敏資料", value: data?.allergies ?? "未知" },
      { label: "特別需要", value: data?.specialNeeds ?? "未知" },
    ].map(item => <View key={item.label} style={styles.keyFact}><Text style={styles.label}>{item.label}</Text><Text style={styles.factValue}>{item.value}</Text></View>)}
  </View>;
}

export function ProfileDataSummary({ data }: { data: ProfileDataView | null }) {
  if (!data) return <Text style={styles.body}>沒有已確認檔案。</Text>;
  const age = data.age;
  const ageLabel = age.kind === "unknown" ? "未知"
    : age.kind === "birth_date" ? `出生日期 ${age.date}`
      : `約 ${age.rawValue} ${profileAgeUnitOptions.find(item => item.value === age.unit)?.label}（截至 ${age.asOf}）`;
  const rows: { label: string; value: string | null }[] = [
    { label: "年齡資料", value: ageLabel }, { label: "預產期", value: data.dueDate },
    { label: "出生孕週原文", value: data.gestationalWeeksRaw }, { label: "地區", value: data.region },
    { label: "語言", value: data.language }, { label: "過敏資料", value: data.allergies },
    { label: "特別需要", value: data.specialNeeds }, { label: "照顧偏好", value: data.preferences },
    { label: "資料來源", value: data.source }, { label: "資料有效至", value: data.validUntil },
  ];
  return <View style={styles.rows}>{rows.map(row => <View key={row.label} style={styles.row}>
    <Text style={styles.label}>{row.label}</Text><Text style={[styles.body, styles.value]}>{row.value ?? "未知"}</Text>
  </View>)}</View>;
}

export function ProfileRevisionSummary({ revision }: { revision: ProfileRevisionView }) {
  return <View style={styles.rows}>
    <Text style={styles.version}>版本 {revision.version}</Text>
    <ProfileDataSummary data={revision.data} />
    <Text style={styles.meta}>確認人：{revision.confirmedByLabel ?? "未知"}；確認時間：{revision.confirmedAtLabel ?? "未知"}</Text>
    <Text style={styles.meta}>確認／更正原因：{revision.reason ?? "尚未確認"}</Text>
  </View>;
}

/** Read-only projection; the complete confirmation and conflict summaries stay unchanged. */
export function ProfileReadingSummary({ data, compact }: { data: ProfileDataView; compact: boolean }) {
  const age = data.age;
  const ageLabel = age.kind === "unknown" ? null : age.kind === "birth_date" ? `出生日期 ${age.date}`
    : `約 ${age.rawValue} ${profileAgeUnitOptions.find(item => item.value === age.unit)?.label ?? age.unit}（截至 ${age.asOf}）`;
  const groups = [
    { title: "健康與照顧", rows: [
      { label: "過敏資料", value: data.allergies }, { label: "特別需要", value: data.specialNeeds }, { label: "照顧偏好", value: data.preferences },
    ] },
    { title: "基本資料", rows: [
      { label: "年齡資料", value: ageLabel }, { label: "地區", value: data.region }, { label: "語言", value: data.language },
      { label: "預產期", value: data.dueDate }, { label: "出生孕週原文", value: data.gestationalWeeksRaw },
    ] },
  ];
  return <View testID="profile-reading-groups" style={[styles.groups, compact && styles.groupsStacked]}>{groups.map(group => {
    const known = group.rows.filter(row => row.value !== null), unknown = group.rows.filter(row => row.value === null);
    return <SectionCard key={group.title} style={[styles.group, group.title === "健康與照顧" && styles.careGroup, compact && styles.groupFull]}>
      <SectionHeader density="compact" title={group.title} icon={group.title === "健康與照顧" ? "shield-check-outline" : "account-child-outline"} />
      {known.map(row => <View key={row.label} style={styles.readingFact}><Text style={styles.readingLabel}>{row.label}</Text><Text style={styles.body}>{row.value}</Text></View>)}
      {unknown.length ? <Text style={[styles.meta, known.length > 0 && styles.unknownDivider]}>未知：{unknown.map(row => row.label).join("、")}</Text> : null}
    </SectionCard>;
  })}</View>;
}

export function ProfileRevisionDetails({ revision }: { revision: ProfileRevisionView }) {
  const rows = [
    { label: "版本", value: String(revision.version) }, { label: "資料來源", value: revision.data?.source ?? "未知" },
    { label: "資料有效至", value: revision.data?.validUntil ?? "未知" },
    { label: "確認人", value: revision.confirmedByLabel ?? "未知" }, { label: "確認時間", value: revision.confirmedAtLabel ?? "未知" },
    { label: "確認／更正原因", value: revision.reason ?? "尚未確認" },
  ];
  return <View testID="profile-revision-details" style={styles.rows}>{rows.map(row => <View key={row.label} style={styles.row}>
    <Text style={styles.label}>{row.label}</Text><Text style={[styles.body, styles.value]}>{row.value}</Text>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  groups: { flexDirection: "row", alignItems: "stretch", gap: spacing.lg, minWidth: 0 },
  groupsStacked: { flexDirection: "column" },
  careGroup: { borderTopWidth: 3, borderTopColor: colors.teal },
  group: { flex: 1, minWidth: 0, gap: spacing.md },
  groupFull: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto", width: "100%" },
  readingFact: { gap: spacing.xs, minWidth: 0 },
  readingLabel: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  unknownDivider: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  keyFacts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  keyFact: { flex: 1, flexBasis: 160, minWidth: 0, gap: spacing.xs, borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: spacing.md },
  factValue: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  rows: { gap: spacing.sm, minWidth: 0 }, row: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xs, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingBottom: spacing.sm },
  value: { flex: 1, minWidth: 120 },
  label: { width: 100, fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  version: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, fontWeight: "700" },
});
