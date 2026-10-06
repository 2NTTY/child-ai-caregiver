import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
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
import { AgentInputToolbar } from "./AgentInputToolbar";
import { ChatComposerInput, type ChatComposerInputHandle } from "./ChatComposerInput";
import { MotionDisclosure } from "../../motion";
import { useInteractionDensity } from "../useInteractionDensity";

const suggestions = ["整理孩子的睡前流程", "核對最近的睡眠記錄", "先列出想問的問題"];
type ControlInteraction = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

// Mount this private subtree with the current identity/child scope key.
export function AgentComposer({ enabled, compact, draft, attachments, onChangeDraft, onPreview, onSources, onAddAttachment, onRemoveAttachment, captureOriginal, focusRequest = 0 }: {
  enabled: boolean; compact: boolean; draft: string; attachments: readonly AssistantAttachment[]; onChangeDraft: (value: string) => void; onPreview: () => void;
  onSources: () => void; onAddAttachment(attachment: AssistantAttachment, replaceId?: string): boolean; onRemoveAttachment(id: string): void;
  captureOriginal?: PhotoFilePickerProps["captureOriginal"]; focusRequest?: number;
}) {
  const input = useRef<ChatComposerInputHandle>(null);
  const touchControls = useInteractionDensity() || compact;
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [inputDialog, setInputDialog] = useState<"file" | "voice" | null>(null);
  const [replacement, setReplacement] = useState<AssistantAttachment | null>(null);
  const canPreview = enabled && canPreviewAssistantDraft({ text: draft, attachments });
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [automaticCollapse, setAutomaticCollapse] = useState(0);
  const hasDraft = draft.length > 0 || attachments.length > 0;
  const showSuggestions = suggestionsExpanded && enabled && !hasDraft && !inputFocused && !keyboardVisible;
  useEffect(() => {
    if (focusRequest && enabled) {
      const frame = requestAnimationFrame(() => input.current?.focus());
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
    if (!enabled || hasDraft || keyboardVisible) setSuggestionsExpanded(false);
  }, [enabled, hasDraft, keyboardVisible]);
  useEffect(() => {
    if (!enabled) { setInputDialog(null); setReplacement(null); setPhotoError(null); }
  }, [enabled]);
  function addAttachment(attachment: AssistantAttachment) {
    if (!enabled) { attachment.dispose?.(); return; }
    if (onAddAttachment(attachment, replacement?.id)) { setInputDialog(null); setReplacement(null); setPhotoError(null); }
  }
  function replaceAttachment(attachment: AssistantAttachment) {
    setReplacement(attachment);
    if (attachment.kind !== "photo") setInputDialog(attachment.kind);
  }
  function preview() { if (canPreview) onPreview(); }
  function toggleSuggestions() {
    if (!enabled || hasDraft) return;
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
  return <View testID="chat-composer" pointerEvents="box-none" style={[styles.composer, compact && styles.mobileComposer]}>
    <View pointerEvents="box-none" style={[styles.composerContent, compact && styles.mobileComposerContent]}>
    <View testID="chat-composer-panel" style={[styles.panel, inputFocused && styles.panelFocused]}>
    <AssistantAttachmentPreview attachments={attachments} enabled={enabled} onRemove={onRemoveAttachment} onReplace={replaceAttachment} />
    {photoError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.photoError}>{photoError}</Text> : null}
    <ChatComposerInput ref={input} onSubmit={preview} canSubmit={canPreview}
      value={draft} onChangeText={onChangeDraft} onFocus={() => { setInputFocused(true); setAutomaticCollapse(value => value + 1); setSuggestionsExpanded(false); }} onBlur={() => setInputFocused(false)}
      disabled={!enabled} />
    <View style={styles.composerActions}><View style={styles.leftActions}><AgentInputToolbar disabled={!enabled} compact={touchControls} onFiles={() => { setReplacement(null); setInputDialog("file"); }} onVoice={() => { setReplacement(null); setInputDialog("voice"); }}
      onPickPhoto={original => addAttachment(photoAttachment(original))} onPhotoError={setPhotoError} captureOriginal={captureOriginal} />
      <Pressable testID="composer-suggestions-toggle" accessibilityRole="button"
        accessibilityLabel={showSuggestions ? "收起建議問題" : "展開建議問題"} accessibilityState={{ expanded: showSuggestions, disabled: !enabled || hasDraft }}
        aria-expanded={showSuggestions} disabled={!enabled || hasDraft} onPress={toggleSuggestions}
        style={({ pressed, hovered, focused }: ControlInteraction) => [styles.iconControl, touchControls && styles.compactControl, (!enabled || hasDraft) && styles.disabled, enabled && !hasDraft && (hovered || focused) && styles.controlActive, focused && enabled && !hasDraft && styles.controlFocused, pressed && enabled && !hasDraft && styles.pressed]}>
        <AppIcon name="star-four-points" size={20} color={chatColors.secondary} /></Pressable></View>
      <Pressable accessibilityRole="button" accessibilityLabel="預覽輸入" accessibilityState={{ disabled: !canPreview }}
        disabled={!canPreview} onPress={preview}
        style={({ focused }: ControlInteraction) => [styles.iconControl, touchControls && styles.compactControl, focused && canPreview && styles.controlFocused]}>
        {({ pressed, hovered }: ControlInteraction) => <View style={[styles.sendCircle, !canPreview && styles.sendDisabled, (pressed || hovered) && canPreview && styles.sendPressed]}><AppIcon name="arrow-up" size={20} color={chatColors.onSend} /></View>}
      </Pressable></View>
    <MotionDisclosure expanded={showSuggestions} scopeKey={JSON.stringify([enabled, hasDraft, automaticCollapse])} testID="composer-suggestions-disclosure"><ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} style={styles.suggestionScroll}
      contentContainerStyle={[styles.suggestions, compact && styles.mobileSuggestions]} keyboardShouldPersistTaps="handled">
      <Text style={styles.suggestionLabel}>本地示例：</Text>{suggestions.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`預填本地示例：${item}`}
        disabled={hasDraft || !enabled} onPress={() => pickSuggestion(item)}
        style={({ pressed }) => [styles.suggestion, compact && styles.mobileSuggestion, (hasDraft || !enabled) && styles.disabled, pressed && enabled && !hasDraft && styles.pressed]}>
        <Text style={styles.suggestionText}>{item}</Text></Pressable>)}
    </ScrollView></MotionDisclosure>
    </View>
    {attachments.length ? <Text style={styles.composerHint}>未送出 · 附件離頁清除；文字草稿保留</Text> : null}
    </View>
    <AssistantInputDialog kind={inputDialog} enabled={enabled} onPick={addAttachment}
      onDismiss={() => { setInputDialog(null); setReplacement(null); }}
      onUseText={() => { setInputDialog(null); setReplacement(null); requestAnimationFrame(() => input.current?.focus()); }}
      onSources={() => { setInputDialog(null); setReplacement(null); onSources(); }} />
    <Portal><AppDialog visible={replacement?.kind === "photo" && enabled} onDismiss={() => setReplacement(null)}>
      <AppDialog.Title>更換未送出照片</AppDialog.Title><AppDialog.Content>
        <PhotoFilePicker disabled={!enabled} onPick={original => addAttachment(photoAttachment(original))} onError={setPhotoError} />
      </AppDialog.Content><AppDialog.Actions><AppButton label="保留原照片" variant="quiet" onPress={() => setReplacement(null)} /></AppDialog.Actions>
    </AppDialog></Portal>
  </View>;
}

