import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView, type ScrollViewProps } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMotionPreferences } from "../motion/preferences";
import { motionTokens } from "../motion/tokens";
import { colors } from "../theme";
import { AppIcon } from "./AppIcon";
import { AppScrollView } from "./AppScrollView";
import { horizontalOverflow, horizontalRevealOffset, nextHorizontalItem, type HorizontalRailItem, type HorizontalRailMetrics } from "./horizontalOverflow";

interface HorizontalOverflowRailProps extends Omit<ScrollViewProps, "horizontal" | "showsHorizontalScrollIndicator"> {
  items: readonly HorizontalRailItem[];
  hintLabel: string;
  hintColor?: string;
  rowTestID?: string;
  hintTestID?: string;
  hintSlotTestID?: string;
  revealTarget?: HorizontalRailItem;
  animatedScroll?: boolean;
  onRevealItem: (key: string, scroll: ScrollView | null) => void;
}

/** A tab/disclosure rail with an independent trailing hint, never a content overlay. */
export const HorizontalOverflowRail = forwardRef<ScrollView, HorizontalOverflowRailProps>(function HorizontalOverflowRail(
  { items, hintLabel, hintColor = colors.muted, rowTestID, hintTestID, hintSlotTestID, revealTarget,
    animatedScroll = true, onRevealItem, style, children, onLayout, onContentSizeChange, onScroll,
    onScrollBeginDrag, onTouchStart, ...props }, forwardedRef,
) {
  const preferences = useMotionPreferences();
  const scrollRef = useRef<ScrollView | null>(null);
  const hintRef = useRef<View | null>(null);
  const metrics = useRef<HorizontalRailMetrics>({ rowWidth: 0, viewportWidth: 0, contentWidth: 0, x: 0 });
  const pending = useRef<{ key: string; x: number } | null>(null);
  const [hint, setHint] = useState({ overflow: false, more: false });
  const [layout, setLayout] = useState({ viewportWidth: 0, contentWidth: 0 });
  const opacity = useSharedValue(0);
  useImperativeHandle(forwardedRef, () => scrollRef.current!, []);

  function updateHint() {
    const next = horizontalOverflow(metrics.current);
    setHint(current => current.overflow === next.overflow && current.more === next.more ? current : next);
  }
  function revealNext() {
    const item = nextHorizontalItem(items, metrics.current, pending.current?.key ?? null);
    if (!item) return;
    const x = horizontalRevealOffset(item, metrics.current);
    pending.current = { key: item.key, x };
    // Use the RN ref signature: RN Web installs it on its DOM viewport as well.
    scrollRef.current?.scrollTo({ x, animated: animatedScroll && preferences.enabled });
    onRevealItem(item.key, scrollRef.current);
  }

  useLayoutEffect(() => {
    if (!revealTarget || layout.viewportWidth <= 0) return;
    pending.current = null;
    const x = horizontalRevealOffset(revealTarget, metrics.current);
    if (Math.abs(x - metrics.current.x) > 1) scrollRef.current?.scrollTo({ x, animated: false });
  }, [revealTarget?.key, revealTarget?.x, revealTarget?.width, layout.viewportWidth, layout.contentWidth]);

  useLayoutEffect(() => {
    cancelAnimation(opacity);
    const target = hint.more ? 1 : 0;
    opacity.value = preferences.enabled ? withTiming(target, {
      duration: motionTokens.selection.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System,
    }) : target;
    if (!hint.more && Platform.OS === "web") {
      const button = hintRef.current as unknown as HTMLElement | null;
      // Wheel/resize can hide a focused hint without an arrow activation.
      if (button?.ownerDocument.activeElement === button) scrollRef.current?.getScrollableNode()?.focus({ preventScroll: true });
    }
  }, [hint.more, preferences.enabled, preferences.epoch, opacity]);

  useLayoutEffect(() => {
    // A preference/viewport interruption settles any native smooth scroll immediately.
    const target = pending.current;
    if (target) {
      scrollRef.current?.scrollTo({ x: Math.max(0, Math.min(target.x, metrics.current.contentWidth - metrics.current.viewportWidth)), animated: false });
      pending.current = null;
    }
  }, [preferences.enabled, preferences.epoch]);
  useLayoutEffect(() => () => { cancelAnimation(opacity); }, [opacity]);
  const hintStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <View testID={rowTestID} style={[styles.row, style]} onLayout={event => {
    metrics.current.rowWidth = event.nativeEvent.layout.width; updateHint();
  }}>
    <AppScrollView {...props} ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16} style={styles.viewport}
      onLayout={event => {
        const viewportWidth = event.nativeEvent.layout.width;
        metrics.current.viewportWidth = viewportWidth;
        setLayout(current => current.viewportWidth === viewportWidth ? current : { ...current, viewportWidth });
        updateHint(); onLayout?.(event);
      }}
      onContentSizeChange={(contentWidth, height) => {
        metrics.current.contentWidth = contentWidth;
        setLayout(current => current.contentWidth === contentWidth ? current : { ...current, contentWidth });
        updateHint(); onContentSizeChange?.(contentWidth, height);
      }}
      onScroll={event => {
        metrics.current.x = event.nativeEvent.contentOffset.x;
        if (pending.current && Math.abs(pending.current.x - metrics.current.x) <= 1) pending.current = null;
        updateHint(); onScroll?.(event);
      }}
      onScrollBeginDrag={event => { pending.current = null; onScrollBeginDrag?.(event); }}
      onTouchStart={event => { pending.current = null; onTouchStart?.(event); }}>
      {children}
    </AppScrollView>
    {hint.overflow ? <View testID={hintSlotTestID} style={styles.slot}>
      <Animated.View pointerEvents={hint.more ? "auto" : "none"} style={[styles.hint, hintStyle]}
        aria-hidden={!hint.more} accessibilityElementsHidden={!hint.more} importantForAccessibility={hint.more ? "auto" : "no-hide-descendants"}>
        <Pressable ref={hintRef} testID={hintTestID} accessibilityRole="button" accessibilityLabel={hintLabel}
          accessibilityState={{ disabled: !hint.more }} aria-disabled={!hint.more} disabled={!hint.more}
          tabIndex={hint.more ? 0 : -1} onPress={revealNext} style={({ pressed }) => [styles.hint, pressed && styles.pressed]}>
          <AppIcon name="chevron-right" size={20} color={hintColor} />
        </Pressable>
      </Animated.View>
    </View> : null}
  </View>;
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexGrow: 0, flexShrink: 1, minWidth: 0, minHeight: 48 },
  viewport: { flex: 1, minWidth: 0 },
  slot: { width: 48, minHeight: 48, flexShrink: 0, justifyContent: "center" },
  hint: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
});
