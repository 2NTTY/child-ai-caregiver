import { useLayoutEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useMotionPreferences } from "../motion";
import { useFirstScreenReady } from "../startup/FirstScreenGate";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { HomeBackground } from "./appearance/HomeBackground";

// The original session owner consumes the introduction; orientation never expires.
export function HomeWelcome({ introductionPending, onIntroductionPresented, scopeKey, compact = false }: {
  introductionPending: boolean; onIntroductionPresented?: () => void; scopeKey: string; compact?: boolean;
}) {
  const pathname = usePathname();
  const preferences = useMotionPreferences();
  const ready = useFirstScreenReady();
  const consumed = useRef(false);
  const callback = useRef(onIntroductionPresented); callback.current = onIntroductionPresented;
  const date = new Date().toLocaleDateString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric", weekday: "long" });
  useLayoutEffect(() => {
    if (!introductionPending || consumed.current || pathname !== "/" || !ready || !preferences.preferenceReady || !preferences.active) return;
    let cancelled = false;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (cancelled || consumed.current) return;
        consumed.current = true; callback.current?.();
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [introductionPending, pathname, ready, preferences.preferenceReady, preferences.active, preferences.epoch, scopeKey]);

  return <View testID="home-welcome" style={[styles.header, compact && styles.compact]}>
    <View style={styles.copy}>
      <Text style={styles.date}>{date}</Text>
      <Text accessibilityRole="header" aria-level={1} style={styles.title}>今日</Text>
      <Text style={styles.description}>先看重要的，再繼續日常。</Text>
    </View>
    {!compact ? <View style={styles.artwork} aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <HomeBackground useCustomImage={false} surface={colors.canvas} containIllustration webCssFade fadeStart={0} fadeEnd={0.25} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.lg, minWidth: 0, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  compact: { paddingTop: 0, paddingBottom: spacing.lg },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  date: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 30, lineHeight: 40, fontWeight: "700" },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  artwork: { width: 170, height: 100, flexShrink: 0, overflow: "hidden" },
});
