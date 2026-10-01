import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Button, Portal, RadioButton, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { AppIcon } from "./AppIcon";
import type { HomeChild } from "../view-model";
import { chineseFont, colors, mobileLayout, radius, spacing, typeScale } from "../theme";

export function ChildPicker({ children, selectedId, onSelect, compact = false, tiny = false, switchOnly = false, shortSwitchLabel = false }: {
  children: HomeChild[]; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean; tiny?: boolean; switchOnly?: boolean; shortSwitchLabel?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const mobile = useWindowDimensions().width < mobileLayout.breakpoint;
  const selected = children.find(child => child.id === selectedId);
  return <><Pressable accessibilityRole="button" accessibilityLabel={`選擇孩子，目前${selected?.displayName ?? "尚未有孩子"}`} accessibilityState={{ expanded: visible, disabled: children.length === 0 }} aria-expanded={visible} aria-disabled={children.length === 0} disabled={children.length === 0}
    onPress={() => setVisible(true)} style={({ pressed }) => [styles.picker, compact && styles.compact, tiny && styles.tiny, switchOnly && styles.switchOnly, shortSwitchLabel && styles.shortSwitch, mobile && styles.mobile, mobile && compact && styles.mobileCompact, visible && styles.open, children.length === 0 && styles.disabled, pressed && styles.pressed]}>
    {switchOnly ? <><AppIcon name="swap-horizontal" size={20} color={colors.deepTeal} /><Text style={styles.name}>{shortSwitchLabel ? "切換" : "切換孩子"}</Text></> : <>
      <View style={[styles.avatar, compact && styles.avatarCompact, tiny && styles.avatarTiny]}><Text style={styles.initial}>{selected?.displayName.slice(0, 1) ?? "育"}</Text></View>
      <View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{selected?.displayName ?? "尚未有孩子"}</Text>{!compact && selected ? <Text numberOfLines={1} style={styles.age}>{selected.ageLabel}</Text> : null}</View>
      <AppIcon name="chevron-down" size={18} color={visible ? colors.teal : colors.muted} />
    </>}
  </Pressable><Portal><Dialog visible={visible} onDismiss={() => setVisible(false)}><Dialog.Title>選擇孩子</Dialog.Title><Dialog.ScrollArea><ScrollView style={{ maxHeight: 360 }}>
    {children.map(child => <RadioButton.Item key={child.id} label={`${child.displayName} · ${child.ageLabel}`} value={child.id} aria-checked={child.id === selectedId} status={child.id === selectedId ? "checked" : "unchecked"} labelStyle={styles.optionLabel} style={[styles.option, child.id === selectedId && styles.optionSelected]} onPress={() => { setVisible(false); onSelect(child.id); }} />)}
  </ScrollView></Dialog.ScrollArea><Dialog.Actions><Button onPress={() => setVisible(false)}>關閉</Button></Dialog.Actions></Dialog></Portal></>;
}
const styles = StyleSheet.create({
  picker: { width: 276, minHeight: 52, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.controlSurface, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium },
  compact: { width: 152, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.small },
  tiny: { width: 132, paddingHorizontal: spacing.sm },
  switchOnly: { width: "auto", minHeight: 44, alignSelf: "flex-start" },
  mobile: { minHeight: mobileLayout.touchTarget },
  mobileCompact: { width: 132 },
  shortSwitch: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  open: { borderColor: colors.teal, backgroundColor: colors.white },
  disabled: { opacity: 0.5 }, pressed: { backgroundColor: colors.selectedNav },
  avatar: { width: 36, height: 36, flexShrink: 0, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  avatarCompact: { width: 30, height: 30 }, avatarTiny: { width: 28, height: 28 },
  initial: { color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700" },
  copy: { flex: 1, minWidth: 0, gap: 2 }, name: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
  age: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
  option: { borderRadius: radius.small, marginVertical: spacing.xs }, optionSelected: { backgroundColor: colors.paleTeal },
  optionLabel: { color: colors.ink, fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 22 },
});
