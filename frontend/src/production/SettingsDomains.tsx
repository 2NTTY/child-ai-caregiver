import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../../src/shared/family.ts";
import { AppCheckbox } from "../components/AppCheckbox";
import { Switch } from "../components/AppSwitch";
import { AppTimeField, AppTimeZoneSelect } from "../components/DateTimeFields";
import { AppButton, SectionHeader } from "../components/ui";
import { SettingsSection as SectionCard } from "../components/settings/SettingsSection";
import { FormErrorSummary, FormFieldMessage } from "../components/FormErrorSummary";
import { WebPushSettingsCard, TelegramSettingsCard } from "../components/notifications/ChannelCards";
import { useContainerWidth } from "../components/useContainerWidth";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { useProduction } from "./ProductionProvider";
import { useDomainEnvironment, useDomainWriteGuard } from "./useDomainEnvironment";
import type { useProductionFamily } from "./useProductionFamily";
import { useProductionModelSettings } from "./useProductionModelSettings";
import { useProductionPushSettings } from "./useProductionPushSettings";
import { useProductionTelegramSettings } from "./useProductionTelegramSettings";
import { useProductionNotificationPreferences, type ProductionPreferenceValues } from "./useProductionNotificationPreferences";
import { useProductionContact } from "./useProductionContact";
import type { SettingsEnvironment } from "./SettingsDomainSupport";
type PersonalDomains = { family: ReturnType<typeof useProductionFamily>; modelSettings: ReturnType<typeof useProductionModelSettings>;
  push: ReturnType<typeof useProductionPushSettings>; telegram: ReturnType<typeof useProductionTelegramSettings>; preferences: ReturnType<typeof useProductionNotificationPreferences> };
