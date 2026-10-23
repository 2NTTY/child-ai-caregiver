import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppScrollView as ScrollView } from "./AppScrollView";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, spacing, typeScale } from "../theme";
import { SectionCard, TextLink } from "./ui";
import { HomeFocus } from "./HomeFocus";

// Pure rail content. AppShell owns desktop layout, modal geometry and motion.
export function RightRailContent({ model, actions, contextPath = "/" }: { model: HomeViewModel; actions: HomeActions; contextPath?: string }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const routeContext = contextPath === "/chat" ? { title: "目前對話", label: "記憶與參考", destination: "memory" as const }
    : contextPath === "/growth" ? { title: "關注與準備", label: "概況", destination: "summary" as const }
    : contextPath === "/care" || contextPath === "/photos" ? { title: "記錄核對", label: "請助手協助", destination: "chat" as const }
    : contextPath === "/tasks" ? { title: "行動安排", label: "家庭日常交接", destination: "family" as const }
    : { title: "照顧空間", label: "前往助手", destination: "chat" as const };
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.cards}>
    {child ? <HomeFocus model={model} actions={actions} full /> : <SectionCard><Text style={styles.meta}>選擇孩子後，再查看對應的待辦與提醒。</Text></SectionCard>}
    {child ? <View style={styles.routeContext}><Text style={styles.contextEyebrow}>{child.displayName} · {routeContext.title}</Text>
      <TextLink label={routeContext.label} onPress={() => actions.open(routeContext.destination)} />
    </View> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
  routeContext: { gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  contextEyebrow: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  scroll: { flex: 1, minHeight: 0 }, cards: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 },
});
