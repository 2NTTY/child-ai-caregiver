import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { AppIcon } from "./AppIcon";
import { Button, Portal, Text, TextInput } from "react-native-paper";
import { AppRadioItem } from "./AppRadioItem";
import { AppDialog as Dialog } from "./AppDialog";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing, typeScale, workspaceType } from "../theme";
import type { ConnectionState, OperationState } from "../view-model";
import { useInteractionDensity } from "./useInteractionDensity";
import { MotionEntrance } from "../motion";
import { MotionSelectionMarker } from "../motion/MotionSelectionMarker";
import { HorizontalOverflowRail } from "./HorizontalOverflowRail";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { useQuietReadFocus } from "./useQuietReadFocus";
import { AppStatusBadge } from "./AppStatusBadge";

export function AppButton({ label, accessibilityLabel = label, onPress, variant = "primary", density = "standard", disabled = false, loading = false, preserveFocusWhenDisabled = false, expanded, style, ref }: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "accent" | "danger" | "danger-secondary";
  density?: "standard" | "compact";
  disabled?: boolean;
  loading?: boolean;
  /** Quiet same-scope reads only; activation remains disabled. */
  preserveFocusWhenDisabled?: boolean;
  expanded?: boolean;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<View>;
}) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  const touch = useInteractionDensity();
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || loading;
  const readFocus = useQuietReadFocus(unavailable, preserveFocusWhenDisabled);
  const buttonRef = (node: View | null) => { readFocus.host.current = node; if (typeof ref === "function") return ref(node); else if (ref) ref.current = node; };
  const press = () => { if (!unavailable) onPress(); };
  const visuallyDisabled = unavailable && !readFocus.preserveWebFocus;
  const filled = variant === "primary" || variant === "accent" || variant === "danger";
  // Disclosure state belongs on the actual control; Paper Button replaces it internally.
  if (expanded !== undefined) return <Pressable ref={buttonRef} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ expanded, disabled: unavailable, busy: loading }} aria-expanded={expanded} aria-disabled={unavailable} aria-busy={loading}
    disabled={readFocus.nativeDisabled} onPress={press} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, styles.buttonContent, styles.disclosureButton, density === "compact" && styles.compactButtonContent,
      (compact || touch) && styles.mobileTarget, visuallyDisabled && styles.disabledOutlineButton, focused && styles.focusedButton, pressed && !unavailable && styles.buttonPressed, style]}>
    <Text style={[styles.buttonLabel, styles.disclosureLabel, compact && mobileType.itemTitle, visuallyDisabled && styles.disabledLabel]}>{label}</Text>
    <AppIcon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={visuallyDisabled ? colors.muted : colors.ink} />
  </Pressable>;
  return (
    <Button
      ref={buttonRef}
      mode={filled ? "contained" : "outlined"}
      icon={variant === "danger" || variant === "danger-secondary" ? ({ color, size }) => <AppIcon name="alert-outline" color={color} size={size} importantForAccessibility="no" /> : undefined}
      buttonColor={variant === "danger" ? colors.errorInk : variant === "accent" ? colors.accent : filled ? undefined : "transparent"}
      textColor={variant === "danger" ? colors.white : variant === "danger-secondary" ? colors.errorInk : variant === "accent" ? colors.onAccent : variant === "secondary" || variant === "quiet" ? colors.ink : undefined}
      rippleColor={variant === "primary" || variant === "danger" ? colors.darkActionRipple : undefined}
      theme={{ colors: { surfaceDisabled: colors.softLine, onSurfaceDisabled: colors.muted } }}
      onPress={press}
      disabled={readFocus.nativeDisabled}
      loading={loading}
      compact={density === "compact"}
      contentStyle={[styles.buttonContent, density === "compact" && styles.compactButtonContent, (compact || touch) && styles.mobileTarget]}
      labelStyle={[styles.buttonLabel, compact && mobileType.itemTitle]}
      style={[styles.button, (variant === "secondary" || variant === "quiet") && styles.outlineButton,
        variant === "quiet" && styles.quietButton, variant === "danger-secondary" && styles.secondaryDangerButton,
        visuallyDisabled && (filled ? styles.disabledFilledButton : styles.disabledOutlineButton), style]}
      accessibilityLabel={accessibilityLabel}
    >
      {label}
    </Button>
  );
}

