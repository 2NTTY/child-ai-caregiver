import { brand } from "../branding";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { HomeBackground } from "./appearance/HomeBackground";
import { AppIcon } from "./AppIcon";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing } from "../theme";
import { AppButton, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { ChildPicker } from "./ChildPicker";
import { previewChecklist } from "../preview/fixture";

const questions = ["整理最近的睡眠", "記錄孩子的飲食", "下次檢查的問題"];
const quickActions = [
  { kind: "note", label: "記錄情況", hint: "日常觀察", icon: "notebook-outline" },
  { kind: "photos", label: "照片記錄", hint: "原圖及草稿", icon: "image-outline" },
  { kind: "measurement", label: "身高體重", hint: "約數及單位", icon: "chart-bar" },
  { kind: "sleep", label: "記錄睡眠", hint: "時間原文", icon: "weather-night" },
] as const;

export function MobileHomeDashboard({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const records = model.records.filter(item => item.childId === child?.id);
  const checklist = previewChecklist.filter(item => item.childId === child?.id);
  const guide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const state = model.operation.state;
  const viewportWidth = useWindowDimensions().width;
  const [quickWidth, setQuickWidth] = useState(0);
  const [childWidth, setChildWidth] = useState(0);
  const fourQuickColumns = quickWidth >= 290;
  const shortSwitch = childWidth ? childWidth < 300 : viewportWidth < 360;
  const splitAge = Boolean(child?.ageSummaryLabel && child?.ageReferenceLabel);

  return <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View testID="mobile-home-greeting" style={styles.greeting}>
      <HomeBackground surface={colors.canvas} fadeBottom />
      <View style={styles.greetingCopy}>
        <Text accessibilityRole="header" style={styles.heading}>你好，{model.caregiverName}！</Text>
        <Text style={styles.subtitle}>{child ? `一起整理${child.displayName}的照顧日常。` : "先把基本資料整理好，再開始記錄。"}</Text>
        <Text style={styles.motto}>每個小日常，都值得好好記下。</Text>
      </View>
    </View>

    <SectionCard testID="mobile-child-card">
      {child ? <>
        <View style={styles.childCardRow} onLayout={event => setChildWidth(event.nativeEvent.layout.width)}>
          <Pressable accessibilityRole="button" accessibilityLabel={`查看${child.displayName}的孩子檔案`} onPress={() => actions.open("profile")} style={({ pressed }) => [styles.identity, pressed && styles.pressed]}>
            <View style={styles.avatar}><Text style={styles.initial}>{child.displayName.slice(0, 1)}</Text></View>
            <View style={styles.childCopy}>
              <View style={styles.nameRow}><Text style={styles.childName}>{child.displayName}</Text><AppIcon name="chevron-right" size={mobileIcons.inline} /></View>
              <Text style={styles.age}>{model.profileLoad === "loading" ? "正在讀取…" : splitAge ? child.ageSummaryLabel : child.ageLabel}</Text>
            </View>
          </Pressable>
          <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} switchOnly shortSwitchLabel={shortSwitch} />
        </View>
        {model.profileLoad !== "loading" ? <View style={styles.childMeta}>
          {splitAge ? <Text style={styles.meta}>{child.ageReferenceLabel}</Text> : null}
          <Text style={styles.meta}>{child.regionLabel} · {child.profileConfirmed ? "檔案已確認" : "待核對"}</Text>
        </View> : null}
      </> : <>
        <Text style={styles.title}>先建立第一位孩子的檔案</Text>
        <Text style={styles.body}>只填已知資料；未知及約數都可以如實保留。</Text>
        <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
      </>}
    </SectionCard>

    {guide ? <SectionCard>
      <SectionHeader title="先完成基本設定" subtitle="檢查孩子、記錄及家庭偏好，再進行對話。" />
      <AppButton label="前往使用引導" onPress={() => actions.open("guide")} />
    </SectionCard> : <Pressable accessibilityRole="button" accessibilityLabel="進行對話" onPress={() => actions.open("chat")} style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
      <AppIcon name="magnify" size={mobileIcons.content} color={colors.muted} /><Text style={styles.askText}>問我關於孩子的問題…</Text>
      <View style={styles.send}><AppIcon name="send" size={mobileIcons.content} color={colors.onAccent} /></View>
    </Pressable>}
    {child && !guide ? <View style={styles.suggestions}>
      {questions.map(question => <Pressable key={question} accessibilityRole="button" accessibilityLabel={`準備問題：${question}`} onPress={() => actions.prepareQuestion(question)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
        <Text style={styles.suggestionText}>{question}</Text>
      </Pressable>)}
    </View> : null}

    <SectionCard style={styles.focus}>
      <SectionHeader title="今日重點" icon="star-four-points" action={<TextLink label="查看記錄" onPress={() => actions.open("care")} />} />
      <View style={styles.focusInner}>
        <View style={styles.focusIcon}><AppIcon name="star-four-points" size={mobileIcons.content} color={colors.deepTeal} /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>{state === "none" ? "從已確認資料開始" : model.operation.title}</Text>
          <Text style={styles.body}>{state === "none" ? (model.recordsLoad === "loading" ? "正在讀取記錄…" : `已載入 ${records.length} 項記錄，先核對原文與時間。`) : model.operation.detail}</Text>
          {state !== "none" ? <OperationPill state={state} /> : null}
        </View>
      </View>
      {["unknown", "failed", "needs_confirmation"].includes(state) ? <AppButton label={state === "unknown" ? "查核原操作" : "查看原操作"} variant="secondary" onPress={actions.reviewOperation} /> : null}
      <Text style={styles.meta}>合成資料；不是 Agent 生成的育兒建議。</Text>
    </SectionCard>

    <SectionCard>
      <SectionHeader title="待辦事項" count={checklist.length} icon="clipboard-check" subtitle="待辦示例 · 尚未建立正式任務" action={<TextLink label="查看全部" onPress={() => actions.open("tasks")} />} />
      <View>{checklist.length === 0 ? <Text style={styles.body}>目前沒有待辦示例。</Text> : checklist.map((item, index) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.title} onPress={() => actions.open(item.destination)} style={({ pressed }) => [styles.row, index === checklist.length - 1 && styles.lastRow, pressed && styles.pressed]}>
        <View style={styles.rowIcon}><AppIcon name="clipboard-check-outline" size={mobileIcons.content} color={colors.teal} /></View>
        <View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.meta}>{item.detail}</Text></View>
        <AppIcon name="chevron-right" size={mobileIcons.inline} />
      </Pressable>)}</View>
    </SectionCard>

    <SectionCard>
      <SectionHeader title="快速記錄" icon="pencil" />
      <View testID="mobile-quick-actions" style={styles.quickGrid} onLayout={event => setQuickWidth(event.nativeEvent.layout.width)}>
        {quickActions.map(item => <Pressable key={item.kind} accessibilityRole="button" accessibilityLabel={`快速${item.label}`} disabled={!child} onPress={() => item.kind === "photos" ? actions.open("photos") : actions.composeCare(item.kind)} style={({ pressed }) => [styles.quick, fourQuickColumns && styles.fourColumns, !child && styles.disabled, pressed && styles.pressed]}>
          <AppIcon name={item.icon} size={mobileIcons.content} color={colors.teal} /><Text style={styles.quickLabel}>{item.label}</Text><Text style={styles.quickHint}>{item.hint}</Text>
        </Pressable>)}
      </View>
    </SectionCard>

    <SectionCard>
      <SectionHeader title="記憶與話題" icon="book-open-page-variant-outline" action={<TextLink label="查看更多" onPress={() => actions.open("memory")} />} />
      <View style={styles.memoryRow}>
        <Image source={require("../../assets/images/assistant.png")} resizeMode="contain" style={styles.assistant} accessibilityLabel={`${brand.name}助手插畫`} />
        <View style={styles.copy}><Text style={styles.title}>把待核對的內容整理在一起</Text><Text style={styles.body}>候選先核對，已確認資料保留來源；私人聊天和家庭共享分開處理。</Text></View>
      </View>
    </SectionCard>
    {model.connection === "offline" ? <Text style={styles.offline}>目前離線；已載入資料可能不是最新，草稿尚未保存。</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { padding: mobileLayout.pageInset, gap: mobileLayout.sectionGap, width: "100%", maxWidth: mobileLayout.breakpoint, alignSelf: "center" },
  greeting: { position: "relative", minHeight: 168, marginHorizontal: -mobileLayout.pageInset, marginTop: -mobileLayout.pageInset, paddingHorizontal: mobileLayout.pageInset, paddingVertical: spacing.lg, justifyContent: "center", overflow: "hidden" },
  greetingCopy: { width: "60%", minWidth: 0, gap: spacing.xs },
  heading: { fontFamily: chineseFont, color: colors.ink, ...mobileType.heading, fontWeight: "800" },
  subtitle: { fontFamily: chineseFont, color: colors.ink, ...mobileType.body },
  motto: { fontFamily: chineseFont, color: colors.teal, ...mobileType.caption },
  childCardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  identity: { flex: 1, minWidth: 0, minHeight: mobileLayout.touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: mobileLayout.childAvatar, height: mobileLayout.childAvatar, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.deepTeal, fontFamily: chineseFont, ...mobileType.sectionTitle, fontWeight: "700" },
  childCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  childName: { fontFamily: chineseFont, ...mobileType.sectionTitle, fontWeight: "800", color: colors.ink, flexShrink: 1 },
  age: { fontFamily: chineseFont, color: colors.muted, ...mobileType.label },
  childMeta: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.sm, rowGap: spacing.xs },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption },
  suggestions: { flexDirection: "row", gap: spacing.sm },
  suggestion: { flex: 1, minWidth: 0, minHeight: mobileLayout.touchTarget, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.white, borderRadius: radius.pill, justifyContent: "center" },
  suggestionText: { fontFamily: chineseFont, color: colors.deepTeal, ...mobileType.label, textAlign: "center" },
  ask: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, backgroundColor: colors.white, minHeight: mobileLayout.askMinHeight },
  askText: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.ink },
  focus: { backgroundColor: colors.paleTeal },
  focusInner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.white, borderRadius: radius.small, padding: spacing.md },
  focusIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, minHeight: 64 },
  lastRow: { borderBottomWidth: 0 },
  rowIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quick: { flexBasis: "45%", flexGrow: 1, minHeight: mobileLayout.quickTileMinHeight, backgroundColor: colors.quietSurface, borderRadius: radius.small, padding: spacing.xs, gap: spacing.xs, alignItems: "center", justifyContent: "center" },
  fourColumns: { flexBasis: "22%" },
  quickLabel: { fontFamily: chineseFont, color: colors.ink, ...mobileType.label, fontWeight: "700", textAlign: "center" },
  quickHint: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, textAlign: "center" },
  memoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  assistant: { width: 56, height: 64 },
  pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
  offline: { fontFamily: chineseFont, color: colors.warningInk, ...mobileType.body },
});
