import { useState, type Ref } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careReviewUsesCareOwner, careReviewDomainLabel, type CareCaptureReview } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { MotionDisclosure } from "../../motion";
import { AppStatusBadge } from "../AppStatusBadge";
import { ReadTargetLink } from "../ReadTargetLink";
import { AppButton } from "../ui";
import { CareValueSummary } from "./CareRecordDetail";

export function CareCaptureDetail({ capture, headingRef, readiness, confirmLabel, canConfirm, canEdit, canSkip, onConfirm, onReview, onSkip, onOpenRecord, canOpenRecord = true, onConfirmImportant, canConfirmImportant = false }: {
  capture: CareCaptureReview; headingRef?: Ref<View>; canOpenRecord?: boolean; readiness: string; confirmLabel: string;
  canConfirm: boolean; canConfirmImportant?: boolean; onConfirmImportant?: () => void; canEdit: boolean; canSkip: boolean;
  onConfirm?: () => void; onReview?: () => void; onSkip?: () => void; onOpenRecord?: (id: string) => void;
}) {
  const [details, setDetails] = useState<string | null>(null);
  const recordLinkLabel = canEdit ? "查看及更正已保存記錄" : "查看已保存記錄";
  const pending = capture.writeState === "not_saved" && capture.reviewState === "pending", update = capture.target.kind === "update";
  const before = capture.target.kind === "update" && capture.basis ? [capture.basis.current, ...capture.basis.history].find(item => item.version === (capture.target as { expectedVersion: number }).expectedVersion) : null;
  const careDomain = careReviewUsesCareOwner(capture);
  const saved = careDomain ? capture.savedRecord : null;
  const recordOnly = !!saved && capture.id === `record:${saved.id}` && capture.sourceId === saved.id;
  const savedMatches = !!saved && (Object.keys(capture.proposedValues) as (keyof typeof capture.proposedValues)[]).every(key => capture.proposedValues[key] === saved.current.values[key]);
  return <View style={s.detail} testID="care-capture-detail">
    <View ref={headingRef} tabIndex={-1} accessibilityLabel="核對記錄內容" testID="care-review-reader-heading" style={s.heading}><Text accessibilityRole="header" aria-level={3} style={s.title}>{capture.title}</Text>
      <CareReviewBadges capture={capture} />
      <Text style={s.meta}>{recordOnly ? `已保存照護記錄 · ${capture.createdAtLabel}` : `${capture.sourceContext?.conversationLabel ?? "未提供對話名稱"} · ${capture.sourceContext?.dateLabel ?? "未提供對話日期"}`}</Text>
    </View>
    {!careDomain ? <Text style={s.warning}>{careReviewDomainLabel(capture)}暫不能保存或確認。</Text> : null}
    {capture.operationValidity?.state === "expired" ? <Text style={s.warning}>原操作已過期{capture.operationValidity.expiresAtLabel ? `（${capture.operationValidity.expiresAtLabel}）` : ""}。待處理事項仍保留，目前不能提交。</Text> : null}
    <View style={s.comparison} testID="care-capture-comparison">
      <View style={s.column} testID="care-capture-original-column"><Text accessibilityRole="header" aria-level={4} style={s.label}>{recordOnly ? "記錄原文與來源" : "你的原話與來源"}</Text>
        <View style={s.original}><AppStatusBadge label={capture.sourceScope === "private" ? "私人原文" : "家庭共享來源"} />
          {capture.sourceState === "unavailable" ? <Text style={s.warning}>來源暫不可用，原文不在這裏顯示。</Text> : <Text selectable style={s.reading}>{capture.originalText}</Text>}
          <Text style={s.meta}>{capture.sourceLabel}</Text>{capture.photo ? <Text style={s.meta}>{capture.photo.label} · 原圖暫不可檢視</Text> : null}</View>
        {update ? <View style={s.section}><Text style={s.label}>{pending ? "準備更新的已有記錄" : "這次更新之前"}</Text>{pending && capture.basis ? <CareValueSummary values={capture.basis.current.values} /> : before ? <CareValueSummary values={before.values} /> : <Text style={s.warning}>未讀到原有版本，不能推定更新前的內容。</Text>}{capture.duplicateHint ? <Text style={s.tool}>{capture.duplicateHint}</Text> : null}</View> : capture.duplicateHint ? <Text style={s.tool}>{capture.duplicateHint}</Text> : null}
      </View>
      <View style={s.column} testID="care-capture-interpretation-column"><Text accessibilityRole="header" aria-level={4} style={s.label}>{recordOnly ? "已保存的結構資料" : "Agent 的理解"}</Text>{pending ? <Text style={s.meta}>{update ? "建議更新為，尚未寫入" : "建議新增，尚未寫入"}</Text> : null}{careDomain ? <CareValueSummary values={capture.proposedValues} /> : <Text selectable style={s.reading}>{capture.proposedValues.text}</Text>}
        {capture.purpose ? <View style={s.section}><Text style={s.label}>為甚麼建議保留</Text><Text style={s.tool}>{capture.purpose}</Text></View> : null}
        <View style={s.scope}><Text style={s.label}>寫入目的地：{!careDomain ? `${careReviewDomainLabel(capture)}（暫不可寫入）` : capture.target.scope === "family" ? "這個孩子的家庭共享記錄" : "私人記錄（暫不可寫入）"}</Text>
          <Text style={s.tool}>{pending ? "只有你明確確認後才會提交。" : "處理結果已保留供追溯。"}私人原始對話不會自動跟隨共享。</Text></View>
        {capture.uncertainties.length ? <View style={s.section}><Text style={s.label}>確認前留意</Text>{capture.uncertainties.map((item, index) => <Text key={index} style={s.tool}>• {item}</Text>)}</View> : null}
        {careDomain && capture.writeState === "saved" ? <View style={s.scope}><Text style={s.label}>目前已保存的內容</Text>
          {saved ? <>{saved.current.version > (capture.resolution?.recordVersion ?? 0) ? <Text style={s.warning}>此記錄其後已有更正，以下顯示目前內容。</Text> : null}
            {savedMatches ? <Text style={s.tool}>目前保存內容與上方整理一致。</Text> : <CareValueSummary values={saved.current.values} />}
</> : <Text style={s.warning}>寫入結果已確認，但目前記錄未讀到或版本不符；不能把整理內容當作目前保存的內容。</Text>}
        </View> : null}
        {capture.reviewRequirement === "required" && capture.reviewState === "pending" ? <View style={s.important}><Text style={s.label}>重要記錄 · 仍需你明確確認</Text><Text style={s.tool}>{capture.writeState === "saved" ? "已保存不代表你已核對。這個黃燈會保留至目前內容獲明確確認；如有誤解，請先修正。" : "這筆內容尚未寫入。關閉、換頁或原操作過期，都不代表你已確認這個安排。"}</Text>
          {careDomain && capture.writeState === "saved" && onConfirmImportant ? <AppButton label="確認重要內容正確" onPress={onConfirmImportant} disabled={!canConfirmImportant} /> : !careDomain ? <Text style={s.warning}>重要內容確認暫不可用。</Text> : null}
        </View> : null}
        {(pending || capture.reviewRequirement === "required" && capture.reviewState === "pending") && readiness ? <Text accessibilityRole="alert" style={s.warning}>{readiness}</Text> : null}
        {pending && careDomain && (!capture.operationValidity || capture.operationValidity.state === "active") ? <View style={s.actions}>
          {onConfirm ? <AppButton label={confirmLabel} disabled={!canConfirm} onPress={onConfirm} /> : <Text style={s.warning}>確認暫不可用，目前不能寫入。</Text>}
          {onReview ? <AppButton label="先調整內容" variant="secondary" onPress={onReview} disabled={!canEdit} /> : null}
          {capture.reviewRequirement !== "required" && onSkip ? <AppButton label="略過，不寫入" variant="quiet" onPress={onSkip} disabled={!canSkip} /> : capture.reviewRequirement !== "required" ? <Text style={s.meta}>略過暫不可用。</Text> : null}
        </View> : <View style={s.section}><Text style={s.tool}>{capture.resolution?.label ?? (capture.reviewState === "pending" ? "這筆事項仍未處理。" : "已處理這筆提案。")}</Text>
          {careDomain && capture.writeState === "saved" && capture.resolution?.recordId && onOpenRecord ? <ReadTargetLink href={{ pathname: "/care", params: { tab: "records", recordId: capture.resolution.recordId } }} label={recordLinkLabel} availability={canOpenRecord ? "ready" : "unavailable"} onOpen={() => onOpenRecord(capture.resolution!.recordId!)} style={s.recordLink}><Text style={s.linkText}>{recordLinkLabel}</Text></ReadTargetLink> : null}</View>}
      </View>
    </View>
    <AppButton label="來源與版本資料" variant="quiet" density="compact" expanded={details === capture.id} onPress={() => setDetails(details === capture.id ? null : capture.id)} />
    <MotionDisclosure expanded={details === capture.id} scopeKey={`${capture.childId}:${capture.id}:${capture.version}`}><View style={s.section}>
      {capture.sourceContext ? <><Text style={s.meta}>{capture.sourceContext.conversationLabel} · {capture.sourceContext.dateLabel}</Text><Text style={s.tool}>目前可對照以上原文；返回原對話的定位接口尚未接通。</Text></> : null}
      <Text style={s.meta}>{recordOnly ? "記錄" : "提案"}：{capture.createdAtLabel} · 版本 {capture.version}</Text><Text style={s.meta}>來源版本：{capture.sourceVersion}</Text>
      {capture.target.kind === "update" ? <Text style={s.meta}>提案基準版本 {capture.target.expectedVersion} · 目前版本 {capture.basis?.current.version ?? "未提供"}</Text> : null}
      {capture.resolution?.recordVersion ? <Text style={s.meta}>確認寫入版本：{capture.resolution.recordVersion}</Text> : null}
    </View></MotionDisclosure>
  </View>;
}
export function CareReviewBadges({ capture }: { capture: CareCaptureReview }) {
  return <View style={s.actions}><AppStatusBadge label={capture.writeState === "saved" ? "已保存" : capture.writeState === "unknown" ? "寫入結果未知" : capture.writeState === "failed" ? "保存失敗" : "尚未寫入"} tone={capture.writeState === "saved" ? "success" : capture.writeState === "failed" ? "error" : "warning"} />
    {capture.operationValidity?.state === "expired" ? <AppStatusBadge label="原操作已過期" tone="warning" /> : null}
    {capture.reviewRequirement === "required" ? <AppStatusBadge testID={capture.reviewState === "pending" ? "care-important-pending" : "care-important-confirmed"} label={capture.reviewState === "pending" ? "重要 · 待你確認" : "重要內容已確認"} tone={capture.reviewState === "pending" ? "warning" : "success"} />
      : capture.reviewState === "pending" ? <AppStatusBadge label="須先確認才寫入" tone="warning" /> : capture.reviewState === "skipped" ? <AppStatusBadge label="已略過" /> : null}
  </View>;
}
const s = StyleSheet.create({
  recordLink: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.sm }, linkText: { fontFamily: chineseFont, ...readingType.body, color: colors.deepTeal, textDecorationLine: "underline" },
  important: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.paleAmber, borderLeftWidth: 3, borderLeftColor: colors.statusWarmLine },
  detail: { gap: spacing.lg, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg }, heading: { gap: spacing.sm },
  comparison: { flexDirection: "column", gap: spacing.lg },
  column: { minWidth: 0, gap: spacing.md },
  section: { gap: spacing.sm }, original: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.quietSurface, borderLeftWidth: 2, borderLeftColor: colors.line },
  scope: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  title: { fontFamily: chineseFont, ...workspaceType.section, color: colors.ink, fontWeight: "700" }, label: { fontFamily: chineseFont, ...readingType.body, fontWeight: "700", color: colors.ink },
  reading: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, tool: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, warning: { fontFamily: chineseFont, ...readingType.body, color: colors.warningInk }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
