import { useState } from "react";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppButton, AppTextField } from "../components/ui";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

const logo = require("../../assets/brand/logo-horizontal.png");
const harbourArt = require("../../assets/images/harbour-family-hero.png");
type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const router = useRouter();
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

  return <ScrollView style={styles.scroll} contentContainerStyle={[styles.root, narrow && styles.rootStack]} keyboardShouldPersistTaps="handled">
    <View style={[styles.story, narrow && styles.storyCompact]}>
      <Image source={harbourArt} resizeMode="cover" accessibilityLabel="香港海旁照顧者與孩子插畫" style={styles.storyImage} />
      <View style={styles.storyContent}>
        <Image source={logo} resizeMode="contain" accessibilityLabel="育伴港" style={styles.storyLogo} />
        <Text style={styles.storyEyebrow}>用資料 · 陪伴成長</Text>
        <Text accessibilityRole="header" style={[styles.storyTitle, narrow && styles.storyTitleCompact]}>用 AI，{narrow ? "" : "\n"}更輕鬆做好育兒大小事。</Text>
        <Text style={styles.storyLead}>結合孩子的已確認資料與可靠來源，幫你記錄、討論及看清下一步。</Text>
        {!narrow ? <View style={styles.features}>
          <Text style={styles.feature}>✦　隨時整理照顧問題與記錄</Text>
          <Text style={styles.feature}>▤　清楚區分候選與已確認資料</Text>
          <Text style={styles.feature}>◇　按權限與家人協調</Text>
          <Text style={styles.feature}>◉　保留原文、時間及資料來源</Text>
        </View> : null}
      </View>
    </View>
    <View style={styles.formSide}>
      <View style={styles.formHeader}><Image source={logo} resizeMode="contain" accessibilityLabel="育伴港" style={styles.formLogo} /><Text style={styles.formTagline}>實用 · 可靠 · 與你同行</Text></View>
      <View style={styles.formCard}>
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
        <Pressable accessibilityRole="link" accessibilityLabel="返回主頁合成預覽" onPress={() => router.replace("/")} style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}><Text style={styles.backLinkText}>返回 Web 主頁預覽 →</Text></Pressable>
      </View>
      <Text style={styles.footer}>育伴港 · 用資料陪伴成長</Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.white }, root: { flexGrow: 1, minHeight: "100%", flexDirection: "row" }, rootStack: { flexDirection: "column" }, pressed: { opacity: 0.65 },
  story: { width: "52%", minHeight: 760, backgroundColor: colors.paper, overflow: "hidden" }, storyCompact: { width: "100%", minHeight: 310 }, storyImage: { position: "absolute", width: "100%", height: "100%", opacity: 0.55 }, storyContent: { flex: 1, paddingHorizontal: spacing.hero, paddingVertical: spacing.xxl, justifyContent: "center", gap: spacing.md }, storyLogo: { width: 190, height: 60, alignSelf: "flex-start" }, storyEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.small, fontWeight: "800" }, storyTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.hero, lineHeight: 48, fontWeight: "800", maxWidth: 600 }, storyTitleCompact: { fontSize: typeScale.heading, lineHeight: 38 }, storyLead: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 26, maxWidth: 570 }, features: { marginTop: spacing.lg, gap: spacing.lg }, feature: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "600" },
  formSide: { flex: 1, minWidth: 0, minHeight: 760, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.xl }, formHeader: { alignItems: "center", gap: spacing.xs }, formLogo: { width: 180, height: 58 }, formTagline: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small }, formCard: { width: "100%", maxWidth: 500, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.large, backgroundColor: colors.white, padding: spacing.xl, gap: spacing.md }, formTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800" }, formIntro: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  modeTabs: { flexDirection: "row", borderRadius: radius.small, backgroundColor: colors.neutralSurface, padding: spacing.xs, gap: spacing.xs }, modeTab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.small }, modeActive: { backgroundColor: colors.white, borderBottomWidth: 2, borderBottomColor: colors.teal }, modeText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, fontWeight: "700" }, modeTextActive: { color: colors.deepTeal }, passwordBlock: { gap: spacing.xs }, passwordToggle: { alignSelf: "flex-end", minHeight: 32, paddingHorizontal: spacing.sm, justifyContent: "center" }, passwordToggleText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" }, result: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.paleTeal, borderRadius: radius.small, padding: spacing.md, fontSize: typeScale.small, lineHeight: 22 }, formNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 }, divider: { height: 1, backgroundColor: colors.line }, unavailable: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, backLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }, backLinkText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" }, footer: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
});
