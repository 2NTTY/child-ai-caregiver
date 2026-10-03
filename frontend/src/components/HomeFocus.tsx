import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, SectionCard } from "./ui";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";

export function HomeFocus({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  if (!model.children.some(child => child.id === model.selectedChildId)) return null;
  const operation = model.operation;
  const focus = model.focus ?? { kind: "unavailable", detail: "尚未取得今日事項，不能確認有沒有需要處理的內容。" };
  const hasOperation = operation.state !== "none";
  return <View testID="home-focus">
    {hasOperation ? <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
      {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={actions.reviewOperation} /> : null}
    </OperationNotice> : focus.kind === "none" ? <View style={styles.quiet}><Text style={styles.heading}>今天暫無指定事項</Text><Text style={styles.body}>{focus.detail ?? "目前的授權快照沒有指定需要處理的事項。"}</Text></View>
      : focus.kind === "unavailable" ? <ReadStateNotice state="unavailable" title="暫未能確認今日事項" message={focus.detail}>
        <AppButton label="重新讀取" density="compact" variant="quiet" disabled={model.connection !== "online" || model.recordsLoad === "loading"} onPress={actions.refresh} />
      </ReadStateNotice> : <SectionCard>
        <Text style={styles.eyebrow}>{focus.kind === "task" ? "今天的一件待辦" : "一項成長關注"}</Text>
        <Text accessibilityRole="header" style={styles.heading}>{focus.title}</Text><Text style={styles.body}>{focus.detail}</Text>
        {focus.whyNow ? <Text style={styles.meta}>{focus.whyNow}</Text> : null}{focus.sourceLabel ? <Text style={styles.meta}>依據：{focus.sourceLabel}</Text> : null}
        <AppButton label={focus.action.label} density="compact" variant="secondary" onPress={() => actions.open(focus.action.destination)} />
      </SectionCard>}
    {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；已載入的事項可能不是最新狀態。</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  quiet: { gap: spacing.xs, paddingVertical: spacing.sm },
  heading: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, marginTop: spacing.xs },
});
