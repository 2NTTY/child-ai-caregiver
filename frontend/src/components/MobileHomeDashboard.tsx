import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppButton, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { ChildPicker } from "./ChildPicker";
import { previewChecklist } from "../preview/fixture";

export function MobileHomeDashboard({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const records = model.records.filter(item => item.childId === child?.id);
  const checklist = previewChecklist.filter(item => item.childId === child?.id);
  const guide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const state = model.operation.state;
  const [quickWidth, setQuickWidth] = useState(0);
  const fourQuickColumns = quickWidth >= 290;
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.greeting}><View style={styles.greetingTop}><Text accessibilityRole="header" style={styles.heading}>你好，{model.caregiverName}！</Text><View aria-hidden importantForAccessibility="no-hide-descendants" style={styles.sprout}><MaterialCommunityIcons name="sprout" size={46} color={colors.teal} /></View></View><Text style={styles.subtitle}>{child ? `一起整理${child.displayName}的照顧日常。` : "先把基本資料整理好，再開始記錄。"}</Text>
      <Text style={styles.motto}>每個小日常，都值得好好記下。</Text></View>
    <SectionCard style={styles.childCard}>{child ? <View style={styles.childCardRow}>
      <View style={styles.identity}><View style={styles.avatar}><Text style={styles.initial}>{child.displayName.slice(0, 1)}</Text></View><View style={styles.copy}>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${child.displayName}的孩子檔案`} onPress={() => actions.open("profile")}><Text style={styles.childName}>{child.displayName}　›</Text></Pressable>
        {model.profileLoad !== "loading" ? <Text style={styles.body}>{child.ageLabel}</Text> : null}<Text style={styles.meta}>{model.profileLoad === "loading" ? "正在讀取孩子資料…" : `${child.regionLabel} · ${child.profileConfirmed ? "檔案已確認" : "待核對"}`}</Text>
      </View></View><ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} switchOnly />
    </View> : <><Text style={styles.title}>先建立第一位孩子的檔案</Text><Text style={styles.body}>只填已知資料；未知及約數都可以如實保留。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></>}</SectionCard>
    {guide ? <SectionCard><SectionHeader title="先完成基本設定" subtitle="檢查孩子、記錄及家庭偏好，再進行對話。" /><AppButton label="前往使用引導" onPress={() => actions.open("guide")} /></SectionCard> : <Pressable accessibilityRole="button" accessibilityLabel="進行對話" onPress={() => actions.open("chat")} style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
      <MaterialCommunityIcons name="magnify" size={25} color={colors.muted} /><Text style={styles.askText}>問我關於孩子的問題…</Text><View style={styles.send}><MaterialCommunityIcons name="send" size={22} color={colors.white} /></View>
    </Pressable>}
    {child && !guide ? <View style={styles.suggestions}>
      {["整理最近的睡眠", "記錄孩子的飲食", "下次檢查的問題"].map(question => <Pressable key={question} accessibilityRole="button" accessibilityLabel={`準備問題：${question}`} onPress={() => actions.prepareQuestion(question)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}><Text style={styles.suggestionText}>{question}</Text></Pressable>)}
    </View> : null}
    <SectionCard style={styles.focus}><SectionHeader title="今日重點" icon="star-four-points" action={<TextLink label="查看記錄" onPress={() => actions.open("care")} />} />
      <View style={styles.focusInner}><View style={styles.focusIcon}><MaterialCommunityIcons name="star-four-points" size={28} color={colors.deepTeal} /></View><View style={styles.copy}>
        <Text style={styles.title}>{state === "none" ? "從已確認資料開始" : model.operation.title}</Text><Text style={styles.body}>{state === "none" ? (model.recordsLoad === "loading" ? "正在讀取記錄…" : `目前載入 ${records.length} 項記錄；先核對原文和時間，再決定下一步。`) : model.operation.detail}</Text>
        {state !== "none" ? <OperationPill state={state} /> : null}
      </View></View>{["unknown", "failed", "needs_confirmation"].includes(state) ? <AppButton label={state === "unknown" ? "查核原操作" : "查看原操作"} variant="secondary" onPress={actions.reviewOperation} /> : null}
      <Text style={styles.meta}>合成資料；不是 Agent 生成的育兒建議。</Text>
    </SectionCard>
    <SectionCard><SectionHeader title={`待處理事項（${checklist.length}）`} icon="clipboard-check" subtitle="本地待辦示例；正式任務在「任務與預約」查看。" action={<TextLink label="查看全部" onPress={() => actions.open("tasks")} />} />
      {checklist.length === 0 ? <Text style={styles.body}>目前沒有待辦示例。</Text> : checklist.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.title} onPress={() => actions.open(item.destination)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View style={styles.rowIcon}><MaterialCommunityIcons name="clipboard-check-outline" size={24} color={colors.teal} /></View><View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.meta}>{item.detail}</Text></View><Text style={styles.arrow}>›</Text>
      </Pressable>)}
    </SectionCard>
    <SectionCard><SectionHeader title="快速記錄" icon="pencil" subtitle="先建立草稿，再核對家庭共享內容。" /><View style={styles.quickGrid} onLayout={event => setQuickWidth(event.nativeEvent.layout.width)}>
      {([{ kind: "note", label: "記錄情況", hint: "日常觀察", icon: "notebook-outline" }, { kind: "sleep", label: "記錄睡眠", hint: "時間原文", icon: "weather-night" }, { kind: "measurement", label: "身高體重", hint: "約數及單位", icon: "chart-bar" }, { kind: "feeding", label: "飲食記錄", hint: "份量與來源", icon: "silverware-fork-knife" }] as const).map(item => <Pressable key={item.kind} accessibilityRole="button" accessibilityLabel={`快速${item.label}`} disabled={!child} onPress={() => actions.composeCare(item.kind)} style={({ pressed }) => [styles.quick, fourQuickColumns && styles.quickNarrow, pressed && styles.pressed]}>
        <MaterialCommunityIcons name={item.icon} size={28} color={colors.teal} /><Text style={[styles.title, fourQuickColumns && styles.quickLabel]}>{item.label}</Text><Text style={styles.meta}>{item.hint}</Text>
      </Pressable>)}
    </View></SectionCard>
    <SectionCard><SectionHeader title="記憶與話題" icon="book-open-page-variant-outline" action={<TextLink label="查看更多" onPress={() => actions.open("memory")} />} />
      <View style={styles.row}><Image source={require("../../assets/images/assistant.png")} resizeMode="contain" style={styles.assistant} accessibilityLabel="育伴港助手插畫" /><View style={styles.copy}><Text style={styles.title}>把待核對的內容整理在一起</Text><Text style={styles.body}>候選先核對，已確認資料保留來源；私人聊天和家庭共享分開處理。</Text></View></View>
    </SectionCard>
    {model.connection === "offline" ? <Text style={styles.offline}>目前離線；已載入資料可能不是最新，草稿尚未保存。</Text> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.canvas }, page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 650, alignSelf: "center" }, greeting: { paddingVertical: spacing.sm, gap: spacing.sm }, heading: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800", lineHeight: 38, flex: 1 }, subtitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 25 }, motto: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, lineHeight: 20 },
  greetingTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, sprout: { width: 50, height: 50, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  childCard: { padding: spacing.md }, childCardRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexBasis: 180, flexGrow: 1, minWidth: 0 }, avatar: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" }, initial: { color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.heading, fontWeight: "700" }, copy: { flex: 1, minWidth: 0, gap: spacing.xs }, childName: { fontFamily: chineseFont, fontSize: typeScale.title, fontWeight: "800", color: colors.ink }, title: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700", color: colors.ink, lineHeight: 22 }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  suggestions: { flexDirection: "row", gap: spacing.sm }, suggestion: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: spacing.sm, backgroundColor: colors.white, borderRadius: radius.pill, justifyContent: "center" }, suggestionText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, textAlign: "center", lineHeight: 19 },
  quickNarrow: { flexBasis: "22%", padding: spacing.xs }, quickLabel: { fontSize: typeScale.caption, lineHeight: 20 },
  ask: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, backgroundColor: colors.white, minHeight: 68 }, askText: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, send: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.teal }, focus: { backgroundColor: colors.mintSurface }, focusInner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.medium, padding: spacing.md }, focusIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, minHeight: 64 }, rowIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, arrow: { color: colors.teal, fontSize: 22 }, quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, quick: { flexBasis: "45%", flexGrow: 1, minHeight: 114, backgroundColor: colors.quietSurface, borderRadius: radius.medium, padding: spacing.md, gap: spacing.xs, alignItems: "center", justifyContent: "center" }, assistant: { width: 64, height: 80 }, pressed: { opacity: 0.68 }, offline: { color: colors.warningInk, fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 23 },
});
