import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { AppButton, SectionCard, SectionHeader, TextLink } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

const suggestions = ["整理孩子的睡前流程", "核對最近的睡眠記錄", "先列出想問的問題"];

export default function ChatPage() {
  const { model, actions, chatDraft, setChatDraft } = usePreview();
  const [localMessages, setLocalMessages] = useState<Record<string, string[]>>({});
  const child = model.children.find(item => item.id === model.selectedChildId);
  const key = model.selectedChildId ?? "no-child";
  const messages = localMessages[key] ?? [];

  function previewMessage() {
    const value = chatDraft.trim();
    if (!value) return;
    setLocalMessages(previous => ({ ...previous, [key]: [...(previous[key] ?? []), value] }));
    setChatDraft("");
  }

  return <View style={styles.root}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionCard style={styles.headingCard}>
        <View style={styles.headingRow}><View style={styles.agentMark}><Text style={styles.agentGlyph}>✦</Text></View><View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>育伴港 Agent 對話</Text><Text style={styles.subtitle}>把已確認資料、你的問題與可靠來源放在一起，逐步討論下一步。</Text></View></View>
        <Text style={styles.previewNote}>合成畫面示例 · 尚未連接 Agent 或發送訊息</Text>
      </SectionCard>
      {!child ? <SectionCard><Text style={styles.body}>請先選擇孩子；不同孩子的私人對話不能混在一起。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard> : <>
        <View style={styles.questionRow}><View style={styles.questionBubble}><Text style={styles.questionText}>最近一星期孩子晚上比較難入睡。我應該先整理哪些資料，才方便討論睡前流程？</Text><Text style={styles.bubbleMeta}>合成問題示例 · 未向 Server 發送</Text></View><View style={styles.personMark}><Text style={styles.personGlyph}>媽</Text></View></View>
        <View style={styles.answerRow}><View style={styles.agentMarkSmall}><Text style={styles.agentGlyph}>✦</Text></View><View style={styles.answerCard}>
          <Text style={styles.answerEyebrow}>示例版式 · 並非 Agent 建議</Text>
          <Text style={styles.answerIntro}>可以先把已確認的睡眠記錄、作息時間，以及你想了解的情況放在一起。正式回答會由已接通的 Agent 按授權資料及適用來源生成。</Text>
          <View style={styles.usedData}><Text style={styles.usedDataTitle}>這個示例畫面可顯示的資料</Text><Text style={styles.usedDataText}>{child.displayName} · {child.ageLabel} · 已載入已確認記錄 {model.records.filter(item => item.childId === child.id).length} 項</Text></View>
          <View style={styles.answerSteps}>
            <Text style={styles.stepTitle}>1　先核對已有記錄</Text><Text style={styles.stepBody}>查看事件發生時間、來源及是否已確認，避免把候選內容當作事實。</Text>
            <Text style={styles.stepTitle}>2　列出仍想釐清的問題</Text><Text style={styles.stepBody}>例如入睡時間、睡前活動與你希望得到的協助；不在預覽中推斷原因。</Text>
            <Text style={styles.stepTitle}>3　再由正式服務提供有來源的回覆</Text><Text style={styles.stepBody}>適用的官方資料、引用片段與日期，須待 Agent／知識接線後才能顯示。</Text>
          </View>
          <View style={styles.answerFooter}><Text style={styles.footerText}>此段只示範排版與狀態，沒有呼叫模型。</Text></View>
        </View></View>
        {messages.map((message, index) => <View key={`${key}-${index}`} style={styles.questionRow}><View style={styles.localBubble}><Text style={styles.questionText}>{message}</Text><Text style={styles.bubbleMeta}>本地預覽 · 未送出</Text></View><View style={styles.personMark}><Text style={styles.personGlyph}>媽</Text></View></View>)}
        <SectionCard>
          <SectionHeader title="來源與後續操作" />
          <Text style={styles.body}>正式引用須顯示支持說法的片段、版本與適用限制；目前沒有 Agent／RAG 答覆，所以這裏不顯示假來源。</Text>
          <TextLink label="查看已確認記錄" onPress={() => actions.open("care")} />
        </SectionCard>
      </>}
    </ScrollView>
    <View style={styles.composer}>
      <View style={styles.composerTop}><Text style={styles.composerLabel}>撰寫問題</Text><Text style={styles.composerHint}>只供本地預覽；不會發送或保存</Text></View>
      <View style={styles.composerRow}><TextInput mode="outlined" multiline accessibilityLabel="撰寫對話問題" placeholder="輸入你想討論的照顧問題…" value={chatDraft} onChangeText={setChatDraft} style={styles.composerInput} outlineStyle={styles.composerOutline} disabled={!child} /><AppButton label="預覽輸入" onPress={previewMessage} disabled={!child || !chatDraft.trim()} /></View>
      <View style={styles.suggestions}><Text style={styles.suggestionLabel}>建議提問：</Text>{suggestions.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={item} onPress={() => setChatDraft(item)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}><Text style={styles.suggestionText}>{item}</Text></Pressable>)}</View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas }, pressed: { opacity: 0.68 }, scroll: { flex: 1 },
  page: { width: "100%", maxWidth: 1060, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.lg },
  headingCard: { gap: spacing.sm }, headingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md }, headingCopy: { flex: 1, minWidth: 0 },
  agentMark: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, agentMarkSmall: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, agentGlyph: { color: colors.teal, fontSize: 28 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" }, subtitle: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, previewNote: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.mintSurface, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, fontSize: typeScale.caption, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, questionRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-start", gap: spacing.sm }, questionBubble: { maxWidth: "82%", backgroundColor: colors.paleTeal, borderRadius: radius.medium, padding: spacing.md, gap: spacing.xs }, localBubble: { maxWidth: "82%", backgroundColor: colors.neutralSurface, borderRadius: radius.medium, padding: spacing.md, gap: spacing.xs }, questionText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 }, bubbleMeta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, textAlign: "right" }, personMark: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.paleAmber, alignItems: "center", justifyContent: "center" }, personGlyph: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  answerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, answerCard: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md }, answerEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "800" }, answerIntro: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24 }, usedData: { backgroundColor: colors.quietSurface, padding: spacing.md, borderRadius: radius.small, gap: spacing.xs }, usedDataTitle: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "800" }, usedDataText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, answerSteps: { gap: spacing.xs }, stepTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800", marginTop: spacing.xs }, stepBody: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, answerFooter: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm }, footerText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  composer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm }, composerTop: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.xs }, composerLabel: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, composerHint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption }, composerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }, composerInput: { flex: 1, minWidth: 185, maxHeight: 110, backgroundColor: colors.white, fontFamily: chineseFont }, composerOutline: { borderColor: colors.line, borderRadius: radius.small }, suggestions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs }, suggestionLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption }, suggestion: { minHeight: 34, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, justifyContent: "center" }, suggestionText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption },
});