const styles = StyleSheet.create({
  composer: { flexShrink: 0, zIndex: 1, marginTop: -chatLayout.composerOverlap, backgroundColor: "transparent", paddingTop: 12, paddingBottom: 12 },
  mobileComposer: { paddingTop: 8, paddingBottom: 8 },
  composerContent: { width: "100%", maxWidth: chatLayout.maxWidth, alignSelf: "center", paddingHorizontal: chatLayout.wideInset, gap: 6 },
  mobileComposerContent: { paddingHorizontal: chatLayout.compactInset },
  panel: { minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: chatLayout.composerRadius, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: chatColors.surface,
    shadowColor: chatColors.ink, shadowOffset: { width: 0, height: 1 }, shadowOpacity: .04, shadowRadius: 10, elevation: 1 },
  panelFocused: { borderColor: chatColors.focus },
  composerHint: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, textAlign: "center" },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, leftActions: { gap: 0, flexDirection: "row", alignItems: "center", minWidth: 0 },
  iconControl: { backgroundColor: "transparent", borderWidth: 0, width: chatLayout.controlSize, height: chatLayout.controlSize, borderRadius: chatLayout.controlSize / 2, alignItems: "center", justifyContent: "center" },
  controlActive: { backgroundColor: chatColors.hover },
  controlFocused: { borderWidth: 1, borderColor: chatColors.focus },
  compactControl: { width: chatLayout.compactControlSize, height: chatLayout.compactControlSize, borderRadius: chatLayout.compactControlSize / 2 },
  sendCircle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: chatColors.send }, sendDisabled: { opacity: .35 },
  photoError: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  suggestionScroll: { flexGrow: 0 }, suggestions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  mobileSuggestions: { flexWrap: "nowrap", gap: spacing.sm }, suggestionLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  suggestion: { backgroundColor: chatColors.hover, minHeight: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: chatColors.line, borderRadius: radius.pill, justifyContent: "center" },
  mobileSuggestion: { minHeight: mobileLayout.touchTarget, flexShrink: 0 },
  suggestionText: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool }, disabled: { opacity: .5 }, pressed: { backgroundColor: colors.paleTeal }, sendPressed: { backgroundColor: colors.accentPressed },
});
