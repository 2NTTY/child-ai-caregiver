import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { usePathname } from "expo-router";
import { usePreview } from "../../preview/PreviewContext";
import { MotionEntrance } from "../../motion";
import { chineseFont, colors, radius, spacing } from "../../theme";
import { AppIcon, type AppIconName } from "../AppIcon";
import { PhotoFilePicker } from "../photos/PhotoFilePicker";
import { DirectionalPressable } from "../navigation/DirectionalPressable";
import { quickInputDirection, type QuickInputKind } from "../navigation/quick-input-gesture";
import { AssistantInputDialog } from "./AssistantInputDialog";
import { CornerCaptureSurface } from "./CornerCaptureSurface";

const choices: { key: QuickInputKind; label: string; icon: AppIconName }[] = [
  { key: "file", label: "文件", icon: "file-document-outline" },
  { key: "voice", label: "語音", icon: "microphone-outline" },
  { key: "text", label: "記一句", icon: "pencil-outline" },
];

// The host ends above navigation. Only the button and open choices accept input.
export function MobileQuickInputDock({ supportedKinds = ["file", "voice", "text"] }: { supportedKinds?: readonly QuickInputKind[] }) {
  const pathname = usePathname();
  const { actions, agentDraftScope, addAgentAttachment, openAgentDraft, agentAttachments, chatDraft } = usePreview();
  const enabled = !!agentDraftScope && pathname === "/";
  const scopeKey = `${agentDraftScope}:${pathname}`;
  const host = useRef<View>(null);
  const [expanded, setExpanded] = useState(false), [selected, setSelected] = useState<QuickInputKind | null>(null);
  const [dialog, setDialog] = useState<"file" | "voice" | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { setExpanded(false); setSelected(null); setDialog(null); setError(null); }, [agentDraftScope, pathname]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (Platform.OS !== "web" || !expanded) return;
    const element = host.current as unknown as HTMLElement | null;
    if (!element) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); cancelGesture();
      element.querySelector<HTMLElement>('[data-testid="mobile-quick-camera"]')?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) cancelGesture(); };
    const focusOut = (event: FocusEvent) => { if (event.relatedTarget && !element.contains(event.relatedTarget as Node)) cancelGesture(); };
    const hidden = () => { if (document.hidden) cancelGesture(); };
    element.addEventListener("keydown", key); element.addEventListener("focusout", focusOut);
    document.addEventListener("pointerdown", outside); document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", cancelGesture);
    return () => {
      element.removeEventListener("keydown", key); element.removeEventListener("focusout", focusOut);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", cancelGesture);
    };
  }, [expanded]);
  function cancelGesture() { setExpanded(false); setSelected(null); }
  function expandOptions() { setError(null); setSelected(null); setExpanded(true); }
  function choose(kind: QuickInputKind) {
    cancelGesture(); setError(null);
    if (!enabled) return;
    if (!supportedKinds.includes(kind)) { setError(`${kind === "voice" ? "語音" : "文件"}功能正在接線；你可以先用文字或照片草稿。`); return; }
    if (kind === "text") openAgentDraft(true); else setDialog(kind);
  }
  const pending = agentAttachments.length > 0 || !!chatDraft.trim();
  return <View ref={host} testID="mobile-quick-input-dock" pointerEvents="box-none" style={[styles.dock, expanded && styles.dockExpanded]}>
    <PhotoFilePicker disabled={!enabled} capturePreferred onPick={actions.openAgentPhoto} onError={setError}
      renderTrigger={trigger => <>
        <DirectionalPressable testID="mobile-quick-camera" label={`拍照；長按選擇其他輸入；拖向上方文件、右上語音或右方文字${pending ? "；有未送出草稿" : ""}`}
          hint={enabled ? "長按放手後可點選；拖曳放手只開啟輸入，不會送出；方向鍵上展開，Tab 選擇，Escape 取消" : "請先選擇孩子"}
          disabled={!enabled || trigger.reading} expanded={expanded}
          scopeKey={scopeKey} style={[styles.camera, (!enabled || trigger.reading) && styles.disabled]}
          onPress={() => { cancelGesture(); setError(null); if (trigger.disabled) setError(trigger.unavailableReason ?? "相機目前不可用"); else trigger.onPress(); }}
          onExpand={expandOptions} onLongPress={expandOptions}
          onGestureStart={() => { cancelGesture(); setError(null); }}
          onGestureMove={(dx, dy) => { if (Math.hypot(dx, dy) > 8) setExpanded(true); setSelected(quickInputDirection(dx, dy)); }}
          onGestureCancel={cancelGesture}
          onGestureEnd={(dx, dy, dragged) => { cancelGesture(); if (dragged) { const kind = quickInputDirection(dx, dy); if (kind) choose(kind); } }}>
          <CornerCaptureSurface />
          <AppIcon name="camera-outline" size={26} color={colors.ink} />
        </DirectionalPressable>
        {!expanded && (error || trigger.reading) ? <View pointerEvents="none" style={styles.status}>
          <Text accessibilityLiveRegion={error ? "assertive" : "polite"} style={styles.statusText}>{error ?? "正在讀取原照片"}</Text>
        </View> : null}
      </>} />
    {expanded && enabled ? <MotionEntrance preset="dialog" animateOnMount triggerKey="quick-input" scopeKey={scopeKey}
      testID="quick-input-directions" pointerEvents="box-none" style={styles.menu}>
      {choices.map(item => <Pressable key={item.key} testID={`quick-input-${item.key}`} accessibilityRole="button" accessibilityLabel={`快捷${item.label}${supportedKinds.includes(item.key) ? "" : "，正在接線"}`}
        accessibilityState={{ selected: selected === item.key, disabled: !supportedKinds.includes(item.key) }} onPress={() => choose(item.key)} style={[styles.choice, styles[item.key], selected === item.key && styles.selected, !supportedKinds.includes(item.key) && styles.disabled]}>
        <AppIcon name={item.icon} size={20} /><Text style={styles.choiceLabel}>{item.label}</Text>{!supportedKinds.includes(item.key) ? <Text style={styles.choiceLabel}>正在接線</Text> : null}
      </Pressable>)}
    </MotionEntrance> : null}
    <AssistantInputDialog kind={dialog} enabled={enabled} onDismiss={() => setDialog(null)} onUseText={() => { setDialog(null); openAgentDraft(true); }}
      onPick={attachment => { if (addAgentAttachment(attachment)) { setDialog(null); openAgentDraft(); } }} />
  </View>;
}
const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, bottom: 0, width: 56, height: 56, zIndex: 4, overflow: "visible" },
  dockExpanded: { width: 180, height: 184 },
  camera: { position: "absolute", left: 0, bottom: 0, width: 56, height: 56, borderRadius: 28,
    backgroundColor: "transparent", overflow: "visible", alignItems: "center", justifyContent: "center" },
  status: { position: "absolute", left: 0, bottom: 68, width: 248, borderRadius: radius.small, backgroundColor: colors.white,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.softLine },
  statusText: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, color: colors.ink },
  menu: { position: "absolute", left: 0, bottom: 0, width: 180, height: 184 },
  choice: { position: "absolute", height: 60, width: 64, borderRadius: radius.medium, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.controlOutline,
    alignItems: "center", justifyContent: "center", gap: 3, shadowColor: colors.ink, shadowOpacity: .1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  file: { left: 0, bottom: 108 }, voice: { left: 72, bottom: 76 }, text: { left: 108, bottom: 0 },
  selected: { borderColor: colors.teal, borderWidth: 2, backgroundColor: colors.paleTeal },
  choiceLabel: { fontFamily: chineseFont, color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "700" }, disabled: { opacity: .4 },
});
