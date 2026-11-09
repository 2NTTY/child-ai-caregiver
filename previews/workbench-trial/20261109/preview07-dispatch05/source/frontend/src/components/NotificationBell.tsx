import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Portal } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { AppScrollView } from "./AppScrollView";
import { radius, spacing } from "../theme";
import { AppButton } from "./ui";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { usePersonalHistoryWorkspace } from "../production/usePersonalHistory";
import { PersonalNotificationContent } from "./history/PersonalHistoryViews";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const owner = usePersonalHistoryWorkspace();
  const current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey;
  const router = useRouter(), navigate = usePreviewNavigation();
  useEffect(() => { setOpen(false); }, [scope]);
  return <>
    <View style={styles.anchor}>
      <ToolbarIconButton icon="bell-outline" label="開啟最近消息" onPress={() => {
        if (owner?.online && owner.access !== "revoked" && owner.notifications.state === "unavailable" && !owner.notificationUnavailable) owner.actions.loadNotifications();
        setOpen(true);
      }} />
    </View>
    <Portal><Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
      <Dialog.Title style={styles.title}>最近消息</Dialog.Title>
      <Dialog.Content style={styles.content}>
        {open ? <AppScrollView style={styles.messages} contentContainerStyle={styles.scrollContent}>
          <PersonalNotificationContent owner={owner} recent />
        </AppScrollView> : null}
      </Dialog.Content>
      <Dialog.Actions style={styles.actions}>
        <AppButton label="查看消息歷史" variant="secondary" disabled={!owner} onPress={() => {
          if (!scope || current.current?.scopeKey !== scope) return;
          setOpen(false); navigate(() => router.push("/history?category=notifications"), "workspace");
        }} />
        <AppButton label="關閉" variant="quiet" onPress={() => setOpen(false)} />
      </Dialog.Actions>
    </Dialog></Portal>
  </>;
}

const styles = StyleSheet.create({
  anchor: { alignItems: "center", justifyContent: "center" },
  dialog: { width: "92%", maxWidth: 520, alignSelf: "center", borderRadius: radius.large },
  title: { flexShrink: 0 },
  // The shared dialog bounds the whole surface; only its message region may shrink.
  content: { flexShrink: 1, minHeight: 0, paddingBottom: 0 },
  messages: { maxHeight: 420, flexShrink: 1, minHeight: 0 },
  actions: { flexGrow: 0, flexShrink: 0, justifyContent: "space-between" },
  scrollContent: { paddingBottom: spacing.sm },
});
