import { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { CareCaptureReview } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { AppButton, SectionHeader } from "../ui";
import { CareValueSummary } from "./CareRecordDetail";

export function CareCaptureDetail({capture, onClose, onReview, canReview}: {capture: CareCaptureReview; onClose: () => void; onReview?: () => void; canReview: boolean}) {
  const headingRef = useRef<View>(null);
  useEffect(() => {if (Platform.OS === "web") (headingRef.current as unknown as HTMLElement | null)?.focus({preventScroll: true});}, [capture.id]);
  return <View style={s.detail} testID="care-capture-detail">
    <SectionHeader density="compact" title="核對助手整理" action={<AppButton label="返回核對清單" variant="quiet" onPress={onClose} />} />
    <View ref={headingRef} tabIndex={-1}><Text accessibilityRole="header" style={s.title}>{capture.title}</Text><Text style={s.status}>私人候選 · 尚未保存為家庭記錄</Text></View>
    <View style={s.section}><Text style={s.label}>整理結果</Text><CareValueSummary values={capture.proposedValues} /></View>
    <View style={s.original}><Text style={s.label}>家長原始輸入</Text><Text selectable style={s.reading}>{capture.originalText}</Text><Text style={s.meta}>{capture.sourceLabel} · {capture.createdAtLabel}</Text></View>
    <View style={s.section}><Text style={s.label}>核對時留意</Text>{capture.uncertainties.map((item, index) => <Text key={index} style={s.tool}>• {item}</Text>)}</View>
    <Text style={s.meta}>下一步只把整理結果放入可修改草稿。須再預覽及明確確認家庭共享；原始私人輸入不會自動公開。</Text>
    {onReview ? <AppButton label="核對／修正整理結果" disabled={!canReview} onPress={onReview} /> : <Text style={s.meta}>正式候選採用回調尚未接通，目前只可閱讀。</Text>}
  </View>;
}
const s = StyleSheet.create({detail:{padding:spacing.lg,gap:spacing.lg,backgroundColor:colors.paper,minWidth:0},section:{gap:spacing.sm},original:{gap:spacing.sm,padding:spacing.md,backgroundColor:colors.canvas,borderLeftWidth:2,borderLeftColor:colors.line},title:{fontFamily:chineseFont,...workspaceType.section,color:colors.ink},label:{fontFamily:chineseFont,...readingType.meta,fontWeight:"700",color:colors.muted},status:{fontFamily:chineseFont,...readingType.tool,color:colors.warningInk},reading:{fontFamily:chineseFont,...readingType.body,color:colors.ink},tool:{fontFamily:chineseFont,...readingType.tool,color:colors.ink},meta:{fontFamily:chineseFont,...readingType.meta,color:colors.muted}});
