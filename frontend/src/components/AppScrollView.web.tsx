import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { OverlayScrollbars } from "overlayscrollbars";
import { colors } from "../theme";
import "overlayscrollbars/overlayscrollbars.css";
import "./appScrollView.css";

type WebScrollView = ScrollView & { getScrollableNode(): HTMLElement };

export const AppScrollView = forwardRef<ScrollView, ScrollViewProps>(function AppScrollView(
  { style, horizontal, showsHorizontalScrollIndicator, showsVerticalScrollIndicator, scrollEnabled, ...props }, forwardedRef,
) {
  const scrollRef = useRef<WebScrollView | null>(null);
  useImperativeHandle(forwardedRef, () => scrollRef.current!, []);

  useEffect(() => {
    const viewport = scrollRef.current?.getScrollableNode();
    const target = viewport?.parentElement;
    if (!viewport || !target) return;
    target.style.setProperty("--app-scrollbar-idle", colors.controlOutline);
    target.style.setProperty("--app-scrollbar-active", colors.ink);
    // Keep RN Web's viewport, events and scrollTo ref; only the scrollbar is replaced.
    const instance = OverlayScrollbars({ target, elements: { viewport }, scrollbars: { slot: target } }, {
      overflow: {
        x: horizontal && scrollEnabled !== false ? "scroll" : "hidden",
        y: !horizontal && scrollEnabled !== false ? "scroll" : "hidden",
      },
      scrollbars: {
        theme: "os-theme-app", autoHide: "never",
        visibility: (horizontal ? showsHorizontalScrollIndicator : showsVerticalScrollIndicator) === false ? "hidden" : "auto",
        dragScroll: scrollEnabled !== false, clickScroll: "instant",
      },
    });
    return () => instance.destroy();
  }, [horizontal, scrollEnabled, showsHorizontalScrollIndicator, showsVerticalScrollIndicator]);

  return <View testID="app-scroll-host" style={[styles.host, style]}>
    <ScrollView {...props} ref={scrollRef} style={styles.viewport} horizontal={horizontal} scrollEnabled={scrollEnabled}
      tabIndex={props.tabIndex ?? 0} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} />
  </View>;
});

const styles = StyleSheet.create({
  host: { position: "relative", flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0 },
  viewport: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0 },
});