const PersonalContext = createContext<PersonalDomains | null>(null);
const ContactContext = createContext<ReturnType<typeof useProductionContact> | null>(null);
type PublishedPersonal = { key: string; domains: PersonalDomains };
type PublishedContact = { key: string; domains: ReturnType<typeof useProductionContact> };
const noop = () => {};
export function ProductionSettingsDomains({ children }: { children: ReactNode }) {
  const env = useDomainEnvironment(), { recordsState } = useProduction();
  const identityScope = JSON.stringify([env.identityKey, env.owner.getSnapshot().sessionGeneration]);
  const childScope = JSON.stringify([env.scopeKey, env.role, env.owner.getSnapshot().sessionGeneration]);
  const [personal, publishPersonal] = useState<PublishedPersonal | null>(null), [contact, publishContact] = useState<PublishedContact | null>(null);
  const personalDomains = personal?.key === identityScope && env.currentIdentity() ? personal.domains : emptyPersonalDomains(env);
  const contactDomains = contact?.key === childScope && env.current() ? contact.domains : emptyContactDomain(env);
  return <PersonalContext.Provider value={personalDomains}><ContactContext.Provider value={contactDomains}>
    <SettingsIdentityBridge key={identityScope} ownerKey={identityScope} env={env} childrenVersion={recordsState.children} publish={publishPersonal} />
    <SettingsChildBridge key={childScope} ownerKey={childScope} env={env} publish={publishContact} />
    {children}
  </ContactContext.Provider></PersonalContext.Provider>;
}
const SettingsIdentityBridge = memo(function SettingsIdentityBridge({ env, ownerKey, childrenVersion: _childrenVersion, publish }: {
  env: SettingsEnvironment; ownerKey: string; childrenVersion: unknown; publish: (value: PublishedPersonal) => void;
}) {
  const family = emptyPersonalDomains(env).family, modelSettings = useProductionModelSettings(env);
  const push = useProductionPushSettings(env), telegram = useProductionTelegramSettings(env), preferences = useProductionNotificationPreferences(env);
  useLayoutEffect(() => { publish({ key: ownerKey, domains: { family, modelSettings, push, telegram, preferences } }); });
  return null;
});
const SettingsChildBridge = memo(function SettingsChildBridge({ env, ownerKey, publish }: { env: SettingsEnvironment; ownerKey: string; publish: (value: PublishedContact) => void }) {
  const contact = useProductionContact(env);
  useLayoutEffect(() => { publish({ key: ownerKey, domains: contact }); });
  return null;
});
function emptyPersonalDomains(env: SettingsEnvironment): PersonalDomains {
  const modelSettings: PersonalDomains["modelSettings"] = { model: { scopeKey: JSON.stringify([env.identityKey, env.owner.getSnapshot().sessionGeneration]), accountName: "", serverLabel: env.apiBaseUrl, snapshot: null,
    online: env.online, authorized: false, busy: "read", operation: "none", notice: "正在核對目前本人設定。", needsRead: false,
    formRevision: 0, secretRevision: 0, keyCheck: null }, actions: { refresh: noop, save: noop, check: noop } };
  const family: PersonalDomains["family"] = { readState: "error", model: { families: [], family: null, selfUserId: env.userId ?? "", children: [], online: env.online,
    loadState: "lost", canManage: false, canStartAction: false, locked: true, draft: null, latest: null, incoming: null, incomingError: null,
    oneTimeCode: null, inviteFormKey: 0, operation: { state: "none", message: "", reference: null }, notice: "家庭多人協作安排於 P4，目前尚未開放。" },
    actions: { selectFamily: noop, refresh: noop, editInvite: noop, reviewInvite: noop, stageMember: noop, stageRevokeInvitation: noop,
      editIncoming: noop, previewIncoming: noop, stageAccept: noop, confirmScope: noop, reviewCurrent: noop, submit: noop, cancel: noop, useLatest: noop, dismissCode: noop, openProfile: noop },
    original: null, busy: true, confirmOriginal: noop, retryOriginal: noop };
  const push: PersonalDomains["push"] = { model: { online: env.online, readState: "loading", locked: true, conflict: false, notice: null, workerEnabled: false,
    review: null, available: false, browserSupported: false, permission: "unsupported", currentBindingId: null, bindings: [], deliveries: [], testsRemaining: 0, nextTestAt: null },
    actions: { refresh: noop, stageEnable: noop, stageRevoke: noop, stageTest: noop, confirmReview: noop, submit: noop, cancel: noop, useLatest: noop },
    original: null, busy: true, savedReference: null, confirmOriginal: noop, retryOriginal: noop };
  const telegram: PersonalDomains["telegram"] = { model: { online: env.online, readState: "loading", locked: true, conflict: false, notice: null, workerEnabled: false,
    review: null, configured: false, binding: null, challenge: null, deliveries: [] }, actions: { refresh: noop, stageBegin: noop, stageConfirm: noop, stageRevoke: noop,
      stageTest: noop, openStartLink: noop, confirmReview: noop, submit: noop, cancel: noop, useLatest: noop }, original: null, busy: true, savedReference: null, confirmOriginal: noop, retryOriginal: noop };
  return { family, modelSettings, push, telegram, preferences: { scopeKey: JSON.stringify([env.identityKey, env.owner.getSnapshot().sessionGeneration]), setDraftEditing: noop, preferences: null, online: env.online, busy: true, original: null, fresh: false,
    notice: "正在核對目前通知偏好。", refresh: noop, save: noop, confirmOriginal: noop, retryOriginal: noop } };
}
function emptyContactDomain(env: SettingsEnvironment): ReturnType<typeof useProductionContact> {
  return { model: { scopeKey: env.scopeKey, childName: env.childName, userId: env.userId ?? "", dataLabel: "尚未讀取", page: null, online: env.online,
    access: "read_only", load: "loading", busy: true, locked: true, notice: "正在核對目前孩子的聯絡資料。", operation: "none", pending: null,
    originalConsent: false, dirty: false, epoch: -1, confirmationEpoch: 0, missingTasks: [] },
    actions: { refresh: noop, markDirty: noop, discard: noop, save: noop, setOriginalConsent: noop, retryOriginal: noop } };
}
export function useProductionSettingsDomains() {
  const domains = useContext(PersonalContext); if (!domains) throw new Error("ProductionSettingsDomains must be mounted once in the private host"); return domains;
}
export function useProductionContactDomain() {
  const contact = useContext(ContactContext); if (!contact) throw new Error("ProductionSettingsDomains must be mounted once in the private host"); return contact;
}
interface RecoveryProps { busy: boolean; confirmed: boolean; reviewed: boolean; consent: boolean; online: boolean; onRead: () => void; onConfirm: (value: boolean) => void; onRetry: () => void; children?: ReactNode }
function SettingsOriginalRecovery({ busy, confirmed, reviewed, consent, online, onRead, onConfirm, onRetry, children }: RecoveryProps) {
  return <View style={styles.recovery}><Text style={styles.body}>{confirmed ? "原操作已確認；目前資料尚待讀回，不能再次提交。" : "原操作結果待查核，其他提交暫停。"}</Text>
    {children}<AppButton label="查原收據及目前狀態" variant="quiet" disabled={!online || busy} onPress={onRead} />
    {!confirmed ? <><AppCheckbox label="我已核對目前資料，同意以原內容及版本重試" checked={consent} disabled={!online || busy || !reviewed} onChange={onConfirm} />
      <AppButton label="明確重試原操作" variant="secondary" disabled={!online || busy || !reviewed || !consent} onPress={onRetry} /></> : null}
  </View>;
}
export function ProductionFamilyOperationNotice() {
  const { family } = useProductionSettingsDomains(), entry = family.original;
  return entry ? <SettingsOriginalRecovery busy={family.busy} confirmed={entry.confirmed} reviewed={entry.reviewed} consent={entry.consent} online={family.model.online}
    onRead={family.actions.refresh} onConfirm={family.confirmOriginal} onRetry={family.retryOriginal}>
    <Text style={styles.meta}>原操作：{entry.draft.kind === "accept" ? "接受已核對的家庭邀請" : entry.draft.kind === "invite" ? `邀請 ${entry.draft.values.email}；版本 ${entry.draft.basis.version}` : entry.draft.kind === "member" ? `更改 ${entry.draft.name} 的角色；版本 ${entry.draft.basis.version}` : `撤銷 ${entry.draft.email} 的邀請；版本 ${entry.draft.basis.version}`}</Text>
  </SettingsOriginalRecovery> : null;
}
export function ProductionChannelSettings() {
  const { push, telegram } = useProductionSettingsDomains(), env = useDomainEnvironment(), layout = useContainerWidth(), stack = layout.width < 760;
  const identityScope = JSON.stringify([env.identityKey, env.owner.getSnapshot().sessionGeneration]);
  const recovery = (domain: typeof push | typeof telegram) => domain.original ? <SettingsOriginalRecovery busy={domain.busy} confirmed={domain.original.confirmed}
    reviewed={domain.original.reviewed} consent={domain.original.consent} online={domain.model.online} onRead={domain.actions.refresh} onConfirm={domain.confirmOriginal} onRetry={domain.retryOriginal}>
    <Text style={styles.meta}>原目標：{domain.original.review.targetLabel} · 原版本 {domain.original.review.expectedVersion ?? "新增綁定"}</Text>
  </SettingsOriginalRecovery> : null;
  return <View testID="channel-settings" style={styles.workspace}>
    <SectionCard><SectionHeader density="compact" title="本人的通知渠道" subtitle="管理本人的接收方式與綁定狀態。" /></SectionCard>
    <View ref={layout.ref} onLayout={layout.onLayout} style={[styles.columns, stack && styles.stack]}>
      <View testID="push-settings" style={[styles.column, stack && styles.fullColumn]}><WebPushSettingsCard production scopeKey={identityScope + ":push"}
        model={push.model} actions={push.actions} operationNotice={recovery(push)} confirmedOperation={push.savedReference ? { reference: push.savedReference } : null} /></View>
      <View testID="telegram-settings" style={[styles.column, stack && styles.fullColumn]}><TelegramSettingsCard production scopeKey={identityScope + ":telegram"}
        model={telegram.model} actions={telegram.actions} operationNotice={recovery(telegram)} confirmedOperation={telegram.savedReference ? { reference: telegram.savedReference } : null} /></View>
    </View>
  </View>;
}
const preferenceSchema = z.object({ timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "請填有效的 IANA 時區。"),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "請填 HH:mm，例如 22:00。"), quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "請填 HH:mm，例如 08:00。"),
  allowAppointmentDuringQuiet: z.boolean() }).refine(value => value.quietStart !== value.quietEnd, { path: ["quietEnd"], message: "開始及結束時間須不同。" });
