import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { profileAgeUnitOptions, type ProfileDataView, type ProfileRevisionView } from "../../profile-view-model";
import { chineseFont, colors, spacing, typeScale , readingType } from "../../theme";

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
    <Text style={styles.label}>{row.label}</Text><Text style={styles.body}>{row.value ?? "未知"}</Text>
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
const styles = StyleSheet.create({
  rows: { gap: spacing.sm, minWidth: 0 }, row: { gap: 2, minWidth: 0 },
  label: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  version: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, fontWeight: "700" },
});
