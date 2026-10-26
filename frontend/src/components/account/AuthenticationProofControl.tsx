import { useLayoutEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { AccountAuthMethods, AccountAuthProvider, ReauthenticationInput, SocialAuthProvider } from "../../../../src/shared/auth-providers";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { colors, readingType, spacing } from "../../theme";

export const authProviderLabel = (provider: AccountAuthProvider) => provider === "password" ? "電郵及密碼" : provider === "google.com" ? "Google" : "Apple";

/** Proof stays in this local form until the explicit authentication gesture. */
export function AuthenticationProofControl({ methods, socialProviders, identityKey, online, disabled = false, busy = false,
  actionLabel = "重新驗證本人身份", onSubmit, onChange }: {
  methods: AccountAuthMethods | null; socialProviders: readonly SocialAuthProvider[]; identityKey: string | null; online: boolean;
  disabled?: boolean; busy?: boolean; actionLabel?: string;
  onSubmit(proof: ReauthenticationInput): void | Promise<unknown>; onChange?(): void;
}) {
  const [selected, setSelected] = useState<AccountAuthProvider | null>(null), [password, setPassword] = useState("");
  const supported = methods?.providers.filter(provider => provider === "password" || socialProviders.includes(provider)) ?? [];
  const method = selected && supported.includes(selected) ? selected
    : methods?.currentProvider && supported.includes(methods.currentProvider) ? methods.currentProvider : supported[0];
  useLayoutEffect(() => { setSelected(null); setPassword(""); }, [identityKey, online, methods?.userId]);
  useLayoutEffect(() => () => { setPassword(""); }, []);
  if (!method) return <Text style={styles.note}>{methods ? "這個平台暫未支援本人已連結方式的重新驗證。" : "請先重新讀取本人登入方式。"}</Text>;
  return <View style={styles.group}>
    <AppSelect label="以已連結方式驗證" value={method} options={supported.map(provider => ({ value: provider, label: authProviderLabel(provider) }))}
      disabled={disabled || busy || !online} onChange={provider => { setSelected(provider); setPassword(""); onChange?.(); }} />
    {method === "password" ? <AppTextField label="目前密碼" accessibilityLabel="本人身份驗證密碼" value={password} onChangeText={setPassword}
      secureTextEntry importantForAutofill="no" autoComplete="off" autoCapitalize="none" autoCorrect={false} disabled={disabled || busy || !online} /> : null}
    <AppButton label={actionLabel} variant="secondary" loading={busy} disabled={disabled || !online || method === "password" && (!password || password.length > 128)}
      onPress={() => { const proof: ReauthenticationInput = method === "password" ? password : { provider: method }; setPassword(""); void onSubmit(proof); }} />
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, note: { color: colors.muted, ...readingType.tool } });
