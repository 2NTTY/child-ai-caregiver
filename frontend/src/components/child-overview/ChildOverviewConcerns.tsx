import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthViewModel } from "../../growth-view-model";
import { overviewConcerns } from "../../overview-read-projection";
import { summaryTime } from "../../summary-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";
import { ReadTargetLink } from "../ReadTargetLink";

export function ChildOverviewConcerns({ model, scopeKey, childId, onOpen, onOpenConcern }: { model: GrowthViewModel | null; scopeKey: string; childId: string; onOpen(): void; onOpenConcern(id: string): void }) {
  const reading = overviewConcerns(model, scopeKey, childId, Date.now());
  const readable = reading.state === "ready" || reading.state === "stale";
  return <View style={styles.card} testID="overview-concerns">
    <Text accessibilityRole="header" aria-level={2} style={styles.title}>最近在留意</Text>
    {reading.state === "stale" ? <Text style={styles.warning}>以下為已載入的關注內容，尚未重新核對。</Text> : null}
    {readable ? reading.items.length ? <View style={styles.items}>{reading.items.map(({ concern, observation }) => <ReadTargetLink key={concern.id} href={`/growth?tab=concerns&concernId=${encodeURIComponent(concern.id)}`} label={`查看關注：${concern.title}`} onOpen={() => onOpenConcern(concern.id)} style={styles.item}>
      <Text style={styles.itemTitle}>{concern.title}</Text>
        {observation ? <><Text style={styles.body} numberOfLines={3}>{observation.text}</Text><Text style={styles.meta}>{summaryTime(observation.at)} · {observation.sourceLabel}</Text></> : <Text style={styles.body}>正在跟進，尚未有可顯示的觀察記錄。</Text>}
    </ReadTargetLink>)}</View> : <Text style={styles.body}>目前已載入的關注鏈，沒有正在跟進的項目。</Text>
      : <Text style={styles.body}>{reading.state === "loading" ? "正在讀取關注內容…" : reading.state === "lost" ? "已無權讀取這位孩子的關注內容。" : reading.state === "error" ? "關注內容暫時未能讀取。" : "關注來源暫不可用，不能判斷是否有跟進項目。"}</Text>}
    {reading.pending ? <Text style={styles.warning}>原關注操作尚待核對，請到關注鏈處理。</Text> : null}
    <ReadTargetLink href="/growth?tab=concerns" label="查看所有關注" onOpen={onOpen} availability={reading.state === "lost" ? "unavailable" : "ready"} style={styles.link}><Text style={styles.linkLabel}>查看所有關注</Text></ReadTargetLink>
  </View>;
}

const styles = StyleSheet.create({
  card: { minWidth: 0, gap: spacing.md },
  title: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", color: colors.ink },
  items: { gap: spacing.md },
  item: { minWidth: 0, minHeight: 48, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  itemTitle: { fontFamily: chineseFont, ...readingType.body, fontWeight: "700", color: colors.teal, textDecorationLine: "underline" },
  body: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted },
  warning: { fontFamily: chineseFont, ...readingType.body, color: colors.warningInk },
  link: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", padding: spacing.sm, borderRadius: radius.small, maxWidth: "100%" },
  linkLabel: { fontFamily: chineseFont, ...readingType.body, color: colors.teal, textDecorationLine: "underline", fontWeight: "600" },
});
