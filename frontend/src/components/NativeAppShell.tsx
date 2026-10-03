import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { brand } from "../branding";
import { MotionEntrance } from "../motion";
import { BrandLogo } from "./BrandLogo";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, mobileLayout, spacing, typeScale } from "../theme";
import { NotificationBell } from "./NotificationBell";
import { ChildPicker } from "./ChildPicker";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { PreviewToolbar, RightRail } from "./AppShell";

export function NativeAppShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const leave = usePreviewNavigation();
  const pathname = usePathname();
  const { model, actions, notice, dismissNotice } = usePreview();
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => { setRailOpen(false); }, [pathname]);
  return <View style={[styles.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <View>
      <View style={styles.header}><Pressable accessibilityRole="link" accessibilityLabel={brand.homeLabel} onPress={() => leave(() => router.push("/"))} style={styles.brand}><BrandLogo style={styles.logo} decorative /></Pressable>
        <View testID="header-actions" style={styles.actions}><NotificationBell operation={model.operation} connection={model.connection} onReview={actions.reviewOperation} />
          <ToolbarIconButton icon="page-layout-sidebar-right" label={railOpen ? "收起資訊側欄" : "開啟資訊側欄"} expanded={railOpen} onPress={() => setRailOpen(value => !value)} />
        </View>
      </View>
      {pathname !== "/" ? <View style={styles.childStrip}><ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} compact /><ChildKeyFacts child={model.children.find(item => item.id === model.selectedChildId)} load={model.profileLoad} /></View> : null}
      <PreviewToolbar />
    </View>
    {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉預覽提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.meta}>{notice}</Text></Pressable> : null}
    <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === "ios" ? "padding" : undefined}>{children}</KeyboardAvoidingView>
    {railOpen ? <Modal visible transparent animationType="none" onRequestClose={() => setRailOpen(false)}>
      <View style={styles.overlay}><View accessible={false} onStartShouldSetResponder={() => true} onResponderRelease={() => setRailOpen(false)} style={styles.scrim} />
        <MotionEntrance preset="dialog" triggerKey="context-drawer" scopeKey={`${model.caregiverName}:${model.selectedChildId}`} animateOnMount accessibilityViewIsModal accessibilityLabel="照顧上下文" style={[styles.drawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <RightRail model={model} actions={actions} home={pathname === "/"} overlay onClose={() => setRailOpen(false)} />
        </MotionEntrance></View>
    </Modal> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: mobileLayout.headerMinHeight, backgroundColor: colors.sidebar, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  brand: { flexShrink: 1, minWidth: 0, justifyContent: "center", minHeight: 48 },
  logo: { width: 124, height: 44 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  childStrip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.sidebar },
  content: { flex: 1 },
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  overlay: { flex: 1, flexDirection: "row", justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
  drawer: { width: "92%", maxWidth: 370, height: "100%", backgroundColor: colors.sidebar },
});
