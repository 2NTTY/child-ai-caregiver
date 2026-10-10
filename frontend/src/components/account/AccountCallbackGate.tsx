import { useLayoutEffect, useState, type ReactNode } from "react";
import { SERVICE_POLICY_VERSION } from "../../../../src/shared/account-service";
import { usePathname, useRouter } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AppButton, AppTextField } from "../ui";
import { AppCheckbox } from "../AppCheckbox";
import { BrandLogo } from "../BrandLogo";
import { useProduction } from "../../production/ProductionProvider";
import { parseAccountCallback } from "../../production/AccountServiceOwner";
import { chineseFont, colors, spacing, typeScale } from "../../theme";
import { AppScrollView } from "../AppScrollView";
import { brand } from "../../branding";
import { StartupLoadingLabel } from "../../startup/StartupLoadingLabel";

export function AccountAccessPanel() {
  const { account, owner, user, signOut, online, identityKey } = useProduction();
  const [accepted, setAccepted] = useState(false);
  useLayoutEffect(() => setAccepted(false), [identityKey, account.status?.policyVersion]);
  // Admission is still closed while checking; normal startup has no recovery actions.
  if (account.gate === "checking" && online) return <View style={styles.loading} testID="production-account-loading" accessibilityLiveRegion="polite" aria-busy>
    <BrandLogo style={styles.logo} decorative />
    <StartupLoadingLabel label={`正在開啟${brand.name}`} />
  </View>;
  return <AppScrollView contentContainerStyle={styles.gate} testID="production-account-gate"><View style={styles.panel}>
    <BrandLogo style={styles.logo} />
    <Text accessibilityRole="header" style={styles.title}>{account.gate === "consent" ? "開始前，了解資料的使用方式" : account.gate === "verification" ? "請先完成電郵驗證" : "確認帳戶服務"}</Text>
    {account.gate === "consent" ? <>
      <Text style={styles.body}>{account.status?.notice}</Text>
      <AppCheckbox label="我已閱讀並同意以上資料使用說明" checked={accepted} disabled={!!account.busy || !online} onChange={setAccepted} />
      <AppButton label="同意並繼續" disabled={!accepted || !online || account.status?.policyVersion !== SERVICE_POLICY_VERSION} loading={account.busy === "consent"} onPress={() => { void owner.accountOwner.acknowledge(); }} />
      {account.status?.policyVersion !== SERVICE_POLICY_VERSION ? <Text style={styles.body}>服務說明已更新，請先更新介面再確認。</Text> : null}
    </> : account.gate === "verification" ? <>
      <Text style={styles.body}>請查看電郵的驗證指引，完成後正常登入。你也可以重新要求指引。</Text>
      <AppButton label="重新要求驗證指引" disabled={!online || !account.status?.mailConfigured} loading={account.busy === "mail"} onPress={() => { if (user?.email) void owner.accountOwner.requestEmail("verification", user.email); }} />
      <AppButton label="重新確認帳戶" variant="secondary" disabled={!online || !!account.busy} onPress={() => { void owner.accountOwner.loadStatus(); }} />
    </> : <>
      <Text style={styles.body}>{account.busy === "status" ? "正在讀取帳戶狀態…" : !online ? "目前離線，連線後才能確認帳戶。" : "暫時未能確認帳戶服務。"}</Text>
      <AppButton label="重新確認帳戶" disabled={!online} loading={account.busy === "status"} onPress={() => { void owner.accountOwner.loadStatus(); }} />
    </>}
    {account.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{account.notice}</Text> : null}
    <AppButton label="登出本人帳戶" variant="quiet" disabled={!online || !!account.busy} onPress={() => { void signOut(); }} />
  </View></AppScrollView>;
}

export function AccountDeletionRecoveryPanel() {
  const { account, owner, online } = useProduction();
  const router = useRouter();
  return <AppScrollView contentContainerStyle={styles.gate}><View style={styles.panel}>
    <BrandLogo style={styles.logo} /><Text accessibilityRole="header" style={styles.title}>查核原帳戶退出結果</Text>
    <Text style={styles.body}>退出結果仍未確認。原收據只保留在這個頁面的記憶中，請保留此頁並查核原操作。</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{account.deletion.message}</Text>
    <AppButton label="查核原退出結果" disabled={!online} loading={account.busy === "check"} onPress={() => { void owner.accountOwner.checkDeletion(); }} />
    <AppButton label="前往正常登入" variant="secondary" disabled={!!account.busy} onPress={() => router.replace("/login")} />
  </View></AppScrollView>;
}

