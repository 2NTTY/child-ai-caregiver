import { Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
import { Portal, Text } from "react-native-paper";
import { TEMPORARY_CHAT_COPY } from "../../../src/shared/temporary-chat.ts";
import { useProduction } from "../production/ProductionProvider";
import { chineseFont, colors, mobileLayout, radius, spacing, typeScale } from "../theme";
import { AppDialog as Dialog } from "./AppDialog";
import { AppIcon } from "./AppIcon";
import { TemporaryChatModal } from "./TemporaryChatModal";

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

/**
 * Top-left isolated entry trigger for Ephemeral Temporary Chat.
 * Mounts in the header before child context identity controls so it visually
 * and functionally stays separate from any selected child's main conversation.
 */
export function TemporaryChatEntry({ compact = false }: { compact?: boolean }) {
  const { temporaryChat, temporaryChatActions } = useProduction();

  if (!temporaryChat?.available) return null;

  const isPending =
    temporaryChat.closeState === "local_cleared_remote_pending" ||
    temporaryChat.closeState === "local_cleared_remote_confirming";
  const noticeVisible = !temporaryChat.open && Boolean(temporaryChat.closeNotice);

  return (
    <>
      <View testID="header-temporary-chat-entry" style={styles.anchor}>
        <Pressable
          testID="temporary-chat-entry-button"
          accessibilityRole="button"
          accessibilityLabel={TEMPORARY_CHAT_COPY.entryAccessibilityLabel}
          onPress={() => {
            void temporaryChatActions.open();
          }}
          style={({ pressed, hovered, focused }: PressState) => [
            styles.entryButton,
            compact && styles.entryButtonCompact,
            (hovered || focused) && styles.entryButtonHover,
            pressed && styles.entryButtonPressed,
          ]}
        >
          <AppIcon name="shield-check-outline" size={18} color={colors.deepTeal} />
          {!compact ? (
            <Text numberOfLines={1} style={styles.entryLabel}>
              {TEMPORARY_CHAT_COPY.entryLabel}
            </Text>
          ) : null}
        </Pressable>
      </View>

      {noticeVisible ? (
        <Portal>
          <Dialog
            visible={noticeVisible}
            onDismiss={() => {
              if (temporaryChat.closeState !== "local_cleared_remote_confirming") {
                temporaryChatActions.dismissCloseNotice();
              }
            }}
            accessibilityLabel="臨時聊天清除狀態"
            testID="temporary-chat-close-dialog"
          >
            <Dialog.Title>
              {isPending ? "本機已清除，遠端清除待確認" : "已退出並清除臨時會話"}
            </Dialog.Title>
            <Dialog.Content style={styles.noticeContent}>
              {isPending ? (
                <Text
                  testID="temporary-chat-close-pending-notice"
                  style={styles.pendingNoticeText}
                >
                  {temporaryChat.closeNotice}
                </Text>
              ) : (
                <Text
                  testID="temporary-chat-close-confirmed-notice"
                  style={styles.confirmedNoticeText}
                >
                  {temporaryChat.closeNotice}
                </Text>
              )}
              <Text style={styles.boundaryNote}>
                {TEMPORARY_CHAT_COPY.thirdPartyBoundaryNotice}
              </Text>
            </Dialog.Content>
            <Dialog.Actions>
              {isPending ? (
                <Pressable
                  testID="temporary-chat-retry-close-button"
                  accessibilityRole="button"
                  accessibilityLabel={TEMPORARY_CHAT_COPY.retryCloseButtonLabel}
                  onPress={() => {
                    void temporaryChatActions.retryPendingRemoteCloses();
                  }}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryButtonText}>
                    {TEMPORARY_CHAT_COPY.retryCloseButtonLabel}
                  </Text>
                </Pressable>
              ) : null}
              {temporaryChat.closeState !== "local_cleared_remote_confirming" ? (
                <Pressable
                  testID="temporary-chat-close-notice-dismiss"
                  accessibilityRole="button"
                  accessibilityLabel="關閉清除狀態通知"
                  onPress={temporaryChatActions.dismissCloseNotice}
                  style={styles.dismissButton}
                >
                  <Text style={styles.dismissButtonText}>知道</Text>
                </Pressable>
              ) : null}
            </Dialog.Actions>
          </Dialog>
        </Portal>
      ) : null}

      <TemporaryChatModal state={temporaryChat} actions={temporaryChatActions} />
    </>
  );
}

const styles = StyleSheet.create({
  anchor: { flexShrink: 0, justifyContent: "center" },
  entryButton: {
    minHeight: 40,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.controlSurface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  entryButtonCompact: {
    minWidth: mobileLayout.touchTarget,
    minHeight: mobileLayout.touchTarget,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  entryButtonHover: { backgroundColor: colors.paleTeal, borderColor: colors.deepTeal },
  entryButtonPressed: { backgroundColor: colors.selectedPressed },
  entryLabel: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.deepTeal,
  },
  noticeContent: { gap: spacing.sm },
  pendingNoticeText: {
    fontFamily: chineseFont,
    fontSize: typeScale.small,
    fontWeight: "700",
    color: colors.warningInk,
    lineHeight: 20,
  },
  confirmedNoticeText: {
    fontFamily: chineseFont,
    fontSize: typeScale.small,
    fontWeight: "700",
    color: colors.ink,
    lineHeight: 20,
  },
  boundaryNote: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    color: colors.muted,
    lineHeight: 18,
  },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.small,
    backgroundColor: colors.deepTeal,
    justifyContent: "center",
  },
  retryButtonText: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.white,
  },
  dismissButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center",
  },
  dismissButtonText: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.ink,
  },
});
