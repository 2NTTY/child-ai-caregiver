import { createContext, Fragment, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Pressable, StyleSheet, View, type ScrollView as NativeScrollView, type StyleProp, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import type { ChatCitationView } from "../../chat-view-model";
import { colors, spacing } from "../../theme";
import { AppScrollView } from "../AppScrollView";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { CitationMarker } from "./CitationMarker";
import { chatColors, chatFont, chatLayout, chatType } from "./chat-presentation";
import { locateCitationSource } from "./locateCitationSource";

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
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<CitationOrigin | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const groupId = useId();
  const sourceRefs = useRef(new Map<string, View>());
  const panelRef = useRef<View | null>(null);
  const tabScrollRef = useRef<NativeScrollView | null>(null);
  const pendingNavigation = useRef<{ id: string; closing: boolean } | null>(null);
  const [tabWidth, setTabWidth] = useState(0);
  const [tabOverflow, setTabOverflow] = useState(false);
  const [moreSources, setMoreSources] = useState(false);
  const tabMetrics = useRef({ rowWidth: 0, width: 0, contentWidth: 0, x: 0 });
  const tabLayouts = useRef(new Map<string, { x: number; width: number }>());
  const pendingReveal = useRef<string | null>(null);
  const selected = sources.find(source => source.id === selectedId);
  function updateTabHint() {
    const { rowWidth, width, contentWidth, x } = tabMetrics.current;
    // Compare against the full row so showing the hint cannot create its own overflow.
    setTabOverflow(rowWidth > 0 && contentWidth > rowWidth + 1);
    setMoreSources(width > 0 && contentWidth > width + x + 1);
  }
  function revealNextSource() {
    const right = tabMetrics.current.x + tabMetrics.current.width;
    const pendingIndex = sources.findIndex(source => source.id === pendingReveal.current);
    const next = sources.find((source, index) => {
      const layout = tabLayouts.current.get(source.id);
      return index > pendingIndex && layout && layout.x + layout.width > right + 1;
    }) ?? sources[sources.length - 1];
    // Consecutive activations can arrive before the native scroll event reports the new offset.
    pendingReveal.current = next?.id ?? null;
    const target = next ? sourceRefs.current.get(next.id) ?? null : null;
    if (onLocateSource) onLocateSource(target, tabScrollRef.current);
    else locateCitationSource(target, null, tabScrollRef.current);
  }
  useLayoutEffect(() => {
    const pending = pendingNavigation.current;
    pendingNavigation.current = null;
    if (pending) onLocateSource?.(pending.closing ? sourceRefs.current.get(pending.id) ?? null : panelRef.current,
      pending.closing ? tabScrollRef.current : undefined);
  }, [selectedId, onLocateSource]);
  function locate(id: string, anchor?: RefObject<View | null>) {
    setLocatedId(id);
    if (anchor?.current) setOrigin({ sourceId: id, anchor });
    if (selectedId && selectedId !== id) { setSelectedId(id); setTechnicalOpen(false); }
    onLocateSource?.(sourceRefs.current.get(id) ?? null, tabScrollRef.current, panelRef.current);
  }
  function toggle(id: string) {
    const closing = selectedId === id;
    pendingNavigation.current = { id, closing };
    setSelectedId(closing ? null : id); setLocatedId(id);
    if (!closing && selectedId !== id) setTechnicalOpen(false);
  }
  function returnToCitation() {
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
          <View testID="answer-source-tab-row" style={styles.tabRow} onLayout={event => {
            tabMetrics.current.rowWidth = event.nativeEvent.layout.width; updateTabHint();
          }}>
          <AppScrollView ref={tabScrollRef} horizontal testID="answer-source-tabs" accessibilityLabel="回答參考來源"
            showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
            onLayout={event => { const width = event.nativeEvent.layout.width; setTabWidth(width); tabMetrics.current.width = width; updateTabHint(); }}
            onContentSizeChange={width => { tabMetrics.current.contentWidth = width; updateTabHint(); }}
            onScroll={event => { tabMetrics.current.x = event.nativeEvent.contentOffset.x; pendingReveal.current = null; updateTabHint(); }}
            style={styles.tabBar} contentContainerStyle={styles.tabs}>
            {sources.map((source, index) => <Fragment key={source.id}>
              {index > 0 ? <View testID="answer-source-separator" accessible={false} style={styles.separator} /> : null}
              <Pressable accessibilityRole="button"
              ref={node => { if (node) sourceRefs.current.set(source.id, node); else sourceRefs.current.delete(source.id); }}
              onLayout={event => { const { x, width } = event.nativeEvent.layout; tabLayouts.current.set(source.id, { x, width }); }}
              accessibilityLabel={`來源【${index + 1}】：${source.title}`} accessibilityState={{ expanded: selectedId === source.id }}
              aria-expanded={selectedId === source.id} aria-controls={`${groupId}-detail-${index}`} onPress={() => toggle(source.id)}
              style={({ pressed }) => [styles.tab, { maxWidth: Math.max(96, Math.min(280, (tabWidth || 224) - 8)) },
                pressed && styles.pressed, (selectedId ?? locatedId) === source.id && styles.located, selectedId === source.id && styles.selectedTab]}>
              <Text numberOfLines={1} style={styles.tabText}>【{index + 1}】{source.title}</Text>
              </Pressable>
            </Fragment>)}
          </AppScrollView>
          {tabOverflow ? <View testID="answer-source-hint-slot" style={styles.hintSlot}>
            {moreSources ? <Pressable testID="answer-source-scroll-hint" accessibilityRole="button" accessibilityLabel="查看更多來源"
              onPress={revealNextSource} style={({ pressed }) => [styles.scrollHint, pressed && styles.pressed]}>
              <AppIcon name="chevron-right" size={20} color={chatColors.secondary} />
            </Pressable> : null}
          </View> : null}
          </View>
          {selected ? <AppScrollView key={selected.id} nativeID={`${groupId}-detail-${sources.indexOf(selected)}`} testID="source-details-panel" style={styles.detailScroll} contentContainerStyle={styles.details}>
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
            <View style={[styles.detailGroup, styles.dividedGroup]}>
              <Pressable accessibilityRole="button" accessibilityLabel="版本與核對資料" accessibilityState={{ expanded: technicalOpen }}
                aria-expanded={technicalOpen} aria-controls={`${groupId}-technical`} onPress={() => setTechnicalOpen(value => !value)} style={styles.technicalToggle}>
                <Text style={styles.technicalTitle}>{technicalOpen ? "收起" : "查看"}版本與核對資料</Text>
              </Pressable>
              {technicalOpen ? <View nativeID={`${groupId}-technical`} testID="source-detail-group" style={styles.detailGroup}>
                <Detail technical label="原來源版本" value={selected.versionId} />
                <Detail technical label="原來源版本校驗" value={selected.versionHash} />
                <Detail technical label="核對時間" value={sourceTime(selected.checkedAt)} />
                <Detail technical label="擷取時間" value={sourceTime(selected.fetchedAt)} />
                <Detail technical label="最後成功核對" value={sourceTime(selected.lastSuccessfulCheckAt)} />
              </View> : null}
            </View>
          </AppScrollView> : null}
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
  tabBar: { height: 48, flex: 1, minWidth: 0 },
  tabs: { flexDirection: "row", alignItems: "center" },
  hintSlot: { width: 48, height: 48, flexShrink: 0 },
  scrollHint: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
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
});
