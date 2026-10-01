import { useState } from "react";
import { brand } from "../branding";
import { BrandLogo } from "../components/BrandLogo";
import { useRouter } from "expo-router";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";
import { AppButton, AppTextField } from "../components/ui";
import { AppIcon } from "../components/AppIcon";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

const harbourArt = require("../../assets/images/harbour-family-hero.png");
type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width < 900;
  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function validate() {
    if (mode === "signUp" && !name.trim()) { setResult("請填寫稱呼。這是本地表單檢查，沒有建立帳戶。"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setResult("請輸入有效電郵地址。這是本地表單檢查。"); return; }
    if (!password) { setResult("請輸入密碼。這是本地表單檢查。"); return; }
    if (mode === "signUp" && password.length < 12) { setResult("建立帳戶需要至少 12 個字元的密碼；預覽不會提交資料。"); return; }
    setResult(`表單格式已通過；此預覽沒有連接 Server，未有${mode === "signIn" ? "登入" : "建立帳戶"}。`);
  }

  return <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Image testID="login-background-image" source={harbourArt} accessible={false} resizeMode="cover" style={styles.backgroundImage} />
    </View>
    <ScrollView style={styles.scrollContent} contentContainerStyle={[styles.root, narrow && styles.rootStack, { paddingTop: insets.top, paddingBottom: insets.bottom }]} keyboardShouldPersistTaps="handled">
    <View testID="login-form-column" style={[styles.formSide, !narrow && styles.formSideSplit]}>
      <View style={styles.formCard}>
        <View style={styles.formHeader}>
          <BrandLogo style={styles.formLogo} /><Text style={styles.formTagline}>實用 · 可靠 · 與你同行</Text>
          <Text style={styles.brandTitle}>用 AI，更輕鬆做好育兒大小事。</Text>
          <Text style={styles.brandLead}>結合孩子的已確認資料與可靠來源，幫你記錄、討論及看清下一步。</Text>
        </View>
        <View style={styles.divider} />
        <Text accessibilityRole="header" style={styles.formTitle}>{mode === "signIn" ? "歡迎回來" : "建立帳戶"}</Text>
        <Text style={styles.formIntro}>{mode === "signIn" ? "登入後，繼續整理孩子的照顧資料。" : "先建立自己的帳戶，再新增孩子的資料。"}</Text>
        <View style={styles.modeTabs}>
          <Pressable accessibilityRole="tab" accessibilityLabel="電郵登入" accessibilityState={{ selected: mode === "signIn" }} onPress={() => { setMode("signIn"); setResult(null); }} style={({ pressed }) => [styles.modeTab, mode === "signIn" && styles.modeActive, pressed && styles.pressed]}><Text style={[styles.modeText, mode === "signIn" && styles.modeTextActive]}>電郵登入</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityLabel="註冊帳戶" accessibilityState={{ selected: mode === "signUp" }} onPress={() => { setMode("signUp"); setResult(null); }} style={({ pressed }) => [styles.modeTab, mode === "signUp" && styles.modeActive, pressed && styles.pressed]}><Text style={[styles.modeText, mode === "signUp" && styles.modeTextActive]}>註冊帳戶</Text></Pressable>
        </View>
        {mode === "signUp" ? <AppTextField label="稱呼" accessibilityLabel="稱呼" value={name} onChangeText={setName} autoComplete="name" /> : null}
        <AppTextField label="電郵地址" accessibilityLabel="電郵地址" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
        <View style={styles.passwordBlock}><AppTextField label={mode === "signUp" ? "密碼（至少 12 個字元）" : "密碼"} accessibilityLabel="密碼" value={password} onChangeText={setPassword} secureTextEntry={!passwordVisible} autoCapitalize="none" autoComplete={mode === "signUp" ? "new-password" : "current-password"} /><Pressable accessibilityRole="button" accessibilityLabel={passwordVisible ? "隱藏密碼" : "顯示密碼"} onPress={() => setPasswordVisible(value => !value)} style={({ pressed }) => [styles.passwordToggle, pressed && styles.pressed]}><Text style={styles.passwordToggleText}>{passwordVisible ? "隱藏" : "顯示"}</Text></Pressable></View>
        <AppButton label={mode === "signIn" ? "登入（預覽）" : "建立帳戶（預覽）"} onPress={validate} />
        {result ? <Text accessibilityLiveRegion="polite" style={styles.result}>{result}</Text> : null}
        <Text style={styles.formNote}>本頁只檢查輸入及展示介面；不會傳送密碼，也不會建立登入狀態。</Text>
        <View style={styles.divider} />
        <Text style={styles.unavailable}>參考圖中的手機、Google／Apple 登入和忘記密碼尚未有本項目可用的正式接線，因此不提供假按鈕。</Text>
        <Pressable accessibilityRole="link" accessibilityLabel="返回主頁合成預覽" onPress={() => router.replace("/")} style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}><Text style={styles.backLinkText}>返回 Web 主頁預覽</Text><AppIcon name="arrow-right" size={18} /></Pressable>
      </View>
      <Text style={styles.footer}>{brand.name} · 用資料陪伴成長</Text>
    </View>
    {!narrow ? <View testID="login-illustration-space" pointerEvents="none" style={styles.illustrationSpace} /> : null}
  </ScrollView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.paper }, scrollContent: { flex: 1 }, backgroundImage: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  root: { flexGrow: 1, minHeight: "100%", flexDirection: "row" }, rootStack: { flexDirection: "column" }, pressed: { opacity: 0.65 }, illustrationSpace: { flex: 1 },
  formSide: { width: "100%", minWidth: 0, minHeight: 760, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.xl }, formSideSplit: { width: "48%" },
  formHeader: { alignItems: "center", gap: spacing.sm }, formLogo: { width: 180, height: 58 }, formTagline: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small },
  brandTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", textAlign: "center" }, brandLead: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22, textAlign: "center" },
  formCard: { width: "100%", maxWidth: 500, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.large, backgroundColor: colors.white, padding: spacing.xl, gap: spacing.md }, formTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800" }, formIntro: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  modeTabs: { flexDirection: "row", borderRadius: radius.small, backgroundColor: colors.neutralSurface, padding: spacing.xs, gap: spacing.xs }, modeTab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.small }, modeActive: { backgroundColor: colors.white, borderBottomWidth: 2, borderBottomColor: colors.teal }, modeText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, fontWeight: "700" }, modeTextActive: { color: colors.deepTeal }, passwordBlock: { gap: spacing.xs }, passwordToggle: { alignSelf: "flex-end", minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: "center" }, passwordToggleText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" }, result: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.paleTeal, borderRadius: radius.small, padding: spacing.md, fontSize: typeScale.small, lineHeight: 22 }, formNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 }, divider: { height: 1, backgroundColor: colors.line }, unavailable: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, backLink: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start" }, backLinkText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" }, footer: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
});
