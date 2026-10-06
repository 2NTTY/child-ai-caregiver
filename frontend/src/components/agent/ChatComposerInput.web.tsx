import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties } from "react";
import { chatColors, chatFont, chatLayout, chatType } from "../chat/chat-presentation";
import type { ChatComposerInputHandle, ChatComposerInputProps } from "./ChatComposerInput";

function fitInput(input: HTMLTextAreaElement) {
  // Measure and restore synchronously before paint, so deletion can shrink without a visible reset.
  const scrollTop = input.scrollTop;
  input.style.height = "0px";
  const height = input.scrollHeight;
  input.style.height = `${Math.max(chatLayout.inputMinHeight, Math.min(chatLayout.inputMaxHeight, height))}px`;
  input.style.overflowY = height > chatLayout.inputMaxHeight ? "auto" : "hidden";
  input.scrollTop = scrollTop;
}

// A local DOM textarea adapter supplies autosizing and IME-safe Enter without changing shared forms.
export const ChatComposerInput = forwardRef<ChatComposerInputHandle, ChatComposerInputProps>(function ChatComposerInput(props, ref) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur() }), []);
  useLayoutEffect(() => { if (input.current) fitInput(input.current); }, [props.value]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth; fitInput(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <><style>{`.chat-composer-input::placeholder { color: ${chatColors.secondary}; opacity: 1; }`}</style>
    <textarea className="chat-composer-input" ref={input} aria-label="撰寫對話問題" placeholder="補充情況，或加入附件…"
    rows={1} disabled={props.disabled} value={props.value} onChange={event => props.onChangeText(event.currentTarget.value)}
    onFocus={props.onFocus} onBlur={props.onBlur} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (event.key !== "Enter" || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      if (!props.disabled && (props.canSubmit ?? !!props.value.trim())) props.onSubmit();
    }} style={inputStyle} /></>;
});

const inputStyle: CSSProperties = {
  display: "block", width: "100%", minWidth: 0, boxSizing: "border-box", border: 0, margin: 0,
  height: chatLayout.inputMinHeight, minHeight: chatLayout.inputMinHeight, maxHeight: chatLayout.inputMaxHeight,
  padding: "8px 8px 4px", resize: "none", background: "transparent", outline: "none",
  fontFamily: chatFont, fontSize: chatType.input.fontSize, lineHeight: `${chatType.input.lineHeight}px`,
  color: chatColors.ink, overflowWrap: "anywhere", overflowY: "hidden", scrollbarWidth: "thin",
};
