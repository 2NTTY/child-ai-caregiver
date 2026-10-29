import { WorkspaceNavigation } from "./workspace/WorkspaceNavigation";
import { useHeaderOperationHints } from "../production/useHeaderOperationHints";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { KeyboardAvoidingView, Pressable, StyleSheet, View } from "react-native";
import { brand } from "../branding";
import { AppIcon } from "./AppIcon";
import { BrandLogo } from "./BrandLogo";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProductionHome as useProduction } from "../production/useProductionHome";
import { chineseFont, colors, mobileLayout, spacing, typeScale } from "../theme";
import { NotificationBell } from "./NotificationBell";
import { CompactHeaderIdentity } from "./CompactHeaderIdentity";

export function NativeAppShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const leave = usePreviewNavigation();
  const pathname = usePathname();
  const operationHints = useHeaderOperationHints();
  const { model, actions, notice, dismissNotice, scopeKey, identityKey, owner } = useProduction();
  const motionScope = scopeKey ?? identityKey ?? "signed-out";
  const current = useRef({ pathname, scopeKey }); current.current = { pathname, scopeKey };
  const openHome = () => leave(() => {
    const snapshot = owner.getSnapshot();
    if (snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey && current.current.pathname === pathname && current.current.scopeKey === scopeKey) router.push("/");
  }, "workspace");
  const isCurrent = () => { const snapshot = owner.getSnapshot(); return snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey; };
  return <WorkspaceNavigation.Root pathname={pathname} layout="compact" scopeKey={scopeKey} isCurrent={isCurrent}><View style={[styles.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <View>
      <View style={styles.header}><CompactHeaderIdentity hints={operationHints} showContext scopeKey={motionScope} routeKey={pathname} model={model} actions={actions}
        brand={<Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} onPress={openHome} style={styles.brand}><BrandLogo style={styles.logo} decorative /></Pressable>} />
        <View testID="header-actions" style={styles.actions}><NotificationBell />

        </View>
      </View>

    </View>
    {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉提示" onPress={dismissNotice} style={styles.notice}><Text style={[styles.meta, {flex: 1}]}>{notice}</Text><AppIcon name="close" size={18} color={colors.warningInk} /></Pressable> : null}
    <View style={styles.content}>{children}</View>

  </View></WorkspaceNavigation.Root>;
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
  header: { minHeight: mobileLayout.headerMinHeight, flexShrink: 0, backgroundColor: colors.sidebar, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  brand: { flexShrink: 1, minWidth: 0, justifyContent: "center", minHeight: 48 },
  logo: { width: 124, height: 44 },
  actions: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  content: { flex: 1 },
  notice: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
