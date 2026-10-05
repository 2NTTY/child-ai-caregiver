import { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFormValues, type CareRecordsActions, type CareRecordsViewModel, type CareRevisionView } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { MotionDisclosure, MotionReveal } from "../../motion";
import { AppButton, SectionCard, SectionHeader } from "../ui";

export function CareValueSummary({ values }: { values: CareFormValues }) {
  return <View style={styles.summary}>
    <Text style={styles.body}>{values.text}</Text>
    <View style={styles.valueContext}>
      <Text style={styles.tool}>種類：{careKindOptions.find(item => item.value === values.kind)?.label}</Text>
      <Text style={styles.tool}>來源：{values.source}</Text>
      <Text style={styles.tool}>數量：{values.quantityRaw ? `${values.quantityRaw} ${values.quantityUnit}（${values.quantityPrecision === "exact" ? "精確" : "約數"}）` : "未提供"}</Text>
      <Text style={styles.tool}>事件時間原文：{values.eventTimeRaw || "未提供"}</Text>
      {values.reason ? <Text style={styles.tool}>更正原因：{values.reason}</Text> : null}
    </View>
  </View>;
}

export function CareRevisionContent({ revision, createdAtLabel }: { revision: CareRevisionView; createdAtLabel?: string }) {
  return <View style={styles.summary}><CareValueSummary values={revision.values} />
    <View style={styles.metadata}>
      <Text style={styles.meta}>時間精度：{revision.eventTimePrecision === "exact" ? "精確" : revision.eventTimePrecision === "approximate" ? "約數" : "未知"}</Text>
      <Text style={styles.meta}>時區：{revision.timeZoneLabel}</Text>
      <Text style={styles.meta}>確認人：{revision.confirmedByLabel}</Text>
      <Text style={styles.meta}>確認時間：{revision.confirmedAtLabel}</Text>
      <Text style={styles.meta}>版本：{revision.version}</Text>
      {createdAtLabel !== undefined ? <Text style={styles.meta}>最初加入：{createdAtLabel}</Text> : null}
    </View>
  </View>;
}

export function CareRecordDetail({ detail, actions, canEdit, online, active = true, revealIntent = null, revealEligible = false }: {
  detail: NonNullable<CareRecordsViewModel["detail"]>; actions: CareRecordsActions; canEdit: boolean; online: boolean; active?: boolean; revealIntent?: string | number | null; revealEligible?: boolean;
}) {
  const { record } = detail;
  const headingRef = useRef<View>(null);
  useEffect(() => {
    if (active && Platform.OS === "web") (headingRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [record.id, active]);
  return <View style={styles.detail}><SectionHeader title="已確認的整理結果" density="compact" action={<AppButton label="返回記錄" density="compact" variant="quiet" onPress={actions.closePanel} />} />
    <View ref={headingRef} accessibilityLabel={record.title} tabIndex={-1} style={styles.recordHeading}><Text accessibilityRole="header" style={styles.title}>{record.title}</Text><Text style={styles.confirmed}>已確認</Text></View>
    <MotionReveal value={record.current} contentKey={JSON.stringify(record.current.values)} scopeKey={`${record.childId}:${record.id}`} regionKey="record-detail-text" triggerKey={revealIntent} eligible={revealEligible && active} preset="local">{revision => <CareRevisionContent revision={revision} createdAtLabel={record.createdAtLabel} />}</MotionReveal>
    <View style={styles.provenance}><Text style={styles.title}>原始依據</Text><Text selectable style={styles.tool}>{record.current.values.source}</Text><Text style={styles.meta}>上方為已確認版本。私人對話原文不會自動跟隨共享；較早內容可按下方版本歷史核對。</Text></View>
    <Text style={styles.tool}>這是家庭共享記錄；更正會建立新版本並保留舊版，不會改寫原文歷史。</Text>
    <View style={styles.actions}>{canEdit ? <AppButton label="更正這筆記錄" onPress={() => actions.startCorrection(record.id)} /> : null}
      {!detail.historyOpen ? <AppButton label="查看更正歷史" variant="secondary" onPress={actions.showHistory} /> : null}</View>
    {canEdit ? <AppButton label="永久刪除此記錄及歷史" variant="quiet" disabled={!online} onPress={() => actions.startDeletion(record.id)} /> : null}
    <MotionDisclosure expanded={detail.historyOpen} scopeKey={`${record.childId}:${record.id}`}><View style={styles.history}><Text accessibilityRole="header" style={styles.title}>更正歷史</Text>
      {detail.history.length === 0 ? <Text style={styles.tool}>目前只有第一個已確認版本。</Text> : detail.history.map(revision => <View key={revision.version} style={styles.revision}>
        <CareRevisionContent revision={revision} />
      </View>)}
      {detail.hasMoreHistory ? <AppButton label="載入更早版本" variant="secondary" onPress={actions.loadOlderHistory} loading={detail.historyLoading} disabled={!online} /> : <Text style={styles.meta}>已到最早的已載入版本。</Text>}
    </View></MotionDisclosure>
  </View>;
}

const styles = StyleSheet.create({
  detail: {padding:spacing.lg,backgroundColor:colors.paper,gap:spacing.lg}, provenance:{padding:spacing.md,backgroundColor:colors.canvas,gap:spacing.sm},
  summary: { gap: spacing.md },
  valueContext: { gap: spacing.xs },
  metadata: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.xs },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  tool: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  recordHeading: { gap: spacing.xs },
  confirmed: { color: colors.deepTeal, fontFamily: chineseFont, ...readingType.tool },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md },
  revision: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md },
});
