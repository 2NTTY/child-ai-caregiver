import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Image, KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "react-native-paper";
import { Controller, useForm, useFormState } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BrandLogo } from "../components/BrandLogo";
import { AppScrollView as ScrollView } from "../components/AppScrollView";
import { AppButton, AppTextField } from "../components/ui";
import { FormErrorSummary, FormFieldMessage } from "../components/FormErrorSummary";
import { loginFormSchemas, type LoginFormValues, type LoginMode } from "../components/auth/login-form";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { useProduction } from "../production/ProductionProvider";

const harbourArt = require("../../assets/images/harbour-family-hero.png");

export default function LoginPage() {
  const router = useRouter(), focused = useIsFocused();
  const { authenticate, refresh, identityKey, auth, online, recordsState, account, accountActions, owner } = useProduction();
  useEffect(() => { if (focused && identityKey) router.replace("/"); }, [focused, identityKey, router]);
  const insets = useSafeAreaInsets(), { width } = useWindowDimensions(), narrow = width < 900;
  const [mode, setMode] = useState<LoginMode>("signIn"), [passwordVisible, setPasswordVisible] = useState(false), [artworkFailed, setArtworkFailed] = useState(false);
  const formId = useId(), intent = useRef(0), active = useRef(focused);
  active.current = focused;
  useEffect(() => { active.current = focused; return () => { active.current = false; intent.current++; }; }, [focused]);
  const { control, handleSubmit, setFocus, resetField, clearErrors, getValues } = useForm<LoginFormValues>({
    defaultValues: { name: "", email: "", password: "" }, resolver: zodResolver(loginFormSchemas[mode]), shouldFocusError: false,
  });
  const { errors } = useFormState({ control });
  const busy = recordsState.busy === "auth" || auth === "checking" || !!account.busy;
  const canSubmit = online && auth !== "unavailable" && !identityKey && !!account.status && !busy;
  useEffect(() => { resetField("password"); setPasswordVisible(false); intent.current++; }, [identityKey, online, resetField]);
  const fields: { field: keyof LoginFormValues; label: string }[] = [
    ...(mode === "signUp" ? [{ field: "name" as const, label: "稱呼" }] : []),
    { field: "email", label: "電郵地址" }, { field: "password", label: "密碼" },
  ];
  const errorEntries = fields.flatMap(item => errors[item.field]?.message ? [{ ...item, message: String(errors[item.field]?.message) }] : []);
  function clearPassword() { resetField("password"); setPasswordVisible(false); }
  function selectMode(next: LoginMode) { intent.current++; setMode(next); clearPassword(); clearErrors(); }
  function submit() {
    if (!canSubmit || !active.current) return;
    const submittedIntent = ++intent.current;
    void handleSubmit(async values => {
      // Resolver completion must not submit a superseded form or bypass current owner admission.
      const live = owner.getSnapshot();
      if (intent.current !== submittedIntent || !active.current || live.identityKey || live.records.auth !== "signedOut"
        || !live.records.online || live.records.busy || live.account.busy || !live.account.status) return;
      const credentials = { ...values }; clearPassword();
      try { await authenticate(mode, credentials); }
      finally { clearPassword(); }
    }, invalid => {
      if (intent.current !== submittedIntent || !active.current) return;
      const first = fields.find(item => invalid[item.field]);
      if (first) setFocus(first.field);
    })();
  }
  function requestEmail(kind: "verification" | "reset") { intent.current++; clearPassword(); clearErrors(); void accountActions.requestEmail(kind, getValues("email")); }
  const field = (name: keyof LoginFormValues) => <Controller key={name} name={name} control={control} render={({ field: input, fieldState }) => {
    const id = `${formId}-${name}`, password = name === "password";
    return <View style={styles.field}>
      <AppTextField ref={input.ref} nativeID={id} name={name} label={name === "name" ? "稱呼" : name === "email" ? "電郵地址" : mode === "signUp" ? "密碼（至少 12 個字元）" : "密碼"}
        accessibilityLabel={name === "name" ? "稱呼" : name === "email" ? "電郵地址" : "密碼"}
        value={input.value} onChangeText={input.onChange} onBlur={input.onBlur} editable={!busy}
        autoComplete={name === "name" ? "name" : name === "email" ? "email" : mode === "signUp" ? "new-password" : "current-password"}
        keyboardType={name === "email" ? "email-address" : "default"} autoCapitalize={name === "name" ? "words" : "none"} autoCorrect={name === "name"} spellCheck={name === "name"}
        secureTextEntry={password && !passwordVisible} returnKeyType={password ? "go" : "next"}
        onSubmitEditing={password ? submit : () => setFocus(name === "name" ? "email" : "password")}
        error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${id}-message` : undefined}
        right={password ? <TextInput.Icon icon={passwordVisible ? "eye-off" : "eye"} accessibilityLabel={passwordVisible ? "隱藏密碼" : "顯示密碼"} disabled={busy}
          forceTextInputFocus={false} onPress={() => setPasswordVisible(value => !value)} /> : undefined} />
      <FormFieldMessage id={`${id}-message`} error={fieldState.error?.message} />
    </View>;
  }} />;
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView style={styles.root} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top, paddingBottom: insets.bottom }]} keyboardShouldPersistTaps="handled">
      <View style={[styles.layout, narrow && styles.stacked]}>
        <View testID="login-form-column" style={[styles.formSide, narrow && styles.compactForm]}>
          <BrandLogo style={styles.logo} />
          <View style={styles.form}>
            <Text accessibilityRole="header" aria-level={1} style={styles.title}>{mode === "signIn" ? "登入" : "建立帳戶"}</Text>
            {mode === "signUp" && account.status?.registration === "invite" ? <Text style={styles.body}>目前只接受獲邀電郵註冊；完成電郵驗證及資料使用確認後，即可新增孩子。</Text>
              : account.status?.registration === "trial" ? <Text style={styles.body}>目前為試用模式，請使用合成資料。</Text> : null}
            <FormErrorSummary entries={errorEntries} onFocus={name => setFocus(name as keyof LoginFormValues)} />
            {mode === "signUp" ? field("name") : null}{field("email")}{field("password")}
            <AppButton label={mode === "signIn" ? "登入" : "建立帳戶"} loading={busy} disabled={!canSubmit} onPress={submit} />
            {account.notice || recordsState.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{account.notice ?? recordsState.notice}</Text> : null}
            {!online ? <Text style={styles.notice}>目前未能連線，請連線後再試。</Text> : null}
            {auth === "unavailable" ? <AppButton label="重新檢查登入狀態" disabled={!online} variant="secondary" onPress={() => { void refresh(); }} /> : null}
            {account.gate === "error" ? <AppButton label="重新確認帳戶服務" variant="secondary" disabled={!online} onPress={() => { void owner.accountOwner.loadStatus(); }} /> : null}
            <View style={styles.recovery}>
              {mode === "signIn" ? <AppButton label="忘記密碼" variant="quiet" disabled={!online || busy || !account.status?.mailConfigured} onPress={() => requestEmail("reset")} /> : null}
              <AppButton label="重寄驗證指引" variant="quiet" disabled={!online || busy || !account.status?.mailConfigured} onPress={() => requestEmail("verification")} />
            </View>
            <View style={styles.modeChoice}><AppButton label={mode === "signIn" ? "建立帳戶" : "已有帳戶，登入"} variant="quiet" disabled={busy} onPress={() => selectMode(mode === "signIn" ? "signUp" : "signIn")} /></View>
          </View>
        </View>
        {!narrow ? <View testID="login-story-column" style={styles.aside}>
          <View testID="login-art-frame" style={styles.artFrame}>
            {artworkFailed ? <View testID="login-art-fallback" style={styles.artFallback}><Text style={styles.fallbackCopy}>把觀察記低，{`\n`}把重要的決定核對清楚。</Text></View>
              : <Image testID="login-background-image" source={harbourArt} resizeMode="contain" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onError={() => setArtworkFailed(true)} style={styles.art} />}
          </View>
          <Text style={styles.asideCopy}>孩子的觀察、安排與原文，留在同一本照顧手冊。</Text>
        </View> : null}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas }, scrollContent: { flexGrow: 1, justifyContent: "center" },
  layout: { width: "100%", maxWidth: 1280, alignSelf: "center", flexDirection: "row", alignItems: "center", minWidth: 0 }, stacked: { flexDirection: "column", alignItems: "stretch" },
  formSide: { flexGrow: 1, flexBasis: 480, minWidth: 0, padding: spacing.xxl, gap: spacing.xl, backgroundColor: colors.paper }, compactForm: { flexBasis: "auto", paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  logo: { width: 172, height: 52, alignSelf: "flex-start" }, form: { width: "100%", maxWidth: 440, gap: spacing.md }, field: { gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 30, lineHeight: 40, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  notice: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, borderLeftWidth: 3, borderLeftColor: colors.teal, paddingLeft: spacing.md },
  recovery: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, modeChoice: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  aside: { flexGrow: 1, flexBasis: 520, minWidth: 0, gap: spacing.lg, padding: spacing.xxl }, artFrame: { width: "100%", aspectRatio: 1672 / 941 }, art: { width: "100%", height: "100%" },
  artFallback: { flex: 1, justifyContent: "center" }, fallbackCopy: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 24, lineHeight: 36, fontWeight: "600" },
  asideCopy: { fontFamily: chineseFont, color: colors.muted, ...readingType.body, maxWidth: 420 },
});
