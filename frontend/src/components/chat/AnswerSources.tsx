import { createContext, Fragment, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView, type StyleProp, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import type { ChatCitationView } from "../../chat-view-model";
import { colors, spacing } from "../../theme";
import { AppScrollView } from "../AppScrollView";
import { HorizontalOverflowRail } from "../HorizontalOverflowRail";
import { AppButton } from "../ui";
import { CitationMarker } from "./CitationMarker";
import { chatColors, chatFont, chatLayout, chatType } from "./chat-presentation";
import { locateCitationSource } from "./locateCitationSource";
import { MotionDisclosure, MotionEntrance } from "../../motion";
import { MotionSelectionMarker } from "../../motion/MotionSelectionMarker";

type CitationOrigin = { sourceId: string; anchor: RefObject<View | null> };
const CitationContext = createContext<{ sources: readonly ChatCitationView[]; locate(id: string, anchor?: RefObject<View | null>): void } | null>(null);
export type LocateAnswerSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => void;
const classificationLabels: Record<ChatCitationView["classification"], string> = {
  official_guidance: "官方指引", recent_information: "近期資訊", synthetic: "合成來源示例",
};
function sourceTime(value: string | null): string {
  return value === null ? "未提供" : Number.isFinite(Date.parse(value))
    ? `${new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })}（香港時間）`
    : "時間資料無效，請重新讀取";
}
function Detail({ label, value, technical = false }: { label: string; value: string; technical?: boolean }) {
  return <View style={styles.detail}><Text style={styles.meta}>{label}</Text><Text selectable style={technical ? styles.meta : styles.body}>{value}</Text></View>;
}

function CitationReference({ number, source, locate }: { number: number; source: ChatCitationView; locate(id: string, anchor: RefObject<View | null>): void }) {
  const anchor = useRef<View>(null);
  return <CitationMarker ref={anchor} number={number} label={`查看引用【${number}】：${source.title}`} onPress={() => locate(source.id, anchor)} />;
}

export function CitationText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const context = useContext(CitationContext);
  if (!context) return <Text selectable style={style}>{children}</Text>;
  const parts: ReactNode[] = [];
  const pattern = /【([1-9]\d*)】|\[([1-9]\d*)\]/g;
  let offset = 0;
  for (const match of children.matchAll(pattern)) {
    const sourceNumber = Number(match[1] ?? match[2]);
    const source = context.sources[sourceNumber - 1];
    if (!source) continue;
    const position = match.index!;
    parts.push(children.slice(offset, position));
    parts.push(<CitationReference key={position} number={sourceNumber} source={source} locate={context.locate} />);
    offset = position + match[0].length;
  }
  parts.push(children.slice(offset));
  return <Text selectable style={style}>{parts}</Text>;
}

