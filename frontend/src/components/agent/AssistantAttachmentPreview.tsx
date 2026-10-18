import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
import { colors, mobileLayout, radius, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { AppScrollView } from "../AppScrollView";
import { chatFont, chatType } from "../chat/chat-presentation";
import { LocalAudioPreview } from "./LocalAudioPreview";

const labels = { photo: "照片", file: "文件", voice: "音訊" };
export function AssistantAttachmentPreview({ attachments, enabled, onRemove, onReplace }: {
  attachments: readonly AssistantAttachment[]; enabled: boolean; onRemove(id: string): void; onReplace(item: AssistantAttachment): void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = attachments.find(item => item.id === selectedId);
  if (!attachments.length) return null;
  return <><AppScrollView horizontal testID="assistant-attachments" contentContainerStyle={styles.list} showsHorizontalScrollIndicator={false}>
    {attachments.map(item => <View key={item.id} testID={`assistant-attachment-${item.kind}`} style={styles.item}>
      <Pressable accessibilityRole="button" accessibilityLabel={`預覽未送出${labels[item.kind]}：${item.fileName}`} onPress={() => setSelectedId(item.id)} style={styles.preview}>
        {item.photo ? <Image source={item.photo.imageSource} accessibilityLabel="本地照片，未上傳" style={styles.thumbnail} /> : <View style={styles.thumbnail}><AppIcon name={item.kind === "voice" ? "microphone-outline" : "file-document-outline"} size={24} /></View>}
        <View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.fileName}</Text><Text style={styles.meta}>{labels[item.kind]} · {item.kind === "file" ? "不支援預覽 · " : ""}未送出 · {Math.max(1, Math.round(item.bytes / 1024))} KB</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`移除附件：${item.fileName}`} disabled={!enabled} onPress={() => onRemove(item.id)} accessibilityState={{disabled: !enabled}} aria-disabled={!enabled} style={[styles.remove, !enabled && styles.disabled]}><AppIcon name="close" size={18} color={colors.errorInk} /></Pressable>
    </View>)}
  </AppScrollView><Portal><AppDialog visible={!!selected && enabled} onDismiss={() => setSelectedId(null)} testID="assistant-attachment-preview">
    <AppDialog.Title>未送出附件</AppDialog.Title><AppDialog.Content><View style={styles.detail}>
      {selected?.photo ? <Image source={selected.photo.imageSource} accessibilityLabel="未上傳照片的本地預覽" resizeMode="contain" style={styles.fullPhoto} /> : null}
      {selected?.kind === "voice" && selected.localUri ? <LocalAudioPreview uri={selected.localUri} /> : null}
      <Text style={styles.name}>{selected?.fileName}</Text><Text style={styles.meta}>{selected?.mimeType} · {selected ? Math.max(1, Math.round(selected.bytes / 1024)) : 0} KB</Text>
      <Text style={styles.meta}>{selected?.kind === "file" ? "不支援預覽。" : "本地預覽，未上傳、辨識或轉錄。"}</Text>
    </View></AppDialog.Content><AppDialog.Actions>
      <AppButton label="更換附件" variant="secondary" onPress={() => { if (selected) onReplace(selected); setSelectedId(null); }} />
      <AppButton label="移除" variant="quiet" onPress={() => { if (selected) onRemove(selected.id); setSelectedId(null); }} />
      <AppButton label="返回草稿" variant="quiet" onPress={() => setSelectedId(null)} />
    </AppDialog.Actions>
  </AppDialog></Portal></>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.sm, paddingBottom: spacing.sm }, item: { width: 252, flexDirection: "row", alignItems: "center", backgroundColor: colors.quietSurface, borderRadius: radius.small, borderWidth: 1, borderColor: colors.softLine },
  preview: { flex: 1, minWidth: 0, minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm },
  thumbnail: { width: 40, height: 40, borderRadius: radius.small, alignItems: "center", justifyContent: "center", backgroundColor: colors.controlSurface },
  copy: { flex: 1, minWidth: 0 }, name: { fontFamily: chatFont, color: colors.ink, ...chatType.tool }, meta: { fontFamily: chatFont, color: colors.muted, ...chatType.meta },
  remove: { backgroundColor: colors.paleCoral, borderLeftWidth: 1, borderLeftColor: colors.errorInk, borderTopRightRadius: radius.small, borderBottomRightRadius: radius.small, width: mobileLayout.touchTarget, minHeight: mobileLayout.touchTarget, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.5 }, detail: { gap: spacing.sm }, fullPhoto: { width: "100%", height: 220, backgroundColor: colors.quietSurface },
});