type AppTextFieldProps = Omit<React.ComponentProps<typeof TextInput>, "ref"> & { ref?: Ref<React.ComponentRef<typeof TextInput>> };
export function AppTextField({ style, outlineStyle, contentStyle, multiline, label, mode, ref, onFocus, onBlur, onChangeText, placeholder, accessibilityLabel, ...props }: AppTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(props.defaultValue ?? "");
  const nativeLabel = Platform.OS !== "web" && mode !== "flat" && !multiline && typeof label === "string";
  // Paper's inactive label waits for its animated text measurement. Use the native placeholder until focus or text.
  const showNativePlaceholder = nativeLabel && !focused && !(props.value ?? uncontrolledValue);
  return <TextInput {...props} multiline={multiline} label={showNativePlaceholder ? undefined : label}
    placeholder={showNativePlaceholder ? label : placeholder} accessibilityLabel={accessibilityLabel ?? (nativeLabel ? label : undefined)}
    onFocus={nativeLabel ? event => { setFocused(true); onFocus?.(event); } : onFocus}
    onBlur={nativeLabel ? event => { setFocused(false); onBlur?.(event); } : onBlur}
    onChangeText={nativeLabel ? (value: string) => { if (props.value === undefined) setUncontrolledValue(value); onChangeText?.(value); } : onChangeText}
    ref={(instance: React.ComponentRef<typeof TextInput> | null) => { if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }}
    mode={mode ?? "outlined"} style={[styles.input, style]} outlineStyle={mode === "flat" ? undefined : [styles.inputOutline, showNativePlaceholder && styles.nativePlaceholderOutline, outlineStyle]}
    contentStyle={[multiline && label ? styles.multilineContent : undefined, contentStyle]} />;
}

function SelectionCount({ count }: { count: number | string }) {
  return <View style={styles.selectionCount} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={styles.selectionCountText}>{count}</Text></View>;
}

export function AppSelectionTrigger({ label, count, onPress, onBlur, disabled = false, preserveFocusWhenDisabled = false, expanded, ref, calendar = false, id, invalid, describedBy }: {
  label: string; onPress: () => void; onBlur?: () => void; disabled?: boolean; expanded: boolean; ref?: Ref<View>; calendar?: boolean;
  preserveFocusWhenDisabled?: boolean;
  count?: number; id?: string; invalid?: boolean; describedBy?: string;
}) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  const touch = useInteractionDensity();
  const readFocus = useQuietReadFocus(disabled, preserveFocusWhenDisabled);
  // Paper 5.15 Button replaces expanded state on its inner control; expose it on the selection trigger itself.
  return <Pressable ref={instance => { readFocus.host.current = instance; if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }} nativeID={id} accessibilityRole="button" accessibilityLabel={count === undefined ? label : `${label}，${count} 項`} accessibilityState={{ expanded, disabled }} aria-expanded={expanded} aria-disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} disabled={readFocus.nativeDisabled}
    onPress={() => { if (!disabled) onPress(); }} onBlur={onBlur} style={({ pressed }) => [styles.selectionTrigger, (compact || touch) && styles.mobileTarget, disabled && !readFocus.preserveWebFocus && styles.selectionDisabled, pressed && !disabled && styles.selectionPressed]}>
    <Text style={styles.selectionLabel}>{label}</Text>{count !== undefined ? <SelectionCount count={count} /> : null}<AppIcon name={calendar ? "calendar-clock-outline" : "chevron-down"} size={20} color={colors.deepTeal} />
  </Pressable>;
}

