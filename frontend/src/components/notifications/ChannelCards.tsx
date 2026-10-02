import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  blocksAnotherTelegramTest, channelDeliveryLabels, channelTime, pushDeliveryNeedsReview, pushTestAllowed, telegramBeginAllowed,
  type ChannelDeliveryView, type ChannelPermission, type ChannelReadState, type ChannelReview,
  type PushSettingsActions, type PushSettingsModel, type TelegramSettingsActions, type TelegramSettingsModel,
} from "../../channel-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../ui";

type SharedModel = PushSettingsModel | TelegramSettingsModel;
type SharedActions = PushSettingsActions | TelegramSettingsActions;
type Tone = "neutral" | "warning" | "error";

const permissionLabels: Record<ChannelPermission, string> = {
  default: "尚未選擇通知權限", granted: "已允許通知", denied: "已拒絕通知", unsupported: "不支援瀏覽器通知",
};
const permissionGuidance: Record<ChannelPermission, string> = {
  default: "正式接線後，須由你在瀏覽器權限提示中選擇允許；本次預覽只模擬登記。",
  granted: "瀏覽器權限已允許；仍須登記本人訂閱，才可使用這個渠道。",
  denied: "請到瀏覽器的網站權限設定更改通知選擇，再回來重新讀取；本頁不能代你更改權限。",
  unsupported: "這個瀏覽器目前不支援通知。你仍可查看及撤銷既有本人訂閱。",
};
const reviewLabels: Record<ChannelReview["kind"], string> = {
  begin: "我同意開始本人的私人渠道綁定",
  confirm: "我已核對這是我的 Telegram 帳號",
  enable: "我同意登記本人的這個瀏覽器",
  revoke: "我了解撤銷後會停止新的投遞",
  test: "我了解一般測試會立即發送，不跟隨安靜時段",
};
const reviewScope: Record<ChannelReview["kind"], string> = {
  begin: "只開始本人的私人 Telegram 綁定步驟。回到此頁讀取候選帳號並核對後，才可確認綁定。",
  confirm: "只將已核對的 Telegram 帳號綁定給本人。渠道綁定不代表已授權所有任務提醒或主動聯絡。",
  enable: "只登記本人的這個瀏覽器。訂閱不代表通知已送達，也不代表已授權所有任務提醒或主動聯絡。",
  revoke: "只撤銷所列的本人渠道，停止新的投遞。已在發送或結果未知的投遞仍須按原操作狀態查核。",
  test: "只向所列的本人渠道立即發送一次一般測試，不跟隨安靜時段。測試結果與照護任務完成分開記錄。",
};
const browserLabelSchema = z.object({
  label: z.string().refine(value => value.trim().length > 0, "請填寫瀏覽器名稱。")
    .refine(value => value.trim().length <= 80, "瀏覽器名稱最多 80 字元。"),
});
type BrowserLabelValues = z.infer<typeof browserLabelSchema>;

