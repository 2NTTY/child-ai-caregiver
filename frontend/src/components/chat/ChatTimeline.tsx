import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppScrollView } from "../AppScrollView";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { spacing } from "../../theme";
import { chatColors, chatFont, chatLayout, chatType } from "./chat-presentation";
import { useChatScrollIntent } from "./useChatScrollIntent";
import { useChatInitialPosition } from "./useChatInitialPosition";
import { useInteractionDensity } from "../useInteractionDensity";
import { MotionEntrance } from "../../motion";
import { isNewReplyArrival } from "./chat-arrival";

export interface ChatTimelineControls { followLatest(): void; holdReadingPosition(): void }

// Items are already-authorized display rows in chronological order; this component does not fetch or persist messages.
export function ChatTimeline<T extends { id: string }>({ items, renderItem, header, footer, emptyState, presentation = "standard", compact = false, recentLimit = 20, scrollRef, controlsRef, followRequest, newReplyId }: {
  items: readonly T[]; renderItem: (item: T) => ReactNode; header?: ReactNode; footer?: ReactNode; emptyState?: ReactNode; presentation?: "standard" | "conversation"; compact?: boolean; recentLimit?: number;
  scrollRef?: MutableRefObject<ScrollView | null>; controlsRef?: MutableRefObject<ChatTimelineControls | null>; followRequest?: string;
  // Set with an appended assistant reply, never for initial/history reads or token updates.
  newReplyId?: string;
}) {
  const motionScope = useId();
  const knownIds = useRef(new Set(items.map(item => item.id)));
  const previousLastId = useRef(items[items.length - 1]?.id);
  const currentIds = items.map(item => item.id);
  const arrivingId = newReplyId && isNewReplyArrival(newReplyId, newReplyId, knownIds.current, previousLastId.current, currentIds) ? newReplyId : undefined;
  useLayoutEffect(() => {
    for (const item of items) knownIds.current.add(item.id);
    previousLastId.current = items[items.length - 1]?.id;
  }, [items]);
  const touchControls = useInteractionDensity() || compact;
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
  const cancelInitialPosition = useChatInitialPosition(ownScroll,
    () => following.current && !readerGesture.current && !prepend.current,
    next => { metrics.current = next; });

  function holdReadingPosition() { cancelInitialPosition(); readerGesture.current = false; following.current = false; }
  function readerIntent() { holdReadingPosition(); readerGesture.current = true; }
  function updateLatestVisibility() {
    const gap = Math.max(0, metrics.current.height - metrics.current.viewport - metrics.current.y);
    // Reader intent pauses following immediately; visibility waits for actual distance and has a small dead zone.
    setAtLatest(previous => gap <= (previous ? 40 : 24));
  }
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
    else updateLatestVisibility();
  }, [items, recentFirst]);
  useLayoutEffect(() => { if (followRequest !== undefined) followLatest(); }, [followRequest]);
  useLayoutEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const moved = Math.abs(contentOffset.y - metrics.current.y) > 1;
    metrics.current = { y: contentOffset.y, height: contentSize.height, viewport: layoutMeasurement.height };
    if (programmatic.current || prepend.current) return;
    if (!following.current || (readerGesture.current && moved)) updateLatestVisibility();
    if (!readerGesture.current) return;
    // A growing streaming reply at the same offset is not a reader gesture.
    if (moved) {
      const nearBottom = contentSize.height - layoutMeasurement.height - contentOffset.y <= 40;
      following.current = nearBottom;
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
    else updateLatestVisibility();
  }
  return <View testID="chat-timeline" style={styles.root}>
    <AppScrollView testID="chat-timeline-scroll" ref={node => { ownScroll.current = node; if (scrollRef) scrollRef.current = node; }} style={styles.scroll}
      contentContainerStyle={[styles.content, compact && styles.compact, presentation === "conversation" && styles.conversation, !items.length && !!emptyState && styles.empty]} keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
      onScroll={onScroll} onScrollBeginDrag={readerIntent} onContentSizeChange={contentChanged} onLayout={event => { metrics.current.viewport = event.nativeEvent.layout.height; if (following.current) queueBottom(); else updateLatestVisibility(); }}>
      {header}
      {start > 0 ? <View testID="chat-history-entry" style={styles.history}><AppButton label={`查看較早記錄（${start} 則）`} variant="quiet" style={styles.historyButton} onPress={revealEarlier} />
        {presentation === "standard" ? <Text style={styles.hint}>分批展開已載入的記錄</Text> : null}</View> : items.length && presentation === "standard" ? <Text testID="chat-history-start" style={styles.hint}>已到本次載入記錄的最早位置</Text> : null}
      {!items.length ? emptyState : null}
      {items.slice(start).map(item => <TimelineEntry key={item.id} id={item.id} scopeKey={motionScope} arriving={arrivingId === item.id}>{renderItem(item)}</TimelineEntry>)}
      {footer}
    </AppScrollView>
    {!atLatest ? <View testID="chat-return-latest" pointerEvents="box-none" style={styles.returnOverlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="回到最新" onPress={followLatest}
        style={({ pressed }) => [styles.returnButton, touchControls && styles.compactReturnButton, pressed && styles.returnPressed]}>
        <AppIcon name="arrow-down" size={20} color={chatColors.ink} />
      </Pressable>
    </View> : null}
  </View>;
}

function TimelineEntry({ id, scopeKey, arriving, children }: { id: string; scopeKey: string; arriving: boolean; children: ReactNode }) {
  // Keep the original arrival decision throughout this mount, including streaming updates.
  const [animateOnMount] = useState(arriving);
  return <View testID="chat-timeline-entry" nativeID={`chat-entry-${id}`} style={styles.item}>
    <MotionEntrance triggerKey={id} scopeKey={scopeKey} preset="message" animateOnMount={animateOnMount}>{children}</MotionEntrance>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, position: "relative" }, scroll: { flex: 1 },
  // Match the composer's normal-flow overlap so the last message and scroll range stay clear of its panel.
  content: { width: "100%", maxWidth: chatLayout.maxWidth, alignSelf: "center", flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: chatLayout.wideInset, paddingVertical: chatLayout.turnGap, paddingBottom: chatLayout.turnGap + chatLayout.composerOverlap, gap: chatLayout.turnGap },
  conversation: { justifyContent: "flex-start" }, empty: { justifyContent: "center" },
  compact: { paddingHorizontal: chatLayout.compactInset, paddingVertical: chatLayout.compactTurnGap, paddingBottom: chatLayout.compactTurnGap + chatLayout.composerOverlap, gap: chatLayout.compactTurnGap }, item: { minWidth: 0 },
  history: { alignItems: "center", gap: spacing.xs, minWidth: 0 }, historyButton: { alignSelf: "center" }, hint: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, textAlign: "center" },
  returnOverlay: { position: "absolute", bottom: spacing.md + chatLayout.composerOverlap, left: 0, right: 0, alignItems: "center", zIndex: 1 },
  returnButton: { width: chatLayout.controlSize, height: chatLayout.controlSize, borderRadius: chatLayout.controlSize / 2, borderWidth: 1, borderColor: chatColors.outline, backgroundColor: chatColors.surface, alignItems: "center", justifyContent: "center" },
  compactReturnButton: { width: chatLayout.compactControlSize, height: chatLayout.compactControlSize, borderRadius: chatLayout.compactControlSize / 2 },
  returnPressed: { backgroundColor: chatColors.hover },
});
