import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type PressableStateCallbackType } from "react-native";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { Portal, Text } from "react-native-paper";
import { canPreviewAssistantDraft, photoAttachment, type AssistantAttachment } from "../../assistant-draft";
import { colors, mobileLayout, radius, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import { PhotoFilePicker, type PhotoFilePickerProps } from "../photos/PhotoFilePicker";
import { chatColors, chatFont, chatLayout, chatType } from "../chat/chat-presentation";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { AssistantAttachmentPreview } from "./AssistantAttachmentPreview";
import { AssistantInputDialog } from "./AssistantInputDialog";
import { AgentVoiceControl, InputControl } from "./AgentInputToolbar";
import { ChatComposerInput, type ChatComposerInputHandle } from "./ChatComposerInput";
import { MotionDisclosure } from "../../motion";
import { useInteractionDensity } from "../useInteractionDensity";
import { VoiceCapture } from "./VoiceCapture";
import type { VoiceCaptureHandle } from "./VoiceRecordingTimer";

const suggestions = ["整理孩子的睡前流程", "核對最近的睡眠記錄", "先列出想問的問題"];
type ControlInteraction = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
type SendFocusTicket = { serial: number; document: Document; dispose(): void };

// Mount this private subtree with the current identity/child scope key.
export function AgentComposer({ embedded = false, centered = false, enabled, allowTyping = false, onStop, stopDisabled = false, stopTarget, queueAction, discussionControl, compact, draft, attachments, onChangeDraft, onPreview, onAddAttachment, onRemoveAttachment, captureOriginal, focusRequest = 0, submitEnabled, submitLabel = "預覽輸入", filesUnavailableReason, voiceUnavailableReason, suggestionLabel = "本地示例", suggestionsAvailable = true }: {
  centered?: boolean; embedded?: boolean; discussionControl?: ReactNode;
  queueAction?: { queued: boolean; press(): void };
  allowTyping?: boolean; onStop?(): void; stopDisabled?: boolean; stopTarget?: string;
  enabled: boolean; compact: boolean; draft: string; attachments: readonly AssistantAttachment[]; onChangeDraft: (value: string) => void; onPreview: () => void | Promise<void>;
  onAddAttachment(attachment: AssistantAttachment, replaceId?: string): boolean; onRemoveAttachment(id: string): void;
  captureOriginal?: PhotoFilePickerProps["captureOriginal"]; focusRequest?: number;
  submitEnabled?: boolean; submitLabel?: string; filesUnavailableReason?: string; voiceUnavailableReason?: string; suggestionLabel?: string; suggestionsAvailable?: boolean;
}) {
  const input = useRef<ChatComposerInputHandle>(null);
  const composer = useRef<View>(null), sendControl = useRef<View>(null);
  const handledFocusRequest = useRef(0);
  const sendFocus = useRef<SendFocusTicket | null>(null), sendSerial = useRef(0);
  const [completedSend, setCompletedSend] = useState(0);
  const touchControls = useInteractionDensity() || compact;
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [inputDialog, setInputDialog] = useState<"file" | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceCapture = useRef<VoiceCaptureHandle>(null);
  const [replacement, setReplacement] = useState<AssistantAttachment | null>(null);
  const canPreview = enabled && !voiceOpen && (submitEnabled ?? canPreviewAssistantDraft({ text: draft, attachments }));
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [automaticCollapse, setAutomaticCollapse] = useState(0);
  const hasDraft = draft.length > 0 || attachments.length > 0;
  const showSuggestions = suggestionsAvailable && suggestionsExpanded && enabled && !hasDraft && !inputFocused && !keyboardVisible;
  function cancelSendFocus(ticket = sendFocus.current) {
    if (!ticket || ticket !== sendFocus.current) return;
    sendFocus.current = null; ticket.dispose();
  }
  useEffect(() => () => cancelSendFocus(), []);
  useEffect(() => { cancelSendFocus(); }, [focusRequest]);
  useEffect(() => {
    const ticket = sendFocus.current;
    if (!ticket || completedSend !== ticket.serial) return;
    const doc = ticket.document;
    const mayReturn = enabled && !doc.hidden && (doc.activeElement === doc.body || doc.activeElement === doc.documentElement);
    // A completed send gets one opportunity, never a deferred retry after unknown/recovery.
    cancelSendFocus(ticket);
    if (mayReturn) input.current?.focus({ preventScroll: true });
  }, [completedSend, enabled, focusRequest]);
  useEffect(() => {
    if (focusRequest && enabled && focusRequest !== handledFocusRequest.current) {
      const frame = requestAnimationFrame(() => { handledFocusRequest.current = focusRequest; input.current?.focus(); });
      return () => cancelAnimationFrame(frame);
    }
  }, [focusRequest, enabled]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardDidShow", () => { setKeyboardVisible(true); setAutomaticCollapse(value => value + 1); setSuggestionsExpanded(false); });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (!enabled || !suggestionsAvailable || hasDraft || keyboardVisible) setSuggestionsExpanded(false);
  }, [enabled, suggestionsAvailable, hasDraft, keyboardVisible]);
  useEffect(() => {
    if (!enabled) { setInputDialog(null); setVoiceOpen(false); setReplacement(null); setPhotoError(null); }
  }, [enabled]);
  function addAttachment(attachment: AssistantAttachment) {
    if (!enabled) { attachment.dispose?.(); return; }
    if (onAddAttachment(attachment, replacement?.id)) { setInputDialog(null); setReplacement(null); setPhotoError(null); }
  }
  function replaceAttachment(attachment: AssistantAttachment) {
    setReplacement(attachment);
    if (attachment.kind === "voice") beginVoice(attachment);
    else if (attachment.kind === "file") setInputDialog("file");
  }
  function beginVoice(replace: AssistantAttachment | null = null) {
    if (!enabled || voiceUnavailableReason || voiceOpen) return;
    setReplacement(replace); setInputDialog(null); setVoiceOpen(true); voiceCapture.current?.start();
  }
  function beginSendFocus() {
    cancelSendFocus();
    if (Platform.OS !== "web" || typeof document === "undefined" || document.hidden) return null;
    const host = composer.current as unknown as HTMLElement | null, origin = document.activeElement;
    if (!origin || !host?.contains(origin) || origin.tagName !== "TEXTAREA" && origin !== (sendControl.current as unknown as HTMLElement)) return null;
    const doc = origin.ownerDocument, win = doc.defaultView;
    const ticket: SendFocusTicket = { serial: ++sendSerial.current, document: doc, dispose: () => {} };
    const cancel = () => cancelSendFocus(ticket);
    const focus = () => { if (doc.activeElement !== origin && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement) cancel(); };
    const visibility = () => { if (doc.hidden) cancel(); };
    // These are deliberate reading/navigation intents. Programmatic scrolling is not one.
    for (const event of ["pointerdown", "wheel", "touchmove", "keydown"] as const) doc.addEventListener(event, cancel, { capture: true, passive: true });
    doc.addEventListener("focusin", focus, true); doc.addEventListener("visibilitychange", visibility);
    win?.addEventListener("blur", cancel);
    ticket.dispose = () => {
      for (const event of ["pointerdown", "wheel", "touchmove", "keydown"] as const) doc.removeEventListener(event, cancel, true);
      doc.removeEventListener("focusin", focus, true); doc.removeEventListener("visibilitychange", visibility);
      win?.removeEventListener("blur", cancel);
    };
    sendFocus.current = ticket;
    return ticket;
  }
  function preview(keyboard = false) {
    if (!canPreview) return;
    const ticket = keyboard ? beginSendFocus() : (cancelSendFocus(), null);
    let result: void | Promise<void>;
    try { result = onPreview(); } catch (error) { cancelSendFocus(ticket); throw error; }
    if (ticket) void Promise.resolve(result).then(() => {
      if (sendFocus.current === ticket) setCompletedSend(ticket.serial);
    }, () => cancelSendFocus(ticket));
  }
  function pressSend(event: GestureResponderEvent) {
    const native = event.nativeEvent as unknown as { key?: string; type?: string; detail?: number };
    preview(Platform.OS === "web" && (native.key === "Enter" || native.key === " " || native.type === "click" && native.detail === 0));
  }
  function toggleSuggestions() {
    if (!enabled || !suggestionsAvailable || hasDraft) return;
    const nextExpanded = !showSuggestions;
    if (nextExpanded) {
      input.current?.blur();
      if (Platform.OS !== "web") Keyboard.dismiss();
    }
    setSuggestionsExpanded(nextExpanded);
  }
  function pickSuggestion(value: string) {
    if (!enabled || hasDraft) return;
    onChangeDraft(value);
    setSuggestionsExpanded(false);
    requestAnimationFrame(() => input.current?.focus());
  }
  return <View ref={composer} testID="chat-composer" pointerEvents="box-none" style={[styles.composer, compact && styles.mobileComposer, centered && styles.centered, embedded && styles.embedded]}>
    <View pointerEvents="box-none" style={[styles.composerContent, compact && styles.mobileComposerContent, embedded && styles.embeddedContent]}>
    <View testID="chat-composer-panel" style={[styles.panel, inputFocused && styles.panelFocused]}>
    <AssistantAttachmentPreview attachments={attachments} enabled={enabled && !voiceOpen} onRemove={onRemoveAttachment} onReplace={replaceAttachment} />
    {enabled ? <VoiceCapture ref={voiceCapture} visible={voiceOpen} onDismiss={() => { setVoiceOpen(false); setReplacement(null); }} onPick={addAttachment} /> : null}
    {photoError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.photoError}>{photoError}</Text> : null}
    <ChatComposerInput autoFocus={embedded} onAttachment={enabled && !voiceOpen && !filesUnavailableReason ? addAttachment : undefined} onAttachmentError={setPhotoError} onStop={stopDisabled ? undefined : onStop} stopTarget={stopTarget} ref={input} onSubmit={() => queueAction ? (!queueAction.queued && queueAction.press()) : preview(true)} canSubmit={canPreview || !!queueAction && !queueAction.queued}
      value={draft} onChangeText={onChangeDraft} onFocus={() => { setInputFocused(true); setAutomaticCollapse(value => value + 1); setSuggestionsExpanded(false); }} onBlur={() => setInputFocused(false)}
      disabled={!enabled && !allowTyping} />
    <View style={styles.composerActions}><View testID="composer-attachment-actions" style={styles.leftActions}><InputControl label="加入附件" icon="plus" disabled={!enabled || voiceOpen || !!filesUnavailableReason} hint={filesUnavailableReason}
      compact={touchControls} onPress={() => { setReplacement(null); setInputDialog("file"); }} />
      {suggestionsAvailable && !hasDraft ? <Pressable testID="composer-suggestions-toggle" accessibilityRole="button"
        accessibilityLabel={showSuggestions ? "收起建議問題" : "展開建議問題"} accessibilityState={{ expanded: showSuggestions, disabled: !enabled || hasDraft }}
        aria-expanded={showSuggestions} disabled={!enabled || hasDraft} onPress={toggleSuggestions}
        style={({ pressed, hovered, focused }: ControlInteraction) => [styles.iconControl, touchControls && styles.compactControl, (!enabled || hasDraft) && styles.disabled, enabled && !hasDraft && (hovered || focused) && styles.controlActive, focused && enabled && !hasDraft && styles.controlFocused, pressed && enabled && !hasDraft && styles.pressed]}>
        <AppIcon name="star-four-points" size={20} color={chatColors.secondary} /></Pressable> : null}{discussionControl}</View>
      <View testID="composer-send-actions" style={styles.rightActions}>
      {queueAction?.queued ? <Text accessibilityLiveRegion="polite" style={styles.queuedLabel}>待傳送</Text> : null}
      {!onStop ? <AgentVoiceControl disabled={!enabled || voiceOpen} compact={touchControls} unavailableReason={voiceUnavailableReason}
        onPress={() => beginVoice()} /> : null}
      {onStop ? <Pressable accessibilityRole="button" accessibilityLabel={stopDisabled ? "停止回覆（暫不可用）" : "停止回覆"}
        accessibilityState={{ disabled: stopDisabled }} disabled={stopDisabled} onPress={onStop}
        style={({ focused }: ControlInteraction) => [styles.iconControl, touchControls && styles.compactControl, focused && styles.controlFocused]}>
        <View style={[styles.stopCircle, stopDisabled && styles.disabled]}><View style={styles.stopSquare} /></View>
      </Pressable> : null}
      {queueAction ? <Pressable accessibilityRole="button" accessibilityLabel={queueAction.queued ? "取消待傳送訊息" : "回覆完成後傳送"} onPress={queueAction.press}
        style={({ focused }: ControlInteraction) => [styles.iconControl, touchControls && styles.compactControl, focused && styles.controlFocused]}>
        <View style={styles.sendCircle}><AppIcon name={queueAction.queued ? "close" : "arrow-up"} size={20} color={chatColors.onSend} /></View>
      </Pressable> : !onStop ? <Pressable ref={sendControl} accessibilityRole="button" accessibilityLabel={submitLabel} accessibilityState={{ disabled: !canPreview }}
        disabled={!canPreview} onPress={pressSend}
        style={({ focused }: ControlInteraction) => [styles.iconControl, touchControls && styles.compactControl, focused && canPreview && styles.controlFocused]}>
        {({ pressed, hovered }: ControlInteraction) => <View style={[styles.sendCircle, !canPreview && styles.sendDisabled, (pressed || hovered) && canPreview && styles.sendPressed]}><AppIcon name="arrow-up" size={20} color={chatColors.onSend} /></View>}
      </Pressable> : null}</View></View>
    <MotionDisclosure expanded={showSuggestions} scopeKey={JSON.stringify([enabled, hasDraft, automaticCollapse])} testID="composer-suggestions-disclosure"><ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} style={styles.suggestionScroll}
      contentContainerStyle={[styles.suggestions, compact && styles.mobileSuggestions]} keyboardShouldPersistTaps="handled">
      <Text style={styles.suggestionLabel}>{suggestionLabel}：</Text>{suggestions.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`預填${suggestionLabel}：${item}`}
        disabled={hasDraft || !enabled} onPress={() => pickSuggestion(item)}
        style={({ pressed }) => [styles.suggestion, compact && styles.mobileSuggestion, (hasDraft || !enabled) && styles.disabled, pressed && enabled && !hasDraft && styles.pressed]}>
        <Text style={styles.suggestionText}>{item}</Text></Pressable>)}
    </ScrollView></MotionDisclosure>
    </View>
    </View>
    <AssistantInputDialog captureOriginal={captureOriginal} kind={inputDialog} enabled={enabled} onPick={addAttachment}
      onDismiss={() => { setInputDialog(null); setReplacement(null); }} />
    <Portal><AppDialog visible={replacement?.kind === "photo" && enabled} onDismiss={() => setReplacement(null)}>
      <AppDialog.Title>更換未送出照片</AppDialog.Title><AppDialog.Content>
        <PhotoFilePicker disabled={!enabled} onPick={original => addAttachment(photoAttachment(original))} onError={setPhotoError} />
      </AppDialog.Content><AppDialog.Actions><AppButton label="保留原照片" variant="quiet" onPress={() => setReplacement(null)} /></AppDialog.Actions>
    </AppDialog></Portal>
  </View>;
}

