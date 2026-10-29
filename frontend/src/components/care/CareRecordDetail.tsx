import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFormValues, type CareRecordsActions, type CareRecordsViewModel, type CareRevisionView } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { MotionDisclosure, MotionReveal } from "../../motion";
import { AppStatusBadge } from "../AppStatusBadge";
import { careReadingStyles } from "./care-styles";
import { AppButton } from "../ui";

function CareMetadata({ label, value }: { label: string; value: string }) {
  return <View style={careReadingStyles.evidenceItem}><Text style={careReadingStyles.evidenceLabel}>{label}</Text><Text selectable accessibilityLabel={`${label}：${value}`} style={careReadingStyles.evidenceValue}>{value}</Text></View>;
}

export function CareValueSummary({ values, hideEmptyQuantity = false }: { values: CareFormValues; hideEmptyQuantity?: boolean }) {
  return <View style={styles.summary}>
    <View style={styles.recordText}><Text style={styles.eyebrow}>記錄內容</Text><Text selectable style={careReadingStyles.body}>{values.text}</Text></View>
    <View style={careReadingStyles.evidence}>
      <CareMetadata label="種類" value={careKindOptions.find(item => item.value === values.kind)?.label ?? values.kind} />
      <CareMetadata label="資料來源" value={values.source || "來源未提供"} />
      {values.quantityRaw || !hideEmptyQuantity ? <CareMetadata label="數量" value={values.quantityRaw ? `${values.quantityRaw} ${values.quantityUnit}（${values.quantityPrecision === "exact" ? "精確" : "約數"}）` : "數量未提供"} /> : null}
      <CareMetadata label="事件時間原文" value={values.eventTimeRaw || "事件時間未提供"} />
    </View>
    {values.reason ? <View style={styles.correctionReason}><Text style={styles.label}>更正原因</Text><Text selectable style={careReadingStyles.body}>{values.reason}</Text></View> : null}
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

export function CareRecordDetail({ detail, actions, canEdit, online, reading = false, active = true, revealIntent = null, revealEligible = false, onReturnToList, headingRef: suppliedHeadingRef, headingLevel = 2 }: {
  headingLevel?: 2 | 3; headingRef?: RefObject<View | null>; detail: NonNullable<CareRecordsViewModel["detail"]>; actions: CareRecordsActions; canEdit: boolean; online: boolean; reading?: boolean; active?: boolean; onReturnToList?(): void; revealIntent?: string | number | null; revealEligible?: boolean;
}) {
  const { record } = detail;
  const localHeadingRef = useRef<View>(null), headingRef = suppliedHeadingRef ?? localHeadingRef;
  const evidenceId = useId(), historyId = useId();
  const [expanded, setExpanded] = useState({recordId: record.id, provenance: false, history: true});
  const provenanceOpen = expanded.recordId === record.id && expanded.provenance;
  const historyOpen = detail.historyOpen && (expanded.recordId !== record.id || expanded.history);
  const historyReady = detail.historyState === "ready" || detail.historyState === undefined && detail.history.length > 0;
  const historyError = detail.historyState === "error";
  const emptyUnconfirmed = detail.history.length === 0 && (!historyReady || record.current.version > 1);
  useEffect(() => {
    if (active && Platform.OS === "web") (headingRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [record.id, active]);
  return <View testID="care-evidence-detail" style={styles.detail}><View style={styles.toolbar}><AppButton label={suppliedHeadingRef ? "返回記錄清單" : "返回記錄"} density="compact" variant="quiet" onPress={onReturnToList ?? actions.closePanel} /></View>
    <View ref={headingRef} testID="care-reader-heading" accessibilityLabel={record.title} tabIndex={-1} style={styles.recordHeading}><AppStatusBadge label="已確認保存" tone="success" /><Text accessibilityRole="header" aria-level={headingLevel} style={styles.title}>{record.title}</Text><Text style={styles.meta}>家庭共享 · 版本 {record.current.version}</Text></View>
    <MotionReveal value={record.current} contentKey={JSON.stringify(record.current.values)} scopeKey={`${record.childId}:${record.id}`} regionKey="record-detail-text" triggerKey={revealIntent} eligible={revealEligible && active} preset="local">{revision => <CareValueSummary values={revision.values} hideEmptyQuantity />}</MotionReveal>
    {record.current.eventTimePrecision === "unknown" ? <Text style={styles.warning}>事件時間尚未確定，原文保留供核對。</Text> : null}
    <View style={styles.summary}>
      <AppButton variant="quiet" controls={evidenceId} label="來源、確認時間及版本" expanded={provenanceOpen} onPress={() => setExpanded({recordId: record.id, provenance: !provenanceOpen, history: expanded.recordId !== record.id || expanded.history})} />
      <MotionDisclosure expanded={provenanceOpen} scopeKey={`${record.childId}:${record.id}`}><View nativeID={evidenceId} style={styles.metadata}>
        <Text style={styles.meta}>時間精度：{record.current.eventTimePrecision === "exact" ? "精確" : record.current.eventTimePrecision === "approximate" ? "約數" : "未知"} · {record.current.timeZoneLabel}</Text>
        <Text style={styles.meta}>確認人：{record.current.confirmedByLabel} · {record.current.confirmedAtLabel}</Text>
        <Text style={styles.meta}>版本 {record.current.version} · 最初加入：{record.createdAtLabel}</Text>
        <Text style={styles.body}>私人對話原文不會自動跟隨共享；此處來源描述不等於私人對話全文。</Text>
      </View></MotionDisclosure>
    </View>
    <View style={styles.correction}><View style={styles.correctionCopy}><Text accessibilityRole="header" aria-level={headingLevel + 1} style={careReadingStyles.sectionTitle}>更正記錄</Text><Text style={styles.body}>家庭共享記錄；更正會建立新版本，並保留舊版。</Text></View>
    {canEdit ? <View style={styles.actions}><AppButton label="更正這筆記錄" disabled={reading} preserveFocusWhenDisabled={reading && online} onPress={() => { if (!reading) actions.startCorrection(record.id); }} /></View> : <Text style={styles.body}>目前只可查看這筆記錄。</Text>}</View>
    <AppButton variant="quiet" controls={historyId} label="更正歷史" expanded={historyOpen} onPress={() => {setExpanded({recordId: record.id, provenance: provenanceOpen, history: !historyOpen}); if (!detail.historyOpen) actions.showHistory();}} />
    <MotionDisclosure expanded={historyOpen} scopeKey={`${record.childId}:${record.id}`}><View nativeID={historyId} style={styles.history}><Text accessibilityRole="header" aria-level={headingLevel + 1} style={styles.title}>更正歷史</Text>
      {detail.historyLoading ? <Text style={styles.tool}>正在讀取更正歷史…</Text> : historyError ? <Text style={styles.tool}>未能讀取更正歷史，請重試。</Text>
        : detail.history.length === 0 ? <Text style={styles.tool}>{historyReady && record.current.version === 1 ? "目前只有第一個已確認版本。" : historyReady ? "未有已載入的更正歷史，請重新讀取核對。" : "尚未讀取更正歷史。"}</Text> : null}
      {detail.history.map(revision => <View key={revision.version} style={styles.revision}>
        <Text accessibilityRole="header" aria-level={headingLevel + 2} style={careReadingStyles.sectionTitle}>舊版 · 版本 {revision.version}</Text>
        <CareRevisionContent revision={revision} />
      </View>)}
      {!detail.historyLoading && (historyError || !historyReady || emptyUnconfirmed) ? <AppButton label={historyError ? "重試讀取歷史" : "讀取更正歷史"} variant="secondary" onPress={detail.historyRetryMore ? actions.loadOlderHistory : actions.showHistory} disabled={!online} />
        : detail.hasMoreHistory ? <AppButton label="載入更早版本" variant="secondary" onPress={actions.loadOlderHistory} loading={detail.historyLoading} disabled={!online} />
          : historyReady && !detail.historyLoading ? <Text style={styles.meta}>已到最早的已載入版本。</Text> : null}
    </View></MotionDisclosure>
    {canEdit ? <View style={styles.deleteSection}><Text style={styles.body}>如需移除整筆記錄，下一步會先核對刪除範圍。</Text><AppButton label="永久刪除此記錄及歷史" variant="danger-secondary" disabled={!online || reading} preserveFocusWhenDisabled={reading && online} onPress={() => { if (!reading) actions.startDeletion(record.id); }} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  detail: { paddingVertical: spacing.md, gap: spacing.lg, minWidth: 0 },
  toolbar: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22, fontWeight: "700" },
  label: { fontFamily: chineseFont, color: colors.ink, fontSize: 14, lineHeight: 22, fontWeight: "700" },
  recordText: { minWidth: 0, gap: spacing.md, paddingVertical: spacing.sm },
  correctionReason: { gap: spacing.sm, paddingLeft: spacing.lg, borderLeftWidth: 2, borderLeftColor: colors.line },
  correction: { minWidth: 0, gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  correctionCopy: { minWidth: 0, gap: spacing.sm },
  deleteSection: { gap: spacing.md, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line, alignItems: "flex-start" },
  summary: { gap: spacing.xl, minWidth: 0 },
  metadata: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.xs },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  tool: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  recordHeading: { gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md },
  revision: { gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine, paddingTop: spacing.md },
});
