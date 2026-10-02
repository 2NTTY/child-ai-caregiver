import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type ScrollView as NativeScrollView, type StyleProp, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import { agentTime, type AgentCitationView } from "../../agent-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppScrollView } from "../AppScrollView";
import { AppButton } from "../ui";
import { CitationMarker } from "./CitationMarker";

const CitationContext = createContext<{ sources: readonly AgentCitationView[]; locate(id: string): void } | null>(null);
export type LocateAnswerSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => void;
const classificationLabels: Record<AgentCitationView["classification"], string> = {
  official_guidance: "官方指引", recent_information: "近期資訊", synthetic: "合成來源示例",
};
function sourceTime(value: string | null): string {
  return value === null ? "未提供" : Number.isFinite(Date.parse(value)) ? `${agentTime(value)}（香港時間）` : "時間資料無效，請重新讀取";
}
function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.meta}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
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
    parts.push(<CitationMarker key={position} number={sourceNumber} label={`查看引用【${sourceNumber}】：${source.title}`}
      onPress={() => context.locate(source.id)} />);
    offset = position + match[0].length;
  }
  parts.push(children.slice(offset));
  return <Text selectable style={style}>{parts}</Text>;
}

export function AnswerSources({ sources, children, testID, onOpenSource, onLocateSource, degraded = false }: {
  sources: readonly AgentCitationView[]; children: ReactNode; testID?: string;
  onOpenSource?: (id: string) => void; onLocateSource?: LocateAnswerSource; degraded?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const sourceRefs = useRef(new Map<string, View>());
  const panelRef = useRef<View | null>(null);
  const tabScrollRef = useRef<NativeScrollView | null>(null);
  const [tabWidth, setTabWidth] = useState(0);
  const selected = sources.find(source => source.id === selectedId);
  function locate(id: string) {
    setLocatedId(id);
    if (selectedId) setSelectedId(id);
    onLocateSource?.(sourceRefs.current.get(id) ?? null, tabScrollRef.current, panelRef.current);
  }
  function toggle(id: string) {
    const closing = selectedId === id;
    setSelectedId(closing ? null : id); setLocatedId(id);
    requestAnimationFrame(() => onLocateSource?.(closing ? sourceRefs.current.get(id) ?? null : panelRef.current,
      closing ? tabScrollRef.current : undefined));
  }
  return <CitationContext.Provider value={{ sources, locate }}>
    <View testID={testID} style={styles.answer}>
      {children}
      <View testID="answer-sources" style={styles.footer}>
        {degraded ? <Text style={styles.warning}>檢索已降級；請核對原來源及適用範圍。</Text> : null}
        {sources.length ? <View ref={panelRef} testID="answer-source-panel" style={styles.panel}>
          <Text accessibilityRole="header" style={styles.footerTitle}>參考來源</Text>
          <AppScrollView ref={tabScrollRef} horizontal testID="answer-source-tabs" accessibilityRole="tablist" accessibilityLabel="回答參考來源"
            onLayout={event => setTabWidth(event.nativeEvent.layout.width)} style={styles.tabBar} contentContainerStyle={styles.tabs}>
            {sources.map((source, index) => <Pressable key={source.id} accessibilityRole="tab"
              ref={node => { if (node) sourceRefs.current.set(source.id, node); else sourceRefs.current.delete(source.id); }}
              accessibilityLabel={`來源分頁【${index + 1}】：${source.title}`} accessibilityState={{ selected: selectedId === source.id, expanded: selectedId === source.id }}
              aria-selected={selectedId === source.id} aria-expanded={selectedId === source.id} onPress={() => toggle(source.id)}
              style={({ pressed }) => [styles.tab, { maxWidth: Math.max(96, Math.min(280, (tabWidth || 224) - 8)) },
                pressed && styles.pressed, (selectedId ?? locatedId) === source.id && styles.located, selectedId === source.id && styles.selectedTab]}>
              <Text numberOfLines={1} style={styles.tabText}>【{index + 1}】{source.title}</Text>
            </Pressable>)}
          </AppScrollView>
          {selected ? <AppScrollView key={selected.id} testID="source-details-panel" style={styles.detailScroll} contentContainerStyle={styles.details}>
          <Text accessibilityRole="header" style={styles.sourceTitle}>{selected.title}</Text>
          <Text style={styles.meta}>{selected.publisher} · {classificationLabels[selected.classification]}</Text>
          <Detail label="章節" value={selected.section} />
          <View style={styles.quote}><Text selectable style={styles.body}>{selected.excerpt}</Text></View>
          {selected.classification === "synthetic" ? <Text style={styles.meta}>此來源只展示引用版式，沒有真實來源證據。</Text> : null}
          <Detail label="原來源版本" value={selected.versionId} />
          <Detail label="原來源版本校驗" value={selected.versionHash} />
          <Detail label="核對時間" value={sourceTime(selected.checkedAt)} />
          <Detail label="擷取時間" value={sourceTime(selected.fetchedAt)} />
          <Detail label="最後成功核對" value={sourceTime(selected.lastSuccessfulCheckAt)} />
          <Detail label="來源日期" value={selected.sourceDate ?? "未提供"} />
          <Detail label="有效至" value={sourceTime(selected.validUntil)} />
          <Detail label="原適用範圍" value={selected.applicabilityLabel} />
          <Detail label="內部限定" value={selected.internalOnly ? "是" : "否"} />
          <Text style={styles.meta}>引用沿用回答當時的來源快照；請核對日期及適用範圍。</Text>
          {selected.url && onOpenSource ? <AppButton label={`開啟原來源：${selected.title}`} variant="secondary"
            onPress={() => onOpenSource(selected.id)} /> : <Text style={styles.meta}>沒有可開啟的真實來源連結。</Text>}
          </AppScrollView> : null}
        </View> : <Text style={styles.meta}>本次沒有可核對的來源片段。</Text>}
      </View>
    </View>
  </CitationContext.Provider>;
}

const styles = StyleSheet.create({
  answer: { gap: spacing.md, minWidth: 0 },
  footer: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.xs, minWidth: 0 },
  footerTitle: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20, fontWeight: "700" },
  pressed: { backgroundColor: colors.quietSurface },
  located: { borderBottomColor: colors.controlOutline },
  sourceTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 21 },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24 },
  panel: { borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.quietSurface, borderRadius: radius.medium, padding: spacing.md, gap: spacing.sm, minWidth: 0 },
  tabBar: { height: 48, flexGrow: 0, flexShrink: 0, minWidth: 0 },
  tabs: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.xs },
  tab: { minHeight: 48, paddingHorizontal: spacing.sm, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", minWidth: 0 },
  selectedTab: { borderBottomColor: colors.deepTeal, backgroundColor: colors.white },
  tabText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, lineHeight: 21, fontWeight: "700" },
  detailScroll: { height: 280, flexGrow: 0 }, details: { paddingVertical: spacing.sm, gap: spacing.md }, detail: { gap: spacing.xs, minWidth: 0 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: spacing.md, minWidth: 0 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption, lineHeight: 21 },
});
