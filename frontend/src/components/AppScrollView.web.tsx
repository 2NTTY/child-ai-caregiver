import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { OverlayScrollbars } from "overlayscrollbars";
import { colors } from "../theme";
import "overlayscrollbars/overlayscrollbars.css";
import "./appScrollView.css";

type WebScrollView = ScrollView & { getScrollableNode(): HTMLElement };

export const AppScrollView = forwardRef<ScrollView, ScrollViewProps>(function AppScrollView(
  { style, horizontal, showsVerticalScrollIndicator, scrollEnabled, ...props }, forwardedRef,
) {
  const scrollRef = useRef<WebScrollView | null>(null);
  useImperativeHandle(forwardedRef, () => scrollRef.current!, []);

  useEffect(() => {
    if (horizontal) return;
    const viewport = scrollRef.current?.getScrollableNode();
    const target = viewport?.parentElement;
    if (!viewport || !target) return;
    target.style.setProperty("--app-scrollbar-idle", colors.controlOutline);
    target.style.setProperty("--app-scrollbar-active", colors.ink);
    // Keep RN Web's viewport, events and scrollTo ref; only the scrollbar is replaced.
    const instance = OverlayScrollbars({ target, elements: { viewport }, scrollbars: { slot: target } }, {
      overflow: { x: "hidden", y: scrollEnabled === false ? "hidden" : "scroll" },
      scrollbars: {
        theme: "os-theme-app", autoHide: "never",
        visibility: showsVerticalScrollIndicator === false ? "hidden" : "auto",
        dragScroll: scrollEnabled !== false, clickScroll: "instant",
      },
    });
    return () => instance.destroy();
  }, [horizontal, scrollEnabled, showsVerticalScrollIndicator]);

  if (horizontal) return <ScrollView {...props} ref={scrollRef} style={style} horizontal
    scrollEnabled={scrollEnabled} showsVerticalScrollIndicator={showsVerticalScrollIndicator} />;

  return <View testID="app-scroll-host" style={[styles.host, style]}>
    <ScrollView {...props} ref={scrollRef} style={styles.viewport} scrollEnabled={scrollEnabled}
      tabIndex={props.tabIndex ?? 0} showsVerticalScrollIndicator={false} />
  </View>;
});

const styles = StyleSheet.create({
  host: { position: "relative", flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0 },
  viewport: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0 },
});
