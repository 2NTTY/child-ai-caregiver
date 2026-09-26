import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField, OperationPill, SectionCard, SectionHeader, UnderlineTabs } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

type Tab = "facts" | "topics" | "summary";
const tabs: { key: Tab; label: string }[] = [{ key: "facts", label: "已確認與候選" }, { key: "topics", label: "話題" }, { key: "summary", label: "私人摘要" }];

export default function MemoryPage() {
  const { width } = useWindowDimensions();
  const { model, actions } = usePreview();
  const [tab, setTab] = useState<Tab>("facts");
  const [factTitle, setFactTitle] = useState("");
  const [factContent, setFactContent] = useState("");
  const [visibility, setVisibility] = useState<"private" | "family">("private");
  const [preview, setPreview] = useState(false);
  const child = model.children.find(item => item.id === model.selectedChildId);
  const stacked = width < 1200;
  return <PageFrame title="記憶與話題" description="候選事實未確認前只供本人查看；話題狀態不代表任何任務已完成。" eyebrow="育伴港 · 私人記憶">
    <View style={styles.context}><Text style={styles.contextTitle}>{child ? `${child.displayName}的記憶` : "尚未選擇孩子"}</Text><OperationPill state={model.operation.state} /></View>
    <UnderlineTabs items={tabs} value={tab} onChange={setTab} />
    {!child ? <SectionCard><Text style={styles.body}>選擇孩子後才可查看對應內容；不會顯示其他孩子的私人候選。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard> : null}
    {child && tab === "facts" ? <View style={[styles.columns, stacked && styles.stack]}>
      <View style={styles.column}>
        <SectionCard><SectionHeader title="事實清單" subtitle="以下是合成展示內容，沒有讀取真記憶。" />
          <View style={styles.fact}><View style={styles.factTop}><Text style={styles.factTitle}>照顧安排示例</Text><Text style={styles.confirmed}>已確認</Text></View><Text style={styles.body}>由照顧者確認的日常安排可以在此顯示，並保留來源與版本。</Text><Text style={styles.meta}>範圍：私人 · 來源：合成示例 · 版本待正式 API 提供</Text></View>
          <View style={styles.fact}><View style={styles.factTop}><Text style={styles.factTitle}>待核對內容示例</Text><Text style={styles.candidate}>待確認候選</Text></View><Text style={styles.body}>尚未核對的描述不能自動用作共享事實或背景關注。</Text><Text style={styles.meta}>只供本人查看 · 未確認</Text></View>
        </SectionCard>
      </View><View style={styles.column}>
        <SectionCard><SectionHeader title="新增候選草稿" subtitle="正式版會先建立私有候選，再由有權使用者確認。" />
          <AppTextField label="事實名稱" accessibilityLabel="候選事實名稱草稿" value={factTitle} onChangeText={value => { setFactTitle(value); setPreview(false); }} />
          <AppTextField label="內容與來源說明" accessibilityLabel="候選事實內容草稿" multiline value={factContent} onChangeText={value => { setFactContent(value); setPreview(false); }} />
          <Text style={styles.label}>預期可見範圍</Text><View style={styles.choiceRow}>{(["private", "family"] as const).map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={item === "private" ? "只供本人" : "家庭共享"} accessibilityState={{ selected: visibility === item }} onPress={() => { setVisibility(item); setPreview(false); }} style={({ pressed }) => [styles.choice, visibility === item && styles.choiceActive, pressed && styles.pressed]}><Text style={[styles.choiceText, visibility === item && styles.choiceTextActive]}>{item === "private" ? "只供本人" : "家庭共享"}</Text></Pressable>)}</View>
          <Text style={styles.meta}>即使選了家庭共享，也要在正式確認時再次核對目標與權限；本頁不會提交。</Text>
          <AppButton label="預覽候選" onPress={() => setPreview(true)} disabled={!factTitle.trim() || !factContent.trim()} />
          {preview ? <View style={styles.review}><Text style={styles.reviewTitle}>私有候選草稿 · 未建立／未確認</Text><Text style={styles.body}>{factTitle}：{factContent}</Text><Text style={styles.meta}>預期範圍：{visibility === "private" ? "只供本人" : "家庭共享（仍待正式再次確認）"}</Text></View> : null}
        </SectionCard>
      </View>
    </View> : null}
    {child && tab === "topics" ? <View style={[styles.columns, stacked && styles.stack]}>
      <View style={styles.column}><SectionCard><SectionHeader title="話題狀態" subtitle="合成示例只展示狀態版式。" /><View style={styles.fact}><View style={styles.factTop}><Text style={styles.factTitle}>想整理睡前流程</Text><Text style={styles.candidate}>待處理</Text></View><Text style={styles.body}>與孩子相關的私人話題；這不是已建立的任務。</Text></View><View style={styles.fact}><View style={styles.factTop}><Text style={styles.factTitle}>上次的記錄問題</Text><Text style={styles.confirmed}>已回答</Text></View><Text style={styles.body}>再次提問須明確說明原因並建立新話題，舊終態保留。</Text></View></SectionCard></View>
      <View style={styles.column}><SectionCard><SectionHeader title="話題與任務的分別" /><Text style={styles.body}>話題可待處理、暫緩、已回答或已解決。改變話題狀態不代表照護任務完成，也不等於通知已送達。</Text><Text style={styles.meta}>正式更新、重開、版本衝突及結果未知的查核，須接現有 MemoryPanel 與原 opId。</Text></SectionCard></View>
    </View> : null}
    {child && tab === "summary" ? <SectionCard><SectionHeader title="私人對話摘要" /><Text style={styles.body}>目前合成預覽沒有讀取摘要。正式版須顯示摘要版本、覆蓋的私人訊息範圍與建立時間；不得用未確認候選取代事實。</Text><AppButton label="前往基本聊天" variant="secondary" onPress={() => actions.open("chat")} /></SectionCard> : null}
  </PageFrame>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 }, context: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, backgroundColor: colors.mintSurface, padding: spacing.lg, borderRadius: radius.medium }, contextTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, column: { flex: 1, minWidth: 0, width: "100%" }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, fact: { padding: spacing.md, backgroundColor: colors.quietSurface, borderRadius: radius.small, gap: spacing.sm }, factTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm }, factTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, confirmed: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, backgroundColor: colors.paleTeal, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill }, candidate: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption, backgroundColor: colors.paleAmber, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill }, choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, choice: { minHeight: 42, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, justifyContent: "center" }, choiceActive: { backgroundColor: colors.teal, borderColor: colors.teal }, choiceText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "700" }, choiceTextActive: { color: colors.white }, review: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small, gap: spacing.xs }, reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "800" },
});
