import { useHeaderOperationHints } from "../production/useHeaderOperationHints";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { AccessibilityInfo, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { brand } from "../branding";
import { MotionDrawerOverlay } from "../motion";
import { AppIcon } from "./AppIcon";
import { BrandLogo } from "./BrandLogo";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProductionHome as useProduction } from "../production/useProductionHome";
import { chineseFont, colors, mobileLayout, spacing, typeScale } from "../theme";
import { NotificationBell } from "./NotificationBell";
import { CompactHeaderIdentity } from "./CompactHeaderIdentity";
import { RightRail } from "./AppShell";

export function NativeAppShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const leave = usePreviewNavigation();
  const pathname = usePathname();
  const operationHints = useHeaderOperationHints();
  const { model, actions, notice, dismissNotice, scopeKey, identityKey } = useProduction();
  const announcedNotice = useRef<string | null>(null);
  useEffect(() => {
    // Live Text covers Android. iOS needs its explicit queued announcement API.
    if (announcedNotice.current === notice) return;
    announcedNotice.current = notice;
    if (Platform.OS === "ios" && notice) AccessibilityInfo.announceForAccessibilityWithOptions(notice, { queue: true });
  }, [notice]);
  const [railOpen, setRailOpen] = useState(false);
  const selectedChild = model.children.find(item => item.id === model.selectedChildId);
  const motionScope = scopeKey ?? identityKey ?? "signed-out";
  const railContext = useRef({ path: pathname, scope: "" });
  const overlayOpen = railOpen && railContext.current.path === pathname && railContext.current.scope === motionScope;
  useEffect(() => { setRailOpen(false); }, [pathname, motionScope]);
  return <View style={[styles.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <View>
      <View style={styles.header}><CompactHeaderIdentity hints={operationHints} showContext scopeKey={motionScope} routeKey={pathname} model={model} actions={actions}
        brand={<Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} onPress={() => leave(() => router.push("/"), "workspace")} style={styles.brand}><BrandLogo style={styles.logo} decorative /></Pressable>} />
        <View testID="header-actions" style={styles.actions}><NotificationBell />
          <ToolbarIconButton icon="page-layout-sidebar-right" label={overlayOpen ? "收起資訊側欄" : "開啟資訊側欄"} expanded={overlayOpen} onPress={() => { railContext.current = { path: pathname, scope: motionScope }; setRailOpen(value => !value); }} />
        </View>
      </View>

    </View>
    <View style={[styles.notice, !notice && styles.noticeEmpty]}><Text accessibilityLiveRegion="polite" style={[styles.meta, {flex: 1}]}>{notice ?? ""}</Text>{notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉提示" onPress={dismissNotice} style={styles.noticeDismiss}><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}</View>
    <View style={styles.content}>{children}</View>
    <MotionDrawerOverlay open={overlayOpen} scopeKey={`${motionScope}:${pathname}`} label="照顧資訊側欄" onRequestClose={() => setRailOpen(false)}>
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}><RightRail model={model} actions={actions} contextPath={pathname} overlay onClose={() => setRailOpen(false)} /></View>
    </MotionDrawerOverlay>
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
  header: { height: mobileLayout.headerMinHeight, flexShrink: 0, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  brand: { flexShrink: 1, minWidth: 0, justifyContent: "center", minHeight: 48 },
  logo: { width: 124, height: 44 },
  actions: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  content: { flex: 1 },
  noticeDismiss: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  // Keep the empty live text mounted; never use display:none/aria-hidden for it.
  noticeEmpty: { height: 0, minHeight: 0, paddingVertical: 0, overflow: "hidden" },
  notice: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
