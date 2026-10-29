import { createContext, memo, use, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
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
import { chineseFont, colors, readingType, spacing } from "../theme";
import { useProduction } from "./ProductionProvider";
import { useDomainEnvironment, useDomainWriteGuard } from "./useDomainEnvironment";
import type { useProductionFamily } from "./useProductionFamily";
import { useProductionModelSettings } from "./useProductionModelSettings";
import { useProductionPushSettings } from "./useProductionPushSettings";
import { useProductionTelegramSettings } from "./useProductionTelegramSettings";
import { useProductionNotificationPreferences, type ProductionPreferenceValues, type PreferenceSaveReceipt } from "./useProductionNotificationPreferences";
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
    <NotificationPreferencesDraftProvider key={`notification-draft:${identityScope}`} domain={personalDomains.preferences}
      isCurrent={() => env.currentIdentity() && identityScope === JSON.stringify([env.owner.getSnapshot().identityKey, env.owner.getSnapshot().sessionGeneration])}>
      {children}
    </NotificationPreferencesDraftProvider>
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
  const { push, telegram } = useProductionSettingsDomains(), env = useDomainEnvironment();
  const identityScope = JSON.stringify([env.identityKey, env.owner.getSnapshot().sessionGeneration]);
  const recovery = (domain: typeof push | typeof telegram) => domain.original ? <SettingsOriginalRecovery busy={domain.busy} confirmed={domain.original.confirmed}
    reviewed={domain.original.reviewed} consent={domain.original.consent} online={domain.model.online} onRead={domain.actions.refresh} onConfirm={domain.confirmOriginal} onRetry={domain.retryOriginal}>
    <Text style={styles.meta}>原目標：{domain.original.review.targetLabel} · 原版本 {domain.original.review.expectedVersion ?? "新增綁定"}</Text>
  </SettingsOriginalRecovery> : null;
  return <View testID="channel-settings" style={styles.workspace}>
    <SectionHeader headingLevel={3} density="compact" title="本人的通知渠道" />
    <View style={styles.workspace}>
      <View testID="push-settings" style={styles.workspace}><WebPushSettingsCard production scopeKey={identityScope + ":push"}
        model={push.model} actions={push.actions} operationNotice={recovery(push)} confirmedOperation={push.savedReference ? { reference: push.savedReference } : null} /></View>
      <View testID="telegram-settings" style={styles.workspace}><TelegramSettingsCard production scopeKey={identityScope + ":telegram"}
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
function useNotificationPreferencesDraft(domain: PersonalDomains["preferences"], isCurrent: () => boolean) {
  const pathname = usePathname(), active = pathname === "/settings";
  const [reviewNotice, setReviewNotice] = useState("");
  const draftRevision = useRef(0);
  const [ownPublication, setOwnPublication] = useState<{ version: number; revision: number } | null>(null);
  const reviseDraft = () => { draftRevision.current += 1; setOwnPublication(null); };
  const receiveOwnSave = (receipt: PreferenceSaveReceipt, revision: number) => {
    if (isCurrent() && receipt.matchesInput && revision === draftRevision.current) setOwnPublication({ version: receipt.version, revision });
  };
  const [review, setReview] = useState<{ values: ProductionPreferenceValues; expectedVersion: number; basis: string } | null>(null);
  const { version: _version, ...defaults } = DEFAULT_NOTIFICATION_PREFERENCES;
  const form = useForm<ProductionPreferenceValues>({ defaultValues: defaults, resolver: zodResolver(preferenceSchema), mode: "onSubmit", shouldFocusError: false });
  const preferenceBasis = JSON.stringify(domain.preferences ? [domain.preferences.version, domain.preferences.timeZone, domain.preferences.quietStart, domain.preferences.quietEnd, domain.preferences.allowAppointmentDuringQuiet] : null);
  const previousBasis = useRef(preferenceBasis);
  useEffect(() => {
    if (previousBasis.current !== preferenceBasis) {
      const ownSaved = ownPublication?.version === domain.preferences?.version && ownPublication?.revision === draftRevision.current;
      if (ownSaved) setReviewNotice("");
      else if (review || form.formState.isDirty) setReviewNotice("通知偏好已改變，原確認已失效；請重新核對草稿及目前版本。");
      setReview(null); previousBasis.current = preferenceBasis;
    }
    if (domain.preferences) {
      const { version: _savedVersion, ...values } = domain.preferences;
      if (!form.formState.isDirty || JSON.stringify(form.getValues()) === JSON.stringify(values)) form.reset(values);
    } else form.reset(defaults);
  }, [preferenceBasis, form.reset, ownPublication]);
  useEffect(() => { if (!domain.online) setReview(null); }, [domain.online]);
  const setDraftEditing = domain.setDraftEditing;
  useEffect(() => {
    setDraftEditing(active && (form.formState.isDirty || !!review));
    return () => setDraftEditing(false);
  }, [active, form.formState.isDirty, !!review, setDraftEditing]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    // Accepted departure discards this local draft; a chapter remount does not.
    if (previousPath.current === "/settings" && !active) {
      const { version: _savedVersion, ...values } = domain.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
      reviseDraft(); form.reset(values); setReview(null); setReviewNotice("");
    }
    previousPath.current = pathname;
  }, [pathname, active, domain.preferences, form.reset]);
  const guards = useRef(new Set<string>());
  const registerGuard = useCallback((id: string) => { guards.current.add(id); return () => { guards.current.delete(id); }; }, []);
  const retainedGuardIds = () => active && isCurrent() ? [...guards.current] : [];
  return { form, review, setReview, reviewNotice, setReviewNotice, preferenceBasis, registerGuard, retainedGuardIds, isCurrent, draftRevision, reviseDraft, receiveOwnSave };
}
const NotificationDraftContext = createContext<ReturnType<typeof useNotificationPreferencesDraft> | null>(null);
/** Keep the original RHF controller with the identity host, not the route entry. */
function NotificationPreferencesDraftProvider({ domain, isCurrent, children }: { domain: PersonalDomains["preferences"]; isCurrent: () => boolean; children: ReactNode }) {
  const draft = useNotificationPreferencesDraft(domain, isCurrent);
  return <NotificationDraftContext value={draft}>{children}</NotificationDraftContext>;
}
function useNotificationDraft() {
  const draft = use(NotificationDraftContext);
  if (!draft) throw new Error("NotificationPreferencesDraftProvider must outlive Settings route entries");
  return draft;
}
export function useSettingsRetainedDrafts() {
  const { retainedGuardIds, isCurrent } = useNotificationDraft();
  return { ids: retainedGuardIds, isCurrent };
}
function NotificationPreferencesForm({ domain }: { domain: PersonalDomains["preferences"] }) {
  const formId = useId(), pathname = usePathname(), primary = useRef<View>(null), outcome = useRef<View>(null);
  const focusRequest = useRef<{ scopeKey: string; expectedVersion: number; revision: number; node: HTMLElement; eligible: boolean; savedVersion: number | null } | null>(null);
  const { form, review, setReview, reviewNotice, setReviewNotice, preferenceBasis, registerGuard, isCurrent, draftRevision, reviseDraft, receiveOwnSave } = useNotificationDraft();
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const moved = (event: FocusEvent) => { const request = focusRequest.current; if (request && !request.node.contains(event.target as Node)) request.eligible = false; };
    document.addEventListener("focusin", moved);
    return () => { document.removeEventListener("focusin", moved); focusRequest.current = null; };
  }, []);
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    if (pathname !== "/settings" || !isCurrent() || request.scopeKey !== domain.scopeKey || request.revision !== draftRevision.current) { focusRequest.current = null; return; }
    if (domain.busy) return;
    const settledOriginal = domain.original?.input.expectedVersion === request.expectedVersion;
    const savedPublication = request.savedVersion !== null && domain.preferences?.version === request.savedVersion;
    if (!settledOriginal && !savedPublication) return;
    focusRequest.current = null;
    const target = outcome.current as unknown as HTMLElement | null;
    if (request.eligible && (request.node.contains(document.activeElement) || document.activeElement === document.body)
      && target?.isConnected && target.getClientRects().length > 0 && !target.closest('[aria-hidden="true"],[inert]')) target.focus();
  });
  const locked = domain.busy || !!domain.original || !domain.online || !domain.fresh;
  const needsAttention = !domain.fresh || !!domain.original || domain.busy || !domain.online;
  function observeSaved(expectedVersion: number, matchesDraft = true) {
    const revision = draftRevision.current, scopeKey = domain.scopeKey;
    const active = Platform.OS === "web" ? document.activeElement as HTMLElement | null : null;
    const primaryNode = primary.current as unknown as HTMLElement | null, outcomeNode = outcome.current as unknown as HTMLElement | null;
    const node = active && (primaryNode?.contains(active) || outcomeNode?.contains(active)) ? active : null;
    const request = node ? { scopeKey, expectedVersion, revision, node, eligible: true, savedVersion: null as number | null } : null;
    focusRequest.current = request;
    return (receipt: PreferenceSaveReceipt) => {
      if (!isCurrent() || revision !== draftRevision.current || receipt.expectedVersion !== expectedVersion) return;
      if (matchesDraft) receiveOwnSave(receipt, revision);
      if (request && focusRequest.current === request) request.savedVersion = receipt.version;
    };
  }
  function recover(action: (observer: (receipt: PreferenceSaveReceipt) => void) => void) {
    if (!domain.original || !isCurrent()) return;
    const original = domain.original.input, draft = form.getValues();
    const matching = draft.timeZone === original.timeZone && draft.quietStart === original.quietStart
      && draft.quietEnd === original.quietEnd && draft.allowAppointmentDuringQuiet === original.allowAppointmentDuringQuiet;
    action(observeSaved(original.expectedVersion, matching));
  }
  const guardId = useDomainWriteGuard(form.formState.isDirty || !!review, false, "account", false, undefined, { pathname: "/settings", routeName: "settings", isCurrent });
  useLayoutEffect(() => registerGuard(guardId), [guardId, registerGuard]);
  const fields = [{ name: "timeZone", label: "通知時區" }, { name: "quietStart", label: "安靜時段開始" }, { name: "quietEnd", label: "安靜時段結束" }] as const;
  const errors = fields.flatMap(field => form.formState.errors[field.name]?.message ? [{ field: field.name, label: field.label, message: form.formState.errors[field.name]!.message! }] : []);
  function input(name: "timeZone" | "quietStart" | "quietEnd", label: string) {
    return <Controller name={name} control={form.control} render={({ field, fieldState }) => <View>
      {name === "timeZone" ? <AppTimeZoneSelect ref={field.ref} id={`${formId}-${name}`} value={field.value} disabled={locked || !!review} onBlur={field.onBlur}
        invalid={!!fieldState.error} describedBy={fieldState.error ? `${formId}-${name}-message` : undefined} onChange={value => { reviseDraft(); field.onChange(value); setReview(null); }} />
        : <AppTimeField ref={field.ref} id={`${formId}-${name}`} errorId={`${formId}-${name}-message`} label={label} value={field.value} disabled={locked || !!review} error={fieldState.error?.message}
          onBlur={field.onBlur} onChange={value => { reviseDraft(); field.onChange(value); setReview(null); }} />}
      {name === "timeZone" ? <FormFieldMessage id={`${formId}-${name}-message`} error={fieldState.error?.message} /> : null}
    </View>} />;
  }
  return <SectionCard><SectionHeader headingLevel={3} density="compact" title="通知偏好" subtitle="設定本人的安靜時段，不會綁定通知渠道或授權發送。"
    action={!domain.original && (!domain.fresh || form.formState.isDirty || !!review) ? <AppButton label="重新讀取" accessibilityLabel="重新讀取通知偏好" variant="quiet" density="compact" disabled={!domain.online || domain.busy} onPress={domain.refresh} /> : undefined} />
    {!domain.online ? <Text style={styles.note}>目前離線；恢復連線並重新讀取後才可保存。</Text> : null}
    {needsAttention && !domain.original && domain.notice ? <Text accessibilityLiveRegion="polite" style={styles.note}>{domain.notice}</Text> : null}
    {!domain.preferences && !domain.notice ? <Text style={styles.note}>{domain.busy ? "正在讀取通知偏好…" : "尚未讀取通知偏好，請重新讀取。"}</Text> : null}
    <FormErrorSummary entries={errors} onFocus={field => form.setFocus(field as "timeZone" | "quietStart" | "quietEnd")} />
    <View style={styles.timeRow}><View style={styles.timeField}>{input("quietStart", "安靜時段開始")}</View><View style={styles.timeField}>{input("quietEnd", "安靜時段結束")}</View></View>
    {input("timeZone", "通知時區")}
    <Controller name="allowAppointmentDuringQuiet" control={form.control} render={({ field }) => <View style={styles.switchRow}>
      <View style={styles.copy}><Text style={styles.title}>預約提醒例外</Text><Text style={styles.note}>只在本人明確開啟後容許例外；預設關閉。</Text></View>
      <Switch accessibilityLabel="預約提醒例外" value={field.value} disabled={locked || !!review} onValueChange={value => { reviseDraft(); field.onChange(value); setReview(null); }} />
    </View>} />
    {reviewNotice ? <Text accessibilityLiveRegion="polite" style={styles.note}>{reviewNotice}</Text> : null}
    {review ? <View testID="notification-preference-review" accessibilityLiveRegion="polite" style={styles.recovery}>
      <Text style={styles.title}>待確認 · 尚未保存 · 版本 {review.expectedVersion}</Text>
      <Text style={styles.body}>{review.values.timeZone}；安靜時段 {review.values.quietStart}–{review.values.quietEnd}；預約例外{review.values.allowAppointmentDuringQuiet ? "開啟" : "關閉"}。</Text>
    </View> : null}
    <AppButton ref={primary} label={review ? "確認保存本人偏好" : "核對通知偏好"} disabled={locked || !!review && review.basis !== preferenceBasis}
      onPress={review ? () => {
        if (locked || review.basis !== preferenceBasis) return;
        domain.save(review.values, review.expectedVersion, observeSaved(review.expectedVersion));
        setReview(null);
      }
        : form.handleSubmit(values => { if (!locked && domain.preferences) { reviseDraft(); setReviewNotice(""); setReview({ values, expectedVersion: domain.preferences.version, basis: preferenceBasis }); } })} />
    {review ? <AppButton label="返回修改" variant="quiet" onPress={() => { reviseDraft(); setReview(null); primary.current?.focus(); }} /> : null}
    {domain.original || !needsAttention && domain.notice ? <View ref={outcome} role="region" accessibilityLabel="通知偏好操作結果" tabIndex={-1} style={styles.workspace}>
      {domain.notice ? <Text accessibilityLiveRegion="polite" style={styles.note}>{domain.notice}</Text> : null}
      {domain.original ? <SettingsOriginalRecovery busy={domain.busy} confirmed={domain.original.confirmed} reviewed={domain.original.reviewed} consent={domain.original.consent}
        online={domain.online} onRead={() => recover(domain.refresh)} onConfirm={domain.confirmOriginal} onRetry={() => recover(domain.retryOriginal)}>
        <Text style={styles.note}>原版本 {domain.original.input.expectedVersion} · {domain.original.input.timeZone} · {domain.original.input.quietStart}–{domain.original.input.quietEnd}</Text>
      </SettingsOriginalRecovery> : null}
    </View> : null}
    <Text style={styles.note}>設定分類之間會保留草稿；離頁須確認捨棄，待查操作須先處理。重新載入不能恢復本次草稿。</Text>
  </SectionCard>;
}
const styles = StyleSheet.create({ workspace: { gap: spacing.lg }, recovery: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md }, field: { gap: spacing.xs }, toggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, timeField: { flexBasis: 180, flexGrow: 1, minWidth: 0 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  copy: { flex: 1, minWidth: 0 }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, note: { fontFamily: chineseFont, color: colors.muted, ...readingType.body }, body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body } });
