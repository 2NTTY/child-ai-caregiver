import { brand } from "../branding";
import { useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppButton, SectionCard } from "../components/ui";
import { AgentConversationPreview } from "../components/agent/AgentConversationPreview";
import { AgentComposer } from "../components/agent/AgentComposer";
import { CitationText } from "../components/chat/AnswerSources";
import { ChatMessage } from "../components/chat/ChatMessage";
import { ChatTimeline, type ChatTimelineControls } from "../components/chat/ChatTimeline";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { useChatTimelinePreview } from "../preview/useChatTimelinePreview";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, mobileLayout, mobileType, readingType, spacing, typeScale, workspaceType } from "../theme";

export default function ChatPage() {
  const { model } = usePreview();
  const viewportWidth = useWindowDimensions().width;
  const [paneWidth, setPaneWidth] = useState(0);
  const child = model.children.find(item => item.id === model.selectedChildId);
  return <View onLayout={event => setPaneWidth(event.nativeEvent.layout.width)} style={styles.root}>
    <ChatContents key={JSON.stringify([model.selectedChildId, model.caregiverName, child?.accessRole])} compact={(paneWidth || viewportWidth) < mobileLayout.breakpoint} />
  </View>;
}

function ChatContents({ compact }: { compact: boolean }) {
  const { model, actions, chatDraft, setChatDraft } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const preview = useChatTimelinePreview(child?.id ?? "no-child");
  const scrollRef = useRef<NativeScrollView | null>(null), timelineRef = useRef<ChatTimelineControls | null>(null);
  const locateSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => {
    timelineRef.current?.holdReadingPosition(); locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  };
  function previewMessage() { const value = chatDraft.trim(); if (!value || !child) return; preview.addQuestion(value); setChatDraft(""); }
  const header = <>
    <SectionCard surface="plain" style={styles.headingCard}>
      <Text accessibilityRole="header" style={[styles.title, compact && mobileType.sectionTitle]}>{brand.agentTitle}</Text>
      <Text style={styles.subtitle}>把已確認資料、你的問題與可靠來源放在一起，逐步討論下一步。</Text>
      <Text style={styles.previewNote}>合成畫面示例 · 尚未連接 Agent 或發送訊息</Text>
    </SectionCard>
    {child ? <AgentConversationPreview childId={child.id} online={model.connection === "online"} onLocateSource={locateSource} onPreviewReply={preview.showReply} />
      : <SectionCard><Text style={styles.body}>請先選擇孩子；不同孩子的私人對話不能混在一起。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard>}
  </>;
  return <>
    <ChatTimeline items={child ? preview.messages : []} recentLimit={6} compact={compact} header={header} scrollRef={scrollRef} controlsRef={timelineRef} followRequest={preview.followRequest}
      renderItem={message => <ChatMessage message={message} testID={message.kind === "intro" ? "chat-answer" : message.id === `${child?.id}-question` ? "chat-question" : message.kind === "local" ? "chat-local-message" : undefined}
        onLocateSource={locateSource} onStop={() => preview.stop(message.id)}>
        {message.kind === "intro" && child ? <>
          <Text style={styles.answerEyebrow}>示例版式 · 並非 Agent 建議</Text>
          <Text style={styles.answerIntro}>可以先把已確認的睡眠記錄、作息時間，以及你想了解的情況放在一起。正式回答會由已接通的 Agent 按授權資料及適用來源生成。</Text>
          <View style={styles.usedData}><Text style={styles.usedDataTitle}>這個示例畫面可顯示的資料</Text><Text style={styles.usedDataText}>{child.displayName} · {child.ageLabel} · 已載入已確認記錄 {model.records.filter(item => item.childId === child.id).length} 項</Text></View>
          <View style={styles.answerSteps}>
            <Text style={styles.stepTitle}>1　先核對已有記錄</Text><CitationText style={styles.stepBody}>查看事件發生時間、來源及是否已確認，避免把候選內容當作事實。【1】</CitationText>
            <Text style={styles.stepTitle}>2　列出仍想釐清的問題</Text><CitationText style={styles.stepBody}>例如入睡時間、睡前活動與你希望得到的協助；不在預覽中推斷原因。【2】</CitationText>
            <Text style={styles.stepTitle}>3　再由正式服務提供有來源的回覆</Text><CitationText style={styles.stepBody}>適用的官方資料、引用片段與日期，須待 Agent／知識接線後才能顯示。【3】</CitationText>
          </View>
          <Text style={styles.footerText}>此段只示範排版與狀態，沒有呼叫模型。</Text>
        </> : undefined}
      </ChatMessage>} />
    <AgentComposer enabled={!!child} compact={compact} draft={chatDraft} onChangeDraft={setChatDraft} onPreview={previewMessage} onPhotos={() => actions.open("photos")} onSources={() => actions.open("sources")} />
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas }, headingCard: { gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.title }, subtitle: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  previewNote: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  answerEyebrow: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, answerIntro: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  usedData: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.softLine, paddingVertical: spacing.sm, gap: spacing.xs }, usedDataTitle: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, fontWeight: "700" }, usedDataText: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  answerSteps: { gap: spacing.sm }, stepTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, marginTop: spacing.sm }, stepBody: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, footerText: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
