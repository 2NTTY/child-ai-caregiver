import { useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { AppIcon } from "./AppIcon";
import { Button, Portal, RadioButton, Text, TextInput } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing, typeScale } from "../theme";
import type { ConnectionState, OperationState } from "../view-model";

export function AppButton({ label, accessibilityLabel = label, onPress, variant = "primary", disabled = false, loading = false, style, ref }: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "accent";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<View>;
}) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  return (
    <Button
      ref={ref}
      mode={variant === "primary" || variant === "accent" ? "contained" : variant === "secondary" ? "outlined" : "text"}
      buttonColor={variant === "accent" ? colors.deepTeal : undefined}
      textColor={variant === "accent" ? colors.white : variant === "secondary" || variant === "quiet" ? colors.ink : undefined}
      onPress={onPress}
      disabled={disabled || loading}
      loading={loading}
      contentStyle={[styles.buttonContent, compact && styles.mobileTarget]}
      labelStyle={[styles.buttonLabel, compact && mobileType.itemTitle]}
      style={[styles.button, variant === "secondary" && styles.outlineButton, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {label}
    </Button>
  );
}

type AppTextFieldProps = Omit<React.ComponentProps<typeof TextInput>, "ref"> & { ref?: Ref<React.ComponentRef<typeof TextInput>> };
export function AppTextField({ style, outlineStyle, mode, ref, ...props }: AppTextFieldProps) {
  return <TextInput {...props} ref={(instance: React.ComponentRef<typeof TextInput> | null) => { if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }}
    mode={mode ?? "outlined"} style={[styles.input, style]} outlineStyle={[styles.inputOutline, outlineStyle]} />;
}

export function AppSelectionTrigger({ label, onPress, disabled = false, expanded, ref, calendar = false }: {
  label: string; onPress: () => void; disabled?: boolean; expanded: boolean; ref?: Ref<View>; calendar?: boolean;
}) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  // Paper 5.15 Button replaces expanded state on its inner control; expose it on the selection trigger itself.
  return <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded, disabled }} aria-expanded={expanded} aria-disabled={disabled} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.selectionTrigger, compact && styles.mobileTarget, disabled && styles.selectionDisabled, pressed && styles.linkPressed]}>
    <Text style={styles.selectionLabel}>{label}</Text><AppIcon name={calendar ? "calendar-clock-outline" : "chevron-down"} size={20} color={colors.deepTeal} />
  </Pressable>;
}

export function AppSelect<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; label: string }[];
  onChange: (value: T) => void; disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const anchor = useRef<View>(null);
  const selected = options.find(item => item.value === value)?.label ?? value;
  function dismiss() {
    setVisible(false);
    if (Platform.OS === "web") (anchor.current as unknown as HTMLElement | null)?.focus();
  }
  return <><AppSelectionTrigger ref={anchor} label={`${label}：${selected}`} disabled={disabled}
    expanded={visible && !disabled} onPress={() => setVisible(true)} />
    {visible && !disabled ? <Portal><Dialog visible onDismiss={dismiss} style={styles.selectDialog}>
      <Dialog.Title>{label}</Dialog.Title><Dialog.ScrollArea><ScrollView style={styles.selectList} keyboardShouldPersistTaps="handled">
        {options.map(item => <RadioButton.Item key={item.value} label={item.label} value={item.value} aria-checked={item.value === value}
          accessibilityLabel={`${label}選項：${item.label}`} status={item.value === value ? "checked" : "unchecked"}
          onPress={() => { onChange(item.value); dismiss(); }} />)}
      </ScrollView></Dialog.ScrollArea><Dialog.Actions><Button onPress={dismiss}>取消</Button></Dialog.Actions>
    </Dialog></Portal> : null}</>;
}

export function SectionCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  return <View testID={testID} style={[styles.card, compact && styles.mobileCard, style]}>{children}</View>;
}

export function SectionHeader({ title, subtitle, action, icon, count }: { title: string; subtitle?: string; action?: ReactNode; icon?: React.ComponentProps<typeof AppIcon>["name"]; count?: number }) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  if (compact) return <View style={styles.mobileHeader}>
    <View style={styles.mobileHeaderRow}><View style={styles.mobileHeaderTitle}>
      {icon ? <AppIcon name={icon} size={mobileIcons.content} color={colors.teal} importantForAccessibility="no" /> : null}
      <Text accessibilityRole="header" style={[styles.sectionTitle, mobileType.sectionTitle]}>{title}</Text>
      {count !== undefined ? <View style={styles.count}><Text accessibilityLabel={`${count} 項`} style={styles.countText}>{count}</Text></View> : null}
    </View>{action ? <View style={styles.mobileHeaderAction}>{action}</View> : null}</View>
    {subtitle ? <Text style={[styles.sectionSubtitle, mobileType.caption]}>{subtitle}</Text> : null}
  </View>;
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.headerText}>
        <View style={styles.sectionTitleRow}>{icon ? <AppIcon name={icon} size={24} color={colors.teal} importantForAccessibility="no" /> : null}<Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{count !== undefined ? <Text style={styles.countText}>{count}</Text> : null}</View>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const operationLabels: Record<OperationState, string> = {
  none: "沒有待處理操作",
  needs_confirmation: "待確認",
  saving: "處理中",
  saved: "已保存",
  failed: "失敗",
  unknown: "結果未知",
};

