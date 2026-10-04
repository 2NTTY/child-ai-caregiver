import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { HomeBackground } from "./appearance/HomeBackground";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, mobileLayout, mobileType, radius, spacing } from "../theme";
import { AppButton, SectionCard, TextLink } from "./ui";
import { ChildPicker } from "./ChildPicker";
import { HomeAgentImportant } from "./HomeAgentImportant";
import { HomeOngoing } from "./HomeOngoing";
import { HomeQuickActions } from "./HomeQuickActions";
import { useMotionPreferences } from "../motion";
import { useFirstScreenReady } from "../startup/FirstScreenGate";

export function MobileHomeDashboard({ model, actions, introductionPending = false }: { model: HomeViewModel; actions: HomeActions; introductionPending?: boolean }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const guide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const { width: windowWidth } = useWindowDimensions();
  const playIntroduction = useRef(introductionPending && Boolean(child)).current;
  const intro = useRef(new Animated.Value(playIntroduction ? 0 : 1)).current;
  const transitionStarted = useRef(false);
  const [greetingHeight, setGreetingHeight] = useState(168);
  const [childHeight, setChildHeight] = useState(98);
  const [headerWidth, setHeaderWidth] = useState(Math.min(windowWidth, mobileLayout.breakpoint) - 2 * mobileLayout.pageInset);
  const [docked, setDocked] = useState(!playIntroduction);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { reducedMotion, preferenceReady } = useMotionPreferences();
  const firstScreenReady = useFirstScreenReady();
  const hasChild = Boolean(child);
  useLayoutEffect(() => {
    if (!preferenceReady || !reducedMotion) return;
    intro.stopAnimation(); intro.setValue(1); setDocked(true);
  }, [intro, preferenceReady, reducedMotion]);
  useFocusEffect(useCallback(() => () => {
    intro.stopAnimation();
    intro.setValue(1);
    setDocked(true);
  }, [intro]));
  useFocusEffect(useCallback(() => {
    if (!firstScreenReady || !hasChild || docked || pickerOpen || !preferenceReady || reducedMotion) return;
    const timer = setTimeout(() => {
      transitionStarted.current = true;
      Animated.timing(intro, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.cubic), useNativeDriver: false })
        .start(({ finished }) => { if (finished) setDocked(true); });
    }, 3000);
    return () => { clearTimeout(timer); intro.stopAnimation(); };
  }, [firstScreenReady, hasChild, docked, pickerOpen, preferenceReady, reducedMotion, intro]));
  function handlePickerOpen(open: boolean) {
    setPickerOpen(open);
    if (open && transitionStarted.current && !docked) {
      intro.stopAnimation();
      intro.setValue(1);
      setDocked(true);
    }
  }

  return <View style={styles.root}><ScrollView testID="mobile-home-scroll" style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
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
        }, docked && styles.childCardDocked]}>
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

    {guide ? <View style={styles.guide}><Text style={styles.body}>已有孩子即可提問；資料需要時再補充。</Text><TextLink label="了解如何使用" onPress={() => actions.open("guide")} /></View> : null}
    <HomeAgentImportant model={model} actions={actions} />
    <HomeOngoing model={model} actions={actions} />
  </ScrollView><HomeQuickActions model={model} actions={actions} docked /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  scroll: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  page: { padding: mobileLayout.pageInset, gap: mobileLayout.sectionGap, width: "100%", maxWidth: mobileLayout.breakpoint, alignSelf: "center" },
  homeHeader: { position: "relative", marginTop: -mobileLayout.pageInset },
  artwork: { position: "absolute", top: 0, left: -mobileLayout.pageInset, right: -mobileLayout.pageInset },
  greeting: { minHeight: 168, paddingVertical: spacing.lg, justifyContent: "center" },
  childCard: { width: "auto", alignSelf: "flex-start", borderRadius: radius.large, gap: spacing.xs },
  // Resolve the returned-page position in layout, before asynchronous onLayout measurements.
  childCardDocked: { position: "absolute", top: "50%", left: 0, marginTop: 0, transform: [{ translateY: "-50%" }] },
  childCardFrame: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.large, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white },
  greetingCopy: { width: "60%", minWidth: 0, gap: spacing.xs },
  heading: { fontFamily: chineseFont, color: colors.ink, fontSize: 26, lineHeight: 34, fontWeight: "800" },
  subtitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24 },
  motto: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22 },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption },
  guide: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
});