export function ProductionNotificationPreferences() {
  const { preferences: domain } = useProductionSettingsDomains();
  return <NotificationPreferencesForm key={domain.scopeKey} domain={domain} />;
}
function NotificationPreferencesForm({ domain }: { domain: PersonalDomains["preferences"] }) {
  const formId = useId();
  const [reviewNotice, setReviewNotice] = useState("");
  const [review, setReview] = useState<{ values: ProductionPreferenceValues; expectedVersion: number; basis: string } | null>(null);
  const { version: _version, ...defaults } = DEFAULT_NOTIFICATION_PREFERENCES;
  const form = useForm<ProductionPreferenceValues>({ defaultValues: defaults, resolver: zodResolver(preferenceSchema), mode: "onSubmit", shouldFocusError: false });
  const locked = domain.busy || !!domain.original || !domain.online || !domain.fresh;
  const preferenceBasis = JSON.stringify(domain.preferences ? [domain.preferences.version, domain.preferences.timeZone, domain.preferences.quietStart, domain.preferences.quietEnd, domain.preferences.allowAppointmentDuringQuiet] : null);
  const previousBasis = useRef(preferenceBasis);
  const needsAttention = !domain.fresh || !!domain.original || domain.busy || !domain.online;
  const fields = [{ name: "timeZone", label: "通知時區" }, { name: "quietStart", label: "安靜時段開始" }, { name: "quietEnd", label: "安靜時段結束" }] as const;
  const errors = fields.flatMap(field => form.formState.errors[field.name]?.message ? [{ field: field.name, label: field.label, message: form.formState.errors[field.name]!.message! }] : []);
  useEffect(() => {
    if (previousBasis.current !== preferenceBasis) {
      if (review || form.formState.isDirty) setReviewNotice("通知偏好已改變，原確認已失效；請重新核對草稿及目前版本。");
      setReview(null); previousBasis.current = preferenceBasis;
    }
    if (domain.preferences) {
      const { version: _savedVersion, ...values } = domain.preferences;
      if (!form.formState.isDirty || JSON.stringify(form.getValues()) === JSON.stringify(values)) form.reset(values);
    } else form.reset(defaults);
  }, [preferenceBasis, form.reset]);
  useEffect(() => { if (!domain.online) setReview(null); }, [domain.online]);
  const setDraftEditing = domain.setDraftEditing;
  useEffect(() => {
    setDraftEditing(form.formState.isDirty || !!review);
    return () => setDraftEditing(false);
  }, [form.formState.isDirty, !!review, setDraftEditing]);
  useDomainWriteGuard(form.formState.isDirty || !!review, false, "account", false);
  function input(name: "timeZone" | "quietStart" | "quietEnd", label: string) {
    return <Controller name={name} control={form.control} render={({ field, fieldState }) => <View>
      {name === "timeZone" ? <AppTimeZoneSelect ref={field.ref} id={`${formId}-${name}`} value={field.value} disabled={locked} onBlur={field.onBlur}
        invalid={!!fieldState.error} describedBy={fieldState.error ? `${formId}-${name}-message` : undefined} onChange={value => { field.onChange(value); setReview(null); }} />
        : <AppTimeField ref={field.ref} id={`${formId}-${name}`} errorId={`${formId}-${name}-message`} label={label} value={field.value} disabled={locked} error={fieldState.error?.message}
          onBlur={field.onBlur} onChange={value => { field.onChange(value); setReview(null); }} />}
      {name === "timeZone" ? <FormFieldMessage id={`${formId}-${name}-message`} error={fieldState.error?.message} /> : null}
    </View>} />;
  }
  return <SectionCard><SectionHeader density="compact" title="通知偏好" subtitle="設定本人的安靜時段，不會綁定通知渠道或授權發送。"
    action={<AppButton label="重新讀取" accessibilityLabel="重新讀取通知偏好" variant="quiet" density="compact" disabled={!domain.online || domain.busy} onPress={domain.refresh} />} />
    {!domain.online ? <Text style={styles.meta}>目前離線；恢復連線並重新讀取後才可保存。</Text> : null}
    {needsAttention && domain.notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{domain.notice}</Text> : null}
    {!domain.preferences && !domain.notice ? <Text style={styles.meta}>{domain.busy ? "正在讀取通知偏好…" : "尚未讀取通知偏好，請重新讀取。"}</Text> : null}
    {domain.original ? <SettingsOriginalRecovery busy={domain.busy} confirmed={domain.original.confirmed} reviewed={domain.original.reviewed} consent={domain.original.consent}
      online={domain.online} onRead={domain.refresh} onConfirm={domain.confirmOriginal} onRetry={domain.retryOriginal}>
      <Text style={styles.meta}>原版本 {domain.original.input.expectedVersion} · {domain.original.input.timeZone} · {domain.original.input.quietStart}–{domain.original.input.quietEnd}</Text>
    </SettingsOriginalRecovery> : null}
    <FormErrorSummary entries={errors} onFocus={field => form.setFocus(field as "timeZone" | "quietStart" | "quietEnd")} />
    <View style={styles.timeRow}><View style={styles.timeField}>{input("quietStart", "安靜時段開始")}</View><View style={styles.timeField}>{input("quietEnd", "安靜時段結束")}</View></View>
    {input("timeZone", "通知時區")}
    <Controller name="allowAppointmentDuringQuiet" control={form.control} render={({ field }) => <View style={styles.switchRow}>
      <View style={styles.copy}><Text style={styles.title}>預約提醒例外</Text><Text style={styles.meta}>只在本人明確開啟後容許例外；預設關閉。</Text></View>
      <Switch accessibilityLabel="預約提醒例外" value={field.value} disabled={locked} onValueChange={value => { field.onChange(value); setReview(null); }} />
    </View>} />
    <AppButton label="核對通知偏好" disabled={locked} onPress={form.handleSubmit(values => { if (!locked && domain.preferences) { setReviewNotice(""); setReview({ values, expectedVersion: domain.preferences.version, basis: preferenceBasis }); } })} />
    {reviewNotice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{reviewNotice}</Text> : null}
    {review ? <View style={styles.recovery}><Text style={styles.title}>待確認 · 尚未保存 · 版本 {review.expectedVersion}</Text><Text style={styles.body}>{review.values.timeZone}；安靜時段 {review.values.quietStart}–{review.values.quietEnd}；預約例外{review.values.allowAppointmentDuringQuiet ? "開啟" : "關閉"}。</Text>
      <AppButton label="確認保存本人偏好" disabled={locked || review.basis !== preferenceBasis} onPress={() => { if (locked || review.basis !== preferenceBasis) return; domain.save(review.values, review.expectedVersion); setReview(null); }} /><AppButton label="返回修改" variant="quiet" onPress={() => setReview(null)} /></View> : null}
    {!needsAttention && domain.notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{domain.notice}</Text> : null}
    <Text style={styles.meta}>設定頁籤之間會保留草稿；離頁須確認捨棄，待查操作須先處理。重新載入不能恢復本次草稿。</Text>
  </SectionCard>;
}
const styles = StyleSheet.create({ workspace: { gap: spacing.lg }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" },
  column: { flex: 1, minWidth: 0, width: "100%", gap: spacing.lg }, fullColumn: { flex: undefined, flexBasis: "auto", flexGrow: 0, flexShrink: 0 },
  recovery: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md }, field: { gap: spacing.xs }, toggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, timeField: { flexBasis: 180, flexGrow: 1, minWidth: 0 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  copy: { flex: 1, minWidth: 0 }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool } });
