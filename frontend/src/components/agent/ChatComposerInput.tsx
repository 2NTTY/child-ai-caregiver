import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentRef } from "react";
import { StyleSheet } from "react-native";
import { TextInput } from "react-native-paper";
import { chatColors, chatFont, chatLayout, chatType } from "../chat/chat-presentation";
import { AppTextField } from "../ui";

export type ChatComposerInputHandle = { focus(): void; blur(): void };
export type ChatComposerInputProps = {
  value: string; disabled: boolean; canSubmit?: boolean; onChangeText(value: string): void; onSubmit(): void;
  onFocus(): void; onBlur(): void;
};

// Native multiline input keeps Enter as a newline; the send control is explicit.
export const ChatComposerInput = forwardRef<ChatComposerInputHandle, ChatComposerInputProps>(function ChatComposerInput(props, ref) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [height, setHeight] = useState<number>(chatLayout.inputMinHeight);
  useEffect(() => { if (!props.value) setHeight(chatLayout.inputMinHeight); }, [props.value]);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur() }), []);
  return <AppTextField ref={input} mode="flat" dense multiline disabled={props.disabled}
    accessibilityLabel="撰寫對話問題" placeholder="補充情況，或加入附件…" placeholderTextColor={chatColors.secondary}
    value={props.value} onChangeText={props.onChangeText} onFocus={props.onFocus} onBlur={props.onBlur}
    underlineColor="transparent" activeUnderlineColor="transparent" underlineStyle={styles.underline}
    onContentSizeChange={event => setHeight(!props.value ? chatLayout.inputMinHeight
      : Math.max(chatLayout.inputMinHeight, Math.min(chatLayout.inputMaxHeight, event.nativeEvent.contentSize.height)))}
    style={[styles.input, { height }]} contentStyle={styles.content} />;
});

const styles = StyleSheet.create({
  input: { backgroundColor: "transparent", fontFamily: chatFont, ...chatType.input },
  content: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4, color: chatColors.ink, fontFamily: chatFont, ...chatType.input },
  underline: { height: 0 },
});