export function AppSelect<T extends string>({ label, value, options, onChange, onSelectionClosed, onBlur, disabled = false, preserveFocusWhenDisabled = false, ref, id, invalid, describedBy, showLabel = true }: {
  label: string; value: T; options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void; onBlur?: () => void; disabled?: boolean; ref?: Ref<View>;
  onSelectionClosed?: (value: T) => void;
  preserveFocusWhenDisabled?: boolean;
  showLabel?: boolean;
  id?: string; invalid?: boolean; describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const anchor = useRef<View>(null);
  const pendingSelection = useRef<T | null>(null);
  useLayoutEffect(() => {
    if (disabled) pendingSelection.current = null;
    return () => { pendingSelection.current = null; };
  }, [disabled]);
  const selected = options.find(item => item.value === value);
  function close() {
    setVisible(false);
    if (Platform.OS === "web") (anchor.current as unknown as HTMLElement | null)?.focus();
  }
  function dismiss() { pendingSelection.current = null; close(); }
  function closed() {
    const next = pendingSelection.current;
    pendingSelection.current = null;
    // RN Modal has now released its focus trap and restored the trigger focus.
    if (next !== null && !visible && !disabled && options.some(item => item.value === next)) onSelectionClosed?.(next);
  }
  return <><AppSelectionTrigger ref={instance => { anchor.current = instance; if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }} id={id} invalid={invalid} describedBy={describedBy} label={showLabel ? `${label}：${selected?.label ?? value}` : selected?.label ?? value} count={selected?.count} disabled={disabled} preserveFocusWhenDisabled={preserveFocusWhenDisabled} onBlur={onBlur}
    expanded={visible && !disabled} onPress={() => { pendingSelection.current = null; setHasOpened(true); setVisible(true); }} />
    {/* Keep the modal stable after first use so close focus and backdrop exit can finish. */}
    {hasOpened ? <Portal><Dialog visible={visible && !disabled} onDismiss={dismiss} onClosed={closed} style={styles.selectDialog}>
      <Dialog.Title>{label}</Dialog.Title><Dialog.ScrollArea><ScrollView style={styles.selectList} keyboardShouldPersistTaps="handled">
        {options.map(item => {
          const checked = item.value === value;
          const select = () => { pendingSelection.current = onSelectionClosed ? item.value : null; onChange(item.value); close(); };
          return item.count === undefined ? <AppRadioItem key={item.value} label={item.label} value={item.value} checked={checked}
            accessibilityLabel={`${label}選項：${item.label}`} disabled={disabled} onPress={select} />
            : <Pressable key={item.value} accessibilityRole="radio" accessibilityLabel={`${label}選項：${item.label}，${item.count} 項`}
              accessibilityState={{ checked, disabled }} aria-checked={checked} aria-disabled={disabled} disabled={disabled} onPress={select}
              {...(Platform.OS === "web" ? { onKeyDown: (event: { key: string; repeat?: boolean; preventDefault(): void }) => {
                if (event.key !== " " && event.key !== "Spacebar") return;
                event.preventDefault(); if (!disabled && !event.repeat) select();
              } } : {})}
              style={({ pressed }) => [styles.countedOption, pressed && !disabled && styles.optionPressed]}>
              <View style={styles.countedOptionCopy}><Text style={styles.countedOptionLabel}>{item.label}</Text><SelectionCount count={item.count} /></View>
              <AppIcon name={checked ? "radiobox-marked" : "radiobox-blank"} size={20} color={colors.ink} />
            </Pressable>;
        })}
      </ScrollView></Dialog.ScrollArea><Dialog.Actions><AppButton label="取消" variant="quiet" onPress={dismiss} /></Dialog.Actions>
    </Dialog></Portal> : null}</>;
}

export function SectionCard({ children, style, testID, surface = "regular" }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; surface?: "regular" | "inset" | "plain" }) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  return <View testID={testID} style={[styles.card, compact && styles.mobileCard, surface === "inset" && styles.insetCard, surface === "plain" && styles.plainCard, style]}>{children}</View>;
}

