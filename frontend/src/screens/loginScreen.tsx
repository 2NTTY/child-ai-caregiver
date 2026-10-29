import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentRef } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { useIsFocused, useRouter } from "expo-router";
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "../components/AppScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "react-native-paper";
import { AppButton, AppTextField } from "../components/ui";
import { FormFieldMessage } from "../components/FormErrorSummary";
import { MotionDisclosure } from "../motion";
import { MotionSelectionMarker } from "../motion/MotionSelectionMarker";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { useFirstScreenImage } from "../startup/FirstScreenGate";
import { useProduction } from "../production/ProductionProvider";

const harbourArt = require("../../assets/images/harbour-family-hero.png");
const harbourSourceSize = { width: 1672, height: 941 };
type Mode = "signIn" | "signUp";
type LoginField = "name" | "email" | "password";

export default function LoginPage() {
  const router = useRouter();
  const focused = useIsFocused();
  const { authenticate, refresh, identityKey, auth, online, recordsState, account, accountActions, owner } = useProduction();
  useEffect(() => { if (focused && identityKey) router.replace("/"); }, [focused, identityKey, router]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width < 900;
  const startupImage = useFirstScreenImage("login-hero", !narrow);
  const [mode, setMode] = useState<Mode>("signIn");
  const modeScope = useId();
  const modeControls = useRef(new Map<Mode, View>());
  const [modePositions, setModePositions] = useState<Partial<Record<Mode, { x: number; width: number }>>>({});
  const modeSelection = modePositions[mode];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<LoginField, string>>>({});
  const controls = useRef<Partial<Record<LoginField, ComponentRef<typeof TextInput>>>>({});
  const [invalidSubmit, setInvalidSubmit] = useState<{ field: LoginField } | null>(null);
  useLayoutEffect(() => { if (invalidSubmit) controls.current[invalidSubmit.field]?.focus(); }, [invalidSubmit]);
  const fieldRef = (field: LoginField) => (node: ComponentRef<typeof TextInput> | null) => { if (node) controls.current[field] = node; else delete controls.current[field]; };
  const errorId = (field: LoginField) => `${modeScope}-${field}-message`;
  const edited = (field: LoginField) => setErrors(previous => previous[field] ? { ...previous, [field]: undefined } : previous);
  const busy = recordsState.busy === "auth" || auth === "checking" || !!account.busy;
  const canSubmit = online && auth !== "unavailable" && !identityKey && !!account.status && !busy;
  useEffect(() => { setPassword(""); setPasswordVisible(false); }, [identityKey, online]);

  function selectMode(next: Mode) { setMode(next); setPassword(""); setPasswordVisible(false); setErrors({}); setInvalidSubmit(null); }
  function moveMode(event: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }) {
    const key = event.nativeEvent?.key ?? event.key;
    const next = key === "ArrowLeft" || key === "ArrowRight" ? mode === "signIn" ? "signUp" : "signIn" : key === "Home" ? "signIn" : key === "End" ? "signUp" : null;
    if (!next) return;
    event.preventDefault(); selectMode(next);
    (modeControls.current.get(next) as unknown as HTMLElement | undefined)?.focus();
  }
  async function submit() {
    if (!canSubmit) return;
    const next: Partial<Record<LoginField, string>> = {};
    if (mode === "signUp" && !name.trim()) next.name = "請填寫稱呼。";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "請輸入有效電郵地址。";
    if (password.length > 128) next.password = "密碼最多 128 個字元。";
    else if (!password) next.password = "請輸入密碼。";
    else if (mode === "signUp" && password.length < 12) next.password = "建立帳戶需要至少 12 個字元的密碼。";
    setErrors(next);
    const first = (["name", "email", "password"] as const).find(field => next[field]);
    if (first) { setInvalidSubmit({ field: first }); return; }
    setInvalidSubmit(null);
    const credentials = { name, email, password }; setPassword(""); setPasswordVisible(false);
    try { await authenticate(mode, credentials); }
    finally { setPassword(""); }
  }

  return <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView style={styles.scroll} contentContainerStyle={[styles.root, narrow && styles.rootStack, { paddingTop: insets.top, paddingBottom: insets.bottom }]} keyboardShouldPersistTaps="handled">
    {!narrow ? <View testID="login-story-column" style={[styles.story, styles.storyDesktop]}>
      <View testID="login-story-content" style={styles.storyContent}>
        <Text style={styles.storyEyebrow}>育伴港 · 照顧日常的工作台</Text>
        <Text accessibilityRole="header" aria-level={2} style={styles.storyTitle}>把照顧的每一步，{"\n"}整理得更清楚。</Text>
        <Text style={styles.storyLead}>記下當下的問題，核對資料來源。讓你和家人看清已確認的事，以及接下來的安排。</Text>
      </View>
      <View testID="login-art-stage" style={styles.artStage}>
        {!startupImage.fallback ? <Image testID="login-background-image" source={harbourArt} resizeMode="contain" onLoad={startupImage.onLoad} onError={startupImage.onError} accessibilityLabel="香港海旁照顧者與孩子插畫" style={styles.storyImage} />
          : <View style={styles.artFallback}><Text style={styles.storyEyebrow}>在日常照顧裡，一步一步同行。</Text></View>}
      </View>
      <Text style={styles.storyNote}>孩子資料、照顧記錄與下一步，各有清楚的位置。</Text>
    </View> : null}
    <View testID="login-form-column" style={[styles.formSide, narrow ? styles.formCompact : styles.formDesktop]}>
      <View style={styles.formHeader}><BrandLogo style={styles.formLogo} /><Text style={styles.formTagline}>你的育兒工作台</Text></View>
      <View style={styles.formCard}>

        <Text accessibilityRole="header" aria-level={1} style={styles.formTitle}>{mode === "signIn" ? "歡迎回來" : "建立帳戶"}</Text>
        <Text style={styles.formIntro}>{mode === "signIn" ? "登入後，繼續整理孩子的照顧資料。" : "先建立自己的帳戶，再新增孩子的資料。"}</Text>
        {mode === "signUp" && account.status?.registration === "invite" ? <Text style={styles.formNote}>目前只接受獲邀電郵註冊；完成電郵驗證及資料使用確認後，即可新增孩子。</Text> : account.status?.registration === "trial" ? <Text style={styles.formNote}>目前為試用模式，請依服務說明使用合成資料。</Text> : null}
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
        <MotionDisclosure expanded={mode === "signUp"} scopeKey={modeScope} testID="login-name-disclosure"><View>
          <AppTextField ref={fieldRef("name")} name="name" label="稱呼" accessibilityLabel="稱呼" value={name} onChangeText={value => { setName(value); edited("name"); }} autoComplete="name"
            error={!!errors.name} aria-invalid={!!errors.name} aria-describedby={errors.name ? errorId("name") : undefined} />
          <FormFieldMessage id={errorId("name")} error={errors.name} />
        </View></MotionDisclosure>
        <View><AppTextField ref={fieldRef("email")} name="email" label="電郵地址" accessibilityLabel="電郵地址" value={email} onChangeText={value => { setEmail(value); edited("email"); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="email"
          error={!!errors.email} aria-invalid={!!errors.email} aria-describedby={errors.email ? errorId("email") : undefined} />
          <FormFieldMessage id={errorId("email")} error={errors.email} />
        </View>
        <View><AppTextField ref={fieldRef("password")} name="password" label={mode === "signUp" ? "密碼（至少 12 個字元）" : "密碼"} accessibilityLabel="密碼" value={password} onChangeText={value => { setPassword(value); edited("password"); }}
          secureTextEntry={!passwordVisible} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete={mode === "signUp" ? "new-password" : "current-password"}
          error={!!errors.password} aria-invalid={!!errors.password} aria-describedby={errors.password ? errorId("password") : undefined}
          returnKeyType="go" onSubmitEditing={() => { if (canSubmit) void submit(); }}
          right={<TextInput.Icon icon={passwordVisible ? "eye-off" : "eye"} accessibilityLabel={passwordVisible ? "隱藏密碼" : "顯示密碼"}
            forceTextInputFocus={false} onPress={() => setPasswordVisible(value => !value)} />} />
          <FormFieldMessage id={errorId("password")} error={errors.password} />
        </View>
        <View style={styles.recoveryRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="重新要求驗證指引"
          disabled={!online || busy || !account.status?.mailConfigured} accessibilityState={{ disabled: !online || busy || !account.status?.mailConfigured }}
          onPress={() => { setPassword(""); setErrors({}); setInvalidSubmit(null); void accountActions.requestEmail("verification", email); }}
          style={({ pressed }) => [styles.recoveryLink, pressed && styles.pressed]}><Text style={styles.recoveryText}>重寄驗證</Text></Pressable>
        {mode === "signIn" ? <Pressable accessibilityRole="button" accessibilityLabel="忘記密碼" disabled={!online || busy || !account.status?.mailConfigured}
          accessibilityState={{ disabled: !online || busy || !account.status?.mailConfigured }}
          onPress={() => { setPassword(""); setErrors({}); setInvalidSubmit(null); void accountActions.requestEmail("reset", email); }}
          style={({ pressed }) => [styles.recoveryLink, pressed && styles.pressed]}><Text style={styles.recoveryText}>忘記密碼？</Text></Pressable> : null}
        </View>
        <AppButton label={mode === "signIn" ? "登入" : "建立帳戶"} loading={busy} disabled={!canSubmit} onPress={() => { void submit(); }} />
        {account.notice || recordsState.notice ? <Text accessibilityLiveRegion="polite" style={styles.result}>{account.notice ?? recordsState.notice}</Text> : null}
        {!online ? <Text style={styles.formNote}>目前未能連線，請連線後再試。</Text> : null}
        {auth === "unavailable" ? <AppButton label="重新檢查登入狀態" disabled={!online} variant="secondary" onPress={() => { void refresh(); }} /> : null}
        {account.gate === "error" ? <AppButton label="重新確認帳戶服務" variant="secondary" disabled={!online} onPress={() => { void owner.accountOwner.loadStatus(); }} /> : null}

      </View>
    </View>
  </ScrollView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  formCompact: { minHeight: 0, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  storyDesktop: { width: "56%", minWidth: 0, flexShrink: 1 },
  formDesktop: { flexGrow: 0, flexShrink: 0, flexBasis: "44%", minWidth: 400, paddingHorizontal: spacing.xxl },
  scroll: { flex: 1, backgroundColor: colors.white }, root: { flexGrow: 1, minHeight: "100%", flexDirection: "row" }, rootStack: { flexDirection: "column" }, pressed: { backgroundColor: colors.pressedOverlay },
  story: { minHeight: 760, backgroundColor: colors.paper, paddingTop: spacing.hero, paddingBottom: spacing.xxl, justifyContent: "space-between", gap: spacing.xl, overflow: "hidden" },
  storyContent: { paddingHorizontal: spacing.xxl, gap: spacing.lg, maxWidth: 600 },
  storyEyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.small, lineHeight: 24, fontWeight: "700" },
  storyTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.hero, lineHeight: 48, fontWeight: "800" },
  storyLead: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 28, maxWidth: 480 },
  artStage: { width: "100%", aspectRatio: harbourSourceSize.width / harbourSourceSize.height, overflow: "hidden" },
  storyImage: { width: "100%", height: "100%" }, artFallback: { flex: 1, paddingHorizontal: spacing.xxl, justifyContent: "center", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.softLine },
  storyNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 22, paddingHorizontal: spacing.xxl },
  formSide: { backgroundColor: colors.canvas, flex: 1, minWidth: 0, minHeight: 760, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.xl }, formHeader: { width: "100%", maxWidth: 440, alignItems: "flex-start", gap: spacing.xs }, formLogo: { width: 180, height: 58 }, formTagline: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small }, formCard: { width: "100%", maxWidth: 460, gap: spacing.lg, padding: spacing.xl, borderRadius: radius.large, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white }, formTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800" }, formIntro: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  modeTabs: { flexDirection: "row", borderRadius: radius.small, backgroundColor: colors.neutralSurface, padding: spacing.xs, gap: spacing.xs }, modeTab: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.small }, modeActive: { backgroundColor: colors.white }, modeInitialMarker: { borderBottomWidth: 2, borderBottomColor: colors.teal }, modeText: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, fontWeight: "700" }, modeTextActive: { color: colors.deepTeal }, recoveryRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: spacing.md }, recoveryLink: { minHeight: 44, paddingHorizontal: spacing.xs, justifyContent: "center", borderRadius: radius.small }, recoveryText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, textDecorationLine: "underline" }, result: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.paleTeal, borderRadius: radius.small, padding: spacing.md, fontSize: typeScale.small, lineHeight: 22 }, formNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 },
});
