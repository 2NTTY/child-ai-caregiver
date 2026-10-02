import { useImperativeHandle, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppScrollView } from "../AppScrollView";
import { AppButton } from "../ui";
import { chineseFont, colors, mobileLayout, spacing, typeScale } from "../../theme";
import { useChatScrollIntent } from "./useChatScrollIntent";

export interface ChatTimelineControls { followLatest(): void; holdReadingPosition(): void }

// Items are already-authorized display rows in chronological order; this component does not fetch or persist messages.
export function ChatTimeline<T extends { id: string }>({ items, renderItem, header, compact = false, recentLimit = 20, scrollRef, controlsRef, followRequest }: {
  items: readonly T[]; renderItem: (item: T) => ReactNode; header?: ReactNode; compact?: boolean; recentLimit?: number;
  scrollRef?: MutableRefObject<ScrollView | null>; controlsRef?: MutableRefObject<ChatTimelineControls | null>; followRequest?: string;
}) {
  const limit = Math.max(1, Math.floor(recentLimit));
  const recentFirst = items[Math.max(0, items.length - limit)]?.id ?? null;
  const [firstId, setFirstId] = useState<string | null>(recentFirst);
  const [atLatest, setAtLatest] = useState(true);
  const firstIndex = items.findIndex(item => item.id === firstId);
  const start = firstIndex < 0 ? Math.max(0, items.length - limit) : firstIndex;
  const ownScroll = useRef<ScrollView | null>(null), ownControls = useRef<ChatTimelineControls | null>(null);
  const following = useRef(true), metrics = useRef({ y: 0, height: 0, viewport: 0 });
  const frame = useRef<number | null>(null), programmatic = useRef(false);
  const prepend = useRef<{ y: number; height: number } | null>(null);
  const readerGesture = useRef(false);

  function holdReadingPosition() { readerGesture.current = false; following.current = false; }
  function readerIntent() { holdReadingPosition(); readerGesture.current = true; setAtLatest(false); }
  useChatScrollIntent(ownScroll, readerIntent);
  function queueBottom() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!following.current) return;
      programmatic.current = true;
      ownScroll.current?.scrollToEnd({ animated: false });
      requestAnimationFrame(() => { programmatic.current = false; });
    });
  }
  function followLatest() {
    prepend.current = null; readerGesture.current = false; following.current = true; setAtLatest(true); setFirstId(recentFirst); queueBottom();
  }
  useImperativeHandle(controlsRef ?? ownControls, () => ({ followLatest, holdReadingPosition }), [recentFirst]);
  useLayoutEffect(() => {
    if (following.current) { setFirstId(recentFirst); queueBottom(); }
    else setAtLatest(false);
  }, [items, recentFirst]);
  useLayoutEffect(() => { if (followRequest !== undefined) followLatest(); }, [followRequest]);
  useLayoutEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const moved = Math.abs(contentOffset.y - metrics.current.y) > 1;
    metrics.current = { y: contentOffset.y, height: contentSize.height, viewport: layoutMeasurement.height };
    if (programmatic.current || prepend.current || !readerGesture.current) return;
    // A growing streaming reply at the same offset is not a reader gesture.
    if (moved) {
      const nearBottom = contentSize.height - layoutMeasurement.height - contentOffset.y <= 40;
      following.current = nearBottom; setAtLatest(nearBottom);
    }
  }
  function revealEarlier() {
    holdReadingPosition(); setAtLatest(false); prepend.current = { y: metrics.current.y, height: metrics.current.height };
    setFirstId(items[Math.max(0, start - limit)]?.id ?? null);
  }
  function contentChanged(_width: number, height: number) {
    metrics.current.height = height;
    if (prepend.current) {
      const previous = prepend.current; prepend.current = null;
      programmatic.current = true;
      ownScroll.current?.scrollTo({ y: Math.max(0, previous.y + height - previous.height), animated: false });
      requestAnimationFrame(() => { programmatic.current = false; });
    } else if (following.current) queueBottom();
  }
  return <View testID="chat-timeline" style={styles.root}>
    <AppScrollView testID="chat-timeline-scroll" ref={node => { ownScroll.current = node; if (scrollRef) scrollRef.current = node; }} style={styles.scroll}
      contentContainerStyle={[styles.content, compact && styles.compact]} keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
      onScroll={onScroll} onScrollBeginDrag={readerIntent} onContentSizeChange={contentChanged} onLayout={event => { metrics.current.viewport = event.nativeEvent.layout.height; if (following.current) queueBottom(); }}>
      {header}
      {start > 0 ? <View testID="chat-history-entry" style={styles.history}><AppButton label={`查看較早記錄（${start} 則）`} variant="quiet" onPress={revealEarlier} />
        <Text style={styles.hint}>分批展開已載入的記錄</Text></View> : items.length ? <Text testID="chat-history-start" style={styles.hint}>已到本次載入記錄的最早位置</Text> : null}
      {items.slice(start).map(item => <View key={item.id} testID="chat-timeline-entry" nativeID={`chat-entry-${item.id}`} style={styles.item}>{renderItem(item)}</View>)}
    </AppScrollView>
    {!atLatest ? <View testID="chat-return-latest" pointerEvents="box-none" style={styles.returnOverlay}><AppButton label="回到最新" variant="secondary" onPress={followLatest} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, position: "relative" }, scroll: { flex: 1 },
  content: { width: "100%", maxWidth: 1060, alignSelf: "center", flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.lg },
  compact: { paddingHorizontal: mobileLayout.pageInset }, item: { minWidth: 0 },
  history: { alignItems: "center", gap: spacing.xs, minWidth: 0 }, hint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20, textAlign: "center" },
  returnOverlay: { position: "absolute", bottom: spacing.md, left: 0, right: 0, alignItems: "center", zIndex: 1 },
});