export function AnswerSources({ sources, children, testID, onOpenSource, onLocateSource, degraded = false }: {
  sources: readonly ChatCitationView[]; children: ReactNode; testID?: string;
  onOpenSource?: (id: string) => void; onLocateSource?: LocateAnswerSource; degraded?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presentedId, setPresentedId] = useState<string | null>(null);
  const [panelTrigger, setPanelTrigger] = useState<number | null>(null);
  const [animateSelection, setAnimateSelection] = useState(false);
  const selectionSerial = useRef(0);
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<CitationOrigin | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const groupId = useId();
  const sourceRefs = useRef(new Map<string, View>());
  const panelRef = useRef<View | null>(null);
  const tabScrollRef = useRef<NativeScrollView | null>(null);
  const detailScrollRef = useRef<NativeScrollView | null>(null);
  const pendingNavigation = useRef<{ id: string; closing: boolean } | null>(null);
  const [tabWidth, setTabWidth] = useState(0);
  const [tabLayouts, setTabLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const windowWidth = useWindowDimensions().width;
  const sourceLayoutKey = JSON.stringify(sources.map(source => [source.id, source.title]));
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const viewport = tabScrollRef.current?.getScrollableNode() as HTMLElement | null;
    if (!viewport || viewport.clientWidth <= 0) return;
    const width = viewport.clientWidth;
    // One follow-up read settles any width reserved by the trailing hint.
    setTabWidth(current => current === width ? current : width);
  }, [windowWidth, sourceLayoutKey, tabWidth]);
  // Retain only an ID during collapse; the live collection controls data access.
  const selected = sources.find(source => source.id === (selectedId ?? presentedId));
  const expanded = selectedId !== null && selected !== undefined;
  const markerId = sources.find(source => source.id === (selectedId ?? locatedId))?.id ?? null;
  const selection = markerId ? tabLayouts[markerId] : undefined;
  function revealSource(id: string) {
    const target = sourceRefs.current.get(id) ?? null;
    if (onLocateSource) onLocateSource(target, tabScrollRef.current);
    else locateCitationSource(target, null, tabScrollRef.current);
  }
  useLayoutEffect(() => {
    // Reset explicitly while preserving the viewport and its control identity.
    if (selectedId === null) return;
    const scroll = detailScrollRef.current;
    const viewport = Platform.OS === "web" ? scroll?.getScrollableNode() : null;
    if (viewport) {
      viewport.style.setProperty("overflow-anchor", "none");
      // RN Web replaces viewport.scrollTo and maps animated:false to "auto".
      const nativeScroll = viewport.ownerDocument?.defaultView?.Element.prototype.scroll;
      if (typeof nativeScroll === "function") {
        nativeScroll.call(viewport, { left: 0, top: 0, behavior: "instant" });
        // Chromium cancels its user animator before the smooth no-op check;
        // this same-target request has no displacement after the instant reset.
        // InitiateScrollAnimation, inspected 2026-10-04 (main, not a pinned release):
        // https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/scroll/scrollable_area.cc
        nativeScroll.call(viewport, { left: 0, top: 0, behavior: "smooth" });
        return;
      }
    }
    // Native platforms and non-DOM adapters keep the RN method signature.
    scroll?.scrollTo({ x: 0, y: 0, animated: false });
  }, [selectedId]);
  useLayoutEffect(() => {
    const pending = pendingNavigation.current;
    pendingNavigation.current = null;
    if (pending) onLocateSource?.(pending.closing ? sourceRefs.current.get(pending.id) ?? null : panelRef.current,
      pending.closing ? tabScrollRef.current : undefined);
  }, [selectedId, onLocateSource]);
  function locate(id: string, anchor?: RefObject<View | null>) {
    setPanelTrigger(null); setAnimateSelection(false);
    setLocatedId(id);
    if (anchor?.current) setOrigin({ sourceId: id, anchor });
    if (selectedId && selectedId !== id) { setSelectedId(id); setPresentedId(id); setTechnicalOpen(false); }
    onLocateSource?.(sourceRefs.current.get(id) ?? null, tabScrollRef.current, panelRef.current);
  }
  function toggle(id: string) {
    const closing = selectedId === id;
    setAnimateSelection(true);
    setPanelTrigger(selectedId !== null && !closing ? ++selectionSerial.current : null);
    if (!closing) setPresentedId(id);
    pendingNavigation.current = { id, closing };
    setSelectedId(closing ? null : id); setLocatedId(id);
    if (!closing && selectedId !== id) setTechnicalOpen(false);
  }
  function returnToCitation() {
    setPanelTrigger(null); setAnimateSelection(false);
    if (origin?.anchor.current && sources.some(source => source.id === origin.sourceId)) {
      onLocateSource?.(origin.anchor.current, undefined, origin.anchor.current);
    }
    else setOrigin(null);
  }
  return <CitationContext.Provider value={{ sources, locate }}>
    <View testID={testID} style={styles.answer}>
      {children}
      <View testID="answer-sources" style={styles.footer}>
        {degraded ? <Text style={styles.warning}>檢索已降級；請核對原來源及適用範圍。</Text> : null}
        {sources.length ? <View ref={panelRef} testID="answer-source-panel" style={styles.panel}>
          <View style={styles.footerHeading}><Text accessibilityRole="header" style={styles.footerTitle}>參考來源</Text>
            {origin && onLocateSource ? <AppButton label="返回引用句" variant="quiet" density="compact" onPress={returnToCitation} /> : null}
          </View>
          <HorizontalOverflowRail ref={tabScrollRef} testID="answer-source-tabs" rowTestID="answer-source-tab-row" accessibilityLabel="回答參考來源"
            layoutRevision={`${sourceLayoutKey}:${tabWidth}`}
            hintLabel="查看更多來源" hintTestID="answer-source-scroll-hint" hintSlotTestID="answer-source-hint-slot" hintColor={chatColors.secondary}
            items={sources.flatMap(source => tabLayouts[source.id] ? [{ key: source.id, ...tabLayouts[source.id] }] : [])}
            onRevealItem={revealSource} animatedScroll={false}
            onLayout={event => setTabWidth(event.nativeEvent.layout.width)} style={styles.tabRow} contentContainerStyle={styles.tabs}>
            {sources.map((source, index) => <Fragment key={source.id}>
              {index > 0 ? <View testID="answer-source-separator" accessible={false} style={styles.separator} /> : null}
              <Pressable accessibilityRole="button"
              ref={node => { if (node) sourceRefs.current.set(source.id, node); else sourceRefs.current.delete(source.id); }}
              onLayout={event => { const { x, width } = event.nativeEvent.layout; setTabLayouts(current => current[source.id]?.x === x && current[source.id]?.width === width ? current : { ...current, [source.id]: { x, width } }); }}
              accessibilityLabel={`來源【${index + 1}】：${source.title}`} accessibilityState={{ expanded: selectedId === source.id }}
              aria-expanded={selectedId === source.id} aria-controls={`${groupId}-detail`} onPress={() => toggle(source.id)}
              style={({ pressed }) => [styles.tab, { maxWidth: Math.max(96, Math.min(280, (tabWidth || 224) - 8)) },
                pressed && styles.pressed, !selection && markerId === source.id && styles.located, !selection && selectedId === source.id && styles.selectedTab]}>
              <Text numberOfLines={1} style={styles.tabText}>【{index + 1}】{source.title}</Text>
              </Pressable>
            </Fragment>)}
            <MotionSelectionMarker x={selection?.x ?? 0} width={selection?.width ?? 0} selectionKey={`${groupId}:${markerId ?? "none"}`} enabled={animateSelection} color={selectedId ? chatColors.ink : chatColors.focus} />
          </HorizontalOverflowRail>
          <MotionDisclosure expanded={expanded} scopeKey={groupId} testID="answer-source-disclosure">
          <AppScrollView ref={detailScrollRef} nativeID={`${groupId}-detail`} testID="source-details-panel" style={styles.detailScroll}>
          <MotionEntrance preset="panel" triggerKey={expanded ? panelTrigger : null} scopeKey={groupId} enabled={expanded} testID="answer-source-content-motion" style={styles.details}>
            {selected ? <>
            <View testID="source-detail-group" style={styles.detailGroup}>
              <Text accessibilityRole="header" style={styles.groupTitle}>引用內容</Text>
              <View style={styles.detail}><Text accessibilityRole="header" style={styles.sourceTitle}>{selected.title}</Text>
                <Text style={styles.meta}>{selected.publisher} · {classificationLabels[selected.classification]}</Text></View>
              <Detail label="章節" value={selected.section} />
              <View style={styles.quote}><Text selectable style={styles.quoteBody}>{selected.excerpt}</Text></View>
              {selected.classification === "synthetic" ? <Text style={styles.meta}>此來源只展示引用版式，沒有真實來源證據。</Text> : null}
            </View>
            <View testID="source-detail-group" style={[styles.detailGroup, styles.dividedGroup]}>
              <Text accessibilityRole="header" style={styles.groupTitle}>日期與適用範圍</Text>
              <Detail label="來源日期" value={selected.sourceDate ?? "未提供"} />
              <Detail label="有效至" value={sourceTime(selected.validUntil)} />
              <Detail label="原適用範圍" value={selected.applicabilityLabel} />
              <Detail label="內部限定" value={selected.internalOnly ? "是" : "否"} />
              <Text style={styles.meta}>引用沿用回答當時的來源快照；請核對日期及適用範圍。</Text>
              {selected.url ? onOpenSource ? <AppButton label="開啟原來源" accessibilityLabel={`開啟原來源：${selected.title}`} variant="secondary"
                onPress={() => onOpenSource(selected.id)} /> : <Text selectable style={styles.body}>{selected.url}</Text>
                : <Text style={styles.meta}>沒有可開啟的真實來源連結。</Text>}
            </View>
            <View style={[styles.technicalGroup, styles.dividedGroup]}>
              <Pressable accessibilityRole="button" accessibilityLabel="版本與核對資料" accessibilityState={{ expanded: technicalOpen }}
                aria-expanded={technicalOpen} aria-controls={`${groupId}-technical`} onPress={() => setTechnicalOpen(value => !value)} style={styles.technicalToggle}>
                <Text style={styles.technicalTitle}>{technicalOpen ? "收起" : "查看"}版本與核對資料</Text>
              </Pressable>
              <MotionDisclosure expanded={technicalOpen} scopeKey={`${groupId}:${selected.id}`}><View nativeID={`${groupId}-technical`} testID="source-detail-group" style={[styles.detailGroup, styles.technicalContents]}>
                <Detail technical label="原來源版本" value={selected.versionId} />
                <Detail technical label="原來源版本校驗" value={selected.versionHash} />
                <Detail technical label="核對時間" value={sourceTime(selected.checkedAt)} />
                <Detail technical label="擷取時間" value={sourceTime(selected.fetchedAt)} />
                <Detail technical label="最後成功核對" value={sourceTime(selected.lastSuccessfulCheckAt)} />
              </View></MotionDisclosure>
            </View>
            </> : null}
          </MotionEntrance>
          </AppScrollView>
          </MotionDisclosure>
        </View> : <Text style={styles.meta}>本次沒有可核對的來源片段。</Text>}
      </View>
    </View>
  </CitationContext.Provider>;
}

