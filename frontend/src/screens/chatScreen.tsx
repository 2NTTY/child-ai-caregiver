import { brand } from "../branding";
import { useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView } from "react-native";
import { AppScrollView as ScrollView } from "../components/AppScrollView";
import { Text } from "react-native-paper";
import { AppButton, SectionCard } from "../components/ui";
import { AgentConversationPreview } from "../components/agent/AgentConversationPreview";
import { AgentComposer } from "../components/agent/AgentComposer";
import { AnswerSources, CitationText } from "../components/agent/AnswerSources";
import { locateCitationSource } from "../components/agent/locateCitationSource";
import { previewAnswerCitations } from "../preview/answer-citations";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, mobileLayout, mobileType, radius, spacing, typeScale } from "../theme";

export default function ChatPage() {
  const { model, actions, chatDraft, setChatDraft } = usePreview();
  const [localMessages, setLocalMessages] = useState<Record<string, string[]>>({});
  const scrollRef = useRef<NativeScrollView | null>(null);
  const locateSource = (target: View | null) => locateCitationSource(target, scrollRef.current);
  const viewportWidth = useWindowDimensions().width;
  const [paneWidth, setPaneWidth] = useState(0);
  const compact = (paneWidth || viewportWidth) < mobileLayout.breakpoint;
  const child = model.children.find(item => item.id === model.selectedChildId);
  const key = model.selectedChildId ?? "no-child";
  const messages = localMessages[key] ?? [];

  function previewMessage() {
    const value = chatDraft.trim();
    if (!value) return;
    setLocalMessages(previous => ({ ...previous, [key]: [...(previous[key] ?? []), value] }));
    setChatDraft("");
  }

  return <View onLayout={event => setPaneWidth(event.nativeEvent.layout.width)} style={styles.root}>
    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
      <SectionCard style={styles.headingCard}>
        <View style={styles.headingRow}><View style={styles.headingCopy}><Text accessibilityRole="header" style={[styles.title, compact && mobileType.sectionTitle]}>{brand.agentTitle}</Text><Text style={[styles.subtitle, compact && mobileType.body]}>把已確認資料、你的問題與可靠來源放在一起，逐步討論下一步。</Text></View></View>
        <Text style={styles.previewNote}>合成畫面示例 · 尚未連接 Agent 或發送訊息</Text>
      </SectionCard>
      {!child ? <SectionCard><Text style={styles.body}>請先選擇孩子；不同孩子的私人對話不能混在一起。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard> : <>
        <View testID="chat-question" style={styles.questionRow}><View style={styles.questionBubble}><Text style={styles.questionText}>最近一星期孩子晚上比較難入睡。我應該先整理哪些資料，才方便討論睡前流程？</Text><Text style={styles.bubbleMeta}>合成問題示例 · 未向 Server 發送</Text></View></View>
        <View testID="chat-answer" style={styles.answerRow}><View style={styles.answerCard}>
          <AnswerSources key={child.id} sources={previewAnswerCitations} onLocateSource={locateSource}>
          <Text style={styles.answerEyebrow}>示例版式 · 並非 Agent 建議</Text>
          <Text style={styles.answerIntro}>可以先把已確認的睡眠記錄、作息時間，以及你想了解的情況放在一起。正式回答會由已接通的 Agent 按授權資料及適用來源生成。</Text>
          <View style={styles.usedData}><Text style={styles.usedDataTitle}>這個示例畫面可顯示的資料</Text><Text style={styles.usedDataText}>{child.displayName} · {child.ageLabel} · 已載入已確認記錄 {model.records.filter(item => item.childId === child.id).length} 項</Text></View>
          <View style={styles.answerSteps}>
            <Text style={styles.stepTitle}>1　先核對已有記錄</Text><CitationText style={styles.stepBody}>查看事件發生時間、來源及是否已確認，避免把候選內容當作事實。【1】</CitationText>
            <Text style={styles.stepTitle}>2　列出仍想釐清的問題</Text><CitationText style={styles.stepBody}>例如入睡時間、睡前活動與你希望得到的協助；不在預覽中推斷原因。【2】</CitationText>
            <Text style={styles.stepTitle}>3　再由正式服務提供有來源的回覆</Text><CitationText style={styles.stepBody}>適用的官方資料、引用片段與日期，須待 Agent／知識接線後才能顯示。【3】</CitationText>
          </View>
          <Text style={styles.footerText}>此段只示範排版與狀態，沒有呼叫模型。</Text>
          </AnswerSources>
        </View></View>
        {messages.map((message, index) => <View key={`${key}-${index}`} testID="chat-local-message" style={styles.questionRow}><View style={styles.localBubble}><Text style={styles.questionText}>{message}</Text><Text style={styles.bubbleMeta}>本地預覽 · 未送出</Text></View></View>)}
        <AgentConversationPreview key={child.id} childId={child.id} online={model.connection === "online"} onLocateSource={locateSource} />
      </>}
    </ScrollView>
    <AgentComposer key={JSON.stringify([child?.id, model.caregiverName, child?.accessRole])} enabled={!!child} compact={compact}
      draft={chatDraft} onChangeDraft={setChatDraft} onPreview={previewMessage} onPhotos={() => actions.open("photos")} onSources={() => actions.open("sources")} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas }, scroll: { flex: 1 },
  page: { width: "100%", maxWidth: 1060, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset },
  headingCard: { gap: spacing.sm }, headingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md }, headingCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" }, subtitle: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, previewNote: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.mintSurface, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, fontSize: typeScale.caption, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, questionRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-start", gap: spacing.sm }, questionBubble: { maxWidth: "82%", backgroundColor: colors.paleTeal, borderRadius: radius.medium, padding: spacing.md, gap: spacing.xs }, localBubble: { maxWidth: "82%", backgroundColor: colors.neutralSurface, borderRadius: radius.medium, padding: spacing.md, gap: spacing.xs }, questionText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 }, bubbleMeta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, textAlign: "right" },
  answerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, answerCard: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md }, answerEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "800" }, answerIntro: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24 }, usedData: { backgroundColor: colors.quietSurface, padding: spacing.md, borderRadius: radius.small, gap: spacing.xs }, usedDataTitle: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "800" }, usedDataText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, answerSteps: { gap: spacing.xs }, stepTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800", marginTop: spacing.xs }, stepBody: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, answerFooter: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm }, footerText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
});
