import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button, Portal, RadioButton, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { HomeChild } from "../view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

export function ChildPicker({ children, selectedId, onSelect, compact = false, tiny = false, switchOnly = false }: {
  children: HomeChild[]; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean; tiny?: boolean; switchOnly?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const selected = children.find(child => child.id === selectedId);
  return <><Pressable accessibilityRole="button" accessibilityLabel={`選擇孩子，目前${selected?.displayName ?? "尚未有孩子"}`} accessibilityState={{ expanded: visible, disabled: children.length === 0 }} aria-expanded={visible} aria-disabled={children.length === 0} disabled={children.length === 0}
    onPress={() => setVisible(true)} style={({ pressed }) => [styles.picker, compact && styles.compact, tiny && styles.tiny, switchOnly && styles.switchOnly, pressed && styles.pressed]}>
    {switchOnly ? <><MaterialCommunityIcons name="swap-horizontal" size={20} color={colors.deepTeal} /><Text style={styles.name}>切換孩子</Text></> : <>
      <View style={[styles.avatar, tiny && styles.avatarTiny]}><Text style={styles.initial}>{selected?.displayName.slice(0, 1) ?? "育"}</Text></View>
      <View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{selected?.displayName ?? "尚未有孩子"}</Text>{!compact && selected ? <Text numberOfLines={1} style={styles.age}>{selected.ageLabel}</Text> : null}</View>
      <MaterialCommunityIcons name="chevron-down" size={18} color={colors.teal} />
    </>}
  </Pressable><Portal><Dialog visible={visible} onDismiss={() => setVisible(false)}><Dialog.Title>選擇孩子</Dialog.Title><Dialog.ScrollArea><ScrollView style={{ maxHeight: 360 }}>
    {children.map(child => <RadioButton.Item key={child.id} label={`${child.displayName} · ${child.ageLabel}`} value={child.id} aria-checked={child.id === selectedId} status={child.id === selectedId ? "checked" : "unchecked"} onPress={() => { setVisible(false); onSelect(child.id); }} />)}
  </ScrollView></Dialog.ScrollArea><Dialog.Actions><Button onPress={() => setVisible(false)}>關閉</Button></Dialog.Actions></Dialog></Portal></>;
}
const styles = StyleSheet.create({ picker: { minHeight: 50, maxWidth: 300, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.quietSurface, paddingHorizontal: spacing.md, borderRadius: radius.pill }, compact: { maxWidth: 155 }, tiny: { paddingHorizontal: spacing.sm, maxWidth: 126 }, switchOnly: { minHeight: 44, alignSelf: "flex-start" }, pressed: { opacity: 0.68 }, avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" }, avatarTiny: { width: 28, height: 28 }, initial: { color: colors.deepTeal, fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700" }, copy: { flexShrink: 1, minWidth: 0, gap: 2 }, name: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" }, age: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption } });
