import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type ScrollView, type ScrollViewProps } from "react-native";
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
  revealRevision?: number;
  animatedScroll?: boolean;
  layoutRevision?: string;
  onRevealItem: (key: string, scroll: ScrollView | null) => void;
}

/** A tab/disclosure rail with an independent trailing hint, never a content overlay. */
export const HorizontalOverflowRail = forwardRef<ScrollView, HorizontalOverflowRailProps>(function HorizontalOverflowRail(
  { items, hintLabel, hintColor = colors.muted, rowTestID, hintTestID, hintSlotTestID, revealTarget, revealRevision,
    animatedScroll = true, layoutRevision, onRevealItem, style, children, onLayout, onContentSizeChange, onScroll,
    onScrollBeginDrag, onTouchStart, ...props }, forwardedRef,
) {
  const preferences = useMotionPreferences();
  const windowWidth = useWindowDimensions().width;
  const rowRef = useRef<View | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const hintRef = useRef<View | null>(null);
  const metrics = useRef<HorizontalRailMetrics>({ rowWidth: 0, viewportWidth: 0, contentWidth: 0, x: 0 });
  const pending = useRef<{ key: string; x: number } | null>(null);
  const [hint, setHint] = useState({ overflow: false, more: false });
  const [hintHovered, setHintHovered] = useState(false);
  const [hintFocused, setHintFocused] = useState(false);
  const [layout, setLayout] = useState({ viewportWidth: 0, contentWidth: 0 });
  const opacity = useSharedValue(0);
  useImperativeHandle(forwardedRef, () => scrollRef.current!, []);

  function updateHint() {
    const next = horizontalOverflow(metrics.current);
    setHint(current => current.overflow === next.overflow && current.more === next.more ? current : next);
  }
  function currentMetrics() {
    const viewport = Platform.OS === "web" ? scrollRef.current?.getScrollableNode() as HTMLElement | null : null;
    // Focus, keyboard and scroll calls can precede RN Web's throttled onScroll.
    if (viewport) metrics.current = { ...metrics.current, x: viewport.scrollLeft,
      viewportWidth: viewport.clientWidth, contentWidth: viewport.scrollWidth };
    return metrics.current;
  }
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const row = rowRef.current as unknown as HTMLElement | null;
    const viewport = scrollRef.current?.getScrollableNode() as HTMLElement | null;
    if (!row || !viewport) return;
    const viewportWidth = viewport.clientWidth, contentWidth = viewport.scrollWidth;
    metrics.current = { rowWidth: row.clientWidth, viewportWidth, contentWidth, x: viewport.scrollLeft };
    // Reserve the hint before paint, using the full row rather than its reduced viewport.
    updateHint();
    setLayout(current => current.viewportWidth === viewportWidth && current.contentWidth === contentWidth
      ? current : { viewportWidth, contentWidth });
  }, [windowWidth, layoutRevision, hint.overflow]);
  function scrollToOffset(x: number, animated: boolean) {
    const viewport = Platform.OS === "web" ? scrollRef.current?.getScrollableNode() as HTMLElement | null : null;
    const nativeScroll = viewport?.ownerDocument.defaultView?.Element.prototype.scroll as
      ((this: Element, options: ScrollToOptions) => void) | undefined;
    if (viewport && typeof nativeScroll === "function") {
      const position = { left: x, top: viewport.scrollTop };
      nativeScroll.call(viewport, { ...position, behavior: animated ? "smooth" : "instant" });
      // Settle an interrupted browser user animator, matching source positioning.
      // The second request is a same-position no-op, so reduced motion stays instant.
      if (!animated) nativeScroll.call(viewport, { ...position, behavior: "smooth" });
      currentMetrics();
      updateHint();
      return;
    }
    scrollRef.current?.scrollTo({ x, animated });
  }
  function revealNext() {
    const latest = currentMetrics();
    if (pending.current && Math.abs(pending.current.x - latest.x) <= 1) pending.current = null;
    const item = nextHorizontalItem(items, latest, pending.current?.key ?? null);
    if (!item) return;
    const x = horizontalRevealOffset(item, latest);
    pending.current = { key: item.key, x };
    scrollToOffset(x, animatedScroll && preferences.enabled);
    onRevealItem(item.key, scrollRef.current);
  }

  useLayoutEffect(() => {
    if (!revealTarget || layout.viewportWidth <= 0) return;
    pending.current = null;
    const x = horizontalRevealOffset(revealTarget, currentMetrics());
    // An explicit selection must settle even when the selected key has not changed.
    // Do not skip a same-position request: an older smooth scroll may still be live.
    scrollToOffset(x, false);
  }, [revealTarget?.key, revealTarget?.x, revealTarget?.width, revealRevision, layout.viewportWidth, layout.contentWidth]);

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const viewport = scrollRef.current?.getScrollableNode() as HTMLElement | null;
    if (!viewport) return;
    // RN Web forwards wheel directly; it does not emit onScrollBeginDrag for it.
    const interrupt = () => { pending.current = null; };
    viewport.addEventListener("wheel", interrupt, { passive: true });
    return () => viewport.removeEventListener("wheel", interrupt);
  }, []);

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
      const latest = currentMetrics();
      scrollToOffset(Math.max(0, Math.min(target.x, latest.contentWidth - latest.viewportWidth)), false);
      pending.current = null;
    }
  }, [preferences.enabled, preferences.epoch]);
  useLayoutEffect(() => () => { cancelAnimation(opacity); }, [opacity]);
  const hintStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <View ref={rowRef} testID={rowTestID} style={[styles.row, style]} onLayout={event => {
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
          tabIndex={hint.more ? 0 : -1} onPress={revealNext} style={styles.hint}
          onHoverIn={() => setHintHovered(true)} onHoverOut={() => setHintHovered(false)}
          onFocus={() => setHintFocused(true)} onBlur={() => setHintFocused(false)}>
          {({ pressed }) => <View pointerEvents="none" style={[styles.hintGlyph,
            hintHovered && styles.hovered, pressed && styles.pressed, hintFocused && styles.focused]}>
            <AppIcon name="chevron-right" size={20} color={hintColor} />
          </View>}
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
  hintGlyph: { width: 32, height: 32, borderRadius: 16, backgroundColor: "transparent", borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  hovered: { backgroundColor: colors.quietSurface },
  pressed: { backgroundColor: colors.paleTeal },
  focused: { borderColor: colors.ink },
});
