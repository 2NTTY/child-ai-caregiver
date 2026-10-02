import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Badge, Button, Portal, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import type { ConnectionState, HomeOperation } from "../view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { OperationPill } from "./ui";
import { ToolbarIconButton } from "./ToolbarIconButton";

const attentionStates = new Set(["needs_confirmation", "failed", "unknown"]);

export function NotificationBell({ operation, connection, onReview }: {
  operation: HomeOperation;
  connection: ConnectionState;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const needsAttention = attentionStates.has(operation.state);
  return <>
    <View style={styles.anchor}>
      <ToolbarIconButton icon="bell-outline" label={`開啟訊息提示${needsAttention ? "：1 項合成狀態需留意" : ""}`}
        onPress={() => setOpen(true)} />
      <Badge visible={needsAttention} size={18} style={styles.badge}>1</Badge>
    </View>
    <Portal><Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
      <Dialog.Title>訊息提示</Dialog.Title>
      <Dialog.Content style={styles.content}>
        <Text style={styles.previewLabel}>合成預覽 · 未接駁站內通知或 Web Push</Text>
        {operation.state === "none" ? <Text style={styles.body}>目前沒有需要處理的操作提示。</Text> : <>
          <OperationPill state={operation.state} />
          <Text style={styles.title}>{operation.title}</Text>
          <Text style={styles.body}>{operation.detail}</Text>
        </>}
        {connection === "offline" ? <Text style={styles.caution}>目前離線；正式版須重讀原操作狀態，不能推斷是否保存。</Text> : null}
        <Text style={styles.note}>角標只表示此預覽有需留意的狀態，不代表訊息已發送、送達或未讀。</Text>
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={() => setOpen(false)}>關閉</Button>
        {needsAttention ? <Button onPress={() => { setOpen(false); onReview(); }}>{operation.state === "unknown" ? "查核原操作" : "查看原操作"}</Button> : null}
      </Dialog.Actions>
    </Dialog></Portal>
  </>;
}

const styles = StyleSheet.create({
  anchor: { alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 1, right: 1, backgroundColor: colors.coral, color: colors.white },
  dialog: { width: "92%", maxWidth: 440, alignSelf: "center", borderRadius: radius.large },
  content: { gap: spacing.sm },
  previewLabel: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 21 },
  caution: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 21 },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
});
