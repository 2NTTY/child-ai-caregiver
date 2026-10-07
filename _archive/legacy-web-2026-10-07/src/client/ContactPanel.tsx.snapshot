import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Button, Checkbox, HelperText, PaperProvider, RadioButton, Text, TextInput } from "react-native-paper";
import {
  contactConsentInput, contactGrantInput, type ContactAttempt, type ContactBinding, type ContactConsentInput,
  type ContactGrantInput, type ContactPage, type ContactRequest,
} from "../shared/contact.ts";
import { ContactApiError, createContactApi } from "./contact-api.ts";

interface Props { apiBaseUrl: string; userId: string; childId: string; online: boolean; onSessionChanged: () => void }
type Attempt = { kind: "consent"; input: ContactConsentInput }
  | { kind: "authorization"; taskId: string; input: ContactGrantInput }
  | { kind: "acknowledge"; attemptId: string; input: { confirmReceived: true } };
interface Pending { attempt: Attempt; confirmed: boolean; reviewed: boolean }
type ConsentDraft = Pick<ContactConsentInput, "enabled" | "allowBackup" | "bindings">;
type GrantDraft = Pick<ContactGrantInput, "allowFollowUp" | "allowFallback" | "backupUserId" | "validUntil">;
type Current = () => boolean;
const emptyConsent = (): ConsentDraft => ({ enabled: false, allowBackup: false, bindings: [] });
const emptyGrant = (): GrantDraft => ({ allowFollowUp: false, allowFallback: false, backupUserId: null, validUntil: "" });
const channelText: Record<ContactBinding["channel"], string> = { web_push: "Web Push", telegram: "Telegram" };
const taskStateText = { scheduled: "待處理", completed: "已完成", cancelled: "已取消", needs_review: "待覆核，已停催" };
const requestStateText: Record<ContactRequest["state"], string> = {
  pending: "待處理（pending）", accepted: "渠道已接受（accepted）", rejected: "渠道已拒絕（rejected）",
  unknown: "結果未知（unknown）", stopped: "已停止（stopped）", coalesced: "今日已有普通提示記錄，未另行發送（coalesced）",
};
const attemptStateText: Record<ContactAttempt["status"], string> = {
  sending: "正在發送（sending）", accepted: "渠道已接受（accepted）", rejected: "渠道已拒絕（rejected）",
  unknown: "結果未知（unknown）", stopped: "已停止（stopped）",
};
const dateText = (value: string) => new Date(value).toLocaleString("zh-HK", { hour12: false });
const sameBinding = (left: ContactBinding, right: ContactBinding) =>
  left.channel === right.channel && left.bindingId === right.bindingId && left.bindingVersion === right.bindingVersion;
const operationText = (attempt: Attempt) => attempt.kind === "consent" ? "保存本人接收同意"
  : attempt.kind === "acknowledge" ? "確認收到通知" : attempt.input.enabled ? "保存任務聯絡授權" : "撤銷任務聯絡授權";
const mayAcknowledge = (attempt: ContactAttempt, userId: string) => attempt.recipientUserId === userId
  && attempt.acknowledgedAt === null && ["sending", "accepted", "unknown"].includes(attempt.status);

function freezeAttempt(value: Attempt): Attempt {
  const copied = JSON.parse(JSON.stringify(value)) as Attempt;
  if (copied.kind === "consent") {
    for (const binding of copied.input.bindings) Object.freeze(binding);
    Object.freeze(copied.input.bindings);
  }
  Object.freeze(copied.input);
  return Object.freeze(copied);
}

function Confirmation({ label, checked, disabled, onToggle }: {
  label: string; checked: boolean; disabled: boolean; onToggle: () => void;
}) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={styles.confirmation}
    {...(Platform.OS === "web" ? {
      "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); if (!disabled) onToggle(); }
      },
    } : {})}>
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants"><Checkbox status={checked ? "checked" : "unchecked"} disabled={disabled} /></View>
    <Text style={styles.confirmationLabel}>{label}</Text>
  </Pressable>;
}

