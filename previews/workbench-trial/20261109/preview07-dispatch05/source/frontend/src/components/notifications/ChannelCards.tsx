import { EmptyListCard } from "../EmptyListCard";
import { AppStatusBadge } from "../AppStatusBadge";
import { SettingsSection as SectionCard } from "../settings/SettingsSection";
import { useId, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  blocksAnotherTelegramTest, channelDeliveryLabels, channelTime, pushDeliveryNeedsReview, pushTestAllowed, telegramBeginAllowed,
  type ChannelDeliveryView, type ChannelPermission, type ChannelReadState, type ChannelReview,
  type PushSettingsActions, type PushSettingsModel, type TelegramSettingsActions, type TelegramSettingsModel,
} from "../../channel-view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { AppButton, AppTextField, SectionHeader } from "../ui";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";

import { MotionFeedback } from "../../motion";

export type ConfirmedChannelOperation = { reference: string } | null;
type SharedModel = PushSettingsModel | TelegramSettingsModel;
type SharedActions = PushSettingsActions | TelegramSettingsActions;
type Tone = "neutral" | "warning" | "error";

const permissionLabels: Record<ChannelPermission, string> = {
  default: "尚未選擇通知權限", granted: "已允許通知", denied: "已拒絕通知", unsupported: "此設備未支援通知",
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
    <Text style={[styles.noteCopy, tone === "warning" && styles.warning, tone === "error" && styles.error]}>{children}</Text>
  </View>;
}

function readMessage(state: ChannelReadState) {
  return state === "ready" ? "" : state === "loading" ? "正在重新讀取本人渠道狀態，上一批訂閱、接收者及投遞暫不展示。"
    : state === "session_changed" ? "登入身份已變更，上一位使用者的渠道、接收者及操作內容已清除。請重新登入，或以正確帳戶重新載入頁面。"
      : "未能讀取本人渠道狀態，上一批訂閱、接收者及投遞暫不展示。請手動重新讀取。";
}

function ChannelAnnouncements({ model }: { model: SharedModel }) {
  return <>
    <StatusAnnouncement eventKey={model.readState} message={readMessage(model.readState)} urgent={model.readState === "failed" || model.readState === "session_changed"} />
    <StatusAnnouncement eventKey={String(model.online)} message={model.online ? "已恢復連線，請重新核對本人渠道狀態。" : "目前離線；恢復連線後才可確認渠道操作或重新讀取。"} />
    <StatusAnnouncement eventKey={String(model.workerEnabled)} message={model.workerEnabled ? "背景投遞暫停提示已解除；可用操作仍按目前渠道狀態判斷。" : "背景投遞目前暫停，不能發送一般測試；排隊中的投遞不等於已發送。"} />
    <StatusAnnouncement eventKey={model.notice ?? ""} message={model.notice ?? ""} />
  </>;
}

function ReadState({ state, online, locked, refresh }: { state: ChannelReadState; online: boolean; locked: boolean; refresh(): void }) {
  return <View style={styles.stack}>
    {state === "loading" || state === "failed" ? <ReadStateNotice key={state} state={state === "loading" ? "loading" : "error"} message={readMessage(state)}>
      {state === "failed" ? <AppButton label="重新讀取本人渠道狀態" variant="secondary" disabled={!online || locked} onPress={refresh} /> : null}
    </ReadStateNotice> : <StateNote>{readMessage(state)}</StateNote>}
    {!online && state !== "session_changed" ? <StateNote tone="warning">目前離線，恢復連線後才可重新讀取。</StateNote> : null}
  </View>;
}

function RuntimeNotices({ model }: { model: SharedModel }) {
  return <>
    {!model.online ? <StateNote tone="warning">目前離線；所示渠道狀態只供參考，恢復連線後才可確認操作或重新讀取。</StateNote> : null}
    {!model.workerEnabled ? <StateNote tone="warning">背景投遞目前暫停，不能發送一般測試；排隊中的投遞不等於已發送。</StateNote> : null}
    {model.notice ? <StateNote>{model.notice}</StateNote> : null}
  </>;
}

