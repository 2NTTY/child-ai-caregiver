import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFormValues, type CareRecordsActions, type CareRecordsViewModel, type CareRevisionView } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { MotionDisclosure, MotionReveal } from "../../motion";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppButton, AppSelectionTrigger } from "../ui";

function CareMetadata({ label, value }: { label: string; value: string }) {
  return <View style={styles.metadataLine}>
    <Text style={[styles.meta, styles.metadataLabel]}>{label}</Text>
    <Text selectable style={[styles.tool, styles.metadataValue]}>{value}</Text>
  </View>;
}

export function CareValueSummary({ values, hideEmptyQuantity = false }: { values: CareFormValues; hideEmptyQuantity?: boolean }) {
  return <View style={styles.summary}>
    <Text selectable style={styles.body}>{values.text}</Text>
    <View style={styles.valueContext}>
      <CareMetadata label="種類" value={careKindOptions.find(item => item.value === values.kind)?.label ?? values.kind} />
      <CareMetadata label="資料來源" value={values.source || "來源未提供"} />
      {values.quantityRaw || !hideEmptyQuantity ? <CareMetadata label="數量" value={values.quantityRaw ? `${values.quantityRaw} ${values.quantityUnit}（${values.quantityPrecision === "exact" ? "精確" : "約數"}）` : "數量未提供"} /> : null}
      <CareMetadata label="事情發生時間" value={values.eventTimeRaw || "事件時間未提供"} />
      {values.reason ? <CareMetadata label="更正原因" value={values.reason} /> : null}
    </View>
  </View>;
}

export function CareRevisionContent({ revision, createdAtLabel }: { revision: CareRevisionView; createdAtLabel?: string }) {
  return <View style={styles.summary}><CareValueSummary values={revision.values} />
    <View style={styles.metadata}>
      <Text style={styles.meta}>時間精度：{revision.eventTimePrecision === "exact" ? "精確" : revision.eventTimePrecision === "approximate" ? "約數" : "未知"}</Text>
      <Text style={styles.meta}>確認人：{revision.confirmedByLabel}</Text>
      <Text style={styles.meta}>確認時間：{revision.confirmedAtLabel}</Text>
      <Text style={styles.meta}>版本：{revision.version}</Text>
      {createdAtLabel !== undefined ? <Text style={styles.meta}>最初加入：{createdAtLabel}</Text> : null}
    </View>
  </View>;
}

