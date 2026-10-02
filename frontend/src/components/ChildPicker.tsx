import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Button, Portal, RadioButton, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { AppIcon } from "./AppIcon";
import type { HomeChild } from "../view-model";
import { chineseFont, colors, mobileLayout, radius, spacing, typeScale } from "../theme";

const homeAvatarSize = 48, homeArrowSize = 20;

export function ChildPicker({ children, selectedId, onSelect, compact = false, tiny = false, switchOnly = false, shortSwitchLabel = false, homeIdentity = false, homeDocked = false, onHomeContentWidth, loading = false, onOpenChange }: {
  children: HomeChild[]; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean; tiny?: boolean; switchOnly?: boolean; shortSwitchLabel?: boolean;
  homeIdentity?: boolean; homeDocked?: boolean; onHomeContentWidth?: (width: number) => void; loading?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [visible, setVisible] = useState(false);
  const mobile = useWindowDimensions().width < mobileLayout.breakpoint;
  const selected = children.find(child => child.id === selectedId);
  const copy = <><Text numberOfLines={1} style={[styles.name, homeIdentity && styles.homeName]}>{selected?.displayName ?? "尚未有孩子"}</Text>{!compact && selected ? <Text numberOfLines={homeIdentity ? undefined : 1} style={[styles.age, homeIdentity && styles.homeAge]}>{loading ? "正在讀取…" : homeIdentity ? selected.ageSummaryLabel ?? selected.ageLabel : selected.ageLabel}</Text> : null}</>;
  function setOpen(open: boolean) { setVisible(open); onOpenChange?.(open); }
  return <><Pressable accessibilityRole="button" accessibilityLabel={`選擇孩子，目前${selected?.displayName ?? "尚未有孩子"}`} accessibilityState={{ expanded: visible, disabled: children.length === 0 }} aria-expanded={visible} aria-disabled={children.length === 0} disabled={children.length === 0}
    onPress={() => setOpen(true)} style={({ pressed }) => [styles.picker, compact && styles.compact, tiny && styles.tiny, switchOnly && styles.switchOnly, shortSwitchLabel && styles.shortSwitch, mobile && styles.mobile, mobile && compact && styles.mobileCompact, homeIdentity && styles.homeIdentity, homeIdentity && homeDocked && styles.homeDocked, visible && !homeIdentity && styles.open, children.length === 0 && styles.disabled, pressed && (homeIdentity ? styles.homePressed : styles.pressed)]}>
    {switchOnly ? <><AppIcon name="swap-horizontal" size={20} color={colors.deepTeal} /><Text style={styles.name}>{shortSwitchLabel ? "切換" : "切換孩子"}</Text></> : <>
      <View style={[styles.avatar, compact && styles.avatarCompact, tiny && styles.avatarTiny, homeIdentity && styles.homeAvatar]}><Text style={[styles.initial, homeIdentity && styles.homeInitial]}>{selected?.displayName.slice(0, 1) ?? "育"}</Text></View>
      <View style={[styles.copy, homeIdentity && homeDocked && styles.homeDockedCopy]}>{homeIdentity ? <View style={styles.homeCopyContent}
        onLayout={event => onHomeContentWidth?.(event.nativeEvent.layout.width + homeAvatarSize + 2 * spacing.sm + homeArrowSize)}>{copy}</View> : copy}</View>
      <AppIcon name="chevron-down" size={homeIdentity ? homeArrowSize : 18} color={visible ? colors.teal : colors.muted} />
    </>}
  </Pressable><Portal><Dialog visible={visible} onDismiss={() => setOpen(false)}><Dialog.Title>選擇孩子</Dialog.Title><Dialog.ScrollArea><ScrollView style={{ maxHeight: 360 }}>
    {children.map(child => <RadioButton.Item key={child.id} label={`${child.displayName} · ${child.ageLabel}`} value={child.id} aria-checked={child.id === selectedId} status={child.id === selectedId ? "checked" : "unchecked"} labelStyle={styles.optionLabel} style={[styles.option, child.id === selectedId && styles.optionSelected]} onPress={() => { setOpen(false); onSelect(child.id); }} />)}
  </ScrollView></Dialog.ScrollArea><Dialog.Actions><Button onPress={() => setOpen(false)}>關閉</Button></Dialog.Actions></Dialog></Portal></>;
}
const styles = StyleSheet.create({
  picker: { width: 276, minHeight: 52, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.controlSurface, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium },
  compact: { width: 152, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.small },
  tiny: { width: 132, paddingHorizontal: spacing.sm },
  switchOnly: { width: "auto", minHeight: 44, alignSelf: "flex-start" },
  mobile: { minHeight: mobileLayout.touchTarget },
  mobileCompact: { width: 132 },
  shortSwitch: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  homeIdentity: { width: "100%", minHeight: 72, paddingHorizontal: 0, backgroundColor: "transparent", borderWidth: 0, borderRadius: radius.small },
  homeDocked: { width: "auto", alignSelf: "flex-start" },
  homeDockedCopy: { flexGrow: 0, flexShrink: 1, flexBasis: "auto" },
  homeCopyContent: { alignSelf: "flex-start", maxWidth: "100%", gap: 2 },
  homePressed: { opacity: 0.72 },
  open: { borderColor: colors.teal, backgroundColor: colors.white },
  disabled: { opacity: 0.5 }, pressed: { backgroundColor: colors.selectedNav },
  avatar: { width: 36, height: 36, flexShrink: 0, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  avatarCompact: { width: 30, height: 30 }, avatarTiny: { width: 28, height: 28 },
  homeAvatar: { width: homeAvatarSize, height: homeAvatarSize },
  homeInitial: { fontSize: 18 },
  homeName: { fontSize: 18, lineHeight: 24 },
  homeAge: { fontSize: 14, lineHeight: 22 },
  initial: { color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700" },
  copy: { flex: 1, minWidth: 0, gap: 2 }, name: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
  age: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
  option: { borderRadius: radius.small, marginVertical: spacing.xs }, optionSelected: { backgroundColor: colors.paleTeal },
  optionLabel: { color: colors.ink, fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 22 },
});
