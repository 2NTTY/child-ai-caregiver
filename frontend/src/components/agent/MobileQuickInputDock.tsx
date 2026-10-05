import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { usePathname } from "expo-router";
import { usePreview } from "../../preview/PreviewContext";
import { chineseFont, colors, mobileLayout, radius, spacing } from "../../theme";
import { AppIcon, type AppIconName } from "../AppIcon";
import { PhotoFilePicker } from "../photos/PhotoFilePicker";
import { DirectionalPressable } from "../navigation/DirectionalPressable";
import { quickInputDirection, type QuickInputKind } from "../navigation/quick-input-gesture";
import { AssistantInputDialog } from "./AssistantInputDialog";

const choices: { key: QuickInputKind; label: string; icon: AppIconName }[] = [
  { key: "file", label: "文件", icon: "file-document-outline" },
  { key: "voice", label: "語音", icon: "microphone-outline" },
  { key: "text", label: "記一句", icon: "pencil-outline" },
];

// A reserved shell row above navigation, so resting controls never cover the home content.
export function MobileQuickInputDock() {
  const pathname = usePathname();
  const { actions, agentDraftScope, addAgentAttachment, openAgentDraft, agentAttachments, chatDraft } = usePreview();
  const enabled = !!agentDraftScope && pathname === "/";
  const [expanded, setExpanded] = useState(false), [selected, setSelected] = useState<QuickInputKind | null>(null);
  const [dialog, setDialog] = useState<"file" | "voice" | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { setExpanded(false); setSelected(null); setDialog(null); setError(null); }, [agentDraftScope, pathname]);
  function cancelGesture() { setExpanded(false); setSelected(null); }
  function choose(kind: QuickInputKind) {
    cancelGesture(); setError(null);
    if (!enabled) return;
    if (kind === "text") openAgentDraft(true); else setDialog(kind);
  }
  const pending = agentAttachments.length > 0 || !!chatDraft.trim();
  return <View testID="mobile-quick-input-dock" style={styles.dock}>
    {expanded && enabled ? <View testID="quick-input-directions" pointerEvents="box-none" style={styles.menu}>
      {choices.map(item => <Pressable key={item.key} testID={`quick-input-${item.key}`} accessibilityRole="button" accessibilityLabel={`快捷${item.label}`}
        accessibilityState={{ selected: selected === item.key }} onPress={() => choose(item.key)} style={[styles.choice, styles[item.key], selected === item.key && styles.selected]}>
        <AppIcon name={item.icon} size={20} /><Text style={styles.choiceLabel}>{item.label}</Text>
      </Pressable>)}
    </View> : null}
    <PhotoFilePicker disabled={!enabled} capturePreferred onPick={actions.openAgentPhoto} onError={setError}
      renderTrigger={trigger => <DirectionalPressable testID="mobile-quick-camera" label="拍照；拖向上方文件、右上語音或右方文字"
        hint="放手只開啟輸入，不會送出；也可點按其他輸入" disabled={!enabled || trigger.reading}
        scopeKey={`${agentDraftScope}:${pathname}`} style={[styles.camera, !enabled && styles.disabled]}
        onPress={() => { cancelGesture(); if (trigger.disabled) setError(trigger.unavailableReason ?? "相機目前不可用"); else trigger.onPress(); }}
        onExpand={() => setExpanded(value => !value)} onGestureStart={() => { setExpanded(true); setSelected(null); }}
        onGestureMove={(dx, dy) => setSelected(quickInputDirection(dx, dy))} onGestureCancel={cancelGesture}
        onGestureEnd={(dx, dy, dragged) => { cancelGesture(); if (dragged) { const kind = quickInputDirection(dx, dy); if (kind) choose(kind); } }}>
        <AppIcon name="camera-outline" size={26} color={colors.ink} />
      </DirectionalPressable>} />
    {!expanded ? <View style={styles.copy}><Text style={styles.title}>{error ?? (pending ? "有未送出草稿" : "臨時記下，再交助手整理")}</Text>
      <Text style={styles.note}>{enabled ? "點按拍照 · 拖曳選其他輸入" : "請先選擇孩子"}</Text></View> : null}
    <Pressable testID="quick-input-expand" accessibilityRole="button" accessibilityLabel={expanded ? "收起其他輸入" : "其他輸入"}
      accessibilityState={{ expanded, disabled: !enabled }} aria-expanded={expanded} disabled={!enabled}
      onPress={() => { setSelected(null); setExpanded(value => !value); }} style={styles.expand}>
      <AppIcon name={expanded ? "close" : "chevron-up"} size={20} /><Text style={styles.note}>{expanded ? "取消" : "其他輸入"}</Text>
    </Pressable>
    <AssistantInputDialog kind={dialog} enabled={enabled} onDismiss={() => setDialog(null)} onUseText={() => { setDialog(null); openAgentDraft(true); }}
      onPick={attachment => { if (addAgentAttachment(attachment)) { setDialog(null); openAgentDraft(); } }} />
  </View>;
}
const styles = StyleSheet.create({
  dock: { height: 84, flexShrink: 0, zIndex: 4, backgroundColor: colors.canvas, borderTopWidth: 1, borderTopColor: colors.softLine,
    flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.sm, overflow: "visible" },
  camera: { width: 56, height: 56, flexShrink: 0, borderRadius: 28, backgroundColor: colors.accent, borderColor: colors.ink, borderWidth: 1,
    alignItems: "center", justifyContent: "center", shadowColor: colors.ink, shadowOpacity: .1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  copy: { flex: 1, minWidth: 0, gap: 2 }, title: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, fontWeight: "700", color: colors.ink },
  note: { fontFamily: chineseFont, fontSize: 10, lineHeight: 14, color: colors.muted },
  expand: { marginLeft: "auto", minWidth: mobileLayout.touchTarget, minHeight: mobileLayout.touchTarget, alignItems: "center", justifyContent: "center", gap: 2 },
  menu: { position: "absolute", left: 0, bottom: 0, width: 240, height: 210 },
  choice: { position: "absolute", minHeight: 56, width: 72, borderRadius: radius.medium, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.controlOutline,
    alignItems: "center", justifyContent: "center", gap: 3, shadowColor: colors.ink, shadowOpacity: .1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  file: { left: 8, bottom: 116 }, voice: { left: 86, bottom: 90 }, text: { left: 124, bottom: 13 },
  selected: { borderColor: colors.teal, borderWidth: 2, backgroundColor: colors.paleTeal },
  choiceLabel: { fontFamily: chineseFont, color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "700" }, disabled: { opacity: .4 },
});
