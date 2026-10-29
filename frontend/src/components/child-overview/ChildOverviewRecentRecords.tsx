import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions } from "../../care-view-model";
import { overviewRecords, overviewRecordTime } from "../../overview-read-projection";
import type { SummaryViewModel } from "../../summary-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";
import { AppButton } from "../ui";

export function ChildOverviewRecentRecords({ model, scopeKey, childId, onRecord, onReview }: { model: SummaryViewModel; scopeKey: string; childId: string; onRecord(id: string): void; onReview(): void }) {
  const reading = overviewRecords(model, scopeKey, childId, Date.now());
  const readable = reading.state === "ready" || reading.state === "stale";
  return <View style={styles.card} testID="overview-recent-records">
    <View style={styles.heading}><View style={styles.headingCopy}><Text style={styles.eyebrow}>從已確認的日常記錄看見</Text><Text accessibilityRole="header" aria-level={2} style={styles.title}>最近生活片段</Text></View>
      {reading.periodLabel ? <Text style={styles.period}>{reading.periodLabel} · {model.page?.period.timeZone}</Text> : null}
    </View>
    {reading.state === "stale" ? <Text style={styles.warning}>以下為已載入的記錄，最新內容尚未核對。</Text> : null}
    {readable ? reading.records.length ? <View>{reading.records.map(record => {
      const kind = careKindOptions.find(item => item.value === record.kind)?.label ?? record.kind;
      const time = overviewRecordTime(record, model.page!.period.timeZone);
      return <View key={record.id} style={styles.record} testID={`overview-record-${record.id}`}>
        <View style={styles.time}><Text style={styles.day}>{time.day}</Text><Text style={styles.meta}>{time.time}</Text></View>
        <View style={styles.recordCopy}><Text style={styles.kind}>{kind}</Text><Text style={styles.body} numberOfLines={3}>{record.text}</Text>
          <AppButton label="查看原記錄" accessibilityLabel={`查看${time.full}${kind}的原記錄`} density="compact" variant="quiet" onPress={() => onRecord(record.id)} />
        </View>
      </View>;
    })}</View> : <Text style={styles.body}>{reading.state === "stale" ? "目前載入的內容沒有可呈現的過往片段，待重新核對。" : "所選期間暫未有可呈現的過往片段。沒有記錄，不代表沒有發生。"}</Text>
      : <Text style={styles.body}>{reading.state === "loading" ? "正在讀取生活記錄…" : reading.state === "lost" ? "已無權讀取這位孩子的生活記錄。" : reading.state === "error" ? "生活記錄暫時未能讀取，請在完整回顧重新核對。" : "生活記錄來源暫不可用。"}</Text>}
    <View style={styles.footer}><View style={styles.footerCopy}><Text style={styles.meta}>只呈現已確認的過往記錄，不代表完整日常。</Text>{reading.omitted || !!model.page?.missing.unknownEventTime ? <Text style={styles.meta}>未能定位於過往期間的記錄不列在這裏；限制與來源見完整回顧。</Text> : null}</View>
      <AppButton label="查看完整回顧" variant="secondary" density="compact" onPress={onReview} disabled={reading.state === "lost" || reading.state === "unavailable"} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { minWidth: 0, padding: spacing.xl, borderRadius: radius.large, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, gap: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }, headingCopy: { flexGrow: 1, gap: spacing.xs },
  eyebrow: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, title: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", color: colors.ink },
  period: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1 },
  record: { flexDirection: "row", gap: spacing.lg, paddingVertical: spacing.lg, borderTopWidth: 1, borderTopColor: colors.softLine, minWidth: 0 },
  time: { width: 58, gap: spacing.xs }, day: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink, fontWeight: "700" },
  recordCopy: { flex: 1, minWidth: 0, gap: spacing.xs, alignItems: "flex-start" }, kind: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, fontWeight: "700" },
  body: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.softLine },
  footerCopy: { flexGrow: 1, flexBasis: 240, minWidth: 0, gap: spacing.xs },
});
