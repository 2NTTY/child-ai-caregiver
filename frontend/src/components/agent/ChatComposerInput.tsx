import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentRef } from "react";
import { StyleSheet } from "react-native";
import { TextInput } from "react-native-paper";
import { chatColors, chatFont, chatLayout, chatType } from "../chat/chat-presentation";
import { AppTextField } from "../ui";

export type ChatComposerInputHandle = { focus(options?: { preventScroll?: boolean }): void; blur(): void };
export type ChatComposerInputProps = {
  onAttachment?(attachment: import("../../assistant-draft").AssistantAttachment): void;
  onAttachmentError?(message: string): void;
  autoFocus?: boolean; placeholder?: string; compact?: boolean; hint?: string;
  onStop?(): void; stopTarget?: string;
  value: string; disabled: boolean; canSubmit?: boolean; onChangeText(value: string): void; onSubmit(): void;
  onFocus?(): void; onBlur?(): void;
};

// Native multiline input keeps Enter as a newline; the send control is explicit.
export const ChatComposerInput = forwardRef<ChatComposerInputHandle, ChatComposerInputProps>(function ChatComposerInput(props, ref) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const min = props.compact ? 32 : chatLayout.inputMinHeight, max = props.compact ? 68 : chatLayout.inputMaxHeight;
  const [height, setHeight] = useState<number>(min);
  useEffect(() => { if (!props.value) setHeight(min); }, [props.value, min]);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur() }), []);
  return <AppTextField autoFocus={props.autoFocus} ref={input} mode="flat" dense multiline disabled={props.disabled}
    accessibilityLabel="撰寫對話問題" accessibilityHint={props.hint} placeholder={props.placeholder ?? "補充情況，或加入附件…"} placeholderTextColor={chatColors.secondary}
    value={props.value} onChangeText={props.onChangeText} onFocus={props.onFocus} onBlur={props.onBlur}
    underlineColor="transparent" activeUnderlineColor="transparent" underlineStyle={styles.underline}
    onContentSizeChange={event => setHeight(!props.value ? min
      : Math.max(min, Math.min(max, event.nativeEvent.contentSize.height)))}
    style={[styles.input, { height }]} contentStyle={[styles.content, props.compact && { paddingVertical: 3, fontSize: 14, lineHeight: 20 }]} />;
});

const styles = StyleSheet.create({
  input: { backgroundColor: "transparent", fontFamily: chatFont, ...chatType.input },
  content: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4, color: chatColors.ink, fontFamily: chatFont, ...chatType.input },
  underline: { height: 0 },
});
