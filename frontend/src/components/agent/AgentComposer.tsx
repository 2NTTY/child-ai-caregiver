import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
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
        style={({ pressed }) => [styles.iconControl, touchControls && styles.compactControl, (!enabled || hasDraft) && styles.disabled, pressed && styles.pressed]}>
        <AppIcon name="star-four-points" size={20} color={chatColors.secondary} /></Pressable></View>
      <Pressable accessibilityRole="button" accessibilityLabel="預覽輸入" accessibilityState={{ disabled: !canPreview }}
        disabled={!canPreview} onPress={preview}
        style={({ pressed }) => [styles.iconControl, touchControls && styles.compactControl, pressed && styles.pressed]}>
        <View style={[styles.sendCircle, !canPreview && styles.sendDisabled]}><AppIcon name="arrow-up" size={20} color={chatColors.onSend} /></View>
      </Pressable></View>
    <MotionDisclosure expanded={showSuggestions} scopeKey={JSON.stringify([enabled, hasDraft, automaticCollapse])} testID="composer-suggestions-disclosure"><ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} style={styles.suggestionScroll}
      contentContainerStyle={[styles.suggestions, compact && styles.mobileSuggestions]} keyboardShouldPersistTaps="handled">
      <Text style={styles.suggestionLabel}>本地示例：</Text>{suggestions.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`預填本地示例：${item}`}
        disabled={hasDraft || !enabled} onPress={() => pickSuggestion(item)}
        style={({ pressed }) => [styles.suggestion, compact && styles.mobileSuggestion, (hasDraft || !enabled) && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.suggestionText}>{item}</Text></Pressable>)}
    </ScrollView></MotionDisclosure>
    </View>
    <Text style={styles.composerHint}>{attachments.length ? "未送出 · 附件離頁清除；文字草稿保留" : "先補文字或附件 · 只作本地預覽"}</Text>
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
  panel: { minWidth: 0, borderWidth: 1, borderColor: chatColors.outline, borderRadius: chatLayout.composerRadius, padding: 8, backgroundColor: chatColors.surface,
    shadowColor: chatColors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: .06, shadowRadius: 12, elevation: 2 },
  panelFocused: { borderColor: chatColors.focus },
  composerHint: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, textAlign: "center" },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, leftActions: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  iconControl: { width: chatLayout.controlSize, height: chatLayout.controlSize, borderRadius: chatLayout.controlSize / 2, alignItems: "center", justifyContent: "center" },
  compactControl: { width: chatLayout.compactControlSize, height: chatLayout.compactControlSize, borderRadius: chatLayout.compactControlSize / 2 },
  sendCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: chatColors.send, borderWidth: 1, borderColor: chatColors.onSend }, sendDisabled: { opacity: .35 },
  photoError: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  suggestionScroll: { flexGrow: 0 }, suggestions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  mobileSuggestions: { flexWrap: "nowrap", gap: spacing.sm }, suggestionLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  suggestion: { minHeight: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: chatColors.line, borderRadius: radius.pill, justifyContent: "center" },
  mobileSuggestion: { minHeight: mobileLayout.touchTarget, flexShrink: 0 },
  suggestionText: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool }, disabled: { opacity: .5 }, pressed: { opacity: .68 },
});