export function SectionHeader({ title, subtitle, action, icon, count, density = "regular" }: { title: string; subtitle?: string; action?: ReactNode; icon?: React.ComponentProps<typeof AppIcon>["name"]; count?: number; density?: "regular" | "compact" }) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  if (compact) return <View style={styles.mobileHeader}>
    <View style={styles.mobileHeaderRow}><View style={styles.mobileHeaderTitle}>
      {icon ? <AppIcon name={icon} size={mobileIcons.content} color={colors.teal} importantForAccessibility="no" /> : null}
      <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, mobileType.sectionTitle, density === "compact" && workspaceType.section]}>{title}</Text>
      {count !== undefined ? <View style={styles.count}><Text accessibilityLabel={`${count} 項`} style={styles.countText}>{count}</Text></View> : null}
    </View>{action ? <View style={styles.mobileHeaderAction}>{action}</View> : null}</View>
    {subtitle ? <Text style={[styles.sectionSubtitle, mobileType.caption]}>{subtitle}</Text> : null}
  </View>;
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.headerText}>
        <View style={styles.sectionTitleRow}>{icon ? <AppIcon name={icon} size={24} color={colors.teal} importantForAccessibility="no" /> : null}<Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, density === "compact" && workspaceType.section]}>{title}</Text>{count !== undefined ? <View style={styles.count}><Text accessibilityLabel={`${count} 項`} style={styles.countText}>{count}</Text></View> : null}</View>
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
  return <AppStatusBadge label={operationLabels[state]} tone={state === "saved" ? "success" : state === "failed" ? "error" : state === "needs_confirmation" || state === "unknown" ? "warning" : state === "saving" ? "info" : "neutral"} />;
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const label = state === "online" ? "已連接" : state === "offline" ? "目前離線" : "正在檢查連線";
  return (
    <View accessibilityRole="text" accessibilityLabel={label} style={[styles.pill, styles.connectionPill, state === "offline" ? styles.amberPill : state === "checking" ? styles.neutralPill : styles.onlineConnection]}>
      <View style={[styles.dot, state === "online" ? styles.tealDot : state === "offline" ? styles.amberDot : styles.neutralDot]} />
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  const touch = useInteractionDensity();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.link, (compact || touch) && styles.mobileTarget, pressed && styles.linkPressed]}>
      <Text style={[styles.linkText, compact && mobileType.label]}>{label}</Text><AppIcon name="arrow-right" size={compact ? mobileIcons.inline : 17} color={colors.ink} />
    </Pressable>
  );
}

/** Keep page actions beside the existing scrollable tabs, not in a duplicate page header. */
export function TabToolbar({ children, actions, testID, stacked = false }: { children: ReactNode; actions?: ReactNode; testID?: string; stacked?: boolean }) {
  return <BackgroundSurface testID={testID} style={[styles.tabToolbar, stacked && styles.tabToolbarStacked]}>
    <View style={[styles.tabToolbarTabs, stacked && styles.tabToolbarFullTabs]}>{children}</View>
    {actions ? <View style={[styles.tabToolbarActions, stacked && styles.tabToolbarWrappedActions]}>{actions}</View> : null}
  </BackgroundSurface>;
}

function tabId(tabsId: string, key: string) { return `${tabsId}-tab-${encodeURIComponent(key)}`; }
function tabPanelId(tabsId: string, key: string) { return `${tabsId}-panel-${encodeURIComponent(key)}`; }

export function UnderlineTabs<T extends string>({ id, label, items, value, onChange }: {
  id: string;
  label?: string;
  items: ReadonlyArray<{ key: T; label: string; count?: number | string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const compact = useWindowDimensions().width < mobileLayout.breakpoint;
  const touch = useInteractionDensity();
  const controls = useRef(new Map<T, View>());
  const [positions, setPositions] = useState<Record<string, { x: number; width: number }>>({});
  const [revealRevision, setRevealRevision] = useState(0);
  const selection = positions[value];
  function measureWebTabs() {
    if (Platform.OS !== "web") return;
    const next: typeof positions = {};
    controls.current.forEach((control, key) => {
      const node = control as unknown as HTMLElement;
      // These share the marker's positioned parent, without screen zoom or transforms.
      next[key] = { x: node.offsetLeft, width: node.offsetWidth };
    });
    setPositions(current => Object.keys(current).length === Object.keys(next).length
      && Object.keys(next).every(key => current[key]?.x === next[key].x && current[key]?.width === next[key].width) ? current : next);
  }
  // RN Web observes each tab's size, not position. A preceding badge can move a
  // tab without resizing it; measure the whole row after commits and any resize.
  useLayoutEffect(measureWebTabs);
  function select(key: T) {
    setRevealRevision(revision => revision + 1);
    onChange(key);
  }
  function move(event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }, index: number) {
    const key = event.nativeEvent?.key ?? event.key;
    const next = key === "ArrowLeft" ? (index + items.length - 1) % items.length
      : key === "ArrowRight" ? (index + 1) % items.length : key === "Home" ? 0 : key === "End" ? items.length - 1 : null;
    if (next === null || !items[next]) return;
    event.preventDefault();
    select(items[next].key);
    (controls.current.get(items[next].key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
  }
  return <HorizontalOverflowRail tabIndex={-1} style={styles.tabsScroll} rowTestID={`${id}-rail`} hintTestID={`${id}-scroll-hint`}
    items={items.flatMap(item => positions[item.key] ? [{ key: item.key, ...positions[item.key] }] : [])}
    revealTarget={selection ? { key: value, ...selection } : undefined} revealRevision={revealRevision} hintLabel={`查看更多${label ?? "分頁"}`}
    onRevealItem={key => { if (Platform.OS === "web") (controls.current.get(key as T) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true }); }}>
    <View accessibilityRole="tablist" accessibilityLabel={label} aria-orientation="horizontal" style={styles.tabs} onLayout={Platform.OS === "web" ? measureWebTabs : undefined}>
    {items.map((item, index) => <Pressable
      key={item.key} nativeID={tabId(id, item.key)} onLayout={event => { if (Platform.OS === "web") { measureWebTabs(); return; } const { x, width } = event.nativeEvent.layout; setPositions(current => current[item.key]?.x === x && current[item.key]?.width === width ? current : { ...current, [item.key]: { x, width } }); }} ref={instance => { if (instance) controls.current.set(item.key, instance); else controls.current.delete(item.key); }}
      accessibilityRole="tab" accessibilityLabel={item.count === undefined ? item.label : `${item.label} ${item.count}`} aria-controls={tabPanelId(id, item.key)} tabIndex={value === item.key ? 0 : -1}
      accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key} onPress={() => select(item.key)}
      {...(Platform.OS === "web" ? { onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => move(event, index) } : {})}
      style={({ pressed }) => [styles.tab, item.count !== undefined && styles.countedTab, (compact || touch) && styles.mobileTarget, !selection && value === item.key && styles.tabActive, pressed && styles.tabPressed]}
    ><Text style={[styles.tabText, value === item.key && styles.tabTextActive]}>{item.label}</Text>{item.count !== undefined ? <SelectionCount count={item.count} /> : null}</Pressable>)}
    <MotionSelectionMarker x={selection?.x ?? 0} width={selection?.width ?? 0} selectionKey={`${id}:${value}`} />
    </View>
  </HorizontalOverflowRail>;
}

export function AppTabPanel({ tabsId, tabKey, active, hasTabList = true, children, style, ...props }: ViewProps & {
  tabsId: string; tabKey: string; active: boolean; hasTabList?: boolean; children: ReactNode;
}) {
  const panel = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && panel.current) (panel.current as unknown as HTMLElement).inert = !active;
  }, [active]);
  return <MotionEntrance {...props} ref={panel} preset="panel" triggerKey={active ? `${tabsId}:${tabKey}:active` : null} scopeKey={tabsId} enabled={active} nativeID={tabPanelId(tabsId, tabKey)} role={Platform.OS === "web" && hasTabList ? "tabpanel" : undefined}
    aria-labelledby={hasTabList ? tabId(tabsId, tabKey) : undefined} aria-hidden={!active} accessibilityElementsHidden={!active}
    importantForAccessibility={active ? "auto" : "no-hide-descendants"} tabIndex={hasTabList ? active ? 0 : -1 : undefined} pointerEvents={active ? "auto" : "none"}
    style={[style, !active && styles.hiddenPanel]}>{children}</MotionEntrance>;
}

const styles = StyleSheet.create({
  button: { maxWidth: "100%", borderRadius: radius.small },
  buttonContent: { minHeight: 44, paddingHorizontal: 4 },
  compactButtonContent: { minHeight: 40 },
  buttonLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700" },
  outlineButton: { borderColor: colors.controlOutline },
  quietButton: { alignSelf: "flex-start", borderColor: "transparent" },
  secondaryDangerButton: { alignSelf: "flex-start", borderColor: colors.errorInk },
  disabledFilledButton: { backgroundColor: colors.softLine },
  disabledOutlineButton: { backgroundColor: "transparent", borderColor: colors.line },
  disabledLabel: { color: colors.muted },
  disclosureButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.controlOutline, backgroundColor: "transparent" },
  disclosureLabel: { color: colors.ink, lineHeight: 22, flexShrink: 1 },
  focusedButton: { borderColor: colors.ink },
  buttonPressed: { backgroundColor: colors.pressedOverlay },
  tabToolbar: { flexDirection: "row", alignItems: "center", minWidth: 0, width: "100%", gap: spacing.md, paddingBottom: spacing.sm },
  tabToolbarStacked: { flexDirection: "column", alignItems: "stretch" },
  tabToolbarTabs: { flex: 1, minWidth: 0 },
  tabToolbarFullTabs: { flex: undefined, width: "100%" },
  tabToolbarActions: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: spacing.sm },
  tabToolbarWrappedActions: { flexWrap: "wrap", alignSelf: "flex-end", maxWidth: "100%" },
  card: { backgroundColor: colors.white, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.large, padding: spacing.xl, gap: spacing.lg },
  mobileCard: { borderRadius: mobileLayout.cardRadius, padding: mobileLayout.cardInset },
  insetCard: { borderWidth: 0, borderRadius: radius.small, backgroundColor: colors.quietSurface, padding: spacing.md },
  plainCard: { borderWidth: 0, borderRadius: 0, backgroundColor: "transparent", padding: 0 },
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
  connectionPill: { alignSelf: "center", borderWidth: 1, borderColor: colors.line },
  onlineConnection: { backgroundColor: colors.controlSurface },
  pillText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  neutralPill: { backgroundColor: colors.neutralSurface },
  amberPill: { backgroundColor: colors.paleAmber },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tealDot: { backgroundColor: colors.teal },
  amberDot: { backgroundColor: colors.amber },
  neutralDot: { backgroundColor: colors.muted },
  link: { minHeight: 44, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center" },
  linkPressed: { backgroundColor: colors.pressedOverlay },
  selectionPressed: { backgroundColor: colors.paleTeal },
  optionPressed: { backgroundColor: colors.paleTeal },
  tabPressed: { backgroundColor: colors.paleTeal },
  linkText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 21, fontWeight: "700", textDecorationLine: "underline" },
  tabsScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white, borderTopLeftRadius: radius.small, borderTopRightRadius: radius.small },
  tabs: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  hiddenPanel: { display: "none" },
  tab: { minHeight: 52, paddingHorizontal: spacing.lg, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  countedTab: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tabActive: { borderBottomColor: colors.teal },
  tabText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, fontWeight: "700" },
  tabTextActive: { color: colors.deepTeal, fontWeight: "800" },
  input: { backgroundColor: colors.controlSurface, fontFamily: chineseFont },
  // Keep the scrolling textarea below its floating label, including enlarged text.
  multilineContent: { marginTop: spacing.md },
  inputOutline: { borderColor: colors.controlOutline, borderRadius: radius.small },
  nativePlaceholderOutline: { top: 6 },
  selectDialog: { maxWidth: 440, width: "90%", alignSelf: "center", marginHorizontal: 0 },
  selectList: { maxHeight: 360 },
  selectionTrigger: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.controlOutline, borderRadius: radius.small, backgroundColor: colors.controlSurface },
  selectionLabel: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "600", lineHeight: 22 },
  selectionCount: { flexShrink: 0, minWidth: 28, minHeight: 24, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  selectionCountText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700", lineHeight: 22, fontVariant: ["tabular-nums"] },
  countedOption: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  countedOptionCopy: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  countedOptionLabel: { flexShrink: 1, fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 24 },
  selectionDisabled: { opacity: 0.5 },
});
