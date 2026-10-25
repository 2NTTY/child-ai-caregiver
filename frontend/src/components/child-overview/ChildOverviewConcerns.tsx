import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthViewModel } from "../../growth-view-model";
import { overviewConcerns } from "../../overview-read-projection";
import { summaryTime } from "../../summary-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";
import { AppButton } from "../ui";

export function ChildOverviewConcerns({ model, scopeKey, childId, onOpen }: { model: GrowthViewModel | null; scopeKey: string; childId: string; onOpen(): void }) {
  const reading = overviewConcerns(model, scopeKey, childId, Date.now());
  const readable = reading.state === "ready" || reading.state === "stale";
  return <View style={styles.card} testID="overview-concerns">
    <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>持續關注</Text><Text style={styles.eyebrow}>近期觀察與跟進</Text></View>
    {reading.state === "stale" ? <Text style={styles.warning}>以下為已載入的關注內容，尚未重新核對。</Text> : null}
    {readable ? reading.items.length ? <View style={styles.items}>{reading.items.map(({ concern, observation }) => <View key={concern.id} style={styles.item}>
      <View style={styles.marker} /><View style={styles.copy}><Text style={styles.itemTitle} numberOfLines={2}>{concern.title}</Text>
        {observation ? <><Text style={styles.body} numberOfLines={3}>{observation.text}</Text><Text style={styles.meta} numberOfLines={2}>{summaryTime(observation.at)} · {observation.sourceLabel}</Text></> : <Text style={styles.meta}>正在跟進，尚未有可顯示的觀察記錄。</Text>}
      </View>
    </View>)}</View> : <Text style={styles.body}>目前已載入的關注鏈，沒有正在跟進的項目。</Text>
      : <Text style={styles.body}>{reading.state === "loading" ? "正在讀取關注內容…" : reading.state === "lost" ? "已無權讀取這位孩子的關注內容。" : reading.state === "error" ? "關注內容暫時未能讀取。" : "關注來源暫不可用，不能判斷是否有跟進項目。"}</Text>}
    {reading.pending ? <Text style={styles.warning}>原關注操作尚待核對，請到關注鏈處理。</Text> : null}
    <View style={styles.footer}><Text style={styles.meta}>保留觀察原文，不作發展評分。</Text><AppButton label="前往關注鏈" variant="quiet" density="compact" onPress={onOpen} disabled={reading.state === "lost"} /></View>
  </View>;
}

const styles = StyleSheet.create({
  card: { flexGrow: 1, minWidth: 0, padding: spacing.lg, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, gap: spacing.lg },
  heading: { gap: spacing.xs }, eyebrow: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted },
  title: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", color: colors.ink },
  items: { gap: spacing.lg }, item: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, minWidth: 0 },
  marker: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.ink, marginTop: 8 },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs }, itemTitle: { fontFamily: chineseFont, ...readingType.body, fontWeight: "700", color: colors.ink },
  body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted },
  warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk },
  footer: { marginTop: "auto", gap: spacing.sm, alignItems: "flex-start", paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
});