const styles = StyleSheet.create({
  composer: { flexShrink: 0, zIndex: 1, marginTop: -chatLayout.composerOverlap, backgroundColor: "transparent", paddingTop: 12, paddingBottom: 12 },
  centered: { marginTop: 0 },
  embedded: { marginTop: 0, paddingVertical: 0 }, embeddedContent: { paddingHorizontal: 0 },
  mobileComposer: { paddingTop: 8, paddingBottom: 8 },
  composerContent: { width: "100%", maxWidth: chatLayout.maxWidth, alignSelf: "center", paddingHorizontal: chatLayout.wideInset, gap: 6 },
  mobileComposerContent: { paddingHorizontal: chatLayout.compactInset },
  panel: { minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: chatLayout.composerRadius, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: chatColors.surface,
    shadowColor: chatColors.ink, shadowOffset: { width: 0, height: 1 }, shadowOpacity: .04, shadowRadius: 10, elevation: 1 },
  panelFocused: { borderColor: chatColors.focus },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, leftActions: { gap: 0, flexDirection: "row", alignItems: "center", minWidth: 0 },
  rightActions: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  iconControl: { backgroundColor: "transparent", borderWidth: 0, width: chatLayout.controlSize, height: chatLayout.controlSize, borderRadius: chatLayout.controlSize / 2, alignItems: "center", justifyContent: "center" },
  controlActive: { backgroundColor: chatColors.hover },
  controlFocused: { borderWidth: 1, borderColor: chatColors.focus },
  compactControl: { width: chatLayout.compactControlSize, height: chatLayout.compactControlSize, borderRadius: chatLayout.compactControlSize / 2 },
  queuedLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  stopCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: chatColors.ink, alignItems: "center", justifyContent: "center" },
  stopSquare: { width: 13, height: 13, borderRadius: 2, backgroundColor: chatColors.surface },
  sendCircle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: chatColors.send }, sendDisabled: { opacity: .35 },
  photoError: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  suggestionScroll: { flexGrow: 0 }, suggestions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  mobileSuggestions: { flexWrap: "nowrap", gap: spacing.sm }, suggestionLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  suggestion: { backgroundColor: "transparent", minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, justifyContent: "center" },
  mobileSuggestion: { minHeight: mobileLayout.touchTarget, flexShrink: 0 },
  suggestionText: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool }, disabled: { opacity: .5 }, pressed: { backgroundColor: colors.paleTeal }, sendPressed: { backgroundColor: colors.accentPressed },
});
