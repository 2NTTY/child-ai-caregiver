import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { authorizedCareCaptureReview, careImportantEventMatches, careImportantReviewReadiness, type CareImportantReviewEvent, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppDialog } from "../AppDialog";
import { AppScrollView } from "../AppScrollView";
import { AppButton } from "../ui";
import { CareReviewBadges } from "./CareCaptureDetail";
import { CareValueSummary } from "./CareRecordDetail";
import { CareWriteNotice } from "./CareReviewHistoryView";

// Production callers must provide an authoritative matching event and current conversation ID.
// demoItemId is only the explicitly labelled preview-tools path; it never claims live correlation.
export function ImportantRecordConfirmation({ model, actions, event, currentConversationId, demoItemId, visible, onDismiss, onEdit }: {
  model: CareRecordsViewModel; actions: CareRecordsActions; event?: CareImportantReviewEvent; currentConversationId?: string | null;
  demoItemId?: string; visible: boolean; onDismiss: () => void; onEdit: (recordId: string) => void;
}) {
  const review = authorizedCareCaptureReview(model);
  const capture = review.items.find(item => item.id === (demoItemId ?? event?.proposalId));
  const matched = !!capture && (demoItemId ? capture.reviewRequirement === "required" : careImportantEventMatches(capture, event, model.scopeKey, currentConversationId));
  const saved = capture?.savedRecord;
  const busy = ["saving", "unknown"].includes(model.operation.state);
  const ready = capture && saved ? careImportantReviewReadiness(capture, { childId: model.child.id, scopeKey: model.scopeKey ?? "", access: model.access, capabilities: review.capabilities,
    expectedVersion: capture.version, expectedSourceVersion: capture.sourceVersion, recordId: saved.id, recordVersion: saved.current.version, expectedScopeKey: model.scopeKey ?? "" }) : null;
  const open = visible && matched && model.access !== "lost";
  return <AppDialog visible={open} onDismiss={() => { if (!busy) onDismiss(); }} testID="important-record-confirmation">
    <AppDialog.Title>請確認這筆重要記錄</AppDialog.Title>
    <AppDialog.ScrollArea><AppScrollView style={s.scroll} contentContainerStyle={s.content}>

      {capture ? <><CareReviewBadges capture={capture} /><Text style={s.label}>{capture.title}</Text>
        <Text style={s.label}>你的原話</Text>{capture.sourceState === "ready" ? <Text selectable style={s.body}>{capture.originalText}</Text> : <Text style={s.warning}>原始來源已變更或不可用，不能確認舊內容。</Text>}
        <Text style={s.label}>目前已保存的內容</Text>{saved ? <CareValueSummary values={saved.current.values} /> : <Text style={s.warning}>未讀到目前記錄，不能確認。</Text>}
        <Text style={s.body}>已保存不代表你已確認內容。若有誤解，先修改；關閉此視窗不會清除記錄頁的黃色待確認提示。</Text>
        <Text style={s.meta}>這次確認只核對記錄，不會通知他人、預約或執行醫療行動。</Text>
        {ready && !ready.allowed && capture.reviewState !== "confirmed" ? <Text style={s.warning}>{ready.reason}</Text> : null}</> : null}
      <CareWriteNotice model={model} actions={actions} />
    </AppScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions>
      {capture && saved && capture.reviewState === "pending" ? <AppButton label={demoItemId ? "內容正確，確認（預覽）" : "內容正確，確認"} disabled={!ready?.allowed || busy || !model.online || !actions.confirmImportantRecord} onPress={() => actions.confirmImportantRecord?.(capture.id, capture.version, capture.sourceVersion, saved.id, saved.current.version, model.scopeKey ?? "")} /> : null}
      {saved ? <AppButton label="內容不對，先修改" variant="secondary" disabled={busy || model.access !== "editable"} onPress={() => onEdit(saved.id)} /> : null}
      <AppButton label={capture?.reviewState === "confirmed" ? "關閉" : "稍後核對，保留黃燈"} variant="quiet" disabled={busy} onPress={onDismiss} />
    </AppDialog.Actions>
  </AppDialog>;
}

const s = StyleSheet.create({ scroll: { maxHeight: 430 }, content: { gap: spacing.md, paddingVertical: spacing.md }, label: { fontFamily: chineseFont, ...readingType.tool, fontWeight: "700", color: colors.ink }, body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk } });
