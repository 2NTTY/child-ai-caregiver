import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { BackHandler, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { Button, Portal, Text } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { NotificationBell } from "./NotificationBell";
import { ChildPicker } from "./ChildPicker";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { PreviewToolbar, RightRail } from "./AppShell";

export function NativeAppShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { model, actions, checkedPreviewItems, togglePreviewItem, notice, dismissNotice } = usePreview();
  const [menuOpen, setMenuOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(90);
  useEffect(() => {
    if (!railOpen || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { setRailOpen(false); return true; });
    return () => subscription.remove();
  }, [railOpen]);
  return <View style={[styles.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <View style={styles.header}><Pressable accessibilityRole="link" accessibilityLabel="育伴港，返回主頁" onPress={() => router.push("/")} style={styles.brand}><Image source={require("../../assets/brand/logo-horizontal.png")} resizeMode="contain" style={styles.logo} /></Pressable>
        <View style={styles.actions}><NotificationBell operation={model.operation} connection={model.connection} onReview={actions.reviewOperation} />
          <Pressable accessibilityRole="button" accessibilityLabel="用戶與更多頁面" onPress={() => setMenuOpen(true)} style={styles.avatar}><Text style={styles.initial}>{model.caregiverName.slice(0, 1)}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={railOpen ? "收起資訊側欄" : "開啟資訊側欄"} accessibilityState={{ expanded: railOpen }} onPress={() => setRailOpen(value => !value)} style={styles.railButton}><MaterialCommunityIcons name="page-layout-sidebar-right" color={colors.deepTeal} size={23} /></Pressable>
        </View>
      </View>
      {pathname !== "/" ? <View style={styles.childStrip}><ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} compact /><ChildKeyFacts child={model.children.find(item => item.id === model.selectedChildId)} load={model.profileLoad} /></View> : null}
      <PreviewToolbar />
    </View>
    {notice ? <Pressable accessibilityRole="button" accessibilityLabel="關閉預覽提示" onPress={dismissNotice} style={styles.notice}><Text style={styles.meta}>{notice}</Text></Pressable> : null}
    <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === "ios" ? "padding" : undefined}>{children}</KeyboardAvoidingView>
    {railOpen ? <View style={[styles.overlay, { top: insets.top + headerHeight, bottom: insets.bottom }]}><Pressable accessibilityRole="button" accessibilityLabel="關閉資訊側欄背景" onPress={() => setRailOpen(false)} style={styles.scrim} /><View style={styles.drawer}><RightRail model={model} actions={actions} checkedPreviewItems={checkedPreviewItems} togglePreviewItem={togglePreviewItem} overlay /></View></View> : null}
    <Portal><Dialog visible={menuOpen} onDismiss={() => setMenuOpen(false)}><Dialog.Title>你的照顧空間</Dialog.Title><Dialog.Content>
      <Text style={styles.meta}>{model.caregiverName} · 合成預覽帳戶</Text>
      {([{ key: "profile", label: "子女檔案" }, { key: "care", label: "照顧記錄" }, { key: "family", label: "家庭協調" }, { key: "settings", label: "設定" }, { key: "guide", label: "使用引導" }] as const).map(item => <Button key={item.key} onPress={() => { setMenuOpen(false); actions.open(item.key); }}>{item.label}</Button>)}
      <Button onPress={() => { setMenuOpen(false); router.push("/login"); }}>登入畫面</Button>
    </Dialog.Content><Dialog.Actions><Button onPress={() => setMenuOpen(false)}>關閉</Button></Dialog.Actions></Dialog></Portal>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 68, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  brand: { flexShrink: 1, minWidth: 0, justifyContent: "center", minHeight: 48 },
  logo: { width: 124, height: 44 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.teal, justifyContent: "center", alignItems: "center" },
  initial: { fontFamily: chineseFont, color: colors.white, fontSize: typeScale.body, fontWeight: "700" },
  railButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.small, backgroundColor: colors.quietSurface },
  childStrip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  content: { flex: 1 },
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  overlay: { position: "absolute", left: 0, right: 0, zIndex: 4, flexDirection: "row", justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
  drawer: { width: "92%", maxWidth: 370, height: "100%", backgroundColor: colors.sidebar },
});