function ChannelReviewPanel({ model, actions, production }: { model: SharedModel; actions: SharedActions; production: boolean }) {
  const replacingChallenge = model.review?.kind === "begin" && "challenge" in model && model.challenge !== null;
  const native = "platform" in model && (model.platform === "android" || model.platform === "ios");
  return <>
    {model.conflict ? <View style={styles.review}>
      <Text accessibilityRole="header" aria-level={3} style={styles.title}>渠道狀態已有更新</Text>
      <Text style={styles.body}>以下渠道資料是最新讀取的狀態；本次操作仍沿用原來核對的版本。請比較目標及版本，再明確選擇使用最新狀態，並重新核對操作。</Text>
      <AppButton label="核對並使用最新渠道狀態" variant="secondary" disabled={!model.online} onPress={actions.useLatest} />
    </View> : null}
    {model.review ? <View style={styles.review}>
      <Text accessibilityRole="header" aria-level={3} style={styles.title}>待確認渠道操作</Text>
      <Text style={styles.body}>目標：{model.review.targetLabel}</Text>
      <Text style={styles.meta}>核對版本：{model.review.expectedVersion === null ? "新登記／綁定，未有既有版本" : model.review.expectedVersion}</Text>
      <Text style={styles.body}>{replacingChallenge
        ? "服務接受重新開始後，會立即令目前的 Telegram 連結及候選帳號失效，並建立新的 10 分鐘連結；舊候選與勾選須重新核對。每小時最多 6 次開始，達限時請稍後重讀。"
        : native && model.review.kind === "enable" ? "只登記本人的這個裝置。系統通知權限及裝置訂閱不代表已授權所有任務提醒或主動聯絡。" : reviewScope[model.review.kind]}</Text>
      <AppCheckbox label={replacingChallenge ? "我明白舊連結及候選帳號會失效，並同意重新開始" : native && model.review.kind === "enable" ? "我同意登記本人的這個裝置" : reviewLabels[model.review.kind]} checked={model.review.confirmed}
        disabled={model.locked || model.conflict} onChange={actions.confirmReview} />
      <View style={styles.actions}>
        <AppButton label={production ? "確認這項渠道操作" : "模擬確認這項渠道操作"} disabled={!model.online || model.locked || model.conflict || !model.review.confirmed} onPress={actions.submit} />
        <AppButton label="取消渠道操作" variant="quiet" disabled={model.locked} onPress={actions.cancel} />
      </View>
    </View> : null}
  </>;
}

function RecentDeliveries({ deliveries, emptyReady }: { deliveries: ChannelDeliveryView[]; emptyReady: boolean }) {
  const latest = [...deliveries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 20);
  return <View style={[styles.stack, styles.group]}>
    <Text accessibilityRole="header" aria-level={3} style={styles.title}>最近投遞</Text>
    <Text style={styles.meta}>最多顯示最近 20 項。渠道已接受不等於已送達或已讀；投遞及本人回覆均不代表照護任務已完成。</Text>
    {latest.length === 0 ? emptyReady ? <EmptyListCard title="已載入資料中暫無投遞紀錄" detail="只代表本次取得的最近紀錄。" /> : null : latest.map(delivery => <View key={delivery.id} style={styles.entry}>
      <View style={styles.top}><Text style={styles.title}>{delivery.label}</Text>
        <AppStatusBadge label={channelDeliveryLabels[delivery.status]} tone={delivery.status === "unknown" ? "warning" : delivery.status === "rejected" ? "error" : delivery.status === "stopped" ? "neutral" : "info"} /></View>
      <Text style={styles.meta}>建立：{channelTime(delivery.createdAt)}</Text>
      {delivery.reasonLabel ? <Text style={styles.meta}>狀態說明：{delivery.reasonLabel}</Text> : null}
      {delivery.status === "unknown" ? <Text style={styles.warning}>結果未知，請查核原投遞狀態；不要盲目重發。</Text> : null}
      {"acknowledgedAt" in delivery && delivery.acknowledgedAt ? <Text style={styles.body}>收到本人回覆：{channelTime(delivery.acknowledgedAt)}</Text> : null}
    </View>)}
  </View>;
}

