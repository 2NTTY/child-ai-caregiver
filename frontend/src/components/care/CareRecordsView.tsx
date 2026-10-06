import { type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import type { CareRecordsActions, CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType } from "../../theme";
import { PageFrame } from "../PageFrame";
import { CareReviewWorkspace, CareWriteNotice } from "./CareReviewHistoryView";

export function CareRecordsView({ model, actions, previewControls, onReviewHistory, onOlderPending, initialRecordId }: {
  model: CareRecordsViewModel; actions: CareRecordsActions; previewControls?: ReactNode;
  onReviewHistory?: () => void; onOlderPending?: () => void; initialRecordId?: string;
}) {
  return <PageFrame title="記錄與核對" density="compact" description={`${model.child.name} · 核對助手記下的內容，有誤時更正`} scrollTestID="care-page-scroll">
    {!model.online ? <Text style={styles.warning}>目前離線，不能確認提交；已載入資料及草稿保留。</Text> : null}
    {model.access === "read_only" ? <Text style={styles.warning}>你可閱讀及對照內容；確認寫入或更正須由擁有人或照顧者處理。</Text> : null}
    <CareWriteNotice model={model} actions={actions} />
    {model.access === "lost" ? <Text style={styles.warning}>已無權查看這個孩子；原文、提案、記錄與草稿已隱藏。</Text> : <CareReviewWorkspace model={model} actions={actions} initialRecordId={initialRecordId} onOlderPending={onOlderPending} onHistory={onReviewHistory} />}
    {previewControls}
  </PageFrame>;
}
const styles = StyleSheet.create({ warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk } });
