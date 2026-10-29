import { useHeaderOperationHints } from "../production/useHeaderOperationHints";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { brand } from "../branding";
import { AppIcon } from "./AppIcon";
import { BrandLogo } from "./BrandLogo";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProductionHome as useProduction } from "../production/useProductionHome";
import { chineseFont, colors, mobileLayout, spacing, typeScale } from "../theme";
import { NotificationBell } from "./NotificationBell";
import { ChildPicker } from "./ChildPicker";
import { ChildKeyFacts } from "./ChildKeyFacts";

export function NativeAppShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const operationHints = useHeaderOperationHints();
  const { model, actions, notice, dismissNotice } = useProduction();
  const announcedNotice = useRef<string | null>(null);
  useEffect(() => {
    // Live Text covers Android. iOS needs its explicit queued announcement API.
    if (announcedNotice.current === notice) return;
    announcedNotice.current = notice;
    if (Platform.OS === "ios" && notice) AccessibilityInfo.announceForAccessibilityWithOptions(notice, { queue: true });
  }, [notice]);
  return <View style={[styles.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <View style={styles.header}>
      <PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} style={StyleSheet.flatten(styles.brand)}><BrandLogo style={styles.logo} decorative /></Pressable></PreviewLink>
      <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} compact />
      <View testID="header-actions" style={styles.actions}><NotificationBell /></View>
    </View>
    {operationHints.length > 0 ? <View style={styles.hints}><ChildKeyFacts hints={operationHints} child={model.children.find(item => item.id === model.selectedChildId)} load={model.profileLoad} /></View> : null}
    <View style={[styles.notice, !notice && styles.noticeEmpty]}><Text accessibilityLiveRegion="polite" style={[styles.meta, {flex: 1}]}>{notice ?? ""}</Text>{notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉提示" onPress={dismissNotice} style={styles.noticeDismiss}><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}</View>
    <View style={styles.content}>{children}</View>

  </View>;
}
// The screen avoids the keyboard; the header and tab bar stay outside this area.
export function NativeKeyboardPane({ children }: { children: ReactNode }) {
  const frame = useRef<View>(null);
  const [screenTop, setScreenTop] = useState(0);
  return <View ref={frame} collapsable={false} style={styles.content}
    onLayout={() => frame.current?.measureInWindow((_x, y) => setScreenTop(y))}>
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={screenTop} style={styles.content}>
      {children}
    </KeyboardAvoidingView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: mobileLayout.headerMinHeight, flexShrink: 0, backgroundColor: colors.white, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  brand: { flexShrink: 1, minWidth: 0, justifyContent: "center", minHeight: 48 },
  logo: { width: 86, height: 34 }, hints: { minHeight: 48, paddingHorizontal: spacing.md, backgroundColor: colors.white },
  actions: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  content: { flex: 1 },
  noticeDismiss: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  // Keep the empty live text mounted; never use display:none/aria-hidden for it.
  noticeEmpty: { height: 0, minHeight: 0, paddingVertical: 0, overflow: "hidden" },
  notice: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
