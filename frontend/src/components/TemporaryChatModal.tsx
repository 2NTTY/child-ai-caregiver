import { Linking, Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
import { Portal, Text } from "react-native-paper";
import { matchOfficialHelpForText } from "../../../src/shared/agent-feedback.ts";
import {
  TEMPORARY_CHAT_COPY,
  type TemporaryChatCloseReason,
} from "../../../src/shared/temporary-chat.ts";
import type { TemporaryChatSnapshot } from "../production/TemporaryChatOwner.ts";
import { chineseFont, colors, mobileLayout, radius, spacing, typeScale } from "../theme";
import { AppDialog as Dialog } from "./AppDialog";
import { AppIcon } from "./AppIcon";
import { AppScrollView } from "./AppScrollView";
import { OfficialHelpCards } from "./chat/OfficialHelpCards";
import { AppTextField } from "./ui";

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface TemporaryChatModalActions {
  open: () => void | Promise<void>;
  setDraft: (value: string) => void;
  send: () => void | Promise<void>;
  exitAndClear: (reason?: TemporaryChatCloseReason) => void | Promise<void>;
}

/**
 * Isolated blank temporary-chat modal.
 * Contains zero child selector, zero child records/facts, zero main chat history,
 * and zero assistant auto-authorization settings.
 */
export function TemporaryChatModal({
  state,
  actions,
}: {
  state: TemporaryChatSnapshot;
  actions: TemporaryChatModalActions;
}) {
  if (!state.open) return null;

  const isBusy = state.phase === "opening" || state.phase === "sending";
  const canSend = state.phase === "ready" && Boolean(state.draft.trim());
  const draftHelpCards = matchOfficialHelpForText(state.draft);

  return (
    <Portal>
      <Dialog
        visible={state.open}
        onDismiss={() => {
          void actions.exitAndClear("user_exit");
        }}
        accessibilityLabel={TEMPORARY_CHAT_COPY.title}
        testID="temporary-chat-modal"
        style={styles.dialog}
      >
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <Text accessibilityRole="header" style={styles.title}>
              {TEMPORARY_CHAT_COPY.title}
            </Text>
            <Text testID="temporary-chat-badge" style={styles.badge}>
              {TEMPORARY_CHAT_COPY.badgeLabel}
            </Text>
          </View>
          <Pressable
            testID="temporary-chat-exit-button"
            accessibilityRole="button"
            accessibilityLabel={TEMPORARY_CHAT_COPY.exitButtonLabel}
            onPress={() => {
              void actions.exitAndClear("user_exit");
            }}
            style={({ pressed, hovered, focused }: PressState) => [
              styles.exitButton,
              (hovered || focused) && styles.exitButtonHover,
              pressed && styles.exitButtonPressed,
            ]}
          >
            <AppIcon name="delete-outline" size={16} color={colors.errorInk} />
            <Text style={styles.exitButtonText}>{TEMPORARY_CHAT_COPY.exitButtonLabel}</Text>
          </Pressable>
        </View>

        <Dialog.Content style={styles.content}>
          <View testID="temporary-chat-boundary-banner" style={styles.boundaryBanner}>
            <Text style={styles.boundaryPrimary}>{TEMPORARY_CHAT_COPY.emptyDescription}</Text>
            <Text style={styles.boundarySecondary}>{TEMPORARY_CHAT_COPY.serviceControlNotice}</Text>
            <Text style={styles.boundarySecondary}>{TEMPORARY_CHAT_COPY.thirdPartyBoundaryNotice}</Text>
          </View>

          <AppScrollView
            testID="temporary-chat-messages"
            style={styles.messagesScroll}
            contentContainerStyle={styles.messagesList}
            keyboardShouldPersistTaps="handled"
          >
            {state.messages.length === 0 ? (
              <View testID="temporary-chat-empty-state" style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{TEMPORARY_CHAT_COPY.emptyTitle}</Text>
                <Text style={styles.emptyHint}>
                  {state.phase === "opening"
                    ? "正在建立獨立空白臨時會話…"
                    : "輸入公共育兒問題即可開始當次臨時對話。"}
                </Text>
              </View>
            ) : (
              state.messages.map(message => {
                const isUser = message.role === "user";
                return (
                  <View
                    key={message.id}
                    testID={`temporary-chat-message-${message.id}`}
                    style={[
                      styles.messageBubble,
                      isUser ? styles.userBubble : styles.modelBubble,
                    ]}
                  >
                    <Text style={styles.messageRole}>
                      {isUser ? "你（臨時對話）" : "助手（臨時對話）"}
                    </Text>
                    <Text selectable style={styles.messageText}>
                      {message.text}
                    </Text>
                    {message.citations?.length ? (
                      <View style={styles.citationsGroup}>
                        {message.citations.map((citation, index) => (
                          <View
                            key={citation.id}
                            testID={`temporary-chat-citation-${citation.id}`}
                            style={styles.citationCard}
                          >
                            <Text style={styles.citationHeader}>
                              [{index + 1}] {citation.publisher} · {citation.title}
                            </Text>
                            {citation.sourceDate ? (
                              <Text style={styles.citationMeta}>
                                來源日期：{citation.sourceDate}
                              </Text>
                            ) : null}
                            {citation.excerpt ? (
                              <Text selectable style={styles.citationExcerpt}>
                                {citation.excerpt}
                              </Text>
                            ) : null}
                            <Pressable
                              accessibilityRole="link"
                              accessibilityLabel={`開啟 ${citation.title}`}
                              onPress={() => {
                                void Linking.openURL(citation.url).catch(() => {});
                              }}
                              style={styles.citationLink}
                            >
                              <Text style={styles.citationLinkText}>開啟公共來源</Text>
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {message.helpCards?.length ? (
                      <View style={styles.helpCardsWrap}>
                        <OfficialHelpCards ids={message.helpCards} />
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </AppScrollView>

          {draftHelpCards.length > 0 ? (
            <View testID="temporary-chat-draft-help" style={styles.helpCardsWrap}>
              <OfficialHelpCards ids={draftHelpCards} />
            </View>
          ) : null}

          {state.error ? (
            <Text testID="temporary-chat-error" accessibilityRole="alert" style={styles.errorText}>
              {state.error}
            </Text>
          ) : null}

          {state.phase === "expired" || (state.phase === "error" && !state.session) ? (
            <View style={styles.restartRow}>
              <Pressable
                testID="temporary-chat-restart-button"
                accessibilityRole="button"
                accessibilityLabel={TEMPORARY_CHAT_COPY.restartButtonLabel}
                onPress={() => {
                  void actions.open();
                }}
                style={({ pressed }: PressState) => [
                  styles.restartButton,
                  pressed && styles.restartButtonPressed,
                ]}
              >
                <Text style={styles.restartButtonText}>
                  {TEMPORARY_CHAT_COPY.restartButtonLabel}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.composerRow}>
              <AppTextField
                testID="temporary-chat-input"
                value={state.draft}
                onChangeText={actions.setDraft}
                placeholder={TEMPORARY_CHAT_COPY.inputPlaceholder}
                accessibilityLabel={TEMPORARY_CHAT_COPY.inputPlaceholder}
                multiline
                disabled={isBusy}
                style={styles.input}
              />
              <Pressable
                testID="temporary-chat-send-button"
                accessibilityRole="button"
                accessibilityLabel="傳送臨時訊息"
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                onPress={() => {
                  void actions.send();
                }}
                style={({ pressed }: PressState) => [
                  styles.sendButton,
                  !canSend && styles.sendButtonDisabled,
                  pressed && canSend && styles.sendButtonPressed,
                ]}
              >
                <AppIcon name="send" size={16} color={canSend ? colors.white : colors.muted} />
                <Text style={[styles.sendButtonText, !canSend && styles.sendButtonTextDisabled]}>
                  {state.phase === "sending" ? "回覆中…" : "傳送"}
                </Text>
              </Pressable>
            </View>
          )}
        </Dialog.Content>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 680, width: "94%", maxHeight: "90%" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: {
    fontFamily: chineseFont,
    fontSize: typeScale.title,
    fontWeight: "800",
    color: colors.ink,
  },
  badge: {
    alignSelf: "flex-start",
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.deepTeal,
    backgroundColor: colors.paleTeal,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  exitButton: {
    minHeight: 40,
    minWidth: mobileLayout.touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.small,
    borderWidth: 1,
    borderColor: colors.errorInk,
    backgroundColor: colors.paleCoral,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  exitButtonHover: { opacity: 0.9 },
  exitButtonPressed: { opacity: 0.8 },
  exitButtonText: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.errorInk,
  },
  content: { gap: spacing.sm, maxHeight: 560 },
  boundaryBanner: {
    backgroundColor: colors.paleAmber,
    borderWidth: 1,
    borderColor: colors.statusWarmLine,
    borderRadius: radius.small,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  boundaryPrimary: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.warningInk,
    lineHeight: 18,
  },
  boundarySecondary: {
    fontFamily: chineseFont,
    fontSize: 11,
    color: colors.warningInk,
    lineHeight: 16,
  },
  messagesScroll: { maxHeight: 260, minHeight: 120 },
  messagesList: { gap: spacing.sm, paddingVertical: spacing.xs },
  emptyState: {
    backgroundColor: colors.quietSurface,
    borderRadius: radius.small,
    padding: spacing.md,
    gap: spacing.xs,
  },
  emptyTitle: {
    fontFamily: chineseFont,
    fontSize: typeScale.small,
    fontWeight: "700",
    color: colors.ink,
  },
  emptyHint: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    color: colors.muted,
    lineHeight: 18,
  },
  messageBubble: {
    borderRadius: radius.small,
    padding: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: colors.paleTeal,
    borderColor: colors.sage,
  },
  modelBubble: {
    backgroundColor: colors.controlSurface,
    borderColor: colors.softLine,
  },
  messageRole: {
    fontFamily: chineseFont,
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
  },
  messageText: {
    fontFamily: chineseFont,
    fontSize: typeScale.small,
    color: colors.ink,
    lineHeight: 20,
  },
  citationsGroup: { gap: spacing.xs, paddingTop: spacing.xs },
  citationCard: {
    backgroundColor: colors.neutralSurface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.small,
    padding: spacing.xs,
    gap: 2,
  },
  citationHeader: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.ink,
  },
  citationMeta: {
    fontFamily: chineseFont,
    fontSize: 11,
    color: colors.muted,
  },
  citationExcerpt: {
    fontFamily: chineseFont,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 17,
  },
  citationLink: { alignSelf: "flex-start", paddingVertical: 2 },
  citationLinkText: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.deepTeal,
    textDecorationLine: "underline",
  },
  helpCardsWrap: {
    backgroundColor: colors.paleAmber,
    borderRadius: radius.small,
    padding: spacing.xs,
  },
  errorText: {
    fontFamily: chineseFont,
    fontSize: typeScale.caption,
    fontWeight: "700",
    color: colors.errorInk,
  },
  restartRow: { flexDirection: "row", justifyContent: "flex-end" },
  restartButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.small,
    backgroundColor: colors.deepTeal,
    justifyContent: "center",
    alignItems: "center",
  },
  restartButtonPressed: { opacity: 0.85 },
  restartButtonText: {
    fontFamily: chineseFont,
    fontSize: typeScale.small,
    fontWeight: "700",
    color: colors.white,
  },
  composerRow: { gap: spacing.sm },
  input: { maxHeight: 100 },
  sendButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.small,
    backgroundColor: colors.deepTeal,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    alignSelf: "flex-end",
  },
  sendButtonDisabled: {
    backgroundColor: colors.softLine,
  },
  sendButtonPressed: { opacity: 0.85 },
  sendButtonText: {
    fontFamily: chineseFont,
    fontSize: typeScale.small,
    fontWeight: "700",
    color: colors.white,
  },
  sendButtonTextDisabled: { color: colors.muted },
});
