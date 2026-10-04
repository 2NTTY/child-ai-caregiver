import { useId, useRef, useState } from "react";
import { BlurView } from "expo-blur";
import { brand } from "../branding";
import { BrandLogo } from "../components/BrandLogo";
import { useRouter } from "expo-router";
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "../components/AppScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";
import { AppButton, AppTextField } from "../components/ui";
import { MotionDisclosure } from "../motion";
import { MotionSelectionMarker } from "../motion/MotionSelectionMarker";
import { AppIcon } from "../components/AppIcon";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { useFirstScreenImage } from "../startup/FirstScreenGate";

const harbourArt = require("../../assets/images/harbour-family-hero.png");
const harbourSourceSize = { width: 1672, height: 941 };
// Keep the fingertip inside the frame and the sun beyond its fixed right crop.
const harbourRightEdge = 1552;
type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width < 900;
  const [storySize, setStorySize] = useState({ width: 0, height: 0 });
  const artworkScale = Math.max(storySize.width / harbourRightEdge, storySize.height / harbourSourceSize.height);
  const artworkWidth = harbourSourceSize.width * artworkScale;
  const artworkHeight = harbourSourceSize.height * artworkScale;
  const startupImage = useFirstScreenImage("login-hero", artworkScale > 0);
  const [mode, setMode] = useState<Mode>("signIn");
  const modeScope = useId();
  const modeControls = useRef(new Map<Mode, View>());
  const [modePositions, setModePositions] = useState<Partial<Record<Mode, { x: number; width: number }>>>({});
  const modeSelection = modePositions[mode];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function selectMode(next: Mode) { setMode(next); setResult(null); }
  function moveMode(event: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }) {
    const key = event.nativeEvent?.key ?? event.key;
    const next = key === "ArrowLeft" || key === "ArrowRight" ? mode === "signIn" ? "signUp" : "signIn" : key === "Home" ? "signIn" : key === "End" ? "signUp" : null;
    if (!next) return;
    event.preventDefault(); selectMode(next);
    (modeControls.current.get(next) as unknown as HTMLElement | undefined)?.focus();
  }
  function validate() {
    if (mode === "signUp" && !name.trim()) { setResult("請填寫稱呼。這是本地表單檢查，沒有建立帳戶。"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setResult("請輸入有效電郵地址。這是本地表單檢查。"); return; }
    if (!password) { setResult("請輸入密碼。這是本地表單檢查。"); return; }
    if (mode === "signUp" && password.length < 12) { setResult("建立帳戶需要至少 12 個字元的密碼；預覽不會提交資料。"); return; }
    setResult(`表單格式已通過；此預覽沒有連接 Server，未有${mode === "signIn" ? "登入" : "建立帳戶"}。`);
  }

  return <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView style={styles.scroll} contentContainerStyle={[styles.root, narrow && styles.rootStack, { paddingTop: insets.top, paddingBottom: insets.bottom }]} keyboardShouldPersistTaps="handled">
    {!narrow ? <View testID="login-story-column" style={[styles.story, styles.storyDesktop]} onLayout={({ nativeEvent: { layout } }) => setStorySize(current => current.width === layout.width && current.height === layout.height ? current : { width: layout.width, height: layout.height })}>
      {!startupImage.fallback ? <Image testID="login-background-image" source={harbourArt} resizeMode="cover" onLoad={startupImage.onLoad} onError={startupImage.onError} accessibilityLabel="香港海旁照顧者與孩子插畫" style={[styles.storyImage, { opacity: artworkScale > 0 ? 0.55 : 0, width: artworkWidth, height: artworkHeight, right: (harbourRightEdge - harbourSourceSize.width) * artworkScale, top: (storySize.height - artworkHeight) / 2 }]} /> : null}
      <View testID="login-story-content" style={[styles.storyContent, styles.storyReadingWidth]}>
        <BlurView testID="login-story-panel" intensity={32} tint="light" style={styles.storyPanel}>
        <BrandLogo style={styles.storyLogo} />
        <Text style={styles.storyEyebrow}>用資料 · 陪伴成長</Text>
        <Text accessibilityRole="header" style={[styles.storyTitle, narrow && styles.storyTitleCompact]}>用 AI，{narrow ? "" : "\n"}更輕鬆做好育兒大小事。</Text>
        <Text style={styles.storyLead}>結合孩子的已確認資料與可靠來源，幫你記錄、討論及看清下一步。</Text>
        <View style={styles.features}>
          <View style={styles.featureRow}><AppIcon name="message-text-outline" /><Text style={styles.feature}>隨時整理照顧問題與記錄</Text></View>
          <View style={styles.featureRow}><AppIcon name="file-document-outline" /><Text style={styles.feature}>清楚區分候選與已確認資料</Text></View>
          <View style={styles.featureRow}><AppIcon name="account-group-outline" /><Text style={styles.feature}>按權限與家人協調</Text></View>
          <View style={styles.featureRow}><AppIcon name="shield-check-outline" /><Text style={styles.feature}>保留原文、時間及資料來源</Text></View>
        </View>
        </BlurView>
      </View>
    </View> : null}
    <View testID="login-form-column" style={[styles.formSide, narrow ? styles.formCompact : styles.formDesktop]}>
      <View style={styles.formHeader}><BrandLogo style={styles.formLogo} /><Text style={styles.formTagline}>實用 · 可靠 · 與你同行</Text></View>
      <View style={styles.formCard}>
        <Text accessibilityRole="header" style={styles.formTitle}>{mode === "signIn" ? "歡迎回來" : "建立帳戶"}</Text>
        <Text style={styles.formIntro}>{mode === "signIn" ? "登入後，繼續整理孩子的照顧資料。" : "先建立自己的帳戶，再新增孩子的資料。"}</Text>
        <View accessibilityRole="tablist" accessibilityLabel="登入方式" style={styles.modeTabs}>
          {([{ key: "signIn", label: "電郵登入" }, { key: "signUp", label: "註冊帳戶" }] as const).map(item => <Pressable key={item.key}
            ref={instance => { if (instance) modeControls.current.set(item.key, instance); else modeControls.current.delete(item.key); }}
            accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: mode === item.key }} aria-selected={mode === item.key} tabIndex={mode === item.key ? 0 : -1}
            onPress={() => selectMode(item.key)} onLayout={event => { const { x, width } = event.nativeEvent.layout; setModePositions(current => current[item.key]?.x === x && current[item.key]?.width === width ? current : { ...current, [item.key]: { x, width } }); }}
            {...(Platform.OS === "web" ? { onKeyDown: moveMode } : {})}
            style={({ pressed }) => [styles.modeTab, mode === item.key && styles.modeActive, mode === item.key && !modeSelection && styles.modeInitialMarker, pressed && styles.pressed]}>
            <Text style={[styles.modeText, mode === item.key && styles.modeTextActive]}>{item.label}</Text></Pressable>)}
          <MotionSelectionMarker x={modeSelection?.x ?? 0} width={modeSelection?.width ?? 0} selectionKey={`${modeScope}:${mode}`} />
        </View>
        <MotionDisclosure expanded={mode === "signUp"} scopeKey={modeScope} testID="login-name-disclosure"><AppTextField label="稱呼" accessibilityLabel="稱呼" value={name} onChangeText={setName} autoComplete="name" /></MotionDisclosure>
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
  </ScrollView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  storyPanel: { padding: spacing.xl, gap: spacing.md, borderRadius: radius.large, overflow: "hidden", borderWidth: 1, borderColor: colors.white },
  formCompact: { minHeight: 0, paddingVertical: spacing.xl },
  storyDesktop: { width: "64%", minWidth: 0, flexShrink: 1 },
  storyReadingWidth: { width: "52%", minWidth: 360, maxWidth: 520 },
  formDesktop: { flexGrow: 0, flexShrink: 0, flexBasis: "36%", minWidth: 400, paddingHorizontal: spacing.xxl },
  featureRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  scroll: { flex: 1, backgroundColor: colors.white }, root: { flexGrow: 1, minHeight: "100%", flexDirection: "row" }, rootStack: { flexDirection: "column" }, pressed: { opacity: 0.65 },
  story: { width: "52%", minHeight: 760, backgroundColor: colors.paper, overflow: "hidden" }, storyCompact: { width: "100%", minHeight: 310 }, storyImage: { position: "absolute", width: "100%", height: "100%", opacity: 0.55 }, storyContent: { flex: 1, paddingHorizontal: spacing.hero, paddingVertical: spacing.xxl, justifyContent: "center", gap: spacing.md }, storyLogo: { width: 190, height: 60, alignSelf: "flex-start" }, storyEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.small, fontWeight: "800" }, storyTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.hero, lineHeight: 48, fontWeight: "800", maxWidth: 600 }, storyTitleCompact: { fontSize: typeScale.heading, lineHeight: 38 }, storyLead: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 26, maxWidth: 570 }, features: { marginTop: spacing.lg, gap: spacing.lg }, feature: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "600" },
  formSide: { flex: 1, minWidth: 0, minHeight: 760, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.xl }, formHeader: { alignItems: "center", gap: spacing.xs }, formLogo: { width: 180, height: 58 }, formTagline: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small }, formCard: { width: "100%", maxWidth: 500, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.large, backgroundColor: colors.white, padding: spacing.xl, gap: spacing.md }, formTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800" }, formIntro: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  modeTabs: { flexDirection: "row", borderRadius: radius.small, backgroundColor: colors.neutralSurface, padding: spacing.xs, gap: spacing.xs }, modeTab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.small }, modeActive: { backgroundColor: colors.white }, modeInitialMarker: { borderBottomWidth: 2, borderBottomColor: colors.teal }, modeText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, fontWeight: "700" }, modeTextActive: { color: colors.deepTeal }, passwordBlock: { gap: spacing.xs }, passwordToggle: { alignSelf: "flex-end", minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: "center" }, passwordToggleText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" }, result: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.paleTeal, borderRadius: radius.small, padding: spacing.md, fontSize: typeScale.small, lineHeight: 22 }, formNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 }, divider: { height: 1, backgroundColor: colors.line }, unavailable: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, backLink: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start" }, backLinkText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" }, footer: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
});