function BrowserEnableForm({ form, disabled, stageEnable, production, platform }: { form: UseFormReturn<BrowserLabelValues>; disabled: boolean; stageEnable(label: string): void; production: boolean; platform?: PushSettingsModel["platform"] }) {
  const formId = useId();
  const error = form.formState.errors.label?.message;
  const native = platform === "android" || platform === "ios", deviceName = platform === "ios" ? "iOS" : "Android";
  return <View style={[styles.stack, styles.group]}>
    <FormErrorSummary entries={error ? [{ field: "label", label: native ? "裝置名稱" : "瀏覽器名稱", message: error }] : []} onFocus={() => form.setFocus("label")} />
    <Controller name="label" control={form.control} render={({ field, fieldState }) => <View>
      <AppTextField ref={field.ref} nativeID={`${formId}-label`} aria-invalid={!!fieldState.error} aria-describedby={`${formId}-label-message`} label={native ? "裝置名稱" : "瀏覽器名稱"} accessibilityLabel={native ? `${deviceName}通知裝置名稱` : "瀏覽器通知名稱"} value={field.value}
        disabled={disabled} onChangeText={field.onChange} onBlur={field.onBlur} error={!!fieldState.error} />
      <FormFieldMessage id={`${formId}-label-message`} error={fieldState.error?.message} help="去除前後空格後須有內容，最多 80 字元；只供你辨認本人訂閱。" />
    </View>} />
    <AppButton label={native ? `啟用此 ${deviceName} 裝置通知` : production ? "啟用此瀏覽器通知" : "預覽啟用此瀏覽器通知"} disabled={disabled} onPress={form.handleSubmit(values => stageEnable(values.label.trim()), () => form.setFocus("label"))} />
  </View>;
}

