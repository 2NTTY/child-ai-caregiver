import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFormValues, type CareRecordsActions, type CareRecordsViewModel, type CareRevisionView } from "../../care-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppButton, SectionCard, SectionHeader } from "../ui";

export function CareValueSummary({ values }: { values: CareFormValues }) {
  return <View style={styles.summary}>
    <Text style={styles.body}>{values.text}</Text>
    <Text style={styles.meta}>種類：{careKindOptions.find(item => item.value === values.kind)?.label}</Text>
    <Text style={styles.meta}>來源：{values.source}</Text>
    <Text style={styles.meta}>數量：{values.quantityRaw ? `${values.quantityRaw} ${values.quantityUnit}（${values.quantityPrecision === "exact" ? "精確" : "約數"}）` : "未提供"}</Text>
    <Text style={styles.meta}>事件時間原文：{values.eventTimeRaw || "未提供"}</Text>
    {values.reason ? <Text style={styles.meta}>更正原因：{values.reason}</Text> : null}
  </View>;
}

export function CareRevisionContent({ revision }: { revision: CareRevisionView }) {
  return <View style={styles.summary}><CareValueSummary values={revision.values} />
    <Text style={styles.meta}>時間精度：{revision.eventTimePrecision === "exact" ? "精確" : revision.eventTimePrecision === "approximate" ? "約數" : "未知"} · {revision.timeZoneLabel}</Text>
    <Text style={styles.meta}>確認人：{revision.confirmedByLabel}</Text><Text style={styles.meta}>確認時間：{revision.confirmedAtLabel}</Text>
  </View>;
}

export function CareRecordDetail({ detail, actions, canEdit, online }: {
  detail: NonNullable<CareRecordsViewModel["detail"]>; actions: CareRecordsActions; canEdit: boolean; online: boolean;
}) {
  const { record } = detail;
  return <SectionCard><SectionHeader title="記錄詳情" action={<AppButton label="返回記錄" variant="quiet" onPress={actions.closePanel} />} />
    <Text style={styles.title}>{record.title}</Text><Text style={styles.badge}>已確認 · 版本 {record.current.version}</Text>
    <CareRevisionContent revision={record.current} /><Text style={styles.meta}>最初加入：{record.createdAtLabel}</Text>
    <Text style={styles.meta}>這是家庭共享記錄；更正會建立新版本並保留舊版，不會改寫原文歷史。</Text>
    <View style={styles.actions}>{canEdit ? <AppButton label="更正這筆記錄" onPress={() => actions.startCorrection(record.id)} /> : null}
      {!detail.historyOpen ? <AppButton label="查看更正歷史" variant="secondary" onPress={actions.showHistory} /> : null}</View>
    {canEdit ? <AppButton label="永久刪除此記錄及歷史" variant="quiet" disabled={!online} onPress={() => actions.startDeletion(record.id)} /> : null}
    {detail.historyOpen ? <View style={styles.history}><Text accessibilityRole="header" style={styles.title}>更正歷史</Text>
      {detail.history.length === 0 ? <Text style={styles.body}>目前只有第一個已確認版本。</Text> : detail.history.map(revision => <View key={revision.version} style={styles.revision}>
        <Text style={styles.revisionTitle}>版本 {revision.version}</Text><CareRevisionContent revision={revision} />
      </View>)}
      {detail.hasMoreHistory ? <AppButton label="載入更早版本" variant="secondary" onPress={actions.loadOlderHistory} loading={detail.historyLoading} disabled={!online} /> : <Text style={styles.meta}>已到最早的已載入版本。</Text>}
    </View> : null}
  </SectionCard>;
}

const styles = StyleSheet.create({
  summary: { gap: spacing.xs }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "700" },
  badge: { alignSelf: "flex-start", backgroundColor: colors.paleTeal, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.caption },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md },
  revision: { backgroundColor: colors.quietSurface, padding: spacing.md, borderRadius: radius.small, gap: spacing.sm },
  revisionTitle: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700", color: colors.deepTeal },
});
