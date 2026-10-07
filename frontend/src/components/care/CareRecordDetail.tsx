import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFormValues, type CareRecordsActions, type CareRecordsViewModel, type CareRevisionView } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { MotionDisclosure, MotionReveal } from "../../motion";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppButton, AppSelectionTrigger, SectionHeader } from "../ui";

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
  const [expanded, setExpanded] = useState({recordId: record.id, provenance: false, history: true});
  const provenanceOpen = expanded.recordId === record.id && expanded.provenance;
  const historyOpen = detail.historyOpen && (expanded.recordId !== record.id || expanded.history);
  const historyReady = detail.historyState === "ready" || detail.historyState === undefined && detail.history.length > 0;
  const historyError = detail.historyState === "error";
  const emptyUnconfirmed = detail.history.length === 0 && (!historyReady || record.current.version > 1);
  useEffect(() => {
    if (active && Platform.OS === "web") (headingRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [record.id, active]);
  return <View style={styles.detail}><SectionHeader title="已確認的整理結果" density="compact" action={<AppButton label="返回記錄" density="compact" variant="quiet" onPress={actions.closePanel} />} />
    <View ref={headingRef} accessibilityLabel={record.title} tabIndex={-1} style={styles.recordHeading}><Text accessibilityRole="header" style={styles.title}>{record.title}</Text><AppStatusBadge label="已確認保存" tone="success" /></View>
    <MotionReveal value={record.current} contentKey={JSON.stringify(record.current.values)} scopeKey={`${record.childId}:${record.id}`} regionKey="record-detail-text" triggerKey={revealIntent} eligible={revealEligible && active} preset="local">{revision => <CareValueSummary values={revision.values} />}</MotionReveal>
    {record.current.eventTimePrecision === "unknown" ? <Text style={styles.warning}>事件時間尚未確定，原文保留供核對。</Text> : null}
    <View style={styles.summary}>
      <AppSelectionTrigger label="來源、確認時間及版本" expanded={provenanceOpen} onPress={() => setExpanded({recordId: record.id, provenance: !provenanceOpen, history: expanded.recordId !== record.id || expanded.history})} />
      <MotionDisclosure expanded={provenanceOpen} scopeKey={`${record.childId}:${record.id}`}><View style={styles.metadata}>
        <Text style={styles.meta}>時間精度：{record.current.eventTimePrecision === "exact" ? "精確" : record.current.eventTimePrecision === "approximate" ? "約數" : "未知"} · {record.current.timeZoneLabel}</Text>
        <Text style={styles.meta}>確認人：{record.current.confirmedByLabel} · {record.current.confirmedAtLabel}</Text>
        <Text style={styles.meta}>版本 {record.current.version} · 最初加入：{record.createdAtLabel}</Text>
        <Text style={styles.meta}>私人對話原文不會自動跟隨共享；此處來源描述不等於私人對話全文。</Text>
      </View></MotionDisclosure>
    </View>
    <Text style={styles.meta}>家庭共享記錄；更正會建立新版本，並保留舊版。</Text>
    {canEdit ? <View style={styles.actions}><AppButton label="更正這筆記錄" onPress={() => actions.startCorrection(record.id)} /></View> : null}
    <AppSelectionTrigger label="更正歷史" expanded={historyOpen} onPress={() => {setExpanded({recordId: record.id, provenance: provenanceOpen, history: !historyOpen}); if (!detail.historyOpen) actions.showHistory();}} />
    <MotionDisclosure expanded={historyOpen} scopeKey={`${record.childId}:${record.id}`}><View style={styles.history}><Text accessibilityRole="header" style={styles.title}>更正歷史</Text>
      {detail.historyLoading ? <Text style={styles.tool}>正在讀取更正歷史…</Text> : historyError ? <Text style={styles.tool}>未能讀取更正歷史，請重試。</Text>
        : detail.history.length === 0 ? <Text style={styles.tool}>{historyReady && record.current.version === 1 ? "目前只有第一個已確認版本。" : historyReady ? "未有已載入的更正歷史，請重新讀取核對。" : "尚未讀取更正歷史。"}</Text> : null}
      {detail.history.map(revision => <View key={revision.version} style={styles.revision}><CareRevisionContent revision={revision} /></View>)}
      {!detail.historyLoading && (historyError || !historyReady || emptyUnconfirmed) ? <AppButton label={historyError ? "重試讀取歷史" : "讀取更正歷史"} variant="secondary" onPress={detail.historyRetryMore ? actions.loadOlderHistory : actions.showHistory} disabled={!online} />
        : detail.hasMoreHistory ? <AppButton label="載入更早版本" variant="secondary" onPress={actions.loadOlderHistory} loading={detail.historyLoading} disabled={!online} />
          : historyReady && !detail.historyLoading ? <Text style={styles.meta}>已到最早的已載入版本。</Text> : null}
    </View></MotionDisclosure>
    {canEdit ? <AppButton label="永久刪除此記錄及歷史" variant="danger-secondary" disabled={!online} onPress={() => actions.startDeletion(record.id)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  detail: {padding:spacing.lg,backgroundColor:colors.paper,gap:spacing.lg},
  summary: { gap: spacing.md },
  valueContext: { gap: spacing.xs },
  metadata: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.xs },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  tool: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  recordHeading: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md },
  revision: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md },
});