export function CareRecordDetail({ detail, actions, canEdit, online, reading = false, active = true, revealIntent = null, revealEligible = false, onReturnToList }: {
  detail: NonNullable<CareRecordsViewModel["detail"]>; actions: CareRecordsActions; canEdit: boolean; online: boolean; reading?: boolean; active?: boolean; onReturnToList?(): void; revealIntent?: string | number | null; revealEligible?: boolean;
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
  return <View style={styles.detail}><View style={styles.readerActions}><AppButton label="返回記錄" density="compact" variant="quiet" onPress={onReturnToList ?? actions.closePanel} /></View>
    <View ref={headingRef} accessibilityLabel={record.title} tabIndex={-1} style={styles.recordHeading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>{record.title}</Text><AppStatusBadge label="已確認保存" tone="success" /></View>
    <View style={styles.recordBody}><MotionReveal value={record.current} contentKey={JSON.stringify(record.current.values)} scopeKey={`${record.childId}:${record.id}`} regionKey="record-detail-text" triggerKey={revealIntent} eligible={revealEligible && active} preset="local">{revision => <CareValueSummary values={revision.values} hideEmptyQuantity />}</MotionReveal></View>
    {record.current.eventTimePrecision === "unknown" ? <Text style={styles.warning}>事件時間尚未確定，原文保留供核對。</Text> : null}
    <View style={styles.correction}><Text style={styles.meta}>家庭共享記錄；更正會建立新版本，並保留舊版。</Text>
      {canEdit ? <AppButton label="更正這筆記錄" disabled={reading} preserveFocusWhenDisabled={reading && online} onPress={() => { if (!reading) actions.startCorrection(record.id); }} /> : null}</View>
    <View style={styles.summary}>
      <AppSelectionTrigger label="確認與版本資料" expanded={provenanceOpen} onPress={() => setExpanded({recordId: record.id, provenance: !provenanceOpen, history: expanded.recordId !== record.id || expanded.history})} />
      <MotionDisclosure expanded={provenanceOpen} scopeKey={`${record.childId}:${record.id}`}><View style={styles.metadata}>
        <CareMetadata label="時間精度" value={record.current.eventTimePrecision === "exact" ? "精確" : record.current.eventTimePrecision === "approximate" ? "約數" : "未知"} />
        <CareMetadata label="時區" value={record.current.timeZoneLabel} />
        <CareMetadata label="確認人" value={record.current.confirmedByLabel} />
        <CareMetadata label="確認時間" value={record.current.confirmedAtLabel} />
        <CareMetadata label="目前版本" value={String(record.current.version)} />
        <CareMetadata label="最初加入" value={record.createdAtLabel} />
        <Text style={styles.meta}>私人對話原文不會自動跟隨共享；此處來源描述不等於私人對話全文。</Text>
      </View></MotionDisclosure>
    </View>
    <AppSelectionTrigger label="更正歷史" expanded={historyOpen} onPress={() => {setExpanded({recordId: record.id, provenance: provenanceOpen, history: !historyOpen}); if (!detail.historyOpen) actions.showHistory();}} />
    <MotionDisclosure expanded={historyOpen} scopeKey={`${record.childId}:${record.id}`}><View style={styles.history}><Text accessibilityRole="header" aria-level={3} style={styles.title}>更正歷史</Text>
      {detail.historyLoading ? <Text style={styles.tool}>正在讀取更正歷史…</Text> : historyError ? <Text style={styles.tool}>未能讀取更正歷史，請重試。</Text>
        : detail.history.length === 0 ? <Text style={styles.tool}>{historyReady && record.current.version === 1 ? "目前只有第一個已確認版本。" : historyReady ? "未有已載入的更正歷史，請重新讀取核對。" : "尚未讀取更正歷史。"}</Text> : null}
      {detail.history.map(revision => <View key={revision.version} style={styles.revision}>
        <View style={styles.revisionHeading}>
          <Text accessibilityRole="header" aria-level={4} style={styles.revisionTitle}>版本 {revision.version}</Text>
          <Text selectable style={styles.meta}>確認人：{revision.confirmedByLabel}</Text>
          <Text selectable style={styles.meta}>確認時間：{revision.confirmedAtLabel}</Text>
        </View>
        <CareValueSummary values={revision.values} />
        <Text style={styles.meta}>時間精度：{revision.eventTimePrecision === "exact" ? "精確" : revision.eventTimePrecision === "approximate" ? "約數" : "未知"}</Text>
      </View>)}
      {!detail.historyLoading && (historyError || !historyReady || emptyUnconfirmed) ? <AppButton label={historyError ? "重試讀取歷史" : "讀取更正歷史"} variant="secondary" onPress={detail.historyRetryMore ? actions.loadOlderHistory : actions.showHistory} disabled={!online} />
        : detail.hasMoreHistory ? <AppButton label="載入更早版本" variant="secondary" onPress={actions.loadOlderHistory} loading={detail.historyLoading} disabled={!online} />
          : historyReady && !detail.historyLoading ? <Text style={styles.meta}>已到最早的已載入版本。</Text> : null}
    </View></MotionDisclosure>
    {canEdit ? <View style={styles.dangerSection}><AppButton label="永久刪除此記錄及歷史" variant="danger-secondary" disabled={!online || reading} preserveFocusWhenDisabled={reading && online} onPress={() => { if (!reading) actions.startDeletion(record.id); }} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  detail: {backgroundColor:colors.paper,gap:spacing.lg,minWidth:0},
  readerActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm },
  recordBody: { minWidth: 0 },
  correction: { alignItems: "flex-start", gap: spacing.sm },
  dangerSection: { paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line, alignItems: "flex-start" },
  summary: { gap: spacing.md },
  valueContext: { gap: spacing.sm, paddingTop: spacing.md },
  metadataLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.md, rowGap: spacing.xs, minWidth: 0 },
  metadataLabel: { flexBasis: 96, flexShrink: 0 },
  metadataValue: { flexBasis: 180, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  metadata: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.xs },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, minWidth: 0, maxWidth: 720,
    ...(Platform.OS === "web" ? { maxWidth: "72ch" } as unknown as TextStyle : {}) },
  tool: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  recordHeading: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md },
  revisionHeading: { gap: spacing.xs },
  revisionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  revision: { gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md },
});