function StateNote({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <View style={[styles.note, tone === "warning" && styles.warningNote, tone === "error" && styles.errorNote]}>
    <AppIcon name="information-outline" size={18} color={tone === "warning" ? colors.warningInk : tone === "error" ? colors.errorInk : colors.muted} />
    <Text accessibilityRole={tone === "neutral" ? "text" : "alert"} style={[styles.noteCopy, tone === "warning" && styles.warning, tone === "error" && styles.error]}>{children}</Text>
  </View>;
}

function ReadState({ state, online, locked, refresh }: { state: ChannelReadState; online: boolean; locked: boolean; refresh(): void }) {
  const message = state === "loading" ? "正在重新讀取本人渠道狀態，上一批訂閱、接收者及投遞暫不展示。"
    : state === "session_changed" ? "登入身份已變更，上一位使用者的渠道、接收者及操作內容已清除。請重新登入，或以正確帳戶重新載入頁面。"
      : "未能讀取本人渠道狀態，上一批訂閱、接收者及投遞暫不展示。請手動重新讀取。";
  return <View style={styles.stack}>
    <StateNote tone={state === "failed" ? "error" : "neutral"}>{message}</StateNote>
    {!online && state !== "session_changed" ? <StateNote tone="warning">目前離線，恢復連線後才可重新讀取。</StateNote> : null}
    {state === "failed" ? <AppButton label="重新讀取本人渠道狀態" variant="secondary" disabled={!online || locked} onPress={refresh} /> : null}
  </View>;
}

function RuntimeNotices({ model }: { model: SharedModel }) {
  return <>
    {!model.online ? <StateNote tone="warning">目前離線；所示渠道狀態只供參考，恢復連線後才可確認操作或重新讀取。</StateNote> : null}
    {!model.workerEnabled ? <StateNote tone="warning">背景投遞目前暫停，不能發送一般測試；排隊中的投遞不等於已發送。</StateNote> : null}
    {model.notice ? <StateNote>{model.notice}</StateNote> : null}
  </>;
}

function ChannelReviewPanel({ model, actions }: { model: SharedModel; actions: SharedActions }) {
  const replacingChallenge = model.review?.kind === "begin" && "challenge" in model && model.challenge !== null;
  return <>
    {model.conflict ? <View style={styles.review}>
      <Text accessibilityRole="header" style={styles.title}>渠道狀態已有更新</Text>
      <Text style={styles.body}>以下渠道資料是最新讀取的狀態；本次操作仍沿用原來核對的版本。請比較目標及版本，再明確選擇使用最新狀態，並重新核對操作。</Text>
      <AppButton label="核對並使用最新渠道狀態" variant="secondary" disabled={!model.online} onPress={actions.useLatest} />
    </View> : null}
    {model.review ? <View style={styles.review}>
      <Text accessibilityRole="header" style={styles.title}>待確認渠道操作</Text>
      <Text style={styles.body}>目標：{model.review.targetLabel}</Text>
      <Text style={styles.meta}>核對版本：{model.review.expectedVersion === null ? "新登記／綁定，未有既有版本" : model.review.expectedVersion}</Text>
      <Text style={styles.body}>{replacingChallenge
        ? "服務接受重新開始後，會立即令目前的 Telegram 連結及候選帳號失效，並建立新的 10 分鐘連結；舊候選與勾選須重新核對。每小時最多 6 次開始，達限時請稍後重讀。"
        : reviewScope[model.review.kind]}</Text>
      <AppCheckbox label={replacingChallenge ? "我明白舊連結及候選帳號會失效，並同意重新開始" : reviewLabels[model.review.kind]} checked={model.review.confirmed}
        disabled={model.locked || model.conflict} onChange={actions.confirmReview} />
      <View style={styles.actions}>
        <AppButton label="模擬確認這項渠道操作" disabled={!model.online || model.locked || model.conflict || !model.review.confirmed} onPress={actions.submit} />
        <AppButton label="取消渠道操作" variant="quiet" disabled={model.locked} onPress={actions.cancel} />
      </View>
    </View> : null}
  </>;
}

function RecentDeliveries({ deliveries }: { deliveries: ChannelDeliveryView[] }) {
  const latest = [...deliveries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 20);
  return <View style={styles.stack}>
    <Text accessibilityRole="header" style={styles.title}>最近投遞</Text>
    <Text style={styles.meta}>最多顯示最近 20 項。渠道已接受不等於已送達或已讀；投遞及本人回覆均不代表照護任務已完成。</Text>
    {latest.length === 0 ? <Text style={styles.meta}>目前沒有投遞紀錄。</Text> : latest.map(delivery => <View key={delivery.id} style={styles.entry}>
      <View style={styles.top}><Text style={styles.title}>{delivery.label}</Text>
        <Text style={[styles.badge, delivery.status === "unknown" && styles.warningBadge, delivery.status === "rejected" && styles.errorBadge]}>{channelDeliveryLabels[delivery.status]}</Text></View>
      <Text style={styles.meta}>建立：{channelTime(delivery.createdAt)}（香港時間）</Text>
      {delivery.reasonLabel ? <Text style={styles.meta}>狀態說明：{delivery.reasonLabel}</Text> : null}
      {delivery.status === "unknown" ? <Text style={styles.warning}>結果未知，請查核原投遞狀態；不要盲目重發。</Text> : null}
      {"acknowledgedAt" in delivery && delivery.acknowledgedAt ? <Text style={styles.body}>收到本人回覆：{channelTime(delivery.acknowledgedAt)}（香港時間）</Text> : null}
    </View>)}
  </View>;
}

function BrowserEnableForm({ form, disabled, stageEnable }: { form: UseFormReturn<BrowserLabelValues>; disabled: boolean; stageEnable(label: string): void }) {
  return <View style={styles.stack}>
    <Controller name="label" control={form.control} render={({ field, fieldState }) => <View>
      <AppTextField ref={field.ref} label="瀏覽器名稱" accessibilityLabel="瀏覽器通知名稱" value={field.value}
        disabled={disabled} onChangeText={field.onChange} onBlur={field.onBlur} error={!!fieldState.error} />
      {fieldState.error ? <HelperText type="error">{fieldState.error.message}</HelperText> : <Text style={styles.fieldHint}>去除前後空格後須有內容，最多 80 字元；只供你辨認本人訂閱。</Text>}
    </View>} />
    <AppButton label="預覽啟用此瀏覽器通知" disabled={disabled} onPress={form.handleSubmit(values => stageEnable(values.label.trim()))} />
  </View>;
}

export function WebPushSettingsCard({ model, actions, operationNotice }: { model: PushSettingsModel; actions: PushSettingsActions; operationNotice?: ReactNode }) {
  const form = useForm<BrowserLabelValues>({ defaultValues: { label: "我的瀏覽器" }, resolver: zodResolver(browserLabelSchema), mode: "onBlur" });
  const ready = model.readState === "ready";
  const actionBlocked = !model.online || model.locked || !!model.review || model.conflict;
  const canEnable = ready && !actionBlocked && model.available && model.browserSupported && model.permission !== "denied" && model.permission !== "unsupported";
  const cooldownReady = model.nextTestAt === null || Date.parse(model.nextTestAt) <= Date.now();
  return <SectionCard style={styles.card}>
    <SectionHeader title="我的瀏覽器通知" icon="bell-outline" subtitle="只管理本人的瀏覽器訂閱；此頁是合成預覽。"
      action={ready ? <AppButton label="重新讀取瀏覽器狀態" variant="quiet" disabled={!model.online || model.locked || !!model.review} onPress={actions.refresh} /> : undefined} />
    {!ready ? <ReadState state={model.readState} online={model.online} locked={model.locked} refresh={actions.refresh} /> : <>
      <RuntimeNotices model={model} />
      {operationNotice}
      {!model.available ? <StateNote tone="warning">瀏覽器通知服務目前未可用，不能啟用訂閱或發送測試；你仍可撤銷既有本人訂閱。</StateNote> : null}
      <View style={styles.entry}>
        <Text style={styles.title}>通知權限：{permissionLabels[model.permission]}</Text>
        <Text style={styles.body}>{permissionGuidance[model.permission]}</Text>
        {!model.browserSupported && model.permission !== "unsupported" ? <Text style={styles.warning}>這個瀏覽器未具備所需支援，不能啟用新訂閱；既有訂閱仍可撤銷。</Text> : null}
      </View>
      <BrowserEnableForm form={form} disabled={!canEnable} stageEnable={actions.stageEnable} />
      <ChannelReviewPanel model={model} actions={actions} />
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.title}>本人瀏覽器訂閱</Text>
        {model.bindings.length === 0 ? <Text style={styles.meta}>目前沒有本人瀏覽器訂閱。</Text> : model.bindings.map(binding => {
          const deliveryNeedsReview = pushDeliveryNeedsReview(model.deliveries, binding.id);
          return <View key={binding.id} style={styles.entry}>
            <View style={styles.top}><Text style={styles.title}>{binding.label}</Text>
              <Text style={styles.badge}>{binding.status === "active" ? "有效" : binding.status === "revoked" ? "已撤銷" : "已過期"}</Text>
              {model.currentBindingId === binding.id ? <Text style={[styles.badge, styles.currentBadge]}>目前瀏覽器</Text> : null}</View>
            <Text style={styles.meta}>提供者：{binding.providerLabel} · 版本 {binding.version}</Text>
            <Text style={styles.meta}>到期：{binding.expiresAt ? `${channelTime(binding.expiresAt)}（香港時間）` : "未提供到期時間"}</Text>
            {binding.status === "active" ? <>
              <View style={styles.actions}>
                <AppButton label="撤銷此訂閱" variant="secondary" disabled={actionBlocked} onPress={() => actions.stageRevoke(binding.id)} />
                <AppButton label="預覽一般測試" variant="quiet" disabled={actionBlocked || !pushTestAllowed(model, binding)} onPress={() => actions.stageTest(binding.id)} />
              </View>
              {deliveryNeedsReview ? <Text style={styles.warning}>這項訂閱仍有排隊中、發送中或結果未知的投遞；請查核原投遞，切勿盲目重送。若服務、worker 及測試限額允許，可明確發起另一項一般測試。</Text> : null}
            </> : null}
          </View>;
        })}
        <Text style={styles.meta}>最近24小時一般測試餘額：{model.testsRemaining} 次。</Text>
        <Text style={styles.meta}>一般測試按最近 24 小時計算，最多 3 次；兩次測試須相隔至少 60 秒。</Text>
        <Text style={cooldownReady ? styles.meta : styles.warning}>{model.nextTestAt ? `下一次可測試時間：${channelTime(model.nextTestAt)}（香港時間）${cooldownReady ? "，冷卻時間已過。" : "，冷卻期間不可再發測試。"}` : "目前沒有測試冷卻時間。"}</Text>
      </View>
      <RecentDeliveries deliveries={model.deliveries} />
    </>}
  </SectionCard>;
}

export function TelegramSettingsCard({ model, actions, operationNotice }: { model: TelegramSettingsModel; actions: TelegramSettingsActions; operationNotice?: ReactNode }) {
  const ready = model.readState === "ready";
  const actionBlocked = !model.online || model.locked || !!model.review || model.conflict;
  const challengeExpired = !!model.challenge && Date.parse(model.challenge.expiresAt) <= Date.now();
  const existingBinding = model.binding !== null && model.binding.status !== "revoked";
  const canBegin = !actionBlocked && telegramBeginAllowed(model);
  const canConfirm = !actionBlocked && model.configured && !existingBinding && model.challenge?.state === "seen" && model.challenge.candidate !== null && !challengeExpired;
  const testBlocked = model.binding !== null && blocksAnotherTelegramTest(model.deliveries, model.binding.id);
  const canTest = !actionBlocked && model.configured && model.workerEnabled && model.binding?.status === "active" && !testBlocked;
  return <SectionCard style={styles.card}>
    <SectionHeader title="我的 Telegram" icon="message-text-outline" subtitle="只綁定本人的私人帳號；此頁是合成預覽。"
      action={ready ? <AppButton label="重新讀取 Telegram 狀態" variant="quiet" disabled={!model.online || model.locked || !!model.review} onPress={actions.refresh} /> : undefined} />
    {!ready ? <ReadState state={model.readState} online={model.online} locked={model.locked} refresh={actions.refresh} /> : <>
      <RuntimeNotices model={model} />
      {operationNotice}
      {!model.configured ? <StateNote tone="warning">Telegram 渠道目前未設定或未可用，不能開始、確認新綁定或發送測試；你仍可撤銷既有本人綁定。</StateNote> : null}
      {model.binding ? <View style={styles.entry}>
        <View style={styles.top}><Text style={styles.title}>{model.binding.label}</Text>
          <Text style={[styles.badge, model.binding.status === "blocked" && styles.errorBadge]}>{model.binding.status === "active" ? "有效綁定" : model.binding.status === "revoked" ? "已撤銷" : "渠道已封鎖"}</Text></View>
        <Text style={styles.body}>本人接收者：{model.binding.label}</Text>
        <Text style={styles.meta}>帳號提示：{model.binding.chatIdHint} · 版本 {model.binding.version}</Text>
        {model.binding.status === "blocked" ? <Text style={styles.warning}>這項綁定已封鎖，不能發送測試；須先撤銷，才可重新開始私人綁定。</Text> : null}
        {model.binding.status !== "revoked" ? <View style={styles.actions}>
          <AppButton label="撤銷 Telegram 綁定" variant="secondary" disabled={actionBlocked} onPress={actions.stageRevoke} />
          <AppButton label="預覽一般測試" variant="quiet" disabled={!canTest} onPress={actions.stageTest} />
        </View> : null}
        {model.binding.status !== "revoked" && testBlocked ? <Text style={styles.warning}>仍有排隊中、發送中或未有本人回覆的未知投遞；先查核原投遞，暫不可另發測試。</Text> : null}
      </View> : <Text style={styles.meta}>目前沒有本人 Telegram 綁定。</Text>}
      {!existingBinding ? <AppButton label={model.challenge ? "預覽重新開始私人綁定" : "預覽開始私人綁定"} disabled={!canBegin} onPress={actions.stageBegin} /> : null}
      {model.challenge ? <View style={styles.entry}>
        <Text accessibilityRole="header" style={styles.title}>{challengeExpired ? "私人綁定步驟已過期" : "私人綁定步驟"}</Text>
        <Text style={styles.meta}>版本 {model.challenge.version} · 到期：{channelTime(model.challenge.expiresAt)}（香港時間）</Text>
        {challengeExpired ? <Text style={styles.warning}>這個步驟已過期，不能再確認候選帳號。請重新開始私人綁定。</Text> : <>
          <Text style={styles.body}>先在 Telegram 完成本人的綁定步驟，再回到此頁手動重新讀取；開始步驟尚未代表綁定完成。</Text>
          <View style={styles.actions}>
            <AppButton label="開啟 Telegram 綁定步驟" variant="secondary" disabled={actionBlocked || !model.configured || existingBinding} onPress={actions.openStartLink} />
            <AppButton label="重新讀取 Telegram 狀態" variant="quiet" disabled={!model.online || model.locked || !!model.review} onPress={actions.refresh} />
          </View>
          <Text style={styles.meta}>合成預覽只展示綁定步驟，不會開啟真實 Telegram 或 bot。</Text>
          {model.challenge.state === "seen" && model.challenge.candidate ? <View style={styles.candidate}>
            <Text style={styles.title}>待核對的 Telegram 帳號</Text>
            <Text style={styles.body}>候選接收者：{model.challenge.candidate.label}</Text>
            <Text style={styles.meta}>帳號提示：{model.challenge.candidate.chatIdHint}</Text>
            <Text style={styles.body}>請核對名稱及帳號提示確實屬於本人，再確認綁定。</Text>
            <AppButton label="核對這個 Telegram 帳號" disabled={!canConfirm} onPress={actions.stageConfirm} />
          </View> : <Text style={styles.meta}>尚未讀取到可核對的候選帳號；請完成步驟後重新讀取。</Text>}
        </>}
      </View> : null}
      <ChannelReviewPanel model={model} actions={actions} />
      <RecentDeliveries deliveries={model.deliveries} />
    </>}
  </SectionCard>;
}

const styles = StyleSheet.create({
  card: { minWidth: 0 },
  stack: { gap: spacing.md, minWidth: 0 },
  entry: { backgroundColor: colors.neutralSurface, padding: spacing.md, borderRadius: radius.small, gap: spacing.sm, minWidth: 0 },
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700", flexShrink: 1 },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20, flexShrink: 1 },
  fieldHint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20, marginTop: spacing.xs },
  warning: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption, lineHeight: 20 },
  error: { color: colors.errorInk },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.neutralSurface, padding: spacing.md, borderRadius: radius.small, minWidth: 0 },
  noteCopy: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23, flex: 1, minWidth: 0 },
  warningNote: { backgroundColor: colors.paleAmber },
  errorNote: { backgroundColor: colors.paleCoral },
  badge: { fontFamily: chineseFont, color: colors.muted, backgroundColor: colors.white, fontSize: typeScale.caption, lineHeight: 20, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, flexShrink: 1 },
  currentBadge: { backgroundColor: colors.paleTeal, color: colors.deepTeal },
  warningBadge: { backgroundColor: colors.paleAmber, color: colors.warningInk },
  errorBadge: { backgroundColor: colors.paleCoral, color: colors.errorInk },
  review: { backgroundColor: colors.neutralSurface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, borderRadius: radius.small, gap: spacing.md, minWidth: 0 },
  candidate: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, gap: spacing.sm, minWidth: 0 },
});
