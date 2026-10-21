import { useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeChild, RecordsLoadState } from "../view-model";
import { HorizontalOverflowRail } from "./HorizontalOverflowRail";
import type { HorizontalRailItem } from "./horizontalOverflow";

type ChildKeyFactsProps = { child: HomeChild | undefined; load: RecordsLoadState; leading?: ReactNode };
type ChildFact = { label: string; value: string };

function childFacts(child: HomeChild): ChildFact[] {
  return [
    { label: "檔案", value: child.profileConfirmed ? "已確認" : "待核對" },
  ];
}
function Fact({ fact }: { fact: ChildFact }) {
  return <View style={styles.fact}><Text style={styles.label}>{fact.label}</Text><Text numberOfLines={1} style={styles.value}>{fact.value}</Text></View>;
}

export function ChildKeyFacts({ child, load, leading }: ChildKeyFactsProps) {
  if (leading) return <ChildFactsRail child={child} load={load} leading={leading} />;
  if (load === "loading") return <Text accessibilityLiveRegion="polite" style={styles.placeholder}>正在讀取孩子資料…</Text>;
  if (load === "error") return <Text accessibilityLiveRegion="polite" style={styles.placeholder}>暫時讀不到孩子資料</Text>;
  if (!child) return <Text style={styles.placeholder}>尚未選擇孩子</Text>;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.facts} accessibilityLabel={`${child.displayName}的關鍵資料`}>
    {childFacts(child).map(fact => <Fact key={fact.label} fact={fact} />)}
  </ScrollView>;
}

function ChildFactsRail({ child, load, leading }: ChildKeyFactsProps) {
  const [positions, setPositions] = useState<Record<string, HorizontalRailItem>>({});
  const controls = useRef(new Map<string, View>());
  const placeholder = load === "loading" ? "正在讀取孩子資料…" : load === "error" ? "暫時讀不到孩子資料" : !child ? "尚未選擇孩子" : null;
  const facts = !placeholder && child ? childFacts(child) : [];
  const items = ["child", ...(placeholder ? ["status"] : facts.map(fact => fact.label))];
  const layoutRevision = `${child?.id ?? "none"}:${load}:${facts.map(fact => fact.value).join(":")}`;
  function item(key: string, content: ReactNode) {
    return <View key={key} ref={node => { if (node) controls.current.set(key, node); else controls.current.delete(key); }}
      tabIndex={key === "child" ? undefined : -1} style={styles.railItem}
      onLayout={event => {
        const { x, width } = event.nativeEvent.layout;
        setPositions(current => current[key]?.x === x && current[key]?.width === width ? current : { ...current, [key]: { key, x, width } });
      }}>{content}</View>;
  }
  return <HorizontalOverflowRail style={styles.rail} contentContainerStyle={styles.railContent}
    rowTestID="header-child-facts" hintTestID="header-child-facts-more" accessibilityLabel="孩子及關鍵資料"
    items={items.flatMap(key => positions[key] ? [positions[key]] : [])} layoutRevision={layoutRevision}
    hintLabel="顯示更多孩子資料" onRevealItem={key => {
      if (Platform.OS === "web") (controls.current.get(key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
    }}>
    {item("child", leading)}
    {placeholder ? item("status", <Text accessibilityLiveRegion="polite" style={styles.status}>{placeholder}</Text>)
      : facts.map(fact => item(fact.label, <Fact fact={fact} />))}
  </HorizontalOverflowRail>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minWidth: 0, flexGrow: 1 },
  facts: { alignItems: "center", gap: spacing.sm, paddingRight: spacing.sm },
  fact: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.controlSurface, borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: spacing.sm, minHeight: 31 },
  label: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  value: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, fontWeight: "700", maxWidth: 120 },
  placeholder: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  rail: { height: 48, minWidth: 0 },
  railContent: { alignItems: "center", gap: spacing.sm },
  railItem: { flexShrink: 0, justifyContent: "center", minHeight: 48 },
  status: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
});