export function WebPushSettingsCard({ model, actions: sourceActions, operationNotice, scopeKey, confirmedOperation, production = false }: { model: PushSettingsModel; actions: PushSettingsActions; operationNotice?: ReactNode; scopeKey: string; confirmedOperation: ConfirmedChannelOperation; production?: boolean }) {
  const stagedBinding = useRef<string | null>(null);
  const [bindingIntent, setBindingIntent] = useState<{ kind: "enable" | "revoke"; id: string | null; baseVersion: number } | null>(null);
  const actions: PushSettingsActions = {
    ...sourceActions,
    stageEnable(label) { stagedBinding.current = model.currentBindingId; setBindingIntent(null); sourceActions.stageEnable(label); },
    stageRevoke(id) { stagedBinding.current = id; setBindingIntent(null); sourceActions.stageRevoke(id); },
    stageTest(id) { setBindingIntent(null); sourceActions.stageTest(id); },
    refresh() { setBindingIntent(null); sourceActions.refresh(); },
    cancel() { setBindingIntent(null); sourceActions.cancel(); },
    useLatest() { setBindingIntent(null); sourceActions.useLatest(); },
    submit() {
      const review = model.review;
      if (review?.confirmed && (review.kind === "enable" || review.kind === "revoke")) setBindingIntent({ kind: review.kind, id: stagedBinding.current, baseVersion: review.expectedVersion ?? 0 });
      else setBindingIntent(null);
      sourceActions.submit();
    },
  };
  const form = useForm<BrowserLabelValues>({ defaultValues: { label: model.platform === "ios" ? "我的iOS裝置" : model.platform === "android" ? "我的Android裝置" : "我的瀏覽器" }, resolver: zodResolver(browserLabelSchema), mode: "onSubmit", shouldFocusError: false });
  const ready = model.readState === "ready";
  const actionBlocked = !model.online || model.locked || !!model.review || model.conflict;
  const canEnable = ready && !actionBlocked && model.available && model.browserSupported && model.permission !== "denied" && model.permission !== "unsupported";
  const native = model.platform === "android" || model.platform === "ios";
  const deviceName = native ? model.platform === "ios" ? "iOS裝置" : "Android裝置" : "瀏覽器";
  const cooldownReady = model.nextTestAt === null || Date.parse(model.nextTestAt) <= Date.now();
  const guidance = native ? ({ default: `須由你在${deviceName}權限提示中選擇允許，才可登記本人的訂閱。`,
    granted: "系統通知權限已允許；仍須登記本人裝置，才可使用這個渠道。",
    denied: "請到系統設定更改育有方的通知權限，再回來重新讀取；本頁不能代你更改權限。",
    unsupported: "這個裝置目前不支援通知。你仍可查看及撤銷既有本人訂閱。" }[model.permission])
    : production && model.permission === "default" ? `須由你在${deviceName}權限提示中選擇允許，才可登記本人的訂閱。` : permissionGuidance[model.permission];
  const unavailable = native ? "此裝置的通知服務目前未可用，不能啟用此裝置；你仍可撤銷既有本人訂閱，測試按各訂閱的服務狀態提供。"
    : "通知服務目前未可用，不能啟用訂閱或發送測試；既有本人訂閱仍可撤銷。";
  return <SectionCard style={styles.card}>
    <ChannelAnnouncements model={model} />
    <StatusAnnouncement eventKey={model.permission} message={`通知權限：${permissionLabels[model.permission]}。${guidance}`} urgent={model.permission === "denied"} />
    <StatusAnnouncement eventKey={`${model.available}:${model.browserSupported}`} message={!model.available ? unavailable : !model.browserSupported ? "此設備未具備所需支援，不能啟用新訂閱；既有訂閱仍可撤銷。" : ""} />
    <SectionHeader density="compact" title={`我的${deviceName}通知`} icon="bell-outline" subtitle={`只管理本人的${deviceName}訂閱。`}
      action={ready && (model.conflict || model.permission === "denied") ? <AppButton label={`重新讀取${deviceName}狀態`} variant="quiet" disabled={!model.online || model.locked || !!model.review} onPress={actions.refresh} /> : undefined} />
    {production ? operationNotice : null}
    {!ready ? <ReadState state={model.readState} online={model.online} locked={production ? model.readState === "loading" : model.locked} refresh={actions.refresh} /> : <>
      <RuntimeNotices model={model} />
      {!production ? operationNotice : null}
      {!model.available ? <StateNote tone="warning">{unavailable}</StateNote> : null}
      <View style={styles.entry}>
        <AppStatusBadge label={`通知權限：${permissionLabels[model.permission]}`} tone={model.permission === "granted" ? "success" : model.permission === "denied" ? "warning" : "neutral"} />
        <Text style={styles.body}>{guidance}</Text>
        {!model.browserSupported && model.permission !== "unsupported" ? <Text style={styles.warning}>此設備未具備所需支援，不能啟用新訂閱；既有訂閱仍可撤銷。</Text> : null}
      </View>
      <BrowserEnableForm platform={model.platform} form={form} disabled={!canEnable} stageEnable={actions.stageEnable} production={production} />
      <ChannelReviewPanel model={model} actions={actions} production={production} />
      <View style={[styles.stack, styles.group]}>
        <Text accessibilityRole="header" aria-level={3} style={styles.title}>本人{native ? "裝置" : deviceName}訂閱</Text>
        {model.bindings.length === 0 ? model.online ? <EmptyListCard title={`目前沒有本人${deviceName}訂閱`} /> : null : model.bindings.map(binding => {
          const deliveryNeedsReview = pushDeliveryNeedsReview(model.deliveries, binding.id);
          const confirmed = !!confirmedOperation && !!bindingIntent && model.online && ready && !model.locked && !model.review && !model.conflict
            && binding.version > bindingIntent.baseVersion && (bindingIntent.kind === "enable" ? binding.id === model.currentBindingId && binding.status === "active" : binding.id === bindingIntent.id && binding.status === "revoked");
          return <View key={binding.id} style={styles.entry}>
            <MotionFeedback active={confirmed} triggerKey={confirmed ? confirmedOperation?.reference ?? null : null} scopeKey={`${scopeKey}:${binding.id}`} testID="push-binding-feedback" animateOnMount={confirmed && bindingIntent?.kind === "enable" && stagedBinding.current === null} style={styles.bindingMetadata}>
            <View style={styles.top}><Text style={styles.title}>{binding.label}</Text>
              <AppStatusBadge label={binding.status === "active" ? "有效綁定" : binding.status === "revoked" ? "已撤銷" : "已過期"} tone={binding.status === "active" ? "success" : binding.status === "revoked" ? "neutral" : "warning"} />
              {model.currentBindingId === binding.id ? <AppStatusBadge label={`目前${deviceName}`} tone="info" /> : null}</View>
            <Text style={styles.meta}>提供者：{binding.providerLabel} · 版本 {binding.version}</Text>
            <Text style={styles.meta}>到期：{binding.expiresAt ? `${channelTime(binding.expiresAt)}` : "未提供到期時間"}</Text>
            </MotionFeedback>
            {binding.status === "active" ? <>
              <View style={styles.actions}>
                <AppButton label="撤銷此訂閱" variant="danger-secondary" disabled={actionBlocked} onPress={() => actions.stageRevoke(binding.id)} />
                <AppButton label={production ? "發送一次一般測試" : "預覽一般測試"} variant="quiet" disabled={actionBlocked || !pushTestAllowed(model, binding)} onPress={() => actions.stageTest(binding.id)} />
              </View>
              {deliveryNeedsReview ? <Text style={styles.warning}>這項訂閱仍有排隊中、發送中或結果未知的投遞；請查核原投遞，切勿盲目重送。若服務、worker 及測試限額允許，可明確發起另一項一般測試。</Text> : null}
            </> : null}
          </View>;
        })}
        <Text style={styles.meta}>最近24小時一般測試餘額：{model.testsRemaining} 次。</Text>
        <Text style={styles.meta}>一般測試按最近 24 小時計算，最多 3 次；兩次測試須相隔至少 60 秒。</Text>
        <Text style={cooldownReady ? styles.meta : styles.warning}>{model.nextTestAt ? `下一次可測試時間：${channelTime(model.nextTestAt)}${cooldownReady ? "，冷卻時間已過。" : "，冷卻期間不可再發測試。"}` : "目前沒有測試冷卻時間。"}</Text>
      </View>
      <RecentDeliveries deliveries={model.deliveries} emptyReady={ready && model.online} />
    </>}
  </SectionCard>;
}

