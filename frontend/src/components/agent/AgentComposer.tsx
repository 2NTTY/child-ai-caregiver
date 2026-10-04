import { useEffect, useRef, useState } from "react";
import { Image, Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { Text } from "react-native-paper";
import type { PhotoOriginal } from "../../photo-view-model";
import { colors, mobileIcons, mobileLayout, radius, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import type { PhotoFilePickerProps } from "../photos/PhotoFilePicker";
import { chatColors, chatFont, chatLayout, chatType } from "../chat/chat-presentation";
import { AgentInputToolbar } from "./AgentInputToolbar";
import { ChatComposerInput, type ChatComposerInputHandle } from "./ChatComposerInput";
import { MotionDisclosure } from "../../motion";
import { useInteractionDensity } from "../useInteractionDensity";

const suggestions = ["整理孩子的睡前流程", "核對最近的睡眠記錄", "先列出想問的問題"];

// Mount this private subtree with the current identity/child scope key.
export function AgentComposer({ enabled, compact, draft, onChangeDraft, onPreview, onPhotos, onSources, captureOriginal }: {
  enabled: boolean; compact: boolean; draft: string; onChangeDraft: (value: string) => void; onPreview: () => void;
  onPhotos: () => void; onSources: () => void; captureOriginal?: PhotoFilePickerProps["captureOriginal"];
}) {
  const input = useRef<ChatComposerInputHandle>(null);
  const touchControls = useInteractionDensity() || compact;
  const currentPhoto = useRef<PhotoOriginal | null>(null);
  const mounted = useRef(true);
  const [photo, setPhoto] = useState<PhotoOriginal | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [automaticCollapse, setAutomaticCollapse] = useState(0);
  const hasDraft = draft.length > 0;
  const showSuggestions = suggestionsExpanded && enabled && !hasDraft && !inputFocused && !keyboardVisible;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentPhoto.current?.dispose?.(); currentPhoto.current = null; };
  }, []);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardDidShow", () => { setKeyboardVisible(true); setAutomaticCollapse(value => value + 1); setSuggestionsExpanded(false); });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (!enabled || hasDraft || keyboardVisible) setSuggestionsExpanded(false);
  }, [enabled, hasDraft, keyboardVisible]);
  function pickPhoto(original: PhotoOriginal) {
    if (!mounted.current || !enabled) { original.dispose?.(); return; }
    if (currentPhoto.current !== original) currentPhoto.current?.dispose?.();
    currentPhoto.current = original; setPhoto(original); setPhotoError(null);
  }
  function removePhoto() {
    currentPhoto.current?.dispose?.(); currentPhoto.current = null; setPhoto(null); setPhotoError(null);
    requestAnimationFrame(() => input.current?.focus());
  }
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
  return <View testID="chat-composer" style={[styles.composer, compact && styles.mobileComposer]}>
    <View style={[styles.composerContent, compact && styles.mobileComposerContent]}>
    <View testID="chat-composer-panel" style={[styles.panel, inputFocused && styles.panelFocused]}>
    {photo ? <View testID="composer-photo-preview" style={styles.photo}>
      <Image source={photo.imageSource} accessibilityLabel="照片本地預覽，未上傳或送出" style={styles.thumbnail} resizeMode="cover" />
      <View style={styles.photoCopy}><Text style={styles.photoName}>{photo.fileName}</Text>
        <Text style={styles.photoNote}>本地照片 · 未上傳／未送出</Text><Text style={styles.photoNote}>離開此頁或切換孩子時清除</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="移除本地照片" onPress={removePhoto}
        style={({ pressed }) => [styles.removePhoto, pressed && styles.pressed]}><AppIcon name="close" size={mobileIcons.content} /></Pressable>
    </View> : null}
    {photoError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.photoError}>{photoError}</Text> : null}
    <ChatComposerInput ref={input} onSubmit={onPreview}
      value={draft} onChangeText={onChangeDraft} onFocus={() => { setInputFocused(true); setAutomaticCollapse(value => value + 1); setSuggestionsExpanded(false); }} onBlur={() => setInputFocused(false)}
      disabled={!enabled} />
    <View style={styles.composerActions}><View style={styles.leftActions}><AgentInputToolbar disabled={!enabled} compact={touchControls} onPhotos={onPhotos} onSources={onSources}
      onUseText={() => input.current?.focus()} onPickPhoto={pickPhoto} onPhotoError={setPhotoError} captureOriginal={captureOriginal} />
      <Pressable testID="composer-suggestions-toggle" accessibilityRole="button"
        accessibilityLabel={showSuggestions ? "收起建議問題" : "展開建議問題"} accessibilityState={{ expanded: showSuggestions, disabled: !enabled || hasDraft }}
        aria-expanded={showSuggestions} disabled={!enabled || hasDraft} onPress={toggleSuggestions}
        style={({ pressed }) => [styles.iconControl, touchControls && styles.compactControl, (!enabled || hasDraft) && styles.disabled, pressed && styles.pressed]}>
        <AppIcon name="star-four-points" size={20} color={chatColors.secondary} /></Pressable></View>
      <Pressable accessibilityRole="button" accessibilityLabel="預覽輸入" accessibilityState={{ disabled: !enabled || !draft.trim() }}
        disabled={!enabled || !draft.trim()} onPress={onPreview}
        style={({ pressed }) => [styles.iconControl, touchControls && styles.compactControl, pressed && styles.pressed]}>
        <View style={[styles.sendCircle, (!enabled || !draft.trim()) && styles.sendDisabled]}><AppIcon name="arrow-up" size={20} color={chatColors.canvas} /></View>
      </Pressable></View>
    <MotionDisclosure expanded={showSuggestions} scopeKey={JSON.stringify([enabled, hasDraft, automaticCollapse])} testID="composer-suggestions-disclosure"><ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} style={styles.suggestionScroll}
      contentContainerStyle={[styles.suggestions, compact && styles.mobileSuggestions]} keyboardShouldPersistTaps="handled">
      <Text style={styles.suggestionLabel}>本地示例：</Text>{suggestions.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`預填本地示例：${item}`}
        disabled={hasDraft || !enabled} onPress={() => pickSuggestion(item)}
        style={({ pressed }) => [styles.suggestion, compact && styles.mobileSuggestion, (hasDraft || !enabled) && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.suggestionText}>{item}</Text></Pressable>)}
    </ScrollView></MotionDisclosure>
    </View>
    <Text style={styles.composerHint}>只供本地預覽；不會發送或保存</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  composer: { backgroundColor: chatColors.canvas, paddingTop: 8, paddingBottom: 12 },
  mobileComposer: { paddingBottom: 8 },
  composerContent: { width: "100%", maxWidth: chatLayout.maxWidth, alignSelf: "center", paddingHorizontal: chatLayout.wideInset, gap: 6 },
  mobileComposerContent: { paddingHorizontal: chatLayout.compactInset },
  panel: { minWidth: 0, borderWidth: 1, borderColor: chatColors.line, borderRadius: chatLayout.composerRadius, padding: 8, backgroundColor: chatColors.canvas },
  panelFocused: { borderColor: chatColors.focus },
  composerHint: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, textAlign: "center" },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, leftActions: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  iconControl: { width: chatLayout.controlSize, height: chatLayout.controlSize, borderRadius: chatLayout.controlSize / 2, alignItems: "center", justifyContent: "center" },
  compactControl: { width: chatLayout.compactControlSize, height: chatLayout.compactControlSize, borderRadius: chatLayout.compactControlSize / 2 },
  sendCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: chatColors.send }, sendDisabled: { opacity: .35 },
  photo: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.quietSurface,
    borderWidth: 1, borderColor: chatColors.line, borderRadius: radius.small },
  thumbnail: { width: 48, height: 48, borderRadius: radius.small, backgroundColor: colors.controlSurface },
  photoCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  photoName: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, flexShrink: 1 },
  photoNote: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  photoError: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  removePhoto: { minHeight: mobileLayout.touchTarget, minWidth: mobileLayout.touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.small },
  suggestionScroll: { flexGrow: 0 }, suggestions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  mobileSuggestions: { flexWrap: "nowrap", gap: spacing.sm }, suggestionLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  suggestion: { minHeight: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: chatColors.line, borderRadius: radius.pill, justifyContent: "center" },
  mobileSuggestion: { minHeight: mobileLayout.touchTarget, flexShrink: 0 },
  suggestionText: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool }, disabled: { opacity: .5 }, pressed: { opacity: .68 },
});
