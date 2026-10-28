import { exportText } from "../../platform/file-export";
import { useLayoutEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useProduction } from "../../production/ProductionProvider";
import { AppButton, AppTextField } from "../ui";
import { AppDialog } from "../AppDialog";
import { AuthenticationProofControl, authProviderLabel } from "./AuthenticationProofControl";
import type { SocialAuthProvider } from "../../../../src/shared/auth-providers";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { HandoverControls } from './HandoverControls';
const deletionSchema = z.object({ confirmation: z.string().refine(value => value === "永久刪除我的帳戶", "請完整輸入「永久刪除我的帳戶」。") });
export function AccountSecurityControls() {
  const { account, accountActions, user, online } = useProduction();
  return <View style={styles.group}>
    <AccountProviderControls />
    <AppButton label="登出其他裝置" variant="secondary" disabled={!online || !!account.busy || account.deletion.phase !== "idle"} onPress={() => { void accountActions.revokeOtherSessions(); }} />
    <AppButton label="重設密碼" variant="quiet" disabled={!online || !!account.busy || !account.status?.mailConfigured} onPress={() => { if (user?.email) void accountActions.requestEmail("reset", user.email); }} />
    {account.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{account.notice}</Text> : null}
  </View>;
}
function AccountProviderControls() {
  const { owner, account, identityKey, online, socialProviders } = useProduction();
  const [target, setTarget] = useState<SocialAuthProvider | null>(null);
  const methods = account.authenticationMethods;
  const close = () => { setTarget(null); owner.accountOwner.cancelProviderLink(); };
  useLayoutEffect(() => { setTarget(null); owner.accountOwner.cancelProviderLink(); }, [identityKey, online, owner]);
  useLayoutEffect(() => () => owner.accountOwner.cancelProviderLink(), [owner]);
  const locked = !online || !!account.busy || account.deletion.phase !== "idle";
  const prepared = account.providerLinkExpiresAtMs !== null;
  return <View style={styles.group}>
    <Text style={styles.title}>本人登入方式</Text>
    <Text style={styles.body}>{methods ? methods.providers.map(authProviderLabel).join("、") || "尚未有可用登入方式。" : "尚未確認本人已連結方式。"}</Text>
    <AppButton label="重新讀取登入方式" variant="quiet" disabled={locked} onPress={() => { void owner.accountOwner.loadAuthenticationMethods(); }} />
    {socialProviders.filter(provider => !methods?.providers.includes(provider)).map(provider => <AppButton key={provider} label={`連結 ${authProviderLabel(provider)}`}
      variant="secondary" disabled={locked || !methods || account.providerLinkNeedsCheck} onPress={() => { owner.accountOwner.cancelProviderLink(); setTarget(provider); }} />)}
    <AppDialog visible={target !== null} onDismiss={close} accessibilityLabel="連結本人登入方式">
      <AppDialog.Title>連結 {target ? authProviderLabel(target) : "登入方式"}</AppDialog.Title>
      <AppDialog.Content>
        <View style={styles.group}>
          <Text style={styles.body}>先以目前已連結方式驗證本人，再親自確認將所選方式連結至同一帳戶。</Text>
          {target && methods?.providers.includes(target) ? <Text style={styles.body}>已確認連結至本人帳戶。</Text>
            : account.providerLinkNeedsCheck ? <Text style={styles.body}>結果尚未確認。請關閉此處，重新讀取登入方式後再繼續。</Text>
            : account.busy === "provider-link" ? <Text style={styles.body}>正在核對本人連結結果，請完成身份視窗的操作。</Text>
            : prepared ? <><Text style={styles.body}>本人身份已驗證。下一步會開啟 {target ? authProviderLabel(target) : "第三方"} 的視窗；請選擇你要連結至目前帳戶的身份。</Text>
              <AppButton label={`確認連結 ${target ? authProviderLabel(target) : "登入方式"}`} disabled={locked}
                onPress={() => { if (target) void owner.accountOwner.linkProvider(target, true); }} />
              <AppButton label="重新選擇驗證方式" variant="quiet" disabled={!!account.busy} onPress={owner.accountOwner.cancelProviderLink} /></>
            : <AuthenticationProofControl methods={methods} socialProviders={socialProviders} identityKey={identityKey} online={online}
              disabled={locked && account.busy !== "provider-prepare"} busy={account.busy === "provider-prepare"} actionLabel="先驗證本人身份"
              onChange={owner.accountOwner.cancelProviderLink} onSubmit={proof => owner.accountOwner.prepareProviderLink(proof)} />}
          {account.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{account.notice}</Text> : null}
        </View>
      </AppDialog.Content>
      <AppDialog.Actions><AppButton label="關閉連結" variant="quiet" onPress={close} /></AppDialog.Actions>
    </AppDialog>
  </View>;
}
export function AccountDataControls() {
  const { owner, account, accountActions, identityKey, online, canPrepareAccountDeletion, socialProviders } = useProduction();
  const form = useForm<{ confirmation: string }>({ resolver: zodResolver(deletionSchema), defaultValues: { confirmation: "" } });
  useLayoutEffect(() => { form.reset(); }, [form.reset, identityKey, online, account.deletion.phase]);
  useLayoutEffect(() => () => { form.reset(); }, [form.reset]);
  const deletion = account.deletion, download = account.download;
  const confirmation = form.watch("confirmation");
  const verification = account.deletionVerification;
  const verified = verification.expiresAtMs !== null && verification.expiresAtMs > Date.now();
  const submit = () => {
    if (!online || account.busy || deletion.phase !== "prepared" || !verified || confirmation !== "永久刪除我的帳戶") return;
    form.reset(); void accountActions.executeDeletion(confirmation);
  };
  return <View style={styles.group}>
    <Text style={styles.body}>{account.status?.notice ?? "資料使用說明尚未確認。"}</Text>
    <HandoverControls />
    <View style={styles.group}>
      <Text style={styles.title}>下載本人資料</Text>
      <Text style={styles.body}>資料按目前可存取範圍分批下載。保留同一次的所有檔案；完成前的部分檔案不代表全部資料。續讀位置只保留在此頁，重新載入後需要重新開始。</Text>
      <AppButton label={download.phase === "idle" ? "下載本人資料" : download.phase === "complete" ? "全部分批檔案已交付" : download.phase === "error" && download.parts === 0 ? "重新開始下載" : "繼續下載下一份"} variant="secondary" loading={account.busy === "download"} disabled={!online || deletion.phase !== "idle" || download.phase === "complete" || !!account.busy && account.busy !== "download"} onPress={() => { void accountActions.downloadNextPart(exportText); }} />
      {download.message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{download.message}</Text> : null}
      {download.phase !== "idle" ? <AppButton label="清除這次續讀位置" variant="quiet" disabled={!!account.busy} onPress={accountActions.clearDownload} /> : null}
    </View>
    <View style={styles.danger}>
      <Text style={styles.title}>永久刪除本人帳戶</Text>
      {deletion.phase === "idle" ? <><Text style={styles.body}>先核對退出範圍，再以已連結方式驗證本人身份，最後輸入確認文字。這會刪除帳戶、本人的私人資料及名下孩子與附屬資料，不能撤銷。共享家庭若仍有其他成員，須先處理責任。</Text>
        {!canPrepareAccountDeletion ? <Text style={styles.body}>請先處理未提交草稿或未確認的原操作，再退出帳戶。</Text> : null}
        <AppButton label="核對帳戶退出範圍" variant="danger-secondary" disabled={!online || !canPrepareAccountDeletion || !!account.busy} onPress={() => { void accountActions.prepareDeletion(); }} /></> : null}
      {deletion.phase === "prepared" ? <>
        <Text style={styles.body}>已核對：本人帳戶、私人資料及 {deletion.childCount === null ? "名下" : deletion.childCount} 位孩子與全部附屬資料。永久刪除不能撤銷，亦無法從歷史復原。</Text>
        {verification.available ? <>
          <Text style={styles.body}>第一步：以目前已連結方式驗證本人身份。憑證只交給既有身份服務，不會送往資料刪除接口。</Text>
          <AuthenticationProofControl methods={account.authenticationMethods} socialProviders={socialProviders} identityKey={identityKey} online={online}
            disabled={!!account.busy && account.busy !== "verify" || verified} busy={account.busy === "verify"} onSubmit={proof => accountActions.verifyDeletionIdentity(proof)} />
          {!account.authenticationMethods ? <AppButton label="重新讀取登入方式" variant="quiet" disabled={!online || !!account.busy} onPress={() => { void owner.accountOwner.loadAuthenticationMethods(); }} /> : null}
          <Text accessibilityLiveRegion="polite" style={styles.body}>{verified ? "身份已驗證，只限這次退出操作短時間內使用；更改身份、取消或逾時後須重新驗證。" : "未完成身份驗證，不能提交永久刪除。"}</Text>
        </> : <Text style={styles.error}>目前登入方式尚未接通安全的重新驗證，為保障帳戶，暫時不能永久刪除。</Text>}
        <Text nativeID="account-deletion-confirmation-help" style={styles.body}>第二步：請完整輸入「永久刪除我的帳戶」，再確認以下最終操作。</Text>
        <Controller control={form.control} name="confirmation" render={({ field, fieldState }) => <AppTextField label="確認文字" accessibilityLabel="帳戶刪除確認文字" aria-invalid={!!fieldState.error} aria-describedby="account-deletion-confirmation-help" value={field.value} onChangeText={field.onChange} ref={field.ref} error={!!fieldState.error} autoCapitalize="none" autoCorrect={false} autoComplete="off" disabled={!online || !!account.busy} />} />
        {form.formState.errors.confirmation ? <Text style={styles.error}>{form.formState.errors.confirmation.message}</Text> : null}
        <AppButton label="確認永久刪除帳戶" variant="danger" loading={account.busy === "delete"}
          disabled={!online || !!account.busy || !verified || confirmation !== "永久刪除我的帳戶"} onPress={submit} />
        <AppButton label="取消這次退出確認" variant="quiet" disabled={!online || !!account.busy && account.busy !== "verify"} onPress={() => { form.reset(); void accountActions.cancelPreparedDeletion(); }} />
      </> : null}
      {deletion.phase === "unknown" ? <><Text style={styles.body}>退出結果仍未確認。請保留此頁，沿原收據查核；現在不能重新建立退出操作。</Text><AppButton label="查核原退出結果" disabled={!online} loading={account.busy === "check"} onPress={() => { void accountActions.checkDeletion(); }} /></> : null}
      {deletion.message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{deletion.message}</Text> : null}
    </View>
    {account.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{account.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, danger: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.errorInk, paddingTop: spacing.lg }, error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool } });
