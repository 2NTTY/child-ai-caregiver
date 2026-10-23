import { type ReactNode, type RefObject } from "react";
import { StyleSheet, type View } from "react-native";
import { Text } from "react-native-paper";
import type { CareRecordsActions, CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { PageFrame } from "../PageFrame";
import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { CareReviewWorkspace, CareWriteNotice } from "./CareReviewHistoryView";

export function CareRecordsView({ model, actions, pendingReview, onReviewHistory, onOlderPending, initialRecordId, manualCreateFocusRef, manualCreateAction }: {
  model: CareRecordsViewModel; actions: CareRecordsActions; pendingReview?: { content: ReactNode; loadedCount?: string };
  onReviewHistory?: () => void; onOlderPending?: () => void; initialRecordId?: string; manualCreateFocusRef?: RefObject<View | null>; manualCreateAction?: ReactNode;
}) {
  return <PageFrame title="核對" density="compact" scrollTestID="care-page-scroll">
    {!model.online || model.access === "read_only" ? <BackgroundSurface padded style={{ gap: spacing.sm }}>
      {!model.online ? <Text style={styles.warning}>目前離線，不能確認提交；已載入資料及草稿保留。</Text> : null}
      {model.access === "read_only" ? <Text style={styles.warning}>你可閱讀及對照內容；確認寫入或更正須由擁有人或照顧者處理。</Text> : null}
    </BackgroundSurface> : null}
    <CareWriteNotice model={model} actions={actions} />
    {model.access === "lost" ? <BackgroundSurface padded><Text style={styles.warning}>已無權查看這個孩子；原文、提案、記錄與草稿已隱藏。</Text></BackgroundSurface> : <CareReviewWorkspace pendingReview={pendingReview} manualCreateFocusRef={manualCreateFocusRef} manualCreateAction={manualCreateAction} model={model} actions={actions} initialRecordId={initialRecordId} onOlderPending={onOlderPending} onHistory={onReviewHistory} />}
  </PageFrame>;
}
const styles = StyleSheet.create({ warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk } });
