import { photoAttachment } from "../../assistant-draft";
import { readWebPhotoOriginal } from "../photos/web-photo-file";
import { fileFromBlob } from "./file-attachment";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties } from "react";
import { chatColors, chatFont, chatLayout, chatType } from "../chat/chat-presentation";
import type { ChatComposerInputHandle, ChatComposerInputProps } from "./ChatComposerInput";

function fitInput(input: HTMLTextAreaElement, compact = false) {
  // Measure and restore synchronously before paint, so deletion can shrink without a visible reset.
  const min = compact ? 32 : chatLayout.inputMinHeight, max = compact ? 68 : chatLayout.inputMaxHeight;
  const scrollTop = input.scrollTop;
  input.style.height = "0px";
  const height = input.scrollHeight;
  input.style.height = `${Math.max(min, Math.min(max, height))}px`;
  input.style.overflowY = height > max ? "auto" : "hidden";
  input.scrollTop = scrollTop;
}

// A local DOM textarea adapter supplies autosizing and IME-safe Enter without changing shared forms.
export const ChatComposerInput = forwardRef<ChatComposerInputHandle, ChatComposerInputProps>(function ChatComposerInput(props, ref) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const intake = useRef(0);
  const acceptFiles = !!props.onAttachment;
  useLayoutEffect(() => () => { intake.current++; }, [acceptFiles]);
  async function addFiles(files: File[]) {
    if (!props.onAttachment) return;
    if (files.length !== 1) { props.onAttachmentError?.("每則訊息可加入一份附件。"); return; }
    const order = ++intake.current;
    const file = files[0];
    try {
      const attachment = /^(image\/(jpeg|png|hei[cf](-sequence)?))$/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
        ? photoAttachment(await readWebPhotoOriginal(file))
        : fileFromBlob(file, file.name, blob => URL.createObjectURL(blob), uri => URL.revokeObjectURL(uri));
      if (intake.current !== order) { attachment.dispose?.(); return; }
      props.onAttachment(attachment);
    } catch (error) {
      if (intake.current === order) props.onAttachmentError?.(error instanceof Error && /JPEG|MiB|HEIC/u.test(error.message)
        ? error.message : "未能加入附件。請選擇 20 MiB 以內的文件。");
    }
  }
  const lastEscape = useRef<{ time: number; target: string | undefined } | null>(null);
  useImperativeHandle(ref, () => ({ focus: options => input.current?.focus(options), blur: () => input.current?.blur() }), []);
  useLayoutEffect(() => { if (input.current) fitInput(input.current, props.compact); }, [props.value, props.compact]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth; fitInput(node, props.compact);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.compact]);
  return <><style>{`.chat-composer-input::placeholder { color: ${chatColors.secondary}; opacity: 1; }`}</style>
    <textarea autoFocus={props.autoFocus} className="chat-composer-input" ref={input} aria-label="撰寫對話問題" aria-description={props.hint} title={props.hint} placeholder={props.placeholder ?? "補充情況，或加入附件…"}
    rows={1} disabled={props.disabled} value={props.value} onChange={event => props.onChangeText(event.currentTarget.value)}
    onFocus={props.onFocus} onBlur={() => { lastEscape.current = null; props.onBlur?.(); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onPaste={event => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); void addFiles(files); }
    }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files));
    }}
    onKeyDown={event => {
      if (event.key === "Escape" && props.onStop && !event.defaultPrevented && !event.repeat && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
        && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const previous = lastEscape.current;
        const time = performance.now();
        if (previous && previous.target === props.stopTarget && time - previous.time < 500) {
          lastEscape.current = null; event.preventDefault(); props.onStop();
        } else { lastEscape.current = { time, target: props.stopTarget }; }
        return;
      }
      lastEscape.current = null;
      if (event.key !== "Enter" || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      if (!props.disabled && (props.canSubmit ?? !!props.value.trim())) props.onSubmit();
    }} style={props.compact ? compactStyle : inputStyle} /></>;
});

const inputStyle: CSSProperties = {
  display: "block", width: "100%", minWidth: 0, boxSizing: "border-box", border: 0, margin: 0,
  height: chatLayout.inputMinHeight, minHeight: chatLayout.inputMinHeight, maxHeight: chatLayout.inputMaxHeight,
  padding: "8px 8px 4px", resize: "none", background: "transparent", outline: "none",
  fontFamily: chatFont, fontSize: chatType.input.fontSize, lineHeight: `${chatType.input.lineHeight}px`,
  color: chatColors.ink, overflowWrap: "anywhere", overflowY: "hidden", scrollbarWidth: "thin",
};

const compactStyle: CSSProperties = { ...inputStyle, minHeight: 32, height: 32, maxHeight: 68, padding: "6px 7px", fontSize: 14, lineHeight: "20px" };
