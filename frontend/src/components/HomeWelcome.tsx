import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionTokens, useMotionPreferences } from "../motion";
import { useFirstScreenReady } from "../startup/FirstScreenGate";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { HomeBackground } from "./appearance/HomeBackground";

// The existing session owner consumes the intro. Routes and child changes never reset it.
export function HomeWelcome({ introductionPending, onIntroductionPresented, scopeKey, compact = false }: {
  introductionPending: boolean; onIntroductionPresented?: () => void; scopeKey: string; compact?: boolean;
}) {
  const pathname = usePathname();
  const preferences = useMotionPreferences();
  const firstScreenReady = useFirstScreenReady();
  const play = useRef(introductionPending).current;
  const initiallyClosed = !play || (preferences.preferenceReady && preferences.reducedMotion);
  const [closed, setClosed] = useState(initiallyClosed);
  const [closing, setClosing] = useState(false);
  const [presented, setPresented] = useState(false);
  const [height, setHeight] = useState(compact ? 152 : 176);
  const progress = useSharedValue(initiallyClosed ? 1 : 0);
  const alive = useRef(true);
  const generation = useRef(0);
  const consumed = useRef(false);
  const callback = useRef(onIntroductionPresented);
  callback.current = onIntroductionPresented;
  const previous = useRef({ scopeKey, epoch: preferences.epoch });
  const consume = useCallback(() => {
    if (!play || consumed.current) return;
    consumed.current = true;
    callback.current?.();
  }, [play]);
  const finish = useCallback((token: number) => {
    if (!alive.current || token !== generation.current) return;
    setClosed(true); setClosing(false);
  }, []);

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current += 1; cancelAnimation(progress); };
  }, [progress]);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { scopeKey, epoch: preferences.epoch };
    const token = ++generation.current;
    cancelAnimation(progress);
    const interrupted = old.scopeKey !== scopeKey || old.epoch !== preferences.epoch || pathname !== "/";
    if (consumed.current && (interrupted || !preferences.enabled)) {
      progress.value = 1; finish(token); return;
    }
    // Initial child-scope resolution and background/layout changes are not a presentation.
    if (!play || consumed.current || pathname !== "/" || !firstScreenReady || !preferences.preferenceReady || !preferences.active) return;
    if (preferences.reducedMotion) { consume(); progress.value = 1; finish(token); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = requestAnimationFrame(() => {
      // Allow the ready, visible tree to paint before starting its reading time.
      frame = requestAnimationFrame(() => {
        if (!alive.current || token !== generation.current) return;
        consume(); setPresented(true);
        timer = setTimeout(() => {
          if (!alive.current || token !== generation.current) return;
          setClosing(true);
          progress.value = withTiming(1, { duration: 360, easing: motionTokens.coverEase, reduceMotion: ReduceMotion.System },
            finished => { if (finished) runOnJS(finish)(token); });
        }, 3000);
      });
    });
    return () => { cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer); cancelAnimation(progress); };
  }, [scopeKey, pathname, preferences.epoch, preferences.enabled, preferences.active, preferences.reducedMotion, preferences.preferenceReady, firstScreenReady, play, consume, finish, progress]);

  // Height, spacing and upward travel share one progress, including the final zero-height seam.
  const frameStyle = useAnimatedStyle(() => ({ height: (height + spacing.lg) * (1 - progress.value) }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -(height + spacing.lg) * progress.value }] }));
  // Keep the initial decorative image mounted until its load/fallback settles the startup gate.
  if (closed && firstScreenReady) return null;
  return <Animated.View testID="home-welcome" style={[styles.clip, frameStyle]} pointerEvents="none"
    aria-hidden={closed || closing} accessibilityElementsHidden={closed || closing} importantForAccessibility={closed || closing ? "no-hide-descendants" : "auto"}
    {...{ dataSet: { introPhase: closed ? "settled" : closing ? "collapsing" : presented ? "reading" : "waiting" } }}>
    <Animated.View testID={compact ? "mobile-home-greeting" : "desktop-home-banner"}
      onLayout={event => setHeight(event.nativeEvent.layout.height)} style={[styles.card, compact && styles.compactCard, cardStyle]}>
      <HomeBackground useCustomImage={false} surface={colors.paper} fitIllustration illustrationInset={compact ? 8 : 4} fadeBottom />
      <View style={[styles.copy, compact && styles.compactCopy]}>
        <Text accessibilityRole="header" style={[styles.greeting, compact && styles.compactGreeting]}>你好</Text>
        <Text style={styles.subline}>每個小日常，都值得好好記下。</Text>
      </View>
    </Animated.View>
  </Animated.View>;
}

export function HomeTodayHeading() {
  const date = new Date().toLocaleDateString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric" });
  return <View testID="home-today-heading" style={styles.today} role="region" accessibilityLabel="今日" tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
    <Text style={styles.date}>{date} · 先看重要的，再繼續日常</Text>
  </View>;
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", flexShrink: 0 },
  card: { width: "100%", maxWidth: 800, alignSelf: "center", minHeight: 176, backgroundColor: colors.paper, borderRadius: radius.medium, overflow: "hidden", justifyContent: "center" },
  compactCard: { minHeight: 152, maxWidth: undefined },
  copy: { width: "56%", minWidth: 0, gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: 32 },
  compactCopy: { width: "60%", paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
  greeting: { fontFamily: chineseFont, color: colors.ink, fontSize: 30, lineHeight: 38, fontWeight: "800" },
  compactGreeting: { fontSize: 26, lineHeight: 34 },
  subline: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  today: { gap: spacing.xs },
  date: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