export function OperationPill({ state }: { state: OperationState }) {
  const tone = state === "none" ? styles.neutralPill
    : state === "needs_confirmation" || state === "unknown" ? styles.amberPill
    : state === "failed" ? styles.coralPill : styles.tealPill;
  return (
    <View accessibilityRole="text" accessibilityLabel={`操作狀態：${operationLabels[state]}`} style={[styles.pill, tone]}>
      <Text style={styles.pillText}>{operationLabels[state]}</Text>
    </View>
  );
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const label = state === "online" ? "已連接" : state === "offline" ? "目前離線" : "正在檢查連線";
  return (
    <View accessibilityRole="text" accessibilityLabel={label} style={[styles.pill, styles.connectionPill, state === "online" ? styles.tealPill : state === "offline" ? styles.amberPill : styles.neutralPill]}>
      <View style={[styles.dot, state === "online" ? styles.tealDot : state === "offline" ? styles.amberDot : styles.neutralDot]} />
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.link, compact && styles.mobileTarget, pressed && styles.linkPressed]}>
      <Text style={[styles.linkText, compact && mobileType.label]}>{label}</Text><AppIcon name="arrow-right" size={compact ? mobileIcons.inline : 17} color={colors.ink} />
    </Pressable>
  );
}

export function UnderlineTabs<T extends string>({ items, value, onChange }: {
  items: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
    {items.map(item => <Pressable
      key={item.key} accessibilityRole="tab" accessibilityLabel={item.label}
      accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key} onPress={() => onChange(item.key)}
      style={({ pressed }) => [styles.tab, compact && styles.mobileTarget, value === item.key && styles.tabActive, pressed && styles.linkPressed]}
    ><Text style={[styles.tabText, value === item.key && styles.tabTextActive]}>{item.label}</Text></Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  button: { maxWidth: "100%" },
  buttonContent: { minHeight: 44, paddingHorizontal: 4 },
  buttonLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700" },
  outlineButton: { borderColor: colors.line },
  card: { backgroundColor: colors.white, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md },
  mobileCard: { borderRadius: mobileLayout.cardRadius, padding: mobileLayout.cardInset },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 29, fontWeight: "700", flexShrink: 1 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionSubtitle: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 21 },
  mobileTarget: { minHeight: mobileLayout.touchTarget, minWidth: mobileLayout.touchTarget },
  mobileHeader: { gap: spacing.xs },
  mobileHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mobileHeaderTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mobileHeaderAction: { flexShrink: 0, maxWidth: "48%" },
  count: { minWidth: 24, paddingHorizontal: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.paleTeal, alignItems: "center" },
  countText: { fontFamily: chineseFont, color: colors.deepTeal, ...mobileType.caption, fontWeight: "700" },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6 },
  connectionPill: { alignSelf: "center" },
  pillText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  neutralPill: { backgroundColor: colors.neutralSurface },
  tealPill: { backgroundColor: colors.paleTeal },
  amberPill: { backgroundColor: colors.paleAmber },
  coralPill: { backgroundColor: colors.paleCoral },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tealDot: { backgroundColor: colors.teal },
  amberDot: { backgroundColor: colors.amber },
  neutralDot: { backgroundColor: colors.muted },
  link: { minHeight: 44, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center" },
  linkPressed: { opacity: 0.6 },
  linkText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 21, fontWeight: "700" },
  tabsScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line },
  tabs: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  tab: { minHeight: 46, paddingHorizontal: spacing.sm, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.teal },
  tabText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, fontWeight: "700" },
  tabTextActive: { color: colors.deepTeal, fontWeight: "800" },
  input: { backgroundColor: colors.white, fontFamily: chineseFont },
  inputOutline: { borderColor: colors.controlOutline, borderRadius: radius.small },
  selectDialog: { maxWidth: 440, width: "90%", alignSelf: "center", marginHorizontal: 0 },
  selectList: { maxHeight: 360 },
  selectionTrigger: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.controlOutline, borderRadius: radius.small, backgroundColor: colors.white },
  selectionLabel: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "600", lineHeight: 22 },
  selectionDisabled: { opacity: 0.5 },
});