const styles = StyleSheet.create({
  answer: { gap: chatLayout.paragraphGap, minWidth: 0 },
  footer: { borderTopWidth: 1, borderTopColor: chatColors.line, paddingTop: chatLayout.paragraphGap, gap: spacing.xs, minWidth: 0 },
  footerTitle: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, fontWeight: "600" },
  footerHeading: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  pressed: { opacity: 0.7 },
  located: { borderBottomColor: chatColors.focus },
  sourceTitle: { fontFamily: chatFont, color: chatColors.ink, ...chatType.section },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  body: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool },
  quoteBody: { fontFamily: chatFont, color: chatColors.ink, ...chatType.body },
  panel: { gap: spacing.xs, minWidth: 0 },
  tabRow: { height: 48, flexDirection: "row", minWidth: 0 },
  tabs: { flexDirection: "row", alignItems: "center" },
  separator: { width: 1, height: 20, backgroundColor: chatColors.line, flexShrink: 0 },
  tab: { minHeight: 48, paddingHorizontal: spacing.sm, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", minWidth: 0 },
  selectedTab: { borderBottomColor: chatColors.ink },
  tabText: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, fontWeight: "600" },
  detailScroll: { height: 280, flexGrow: 0 }, details: { paddingVertical: spacing.sm, gap: spacing.md }, detail: { gap: spacing.xs, minWidth: 0 },
  detailGroup: { gap: spacing.sm, minWidth: 0 }, dividedGroup: { borderTopWidth: 1, borderTopColor: chatColors.line, paddingTop: spacing.md },
  groupTitle: { fontFamily: chatFont, color: chatColors.ink, ...chatType.section },
  quote: { borderLeftWidth: 2, borderLeftColor: chatColors.line, paddingLeft: spacing.md, minWidth: 0 },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.meta },
  technicalTitle: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, fontWeight: "600" },
  technicalToggle: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  technicalGroup: { minWidth: 0 }, technicalContents: { paddingTop: spacing.sm },
});
