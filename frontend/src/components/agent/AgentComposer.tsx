import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import type { PhotoOriginal } from "../../photo-view-model";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing, typeScale } from "../../theme";
import { AppIcon } from "../AppIcon";
import type { PhotoFilePickerProps } from "../photos/PhotoFilePicker";
import { AppButton, AppTextField } from "../ui";
import { AgentInputToolbar } from "./AgentInputToolbar";

const suggestions = ["整理孩子的睡前流程", "核對最近的睡眠記錄", "先列出想問的問題"];

// Mount this private subtree with the current identity/child scope key.
export function AgentComposer({ enabled, compact, draft, onChangeDraft, onPreview, onPhotos, onSources, captureOriginal }: {
  enabled: boolean; compact: boolean; draft: string; onChangeDraft: (value: string) => void; onPreview: () => void;
  onPhotos: () => void; onSources: () => void; captureOriginal?: PhotoFilePickerProps["captureOriginal"];
}) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const currentPhoto = useRef<PhotoOriginal | null>(null);
  const mounted = useRef(true);
  const [photo, setPhoto] = useState<PhotoOriginal | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentPhoto.current?.dispose?.(); currentPhoto.current = null; };
  }, []);
  function pickPhoto(original: PhotoOriginal) {
    if (!mounted.current || !enabled) { original.dispose?.(); return; }
    if (currentPhoto.current !== original) currentPhoto.current?.dispose?.();
    currentPhoto.current = original; setPhoto(original); setPhotoError(null);
  }
  function removePhoto() {
    currentPhoto.current?.dispose?.(); currentPhoto.current = null; setPhoto(null); setPhotoError(null);
    requestAnimationFrame(() => input.current?.focus());
  }
  return <View testID="chat-composer" style={[styles.composer, compact && styles.mobileComposer]}>
    <View style={styles.composerTop}><Text style={styles.composerLabel}>撰寫問題</Text><Text style={styles.composerHint}>只供本地預覽；不會發送或保存</Text></View>
    {photo ? <View testID="composer-photo-preview" style={styles.photo}>
      <Image source={photo.imageSource} accessibilityLabel="照片本地預覽，未上傳或送出" style={styles.thumbnail} resizeMode="cover" />
      <View style={styles.photoCopy}><Text style={styles.photoName}>{photo.fileName}</Text>
        <Text style={styles.photoNote}>本地照片 · 未上傳／未送出</Text><Text style={styles.photoNote}>離開此頁或切換孩子時清除</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="移除本地照片" onPress={removePhoto}
        style={({ pressed }) => [styles.removePhoto, pressed && styles.pressed]}><AppIcon name="close" size={mobileIcons.content} /></Pressable>
    </View> : null}
    {photoError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.photoError}>{photoError}</Text> : null}
    <View style={styles.composerRow}><AppTextField ref={input} multiline accessibilityLabel="撰寫對話問題" placeholder="輸入你想討論的照顧問題…"
      value={draft} onChangeText={onChangeDraft} style={[styles.composerInput, compact && styles.mobileComposerInput]} disabled={!enabled} /></View>
    <View style={styles.composerActions}><AgentInputToolbar disabled={!enabled} compact={compact} onPhotos={onPhotos} onSources={onSources}
      onUseText={() => input.current?.focus()} onPickPhoto={pickPhoto} onPhotoError={setPhotoError} captureOriginal={captureOriginal} />
      <AppButton label={compact ? "預覽" : "預覽輸入"} accessibilityLabel="預覽輸入" onPress={onPreview} disabled={!enabled || !draft.trim()} /></View>
    <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} style={styles.suggestionScroll}
      contentContainerStyle={[styles.suggestions, compact && styles.mobileSuggestions]} keyboardShouldPersistTaps="handled">
      <Text style={styles.suggestionLabel}>建議提問：</Text>{suggestions.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={item}
        disabled={!!draft.trim() || !enabled} onPress={() => onChangeDraft(item)}
        style={({ pressed }) => [styles.suggestion, compact && styles.mobileSuggestion, (!!draft.trim() || !enabled) && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.suggestionText}>{item}</Text></Pressable>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  composer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm },
  mobileComposer: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: spacing.sm },
  composerTop: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.xs },
  composerLabel: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" },
  composerHint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  composerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  composerInput: { flex: 1, minWidth: 185, maxHeight: 110, backgroundColor: colors.white, fontFamily: chineseFont },
  mobileComposerInput: { minWidth: 0, fontSize: mobileType.body.fontSize },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  photo: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.quietSurface,
    borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.small },
  thumbnail: { width: 48, height: 48, borderRadius: radius.small, backgroundColor: colors.controlSurface },
  photoCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  photoName: { fontFamily: chineseFont, color: colors.ink, ...mobileType.body },
  photoNote: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption },
  photoError: { fontFamily: chineseFont, color: colors.warningInk, ...mobileType.body },
  removePhoto: { minHeight: mobileLayout.touchTarget, minWidth: mobileLayout.touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.small },
  suggestionScroll: { flexGrow: 0 }, suggestions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  mobileSuggestions: { flexWrap: "nowrap", gap: spacing.sm }, suggestionLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  suggestion: { minHeight: 34, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, justifyContent: "center" },
  mobileSuggestion: { minHeight: mobileLayout.touchTarget, flexShrink: 0 },
  suggestionText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption }, disabled: { opacity: .5 }, pressed: { opacity: .68 },
});