export function TelegramSettingsCard({ model, actions: sourceActions, operationNotice, scopeKey, confirmedOperation, production = false }: { model: TelegramSettingsModel; actions: TelegramSettingsActions; operationNotice?: ReactNode; scopeKey: string; confirmedOperation: ConfirmedChannelOperation; production?: boolean }) {
  const [bindingIntent, setBindingIntent] = useState<{ kind: "confirm" | "revoke"; id: string | null; baseVersion: number } | null>(null);
  const actions: TelegramSettingsActions = {
    ...sourceActions,
    stageBegin() { setBindingIntent(null); sourceActions.stageBegin(); },
    stageConfirm() { setBindingIntent(null); sourceActions.stageConfirm(); },
    stageRevoke() { setBindingIntent(null); sourceActions.stageRevoke(); },
    stageTest() { setBindingIntent(null); sourceActions.stageTest(); },
    refresh() { setBindingIntent(null); sourceActions.refresh(); },
    cancel() { setBindingIntent(null); sourceActions.cancel(); },
    useLatest() { setBindingIntent(null); sourceActions.useLatest(); },
    submit() {
      const review = model.review;
      if (review?.confirmed && (review.kind === "confirm" || review.kind === "revoke")) setBindingIntent({ kind: review.kind, id: model.binding?.id ?? null, baseVersion: model.binding?.version ?? 0 });
      else setBindingIntent(null);
      sourceActions.submit();
    },
  };
  const ready = model.readState === "ready";
  const actionBlocked = !model.online || model.locked || !!model.review || model.conflict;
  const challengeExpired = !!model.challenge && Date.parse(model.challenge.expiresAt) <= Date.now();
  const existingBinding = model.binding !== null && model.binding.status !== "revoked";
  const confirmed = !!confirmedOperation && !!bindingIntent && !!model.binding && model.online && ready && !model.locked && !model.review && !model.conflict
    && model.binding.version > bindingIntent.baseVersion && (bindingIntent.kind === "confirm" ? model.binding.status === "active" : model.binding.id === bindingIntent.id && model.binding.status === "revoked");
  const canBegin = !actionBlocked && telegramBeginAllowed(model);
  const canConfirm = !actionBlocked && model.configured && !existingBinding && model.challenge?.state === "seen" && model.challenge.candidate !== null && !challengeExpired;
  const testBlocked = model.binding !== null && blocksAnotherTelegramTest(model.deliveries, model.binding.id);
  const canTest = !actionBlocked && model.configured && model.workerEnabled && model.binding?.status === "active" && !testBlocked;
  return <SectionCard style={styles.card}>
    <ChannelAnnouncements model={model} />
    <StatusAnnouncement eventKey={String(model.configured)} message={!model.configured ? "Telegram 渠道目前未設定或未可用，不能開始、確認新綁定或發送測試；既有本人綁定仍可撤銷。" : ""} />
    <StatusAnnouncement eventKey={`${model.binding?.id ?? ""}:${model.binding?.status ?? "none"}`} message={model.binding?.status === "blocked" ? "本人 Telegram 渠道已封鎖，不能發送測試；須先撤銷，才可重新開始私人綁定。" : ""} urgent={model.binding?.status === "blocked"} />
    <SectionHeader density="compact" title="我的 Telegram" icon="message-text-outline" subtitle="只綁定本人的私人帳號。"
      action={ready && model.conflict ? <AppButton label="重新讀取 Telegram 狀態" variant="quiet" disabled={!model.online || model.locked || !!model.review} onPress={actions.refresh} /> : undefined} />
    {production ? operationNotice : null}
    {!ready ? <ReadState state={model.readState} online={model.online} locked={production ? model.readState === "loading" : model.locked} refresh={actions.refresh} /> : <>
      <RuntimeNotices model={model} />
      {!production ? operationNotice : null}
      {!model.configured ? <StateNote tone="warning">Telegram 渠道目前未設定或未可用，不能開始、確認新綁定或發送測試；你仍可撤銷既有本人綁定。</StateNote> : null}
      {model.binding ? <View style={styles.entry}>
        <MotionFeedback active={confirmed} triggerKey={confirmed ? confirmedOperation?.reference ?? null : null} scopeKey={`${scopeKey}:${model.binding.id}`} testID="telegram-binding-feedback" animateOnMount={confirmed && bindingIntent?.kind === "confirm" && bindingIntent.id === null} style={styles.bindingMetadata}>
        <View style={styles.top}><Text style={styles.title}>{model.binding.label}</Text>
          <AppStatusBadge label={model.binding.status === "active" ? "有效綁定" : model.binding.status === "revoked" ? "已撤銷" : "渠道已封鎖"} tone={model.binding.status === "active" ? "success" : model.binding.status === "blocked" ? "error" : "neutral"} /></View>
        <Text style={styles.body}>本人接收者：{model.binding.label}</Text>
        <Text style={styles.meta}>帳號提示：{model.binding.chatIdHint} · 版本 {model.binding.version}</Text>
        </MotionFeedback>
        {model.binding.status === "blocked" ? <Text style={styles.warning}>這項綁定已封鎖，不能發送測試；須先撤銷，才可重新開始私人綁定。</Text> : null}
        {model.binding.status !== "revoked" ? <View style={styles.actions}>
          <AppButton label="撤銷 Telegram 綁定" variant="danger-secondary" disabled={actionBlocked} onPress={actions.stageRevoke} />
          <AppButton label={production ? "發送一次一般測試" : "預覽一般測試"} variant="quiet" disabled={!canTest} onPress={actions.stageTest} />
        </View> : null}
        {model.binding.status !== "revoked" && testBlocked ? <Text style={styles.warning}>仍有排隊中、發送中或未有本人回覆的未知投遞；先查核原投遞，暫不可另發測試。</Text> : null}
      </View> : model.online ? <EmptyListCard title="目前沒有本人 Telegram 綁定" /> : null}
      {!existingBinding ? <AppButton label={production ? model.challenge ? "重新開始私人綁定" : "開始私人綁定" : model.challenge ? "預覽重新開始私人綁定" : "預覽開始私人綁定"} disabled={!canBegin} onPress={actions.stageBegin} /> : null}
      {model.challenge ? <View style={styles.entry}>
        <Text accessibilityRole="header" aria-level={3} style={styles.title}>{challengeExpired ? "私人綁定步驟已過期" : "私人綁定步驟"}</Text>
        <Text style={styles.meta}>版本 {model.challenge.version} · 到期：{channelTime(model.challenge.expiresAt)}</Text>
        {challengeExpired ? <Text style={styles.warning}>這個步驟已過期，不能再確認候選帳號。請重新開始私人綁定。</Text> : <>
          <Text style={styles.body}>先在 Telegram 完成本人的綁定步驟，再回到此頁手動重新讀取；開始步驟尚未代表綁定完成。</Text>
          <View style={styles.actions}>
            <AppButton label="開啟 Telegram 綁定步驟" variant="secondary" disabled={actionBlocked || !model.configured || existingBinding} onPress={actions.openStartLink} />
            <AppButton label="重新讀取 Telegram 狀態" variant="quiet" disabled={!model.online || model.locked || !!model.review} onPress={actions.refresh} />
          </View>
          <Text style={styles.meta}>{production ? "按下入口會開啟目前服務提供的 Telegram 綁定連結；須由本人完成，再回來核對候選帳號。" : "合成預覽只展示綁定步驟，不會開啟真實 Telegram 或 bot。"}</Text>
          {model.challenge.state === "seen" && model.challenge.candidate ? <View style={styles.candidate}>
            <Text style={styles.title}>待核對的 Telegram 帳號</Text>
            <Text style={styles.body}>候選接收者：{model.challenge.candidate.label}</Text>
            <Text style={styles.meta}>帳號提示：{model.challenge.candidate.chatIdHint}</Text>
            <Text style={styles.body}>請核對名稱及帳號提示確實屬於本人，再確認綁定。</Text>
            <AppButton label="核對這個 Telegram 帳號" disabled={!canConfirm} onPress={actions.stageConfirm} />
          </View> : <Text style={styles.meta}>尚未讀取到可核對的候選帳號；請完成步驟後重新讀取。</Text>}
        </>}
      </View> : null}
      <ChannelReviewPanel model={model} actions={actions} production={production} />
      <RecentDeliveries deliveries={model.deliveries} emptyReady={ready && model.online} />
    </>}
  </SectionCard>;
}

const styles = StyleSheet.create({
  bindingMetadata: { gap: spacing.sm },
  card: { minWidth: 0 },
  stack: { gap: spacing.md, minWidth: 0 },
  entry: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.sm, minWidth: 0 },
  group: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700", flexShrink: 1 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  error: { color: colors.errorInk },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm, minWidth: 0 },
  noteCopy: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool, flex: 1, minWidth: 0 },
  warningNote: { borderLeftWidth: 2, borderLeftColor: colors.warningInk, paddingLeft: spacing.md },
  errorNote: { borderLeftWidth: 2, borderLeftColor: colors.errorInk, paddingLeft: spacing.md },
  review: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.md, minWidth: 0 },
  candidate: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, gap: spacing.sm, minWidth: 0 },
});