const resetSchema = z.object({ password: z.string().min(12, "新密碼需要至少 12 個字元。").max(128, "密碼最多 128 個字元。"), repeat: z.string() }).refine(value => value.password === value.repeat, { path: ["repeat"], message: "兩次密碼未一致。" });
function CallbackPanel() {
  const { account, owner, online, identityKey } = useProduction();
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: "", repeat: "" } });
  useLayoutEffect(() => { form.reset(); }, [form.reset, online, identityKey]);
  const callback = account.callback;
  if (!callback) return null;
  const reset = callback.kind === "reset" && callback.phase === "form";
  const submit = form.handleSubmit(async input => { form.reset(); await owner.accountOwner.resetPassword(input.password); });
  return <AppScrollView contentContainerStyle={styles.gate}><View style={styles.panel}>
    <BrandLogo style={styles.logo} /><Text accessibilityRole="header" style={styles.title}>{reset ? "重設密碼" : callback.kind === "verified" ? "電郵驗證" : "帳戶連結"}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{callback.message}</Text>
    {reset ? <>
      <Controller control={form.control} name="password" render={({ field, fieldState }) => <AppTextField label="新密碼" accessibilityLabel="新密碼" value={field.value} onChangeText={field.onChange} ref={field.ref} error={!!fieldState.error} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" disabled={!online || !!account.busy} />} />
      {form.formState.errors.password ? <Text style={styles.body}>{form.formState.errors.password.message}</Text> : null}
      <Controller control={form.control} name="repeat" render={({ field, fieldState }) => <AppTextField label="再次輸入新密碼" accessibilityLabel="再次輸入新密碼" value={field.value} onChangeText={field.onChange} ref={field.ref} error={!!fieldState.error} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" disabled={!online || !!account.busy} />} />
      {form.formState.errors.repeat ? <Text style={styles.body}>{form.formState.errors.repeat.message}</Text> : null}
      <AppButton label="確認重設密碼" disabled={!online || !!account.busy && account.busy !== "reset"} loading={account.busy === "reset"} onPress={() => { void submit(); }} />
    </> : null}
    <AppButton label={reset ? "返回登入並重新要求指引" : "前往正常登入"} variant="secondary" disabled={!!account.busy} onPress={() => { form.reset(); owner.accountOwner.closeCallback(); router.replace("/login"); void owner.refresh(); }} />
  </View></AppScrollView>;
}

/** The root callback gate captures the token before any dashboard redirect and scrubs it before mounting business pages. */
export function AccountCallbackGate({ children }: { children: ReactNode }) {
  const { account, owner, identityKey } = useProduction();
  const pathname = usePathname();
  const [incoming, setIncoming] = useState(() => Platform.OS === "web" && typeof window !== "undefined" ? parseAccountCallback(window.location.href) : null);
  useLayoutEffect(() => {
    if (!incoming) return;
    window.history.replaceState(window.history.state, "", incoming.cleanUrl);
    owner.accountOwner.acceptCallback(incoming); setIncoming(null);
  }, [incoming, owner]);
  if (incoming && !account.callback) return <View style={styles.gate}><Text>正在讀取帳戶連結…</Text></View>;
  if (account.callback) return <CallbackPanel />;
  const deletionRecovery = !identityKey && account.deletion.phase === "unknown" && pathname !== "/login";
  const admission = !!identityKey && account.gate !== "ready";
  // Keep the root navigator mounted while admission changes; unmounting clears its deep-link state.
  const blocked = admission || deletionRecovery;
  return <View style={styles.root}>
    <View style={[styles.routes, blocked && styles.hidden]} pointerEvents={blocked ? "none" : "auto"}
      accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? "no-hide-descendants" : "auto"} aria-hidden={blocked}
      {...(Platform.OS === "web" ? { inert: blocked } : {})}>{children}</View>
    {blocked ? <View style={styles.accountPanel}>{deletionRecovery ? <AccountDeletionRecoveryPanel /> : <AccountAccessPanel />}</View> : null}
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas }, routes: { flex: 1, minHeight: 0 }, hidden: { opacity: 0 }, accountPanel: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.canvas }, loading: { flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg }, gate: { flexGrow: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", padding: spacing.xl }, panel: { width: "100%", maxWidth: 540, gap: spacing.lg }, logo: { width: 164, height: 53 }, title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 24 } });
