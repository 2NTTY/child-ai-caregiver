import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Badge, Portal, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import type { ConnectionState, HomeOperation } from "../view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppButton } from "./ui";
import { OperationNotice } from "./OperationNotice";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";

const attentionStates = new Set(["needs_confirmation", "failed", "unknown"]);

export function NotificationBell({ operation, connection, onReview }: {
  operation: HomeOperation;
  connection: ConnectionState;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter(), navigate = usePreviewNavigation();
  const needsAttention = attentionStates.has(operation.state);
  return <>
    <View style={styles.anchor}>
      <ToolbarIconButton icon="bell-outline" label={`開啟訊息提示${needsAttention ? "：1 項狀態需留意" : ""}`}
        onPress={() => setOpen(true)} />
      <Badge visible={needsAttention} size={18} style={styles.badge}>1</Badge>
    </View>
    <Portal><Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
      <Dialog.Title>訊息提示</Dialog.Title>
      <Dialog.Content style={styles.content}>

        {operation.state === "none" ? <Text style={styles.body}>目前沒有操作提示</Text> : <OperationNotice state={operation.state} title={operation.title} message={operation.detail} />}
        {connection === "offline" ? <Text style={styles.caution}>{operation.state === "unknown" || operation.state === "saving" ? "目前離線，連線後可查核操作結果" : "目前離線"}</Text> : null}
        <AppButton label="查看通知歷史" variant="secondary" onPress={() => { setOpen(false); navigate(() => router.push("/history?category=notifications")); }} />
      </Dialog.Content>
      <Dialog.Actions>
        <AppButton label="關閉" variant="quiet" onPress={() => setOpen(false)} />
        {needsAttention ? <AppButton label={operation.state === "unknown" ? "查核原操作" : "查看原操作"} onPress={() => { setOpen(false); onReview(); }} /> : null}
      </Dialog.Actions>
    </Dialog></Portal>
  </>;
}

const styles = StyleSheet.create({
  anchor: { alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 1, right: 1, backgroundColor: colors.coral, color: colors.white },
  dialog: { width: "92%", maxWidth: 440, alignSelf: "center", borderRadius: radius.large },
  content: { gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 21 },
  caution: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 21 },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
});