export function ContactPanel(props: Props) {
  return <PaperProvider><ContactWorkspace key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId])} {...props} /></PaperProvider>;
}

function ContactWorkspace({ apiBaseUrl, userId, childId, online, onSessionChanged }: Props) {
  const api = useMemo(() => createContactApi(apiBaseUrl), [apiBaseUrl]);
  const [page, setPage] = useState<ContactPage | null>(null);
  const [authorized, setAuthorized] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [consentDraft, setConsentDraft] = useState<ConsentDraft>(emptyConsent);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [grantDraft, setGrantDraft] = useState<GrantDraft>(emptyGrant);
  const [grantConfirmed, setGrantConfirmed] = useState(false);
  const [revokeConfirmed, setRevokeConfirmed] = useState("");
  const [ackConfirmed, setAckConfirmed] = useState("");
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const available = online && authorized && !!userId && !!childId;
  const availableRef = useRef(available); availableRef.current = available;
  const refreshRef = useRef<() => void>(() => {});
  const sessionChanged = useRef(onSessionChanged); sessionChanged.current = onSessionChanged;

  const clearDrafts = useCallback(() => {
    setConsentDraft(emptyConsent()); setConsentConfirmed(false); setSelectedTaskId(""); setGrantDraft(emptyGrant());
    setGrantConfirmed(false); setRevokeConfirmed(""); setAckConfirmed(""); setRetryConfirmed(false);
  }, []);
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; setBusy("");
  }, []);
  const clearIdentity = useCallback(() => {
    cancelRequests(); api.resetOnline(); pendingRef.current = null; setPending(null);
    setPage(null); clearDrafts(); setAuthorized(false);
    setNotice("登入帳號或孩子權限已改變，聯絡資料、草稿及待核對操作已清除。請重新選擇孩子。");
    sessionChanged.current();
  }, [api, cancelRequests, clearDrafts]);
  const applyPage = (next: ContactPage) => {
    setPage(next); clearDrafts();
    setConsentDraft({
      enabled: next.consent.enabled, allowBackup: next.consent.allowBackup,
      bindings: next.consent.bindings.map(binding => ({ ...binding })),
    });
  };

  const run = async (label: string, operation: (signal: AbortSignal, current: Current) => Promise<void>, entry?: Pending) => {
    if (!availableRef.current || inFlight.current) return;
    inFlight.current = true;
    const started = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    const current = () => availableRef.current && generation.current === started && !controller.signal.aborted;
    setBusy(label); setNotice("");
    try {
      await operation(controller.signal, current);
    } catch (error) {
      const affected = entry ?? pendingRef.current;
      if (affected && pendingRef.current === affected && error instanceof ContactApiError && error.confirmed) affected.confirmed = true;
      if (!current()) return;
      const responseStatus = error instanceof ContactApiError ? error.status : 0;
      const code = error instanceof ContactApiError ? error.onlineCode : null;
      if (responseStatus === 401 || responseStatus === 403 || responseStatus === 404 || code === "session_changed") {
        clearIdentity(); return;
      }
      setPage(null); clearDrafts();
      if (entry && (entry.confirmed || api.hasPendingOnline() || responseStatus === 0 || responseStatus === 409 || responseStatus >= 500)) {
        entry.reviewed = false; setPending({ ...entry });
        setNotice(entry.confirmed ? "Server 已確認原操作，但最新狀態未能讀取。請查核原操作及重新讀取，毋須再次提交。"
          : responseStatus === 409 ? "操作出現版本或授權衝突。請先查核原收據及最新資料，再明確確認。"
          : "提交結果未能確認。原操作識別及內容保留，系統不會自動重送。請先查核原操作。");
      } else {
        if (entry) { pendingRef.current = null; setPending(null); }
        const retained = pendingRef.current;
        if (retained) { retained.reviewed = false; setPending({ ...retained }); }
        setNotice(entry ? "請求未被接納。請重新讀取及核對後再確認。"
          : retained?.confirmed ? "原操作已確認，但聯絡資料讀取失敗。請再次查核及重新讀取。"
          : "聯絡資料讀取失敗，請手動重新讀取。");
      }
    } finally {
      requests.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  };

  const refresh = () => { void run("讀取", async (signal, current) => {
    const entry = pendingRef.current;
    const receipt = await api.reconcilePending(signal, userId);
    if (entry && receipt?.state === "confirmed") entry.confirmed = true;
    const next = await api.page(childId, signal, userId);
    if (!current()) return;
    applyPage(next);
    if (entry && !entry.confirmed && api.hasPendingOnline()) {
      entry.reviewed = receipt?.state === "unconfirmed"; setPending({ ...entry });
      setNotice("原操作尚無確認收據。已讀取目前資料；請核對後明確選擇是否沿用原操作識別及原內容重試。");
    } else {
      pendingRef.current = null; setPending(null);
      if (entry) setNotice(entry.confirmed ? "Server 已確認原操作，最新聯絡資料已讀取，毋須再次提交。"
        : "目前沒有已建立的待查操作識別。資料已重新讀取；請核對後重新明確確認。");
    }
  }); };
  refreshRef.current = refresh;

  useEffect(() => () => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; pendingRef.current = null; api.resetOnline();
  }, [api]);
  useEffect(() => {
    cancelRequests(); setPage(null); clearDrafts();
    const entry = pendingRef.current;
    if (entry) { entry.reviewed = false; setPending({ ...entry }); }
    if (available) refreshRef.current();
    else setNotice("");
  }, [available, cancelRequests, clearDrafts]);

  const ready = available && !!page && !busy && !pending && !api.hasPendingOnline();
  const editable = ready && page?.canManage === true;
  const selectedTask = page?.tasks.find(task => task.id === selectedTaskId) ?? null;
  const selectedGrant = selectedTask ? page?.grants.find(grant => grant.taskId === selectedTask.id) ?? null : null;
  const primary = selectedTask ? page?.recipients.find(recipient => recipient.userId === selectedTask.assigneeUserId) ?? null : null;
  const primaryEligible = !!primary?.enabled && primary.channels.length > 0;
  const backupRecipients = page?.recipients.filter(recipient => recipient.userId !== selectedTask?.assigneeUserId
    && recipient.enabled && recipient.allowBackup && recipient.channels.length > 0) ?? [];
  const grantKey = selectedTask && selectedGrant ? JSON.stringify([selectedTask.id, selectedTask.version, selectedGrant.version]) : "";
  const consentBindingsValid = !!page && consentDraft.bindings.every(binding => page.availableBindings.some(availableBinding => sameBinding(binding, availableBinding)));
  const grantInput = selectedTask ? contactGrantInput.safeParse({
    ...grantDraft, validUntil: grantDraft.validUntil.trim(), expectedVersion: selectedGrant?.version ?? 0,
    expectedTaskVersion: selectedTask.version, enabled: true, content: "generic_notice", trigger: "task_due", confirm: true,
  }) : null;
  const expiresAt = Date.parse(grantDraft.validUntil);
  const expiryValid = Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt <= Date.now() + 365 * 24 * 60 * 60 * 1000;
  const backupValid = grantDraft.backupUserId === null || backupRecipients.some(recipient => recipient.userId === grantDraft.backupUserId);
  const canAuthorize = !!selectedTask && selectedTask.occurrence.state === "scheduled" && primaryEligible && expiryValid && backupValid && grantInput?.success === true;
  const canRetry = available && !!page?.canManage && !!pending && pending.reviewed && !pending.confirmed && api.hasPendingOnline();

  const submit = (attempt: Attempt, retry = false) => {
    if (!available || !page?.canManage || inFlight.current
      || (retry ? !api.hasPendingOnline() : pendingRef.current !== null || api.hasPendingOnline())) return;
    if (!retry) {
      if (attempt.kind === "consent" && (!consentConfirmed || attempt.input.expectedVersion !== page.consent.version
        || attempt.input.enabled && (!consentBindingsValid || attempt.input.bindings.length === 0))) return;
      if (attempt.kind === "authorization") {
        if (!selectedTask || selectedTask.id !== attempt.taskId || selectedTask.version !== attempt.input.expectedTaskVersion
          || (selectedGrant?.version ?? 0) !== attempt.input.expectedVersion) return;
        if (attempt.input.enabled ? !canAuthorize || !grantConfirmed : !selectedGrant?.enabled || revokeConfirmed !== grantKey) return;
        if (attempt.input.enabled) {
          const expires = Date.parse(attempt.input.validUntil);
          const now = Date.now();
          if (expires <= now || expires > now + 365 * 24 * 60 * 60 * 1000) {
            setGrantConfirmed(false); setNotice("授權期限已不在可用範圍，請重新核對期限。"); return;
          }
        }
      }
      if (attempt.kind === "acknowledge") {
        const actual = page.requests.flatMap(request => request.attempts).find(item => item.id === attempt.attemptId);
        if (!actual || !mayAcknowledge(actual, userId) || ackConfirmed !== actual.id) return;
      }
    }
    const entry = retry ? pendingRef.current : { attempt: freezeAttempt(attempt), confirmed: false, reviewed: false };
    if (!entry || entry.confirmed || retry && (!entry.reviewed || !retryConfirmed || entry.attempt !== attempt)) return;
    entry.reviewed = false; pendingRef.current = entry; setPending({ ...entry }); setRetryConfirmed(false);
    const original = entry.attempt;
    void run(operationText(original), async (signal, current) => {
      if (original.kind === "consent") await api.consent(childId, original.input, signal, userId);
      else if (original.kind === "authorization") await api.authorization(childId, original.taskId, original.input, signal, userId);
      else await api.acknowledge(childId, original.attemptId, original.input, signal, userId);
      entry.confirmed = true;
      if (!current()) return;
      clearDrafts();
      const next = await api.page(childId, signal, userId);
      if (!current()) return;
      applyPage(next); pendingRef.current = null; setPending(null);
      setNotice(original.kind === "acknowledge" ? "已確認收到通知。照護任務完成請在任務面板處理。"
        : "操作已確認，聯絡資料已重新讀取。");
    }, entry);
  };

  const updateConsent = (next: ConsentDraft) => { setConsentDraft(next); setConsentConfirmed(false); };
  const updateGrant = (next: GrantDraft) => { setGrantDraft(next); setGrantConfirmed(false); setRevokeConfirmed(""); };
  const chooseBinding = (binding: ContactBinding) => {
    const selected = consentDraft.bindings.some(item => sameBinding(item, binding));
    updateConsent({
      ...consentDraft,
      bindings: selected ? consentDraft.bindings.filter(item => !sameBinding(item, binding))
        : [...consentDraft.bindings.filter(item => item.channel !== binding.channel), {
          channel: binding.channel, bindingId: binding.bindingId, bindingVersion: binding.bindingVersion,
        }],
    });
  };
  const recipientName = (receiverId: string) => page?.recipients.find(recipient => recipient.userId === receiverId)?.name ?? receiverId;
  const moveBinding = (index: number) => {
    if (index <= 0) return;
    const bindings = [...consentDraft.bindings];
    [bindings[index - 1], bindings[index]] = [bindings[index]!, bindings[index - 1]!];
    updateConsent({ ...consentDraft, bindings });
  };
  return <View style={styles.section}>
    <Text variant="titleLarge" accessibilityRole="header">主動聯絡授權</Text>
    <Text>此頁管理這個孩子的一般通知。本人接收同意與每個任務的聯絡授權須分別確認。</Text>
    <Text>渠道接受（accepted）不代表已送達、已讀或任務已完成。結果未知時不會自動重發或切換渠道。</Text>
    <Button mode="outlined" disabled={!available || !!busy} onPress={refresh}>
      {busy === "讀取" ? "正在查核…" : "查核原操作及重新讀取聯絡狀態"}
    </Button>
    {!online && <Text>目前離線，聯絡資料及表單已清除。未確認的原操作保留；回復連線後先查核收據。</Text>}
    {!authorized && <Text>請重新登入或選擇有權讀取的孩子。</Text>}
    {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
    {available && pending && <View style={styles.group}>
      <Text>待核對原操作：{operationText(pending.attempt)}。其他提交暫停。</Text>
      {pending.attempt.kind === "consent" && <Text>
        原設定：{pending.attempt.input.enabled ? "啟用接收" : "停用接收"}；
        後備接收：{pending.attempt.input.allowBackup ? "同意" : "不同意"}；
        渠道次序：{pending.attempt.input.bindings.map(binding => channelText[binding.channel]).join(" → ") || "沒有"}；
        原接收同意版本 {pending.attempt.input.expectedVersion}
      </Text>}
      {pending.attempt.kind === "authorization" && <>
        <Text>
          原任務版本 {pending.attempt.input.expectedTaskVersion}；授權版本 {pending.attempt.input.expectedVersion}；
          原操作：{pending.attempt.input.enabled ? "啟用" : "撤銷"}；期限：{dateText(pending.attempt.input.validUntil)}
        </Text>
        <Text>
          原範圍：一般通知／任務到期；跟進：{pending.attempt.input.allowFollowUp ? "最多一次" : "沒有"}；
          已知失敗切換：{pending.attempt.input.allowFallback ? "允許" : "不允許"}；
          後備接收者：{pending.attempt.input.backupUserId
            ? recipientName(pending.attempt.input.backupUserId)
            : "沒有"}
        </Text>
      </>}
      {canRetry && <>
        <Text>已查原收據及目前資料。重試保留原對象、內容、版本及操作識別；Server 會按現時權限判斷是否接納。</Text>
        <Confirmation label="我已核對最新資料，確認以原操作識別及原內容再核對／提交" checked={retryConfirmed}
          disabled={!!busy} onToggle={() => setRetryConfirmed(value => !value)} />
        <Button mode="contained" disabled={!!busy || !retryConfirmed} onPress={() => submit(pending.attempt, true)}>以原操作再核對／提交</Button>
      </>}
    </View>}
    {available && page && <>
      {!page.canManage && <Text>你目前只有檢視權限，不能修改接收同意、任務授權或收到確認。</Text>}
      {!page.workerEnabled && <Text>發送 worker 目前停用，聯絡不會即時外發。仍可讀取及管理授權。</Text>}
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">本人接收同意</Text>
        <Text>目前：{page.consent.enabled ? "已同意接收" : "未同意接收"}；後備接收：{page.consent.allowBackup ? "已同意" : "未同意"}；版本 {page.consent.version}</Text>
        <Confirmation label="我選擇啟用這個孩子的一般通知接收" checked={consentDraft.enabled} disabled={!editable}
          onToggle={() => updateConsent({ ...consentDraft, enabled: !consentDraft.enabled })} />
        <Confirmation label="我亦同意被選為這個孩子的後備接收者" checked={consentDraft.allowBackup} disabled={!editable || !consentDraft.enabled}
          onToggle={() => updateConsent({ ...consentDraft, allowBackup: !consentDraft.allowBackup })} />
        <Text>每個渠道最多選一個綁定。選取次序是渠道偏好，可將已選渠道上移。</Text>
        {page.availableBindings.length === 0 && <Text>目前沒有可用的本人綁定。請先在 Web Push 或 Telegram 渠道面板完成設定，再重新讀取。</Text>}
        {page.availableBindings.map(binding => <Confirmation key={binding.channel + ":" + binding.bindingId}
          label={channelText[binding.channel] + "：" + (binding.label || "本人渠道")}
          checked={consentDraft.bindings.some(item => sameBinding(item, binding))} disabled={!editable || !consentDraft.enabled}
          onToggle={() => chooseBinding(binding)} />)}
        {consentDraft.bindings.map((binding, index) => {
          const availableBinding = page.availableBindings.find(item => sameBinding(item, binding));
          return <View key={binding.channel + ":" + binding.bindingId} style={styles.row}>
            <Text style={styles.rowLabel}>偏好 {index + 1}：{channelText[binding.channel]}；{availableBinding?.label || (availableBinding ? "本人渠道" : "原綁定已不可用")}</Text>
            <Button mode="outlined" disabled={!editable || !consentDraft.enabled || index === 0} onPress={() => moveBinding(index)}>上移</Button>
            <Button mode="outlined" disabled={!editable || !consentDraft.enabled}
              onPress={() => updateConsent({ ...consentDraft, bindings: consentDraft.bindings.filter((_, position) => position !== index) })}>移除</Button>
          </View>;
        })}
        {consentDraft.enabled && (!consentBindingsValid || consentDraft.bindings.length === 0) && <HelperText type="error">請選擇至少一個目前可用的本人綁定。</HelperText>}
        <Text>停用會撤回這個孩子的一般通知及後備接收同意。接收同意本身不授權任何任務外發。</Text>
        <Confirmation label="我確認以上本人接收及後備設定，只接收不含孩子正文的一般通知" checked={consentConfirmed} disabled={!editable}
          onToggle={() => setConsentConfirmed(value => !value)} />
        <Button mode="contained" disabled={!editable || !consentConfirmed || consentDraft.enabled && (!consentBindingsValid || consentDraft.bindings.length === 0)}
          onPress={() => {
            const input = contactConsentInput.safeParse({
              expectedVersion: page.consent.version, enabled: consentDraft.enabled,
              allowBackup: consentDraft.enabled && consentDraft.allowBackup,
              bindings: consentDraft.enabled ? consentDraft.bindings : [], confirm: true,
            });
            if (input.success) submit({ kind: "consent", input: input.data });
          }}>確認保存本人接收同意</Button>
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">可接收的家庭成員</Text>
        {page.recipients.length === 0 && <Text>目前沒有具備任務接收資格的家庭成員。</Text>}
        {page.recipients.map(recipient => <Text key={recipient.userId}>
          {recipient.name}：{recipient.enabled ? "已同意接收" : "未同意接收"}；
          {recipient.allowBackup ? "可作後備" : "未同意作後備"}；
          渠道：{recipient.channels.map(channel => channelText[channel]).join("、") || "沒有可用渠道"}
        </Text>)}
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">每個任務的外發授權</Text>
        <Text>主要接收者固定為任務負責人。改期、轉派或版本改變後須重新確認；完成、取消、撤權會停止後續聯絡。</Text>
        <Text>完成或取消任務請使用現有任務面板。</Text>
        {page.tasksHaveMore && <Text>此頁最多顯示 50 個任務，尚有其他任務未列出。</Text>}
        {page.tasks.length === 0 && <Text>目前沒有任務。</Text>}
        {page.tasks.map(task => {
          const grant = page.grants.find(item => item.taskId === task.id);
          const recipient = page.recipients.find(item => item.userId === task.assigneeUserId);
          const activeGrant = !!grant?.enabled && grant.taskVersion === task.version && Date.parse(grant.validUntil) > Date.now();
          return <View key={task.id} style={styles.item}>
            <Text variant="titleSmall">{task.title}</Text>
            <Text>{taskStateText[task.occurrence.state]}；任務版本 {task.version}；負責人：{recipient?.name || "目前不具備接收資格"}</Text>
            <Text>到期：{dateText(task.occurrence.dueAt)}；時區：{task.occurrence.timeZone}</Text>
            <Text>聯絡授權：{activeGrant ? "目前版本已授權" : grant?.enabled ? "已過期或任務版本已改變，須重新確認" : "未啟用"}</Text>
            {grant && <Text>
              授權版本 {grant.version}／任務版本 {grant.taskVersion}；到期：{dateText(grant.validUntil)}；
              跟進：{grant.allowFollowUp ? "最多一次" : "沒有"}；已知失敗後切換：{grant.allowFallback ? "已授權" : "未授權"}
            </Text>}
            {grant?.backupUserId && <Text>後備接收者：{page.recipients.find(item => item.userId === grant.backupUserId)?.name || "目前不具備後備接收資格"}</Text>}
            <Button mode="outlined" disabled={!editable} onPress={() => {
              setSelectedTaskId(task.id); setGrantDraft(emptyGrant()); setGrantConfirmed(false); setRevokeConfirmed("");
            }}>核對及管理這個任務的授權</Button>
          </View>;
        })}
        {selectedTask && <View style={styles.group}>
          <Text variant="titleSmall">核對任務：{selectedTask.title}；版本 {selectedTask.version}</Text>
          <Text>主要接收者：{primary?.name || "目前不具備接收資格"}（任務負責人）</Text>
          {!primaryEligible && <Text>負責人須先啟用本人接收同意並選擇可用渠道，才可授權外發。</Text>}
          {selectedTask.occurrence.state !== "scheduled" && <Text>此任務已停催，不能啟用新聯絡授權。</Text>}
          <Confirmation label="到期未處理時，允許最多一次跟進" checked={grantDraft.allowFollowUp} disabled={!editable}
            onToggle={() => updateGrant({ ...grantDraft, allowFollowUp: !grantDraft.allowFollowUp })} />
          <Confirmation label="只有渠道已知失敗時，允許按接收者的渠道偏好切換／使用後備接收者"
            checked={grantDraft.allowFallback} disabled={!editable}
            onToggle={() => updateGrant({ ...grantDraft, allowFallback: !grantDraft.allowFallback, backupUserId: null })} />
          {grantDraft.allowFallback && <>
            <Text>可選一位已同意的後備接收者。結果未知不會觸發切換。</Text>
            <RadioButton.Group value={grantDraft.backupUserId ?? ""} onValueChange={value => updateGrant({ ...grantDraft, backupUserId: value || null })}>
              <RadioButton.Item label="不選後備接收者" value="" disabled={!editable} />
              {backupRecipients.map(recipient => <RadioButton.Item key={recipient.userId} label={recipient.name} value={recipient.userId} disabled={!editable} />)}
            </RadioButton.Group>
          </>}
          <TextInput mode="outlined" label="授權到期時間（含時區）" accessibilityLabel="授權到期時間（含時區）"
            value={grantDraft.validUntil} editable={editable} placeholder="YYYY-MM-DDTHH:mm:ss+08:00"
            onChangeText={value => updateGrant({ ...grantDraft, validUntil: value })} />
          <HelperText type={grantDraft.validUntil && !expiryValid ? "error" : "info"}>
            請明確輸入含時區的 ISO 時間；必須在未來，最長 365 日。
          </HelperText>
          <Text>內容範圍：一般通知（generic_notice），不含孩子正文。觸發範圍：這個任務到期（task_due）。</Text>
          <Confirmation label="我確認以以上任務版本、接收者、期限及選項，授權一般通知／任務到期聯絡"
            checked={grantConfirmed} disabled={!editable || !canAuthorize} onToggle={() => setGrantConfirmed(value => !value)} />
          <Button mode="contained" disabled={!editable || !canAuthorize || !grantConfirmed}
            onPress={() => { if (grantInput?.success) submit({ kind: "authorization", taskId: selectedTask.id, input: grantInput.data }); }}>
            確認保存此任務的聯絡授權
          </Button>
          {selectedGrant?.enabled && <>
            <Confirmation label="我確認撤銷這個任務現有的聯絡授權" checked={revokeConfirmed === grantKey} disabled={!editable}
              onToggle={() => setRevokeConfirmed(value => value === grantKey ? "" : grantKey)} />
            <Button mode="outlined" disabled={!editable || revokeConfirmed !== grantKey} onPress={() => submit({
              kind: "authorization", taskId: selectedTask.id, input: {
                expectedVersion: selectedGrant.version, expectedTaskVersion: selectedTask.version, enabled: false,
                allowFollowUp: selectedGrant.allowFollowUp, allowFallback: selectedGrant.allowFallback, backupUserId: selectedGrant.backupUserId,
                validUntil: selectedGrant.validUntil, content: "generic_notice", trigger: "task_due", confirm: true,
              },
            })}>確認撤銷此任務的聯絡授權</Button>
          </>}
        </View>}
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">近期聯絡及真實渠道結果</Text>
        <Text>「我已收到」只確認本人收到通知。照護任務完成須在任務面板另行確認。</Text>
        {page.historyLimited && <Text>此頁最多顯示最近 50 筆聯絡記錄；這不是完整歷史。</Text>}
        {page.requests.length === 0 && <Text>尚無聯絡記錄。</Text>}
        {page.requests.map(request => <View key={request.id} style={styles.item}>
          <Text variant="titleSmall">{page.tasks.find(task => task.id === request.taskId)?.title || "任務未列於目前清單"}</Text>
          <Text>{request.phase === "initial" ? "首次聯絡" : "一次跟進"}；任務版本 {request.taskVersion}；{requestStateText[request.state]}</Text>
          <Text>建立：{dateText(request.createdAt)}；處理時間：{dateText(request.nextAt)}</Text>
          {request.state === "coalesced" && <Text>此項保留於站內台帳；不表示先前通知已送達。請查看當日首次聯絡的實際結果。</Text>}
          {request.state === "unknown" && <Text>請向接收者核對。此結果不會自動重送或觸發後備聯絡。</Text>}
          {request.attempts.length === 0 && <Text>目前沒有實際渠道發送嘗試。</Text>}
          {request.attempts.map(attempt => <View key={attempt.id} style={styles.item}>
            <Text>{channelText[attempt.channel]}；接收者：{attempt.recipientUserId === userId ? "本人" : page.recipients.find(item => item.userId === attempt.recipientUserId)?.name || "舊接收者"}；{attemptStateText[attempt.status]}</Text>
            <Text>發送嘗試：{dateText(attempt.attemptedAt)}；授權版本 {attempt.grantVersion}；任務版本 {attempt.taskVersion}</Text>
            {attempt.finishedAt && <Text>結果記錄：{dateText(attempt.finishedAt)}</Text>}
            {attempt.acknowledgedAt && <Text>接收者已確認收到：{dateText(attempt.acknowledgedAt)}</Text>}
            {attempt.status === "unknown" && <Text>結果未知，請先核對此渠道；不會自動重送或切換。</Text>}
            {page.canManage && mayAcknowledge(attempt, userId) && <>
              <Confirmation label="我確認本人已收到以上這次通知" checked={ackConfirmed === attempt.id} disabled={!editable}
                onToggle={() => setAckConfirmed(value => value === attempt.id ? "" : attempt.id)} />
              <Button mode="outlined" disabled={!editable || ackConfirmed !== attempt.id}
                onPress={() => submit({ kind: "acknowledge", attemptId: attempt.id, input: { confirmReceived: true } })}>我已收到</Button>
            </>}
          </View>)}
        </View>)}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  item: { gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  confirmation: { flexDirection: "row", alignItems: "center", gap: 4 },
  confirmationLabel: { flex: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  rowLabel: { flex: 1, minWidth: 160 },
});
