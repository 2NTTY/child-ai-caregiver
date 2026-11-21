import { Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
import { Text } from "react-native-paper";
import { CHAT_MODE_COPY, type ChatMode } from "../../../../src/shared/chat";
import { colors, mobileLayout, radius, spacing } from "../../theme";
import { chatColors, chatFont, chatLayout, chatType } from "./chat-presentation";

type ControlInteraction = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface ChatModeSwitchProps {
  mode: ChatMode;
  disabled?: boolean;
  compact?: boolean;
  inflightNotice?: string | null;
  onChangeMode: (mode: ChatMode) => void;
}

/** Explicit main-chat mode toggle ("assistant" vs "chat_only") without altering thread history. */
export function ChatModeSwitch({ mode, disabled = false, compact = false, inflightNotice, onChangeMode }: ChatModeSwitchProps) {
  const options: ReadonlyArray<{ value: ChatMode; label: string; testID: string }> = [
    { value: "assistant", label: CHAT_MODE_COPY.assistantLabel, testID: "chat-mode-option-assistant" },
    { value: "chat_only", label: CHAT_MODE_COPY.chatOnlyLabel, testID: "chat-mode-option-chat-only" },
  ];

  return (
    <View testID="chat-mode-bar" style={[styles.bar, compact && styles.compactBar]}>
      <View
        testID="chat-mode-switch"
        accessibilityRole="radiogroup"
        accessibilityLabel="主聊天模式"
        style={styles.segmented}
      >
        {options.map(option => {
          const checked = mode === option.value;
          return (
            <Pressable
              key={option.value}
              testID={option.testID}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked, disabled }}
              disabled={disabled}
              onPress={() => onChangeMode(option.value)}
              style={({ pressed, hovered, focused }: ControlInteraction) => [
                styles.option,
                compact && styles.compactOption,
                checked && styles.optionActive,
                (hovered || focused) && !checked && !disabled && styles.optionHover,
                pressed && !disabled && styles.optionPressed,
                disabled && styles.disabled,
              ]}
            >
              <Text style={[styles.optionLabel, checked && styles.optionLabelActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === "chat_only" ? (
        <View testID="chat-mode-only-banner" style={styles.banner}>
          <Text style={styles.bannerText}>{CHAT_MODE_COPY.chatOnlyBanner}</Text>
          <Pressable
            testID="chat-mode-switch-to-assistant"
            accessibilityRole="button"
            accessibilityLabel={CHAT_MODE_COPY.switchToAssistantLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onChangeMode("assistant")}
            style={({ pressed, hovered, focused }: ControlInteraction) => [
              styles.switchAction,
              compact && styles.compactOption,
              (hovered || focused) && !disabled && styles.optionHover,
              pressed && !disabled && styles.optionPressed,
              disabled && styles.disabled,
            ]}
          >
            <Text style={styles.switchActionLabel}>{CHAT_MODE_COPY.switchToAssistantLabel}</Text>
          </Pressable>
        </View>
      ) : null}

      {inflightNotice ? (
        <Text testID="chat-mode-inflight-notice" accessibilityRole="alert" style={styles.inflightNotice}>
          {inflightNotice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: "100%",
    maxWidth: chatLayout.maxWidth,
    alignSelf: "center",
    paddingHorizontal: chatLayout.wideInset,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    marginBottom: chatLayout.composerOverlap,
    gap: spacing.xs,
    zIndex: 2,
  },
  compactBar: {
    paddingHorizontal: chatLayout.compactInset,
  },
  segmented: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.quietSurface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    padding: 2,
    gap: 2,
  },
  option: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  compactOption: {
    minHeight: mobileLayout.touchTarget,
  },
  optionActive: {
    backgroundColor: colors.accent,
  },
  optionHover: {
    backgroundColor: colors.paleTeal,
  },
  optionPressed: {
    backgroundColor: colors.selectedPressed,
  },
  optionLabel: {
    fontFamily: chatFont,
    color: chatColors.secondary,
    ...chatType.tool,
    fontWeight: "600",
  },
  optionLabelActive: {
    color: chatColors.ink,
  },
  banner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.paleAmber,
    borderWidth: 1,
    borderColor: colors.statusWarmLine,
    borderRadius: radius.small,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bannerText: {
    fontFamily: chatFont,
    color: colors.warningInk,
    ...chatType.meta,
    flexShrink: 1,
  },
  switchAction: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.controlOutline,
    backgroundColor: chatColors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  switchActionLabel: {
    fontFamily: chatFont,
    color: chatColors.ink,
    ...chatType.meta,
    fontWeight: "600",
  },
  inflightNotice: {
    fontFamily: chatFont,
    color: colors.warningInk,
    ...chatType.meta,
  },
  disabled: {
    opacity: 0.5,
  },
});
