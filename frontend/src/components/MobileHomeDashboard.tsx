import { brand } from "../branding";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AccessibilityInfo, Animated, Easing, Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { HomeBackground } from "./appearance/HomeBackground";
import { AppIcon } from "./AppIcon";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing } from "../theme";
import { AppButton, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { ChildPicker } from "./ChildPicker";
import { previewChecklist } from "../preview/fixture";

const quickActions = [
  { kind: "note", label: "記錄情況", hint: "日常觀察", icon: "notebook-outline" },
  { kind: "photos", label: "照片記錄", hint: "原圖及草稿", icon: "image-outline" },
  { kind: "measurement", label: "身高體重", hint: "約數及單位", icon: "chart-bar" },
  { kind: "sleep", label: "記錄睡眠", hint: "時間原文", icon: "weather-night" },
] as const;

export function MobileHomeDashboard({ model, actions, introductionPending = false }: { model: HomeViewModel; actions: HomeActions; introductionPending?: boolean }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const records = model.records.filter(item => item.childId === child?.id);
  const checklist = previewChecklist.filter(item => item.childId === child?.id);
  const guide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const state = model.operation.state;
  const { width: windowWidth } = useWindowDimensions();
  const [quickWidth, setQuickWidth] = useState<number | null>(null);
  const initialQuickWidth = Math.max(0, Math.min(windowWidth, mobileLayout.breakpoint) - 2 * mobileLayout.pageInset - 2 * mobileLayout.cardInset - 2);
  const fourQuickColumns = (quickWidth ?? initialQuickWidth) >= 290;
  const playIntroduction = useRef(introductionPending && Boolean(child)).current;
  const intro = useRef(new Animated.Value(playIntroduction ? 0 : 1)).current;
  const transitionStarted = useRef(false);
  const [greetingHeight, setGreetingHeight] = useState(168);
  const [childHeight, setChildHeight] = useState(98);
  const [headerWidth, setHeaderWidth] = useState(Math.min(windowWidth, mobileLayout.breakpoint) - 2 * mobileLayout.pageInset);
  const [docked, setDocked] = useState(!playIntroduction);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const hasChild = Boolean(child);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReducedMotion(value); }, () => { if (active) setReducedMotion(true); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { active = false; subscription?.remove(); };
  }, []);
  useFocusEffect(useCallback(() => () => {
    intro.stopAnimation();
    intro.setValue(1);
    setDocked(true);
  }, [intro]));
  useFocusEffect(useCallback(() => {
    if (!hasChild || docked || pickerOpen || reducedMotion === null) return;
    const timer = setTimeout(() => {
      transitionStarted.current = true;
      if (reducedMotion) { intro.setValue(1); setDocked(true); return; }
      Animated.timing(intro, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.cubic), useNativeDriver: false })
        .start(({ finished }) => { if (finished) setDocked(true); });
    }, 3000);
    return () => { clearTimeout(timer); intro.stopAnimation(); };
  }, [hasChild, docked, pickerOpen, reducedMotion, intro]));
  function handlePickerOpen(open: boolean) {
    setPickerOpen(open);
    if (open && transitionStarted.current && !docked) {
      intro.stopAnimation();
      intro.setValue(1);
      setDocked(true);
    }
  }

  return <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View testID="mobile-home-header" onLayout={event => setHeaderWidth(event.nativeEvent.layout.width)} style={[styles.homeHeader, { minHeight: greetingHeight }]}>
      <View pointerEvents="none" style={[styles.artwork, { height: greetingHeight }]}><HomeBackground surface={colors.canvas} fadeBottom fitIllustration /></View>
      <Animated.View testID="mobile-home-greeting" pointerEvents="none" accessibilityElementsHidden={hasChild && docked} aria-hidden={hasChild && docked}
        onLayout={event => setGreetingHeight(event.nativeEvent.layout.height)}
        style={[styles.greeting, { minHeight: greetingHeight, opacity: hasChild ? intro.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] }) : 1 }]}>
      <View style={styles.greetingCopy}>
        <Text accessibilityRole="header" style={styles.heading}>你好，{model.caregiverName}！</Text>
        <Text style={styles.subtitle}>{child ? `一起整理${child.displayName}的照顧日常。` : "先把基本資料整理好，再開始記錄。"}</Text>
        <Text style={styles.motto}>每個小日常，都值得好好記下。</Text>
      </View>
      </Animated.View>
      {child ? <Animated.View testID="mobile-child-card" onLayout={event => setChildHeight(event.nativeEvent.layout.height)}
        style={[styles.childCard, {
          minWidth: intro.interpolate({ inputRange: [0, 1], outputRange: [headerWidth, 0] }),
          maxWidth: intro.interpolate({ inputRange: [0, 1], outputRange: ["100%", "62%"] }),
          marginTop: intro.interpolate({ inputRange: [0, 1], outputRange: [mobileLayout.sectionGap, -(greetingHeight + childHeight) / 2] }),
          padding: intro.interpolate({ inputRange: [0, 1], outputRange: [spacing.md, 0] }),
        }]}>
        <Animated.View testID="mobile-child-card-frame" pointerEvents="none" style={[styles.childCardFrame,
          { opacity: intro.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [1, 1, 0, 0], extrapolate: "clamp" }) }]} />
        <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} homeIdentity
          loading={model.profileLoad === "loading"} onOpenChange={handlePickerOpen} />
        {!child.profileConfirmed ? <Text style={styles.meta}>檔案待核對</Text> : null}
      </Animated.View> : null}
    </View>

    {!child ? <SectionCard testID="mobile-child-card">
        <Text style={styles.title}>先建立第一位孩子的檔案</Text>
        <Text style={styles.body}>只填已知資料；未知及約數都可以如實保留。</Text>
        <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
    </SectionCard> : null}

    {guide ? <SectionCard>
      <SectionHeader title="先完成基本設定" subtitle="檢查孩子、記錄及家庭偏好，再進行對話。" />
      <AppButton label="前往使用引導" onPress={() => actions.open("guide")} />
    </SectionCard> : null}

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
  homeHeader: { position: "relative", marginTop: -mobileLayout.pageInset },
  artwork: { position: "absolute", top: 0, left: -mobileLayout.pageInset, right: -mobileLayout.pageInset },
  greeting: { minHeight: 168, paddingVertical: spacing.lg, justifyContent: "center" },
  childCard: { width: "auto", alignSelf: "flex-start", borderRadius: radius.large, gap: spacing.xs },
  childCardFrame: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.large, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white },
  greetingCopy: { width: "60%", minWidth: 0, gap: spacing.xs },
  heading: { fontFamily: chineseFont, color: colors.ink, fontSize: 26, lineHeight: 34, fontWeight: "800" },
  subtitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24 },
  motto: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22 },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption },
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
