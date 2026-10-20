import { exportText } from "../../platform/file-export";
import { useLayoutEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useProduction } from "../../production/ProductionProvider";
import { AppButton, AppTextField } from "../ui";
import { chineseFont, colors, readingType, spacing } from "../../theme";
const deletionSchema = z.object({ password: z.string().min(1, "請輸入密碼。").max(128, "密碼最多 128 個字元。"), confirmation: z.string().refine(value => value === "永久刪除我的帳戶", "請完整輸入「永久刪除我的帳戶」。") });
export function AccountSecurityControls() {
  const { account, accountActions, user, online } = useProduction();
  return <View style={styles.group}>
    <AppButton label="登出其他裝置" variant="secondary" disabled={!online || !!account.busy || account.deletion.phase !== "idle"} onPress={() => { void accountActions.revokeOtherSessions(); }} />
    <AppButton label="要求重設密碼指引" variant="quiet" disabled={!online || !!account.busy || !account.status?.mailConfigured} onPress={() => { if (user?.email) void accountActions.requestEmail("reset", user.email); }} />
    {account.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{account.notice}</Text> : null}
  </View>;
}
export function AccountDataControls() {
  const { account, accountActions, identityKey, online, canPrepareAccountDeletion } = useProduction();
  const form = useForm<{ password: string; confirmation: string }>({ resolver: zodResolver(deletionSchema), defaultValues: { password: "", confirmation: "" } });
  useLayoutEffect(() => { form.reset(); }, [form.reset, identityKey, online, account.deletion.phase]);
  const deletion = account.deletion, download = account.download;
  const submit = form.handleSubmit(async input => { form.reset(); await accountActions.executeDeletion(input.password, input.confirmation); });
  return <View style={styles.group}>
    <Text style={styles.body}>{account.status?.notice ?? "資料使用說明尚未確認。"}</Text>
    <View style={styles.group}>
      <Text style={styles.title}>下載本人資料</Text>
      <Text style={styles.body}>資料按目前可存取範圍分批下載。保留同一次的所有檔案；完成前的部分檔案不代表全部資料。續讀位置只保留在此頁，重新載入後需要重新開始。</Text>
      <AppButton label={download.phase === "idle" ? "下載本人資料" : download.phase === "complete" ? "全部分批檔案已交付" : download.phase === "error" && download.parts === 0 ? "重新開始下載" : "繼續下載下一份"} variant="secondary" loading={account.busy === "download"} disabled={!online || deletion.phase !== "idle" || download.phase === "complete" || !!account.busy && account.busy !== "download"} onPress={() => { void accountActions.downloadNextPart(exportText); }} />
      {download.message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{download.message}</Text> : null}
      {download.phase !== "idle" ? <AppButton label="清除這次續讀位置" variant="quiet" disabled={!!account.busy} onPress={accountActions.clearDownload} /> : null}
    </View>
    <View style={styles.danger}>
      <Text style={styles.title}>永久刪除本人帳戶</Text>
      {deletion.phase === "idle" ? <><Text style={styles.body}>先由 Server 核對退出範圍，再確認密碼與固定文字。這會刪除帳戶、本人的私人資料及名下孩子與附屬資料，不能撤銷。共享家庭若仍有其他成員，須先處理責任。</Text>
        {!canPrepareAccountDeletion ? <Text style={styles.body}>請先處理未提交草稿或未確認的原操作，再退出帳戶。</Text> : null}
        <AppButton label="核對帳戶退出範圍" variant="danger-secondary" disabled={!online || !canPrepareAccountDeletion || !!account.busy} onPress={() => { void accountActions.prepareDeletion(); }} /></> : null}
      {deletion.phase === "prepared" ? <>
        <Text style={styles.body}>已核對：本人帳戶、私人資料及 {deletion.childCount === null ? "名下" : deletion.childCount} 位孩子與附屬資料。請完整輸入「永久刪除我的帳戶」並以密碼確認。</Text>
        <Controller control={form.control} name="confirmation" render={({ field, fieldState }) => <AppTextField label="確認文字" accessibilityLabel="帳戶刪除確認文字" value={field.value} onChangeText={field.onChange} ref={field.ref} error={!!fieldState.error} autoCorrect={false} autoComplete="off" disabled={!online || !!account.busy} />} />
        {form.formState.errors.confirmation ? <Text style={styles.body}>{form.formState.errors.confirmation.message}</Text> : null}
        <Controller control={form.control} name="password" render={({ field, fieldState }) => <AppTextField label="目前密碼" accessibilityLabel="帳戶刪除密碼" value={field.value} onChangeText={field.onChange} ref={field.ref} error={!!fieldState.error} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" disabled={!online || !!account.busy} />} />
        {form.formState.errors.password ? <Text style={styles.body}>{form.formState.errors.password.message}</Text> : null}
        <AppButton label="確認永久刪除帳戶" variant="danger" loading={account.busy === "delete"} disabled={!online || !!account.busy && account.busy !== "delete"} onPress={() => { void submit(); }} />
        <AppButton label="取消這次退出確認" variant="quiet" disabled={!online || !!account.busy} onPress={() => { form.reset(); void accountActions.cancelPreparedDeletion(); }} />
      </> : null}
      {deletion.phase === "unknown" ? <><Text style={styles.body}>退出結果仍未確認。請保留此頁，沿原收據查核；現在不能重新建立退出操作。</Text><AppButton label="查核原退出結果" disabled={!online} loading={account.busy === "check"} onPress={() => { void accountActions.checkDeletion(); }} /></> : null}
      {deletion.message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{deletion.message}</Text> : null}
    </View>
    {account.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{account.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, danger: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool } });
