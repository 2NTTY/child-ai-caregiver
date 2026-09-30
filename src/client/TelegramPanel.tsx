import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { TelegramBinding, TelegramChallenge, TelegramDelivery, TelegramStatus } from "../shared/telegram.ts";
import { createTelegramApi, TelegramApiError } from "./telegram-api.ts";

interface Props { userId: string; online: boolean; apiBaseUrl: string; onSessionChanged?: () => void }
type Attempt = { kind: "begin" } | { kind: "confirm"; id: string; version: number; accountKey: string }
  | { kind: "revoke" | "test"; id: string; version: number };
interface Pending { attempt: Attempt; confirmed: boolean; reviewed: boolean }
type Current = () => boolean;
const operationText = { begin: "開始綁定", confirm: "確認 Telegram 帳號", revoke: "撤銷綁定", test: "發送一般測試" };
const bindingText = { active: "已綁定", revoked: "已撤銷", blocked: "Telegram 已封鎖此渠道" };
const deliveryText: Record<TelegramDelivery["status"], string> = {
  queued: "待發送（queued）", sending: "正在發送（sending）", accepted: "渠道已接受（accepted）",
  rejected: "渠道已拒絕（rejected）", unknown: "投遞結果未知（unknown）", stopped: "已停止（stopped）",
};
const bindingKey = (binding: TelegramBinding | null) => binding ? `${binding.id}:${binding.version}` : "";
const candidateKey = (challenge: TelegramChallenge | null) => challenge?.candidate
  ? JSON.stringify([challenge.id, challenge.version, challenge.candidate.label, challenge.candidate.chatIdHint]) : "";
const dateText = (value: string) => new Date(value).toLocaleString("zh-HK", { hour12: false });
function safeStartUrl(status: TelegramStatus): string | null {
  const username = status.botUsername;
  const url = status.challenge?.startUrl;
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username) || !url) return null;
  const prefix = `https://t.me/${username}?start=`;
  return url.startsWith(prefix) && /^[A-Za-z0-9_-]{1,64}$/.test(url.slice(prefix.length)) ? url : null;
}

function Action({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Confirmation({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={[styles.confirmation, disabled && styles.disabled]}
    {...(Platform.OS === "web" ? {
      "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); if (!disabled) onToggle(); }
      },
    } : {})}><Text style={styles.body}>{checked ? "☑" : "☐"} {label}</Text></Pressable>;
}

export function TelegramPanel(props: Props) {
  return <TelegramWorkspace key={`${props.userId}\n${props.apiBaseUrl}`} {...props} />;
}

function TelegramWorkspace({ userId, online, apiBaseUrl, onSessionChanged }: Props) {
  const api = useMemo(() => createTelegramApi(apiBaseUrl), [apiBaseUrl]);
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [authorized, setAuthorized] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [privateConfirmed, setPrivateConfirmed] = useState(false);
  const [accountConfirmed, setAccountConfirmed] = useState("");
  const [revokeConfirmed, setRevokeConfirmed] = useState("");
  const [testConfirmed, setTestConfirmed] = useState("");
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const available = online && authorized && !!userId;
  const availableRef = useRef(available); availableRef.current = available;
  const refreshRef = useRef<() => void>(() => {});
  const sessionChanged = useRef(onSessionChanged); sessionChanged.current = onSessionChanged;

  const clearConfirmations = useCallback(() => {
    setPrivateConfirmed(false); setAccountConfirmed(""); setRevokeConfirmed(""); setTestConfirmed(""); setRetryConfirmed(false);
  }, []);
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; setBusy("");
  }, []);
  const clearIdentity = useCallback(() => {
    cancelRequests(); api.resetOnline(); pendingRef.current = null;
    setPending(null); setStatus(null); clearConfirmations(); setAuthorized(false);
    setNotice("登入帳號或權限已改變，Telegram 資料及勾選已清除。請重新登入。");
    sessionChanged.current?.();
  }, [api, cancelRequests, clearConfirmations]);

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
      if (affected && pendingRef.current === affected && error instanceof TelegramApiError && error.confirmed) affected.confirmed = true;
      if (!current()) return;
      const responseStatus = error instanceof TelegramApiError ? error.status : 0;
      const code = error instanceof TelegramApiError ? error.onlineCode : null;
      if (responseStatus === 401 || responseStatus === 403 || code === "session_changed") { clearIdentity(); return; }
      if (responseStatus === 404) { setStatus(null); clearConfirmations(); }
      if (entry && (entry.confirmed || api.hasPendingOnline() || responseStatus === 0 || responseStatus === 409 || responseStatus >= 500)) {
        entry.reviewed = false; setPending({ ...entry }); setRetryConfirmed(false);
        if (responseStatus === 409) clearConfirmations();
        setNotice(entry.confirmed ? "Server 已確認原操作，但最新狀態未能讀取。請查核原操作及重新讀取，毋須再次提交。"
          : responseStatus === 409 ? "操作未獲接納，請核對原收據、最新綁定及發送限制，再明確確認。"
          : "提交結果未能確認。原操作識別及內容保留，系統不會自動重送。請先查核原操作。");
      } else {
        if (entry) { pendingRef.current = null; setPending(null); clearConfirmations(); }
        const retained = pendingRef.current;
        if (retained) { retained.reviewed = false; setPending({ ...retained }); setRetryConfirmed(false); }
        setNotice(responseStatus === 429 ? "一般測試已受發送次數或間隔限制，請稍後再確認。"
          : entry ? "請求未被接納，請重新讀取並核對後再確認。"
          : retained?.confirmed ? "原操作已確認，但 Telegram 狀態讀取失敗。請再次查核及重新讀取。"
          : "Telegram 資料讀取失敗，請手動重新讀取。");
      }
    } finally {
      requests.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  };

  const refresh = () => { void run("讀取", async (signal, current) => {
    const receipt = await api.reconcilePending(signal, userId);
    const entry = pendingRef.current;
    if (entry && receipt?.state === "confirmed") entry.confirmed = true;
    const next = await api.status(signal, userId);
    if (!current()) return;
    setStatus(next); setRetryConfirmed(false);
    if (entry && !entry.confirmed && api.hasPendingOnline()) {
      entry.reviewed = receipt?.state === "unconfirmed"; setPending({ ...entry });
      setNotice("原操作尚無確認收據。已讀取目前資料；請核對後明確選擇是否沿用原操作識別重試。");
    } else {
      pendingRef.current = null; setPending(null);
      if (entry) {
        clearConfirmations();
        setNotice(entry.confirmed ? "Server 已確認原操作，最新 Telegram 資料已讀取，毋須再次提交。"
          : "目前沒有待查的原操作收據。資料已重新讀取，請核對後重新明確確認。");
      }
    }
  }); };
  refreshRef.current = refresh;

  useEffect(() => {
    return () => {
      generation.current++;
      for (const request of requests.current) request.abort();
      requests.current.clear(); inFlight.current = false; pendingRef.current = null; api.resetOnline();
    };
  }, [api]);
  useEffect(() => {
    cancelRequests(); setStatus(null); clearConfirmations();
    const entry = pendingRef.current;
    if (entry) { entry.reviewed = false; setPending({ ...entry }); }
    if (available) refreshRef.current();
    else setNotice("");
  }, [available, cancelRequests, clearConfirmations]);

  const submit = (attempt: Attempt, retry = false) => {
    if (!status || !available || inFlight.current || (retry ? !api.hasPendingOnline() : pendingRef.current !== null || api.hasPendingOnline())) return;
    if (!retry) {
      const latestBinding = status.binding;
      const latestChallenge = status.challenge;
      if (attempt.kind !== "revoke" && !status.configured) return;
      if (attempt.kind === "begin" && (latestBinding && latestBinding.status !== "revoked" || !privateConfirmed)) return;
      if (attempt.kind === "confirm" && (latestBinding && latestBinding.status !== "revoked" || !latestChallenge || latestChallenge.state !== "seen"
        || Date.parse(latestChallenge.expiresAt) <= Date.now() || latestChallenge.id !== attempt.id || latestChallenge.version !== attempt.version
        || candidateKey(latestChallenge) !== attempt.accountKey || accountConfirmed !== attempt.accountKey)) return;
      if ((attempt.kind === "revoke" || attempt.kind === "test") && (!latestBinding || latestBinding.id !== attempt.id || latestBinding.version !== attempt.version)) return;
      if (attempt.kind === "revoke" && (latestBinding?.status === "revoked" || revokeConfirmed !== bindingKey(latestBinding))) return;
      if (attempt.kind === "test" && (!status.workerEnabled || latestBinding?.status !== "active" || testConfirmed !== bindingKey(latestBinding)
        || status.deliveries.some(item => item.bindingId === attempt.id && (item.status === "queued" || item.status === "sending" || item.status === "unknown" && item.acknowledgedAt === null)))) return;
    }
    const entry = retry ? pendingRef.current : { attempt, confirmed: false, reviewed: false };
    if (!entry || entry.confirmed || retry && (!entry.reviewed || !retryConfirmed || entry.attempt !== attempt)) return;
    entry.reviewed = false; pendingRef.current = entry; setPending({ ...entry }); setRetryConfirmed(false);
    void run(operationText[attempt.kind], async (signal, current) => {
      if (attempt.kind === "begin") await api.begin(signal, userId);
      else if (attempt.kind === "confirm") await api.confirm(attempt.id, attempt.version, signal, userId);
      else if (attempt.kind === "revoke") await api.revoke(attempt.id, attempt.version, signal, userId);
      else await api.test(attempt.id, attempt.version, signal, userId);
      entry.confirmed = true;
      if (!current()) return;
      clearConfirmations();
      const next = await api.status(signal, userId);
      if (!current()) return;
      setStatus(next); pendingRef.current = null; setPending(null);
      setNotice(attempt.kind === "test" ? "一般測試操作已確認。請按投遞狀態核對；渠道接受不代表已讀。" : "操作已確認，Telegram 資料已重新讀取。");
    }, entry);
  };

  const binding = available ? status?.binding ?? null : null;
  const challenge = available ? status?.challenge ?? null : null;
  const bound = !!binding && binding.status !== "revoked";
  const ready = available && !!status && !busy && !pending && !api.hasPendingOnline();
  const configured = status?.configured === true;
  const expires = !!challenge && Date.parse(challenge.expiresAt) > Date.now();
  const accountKey = candidateKey(challenge);
  const currentBindingKey = bindingKey(binding);
  const startUrl = status ? safeStartUrl(status) : null;
  const awaitingDelivery = !!binding && !!status?.deliveries.some(item => item.bindingId === binding.id
    && (item.status === "queued" || item.status === "sending" || item.status === "unknown" && item.acknowledgedAt === null));
  const canRetry = available && !!pending && pending.reviewed && !pending.confirmed && api.hasPendingOnline() && !!status;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>我的 Telegram 渠道</Text>
    <Text style={styles.hint}>此綁定屬於你本人，切換孩子不會改變接收帳號。請使用私人對話，並核對接收帳號。</Text>
    <Action label={busy === "讀取" ? "正在查核…" : "查核原操作及重新讀取 Telegram 狀態"} disabled={!available || !!busy} onPress={refresh} />
    {!online && <Text style={styles.warning}>目前離線，Telegram 資料及勾選已清除。回復連線後請核對最新狀態。</Text>}
    {!authorized && <Text style={styles.warning}>請重新登入後讀取 Telegram 狀態。</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {available && pending && <View style={styles.group}>
      <Text style={styles.warning}>待核對原操作：{operationText[pending.attempt.kind]}。其他提交暫停。</Text>
      {canRetry && <>
        <Text style={styles.hint}>Server 會先查原收據，再按原內容、版本及目前設定判斷是否接納；本頁不會另建操作。</Text>
        {pending.attempt.kind === "begin" && <Text style={styles.warning}>若原操作尚未落實，本次會產生綁定連結，並取代未完成的連結。</Text>}
        {pending.attempt.kind === "test" && <Text style={styles.warning}>若原操作已落實，只會取回原收據，不會再發一次；未落實才按原綁定及原版本提交一般測試。</Text>}
        <Confirmation label="我已核對最新狀態，確認以原操作再核對／提交，保留原內容" checked={retryConfirmed} disabled={!!busy} onToggle={() => setRetryConfirmed(value => !value)} />
        <Action label="以原操作再核對／提交" disabled={!!busy || !retryConfirmed} onPress={() => submit(pending.attempt, true)} />
      </>}
    </View>}
    {available && status && <>
      {!configured && <Text style={styles.warning}>Telegram 渠道目前停用；新綁定、帳號確認及一般測試暫停，仍可撤銷既有綁定並查核原操作。</Text>}
      {!status.workerEnabled && <Text style={styles.warning}>發送 worker 目前停用，不能開始一般測試。</Text>}
      {binding && <View style={styles.group}>
        <Text style={styles.label}>綁定狀態：{bindingText[binding.status]}</Text>
        <Text style={styles.body}>帳號：{binding.label || "未提供帳號名稱"}；帳號提示：{binding.chatIdHint}</Text>
        <Text style={styles.hint}>最後更新：{dateText(binding.updatedAt)}</Text>
        {bound && <>
          <Text style={styles.hint}>更換接收帳號前須先撤銷。撤銷會停止這個綁定的後續外發。</Text>
          <Confirmation label="我確認撤銷以上 Telegram 綁定" checked={revokeConfirmed === currentBindingKey} disabled={!ready}
            onToggle={() => setRevokeConfirmed(value => value === currentBindingKey ? "" : currentBindingKey)} />
          <Action label="確認撤銷綁定" disabled={!ready || revokeConfirmed !== currentBindingKey} onPress={() => submit({ kind: "revoke", id: binding.id, version: binding.version })} />
        </>}
      </View>}
      {!bound && <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.subheading}>綁定私人 Telegram 帳號</Text>
        <Text style={styles.hint}>連結有效 10 分鐘，只用作本次綁定。請在 Telegram 私人對話按 Start，再回此頁手動重新讀取；本頁不會自動輪詢。</Text>
        <Confirmation label="我確認使用本人私人 Telegram 對話作接收渠道" checked={privateConfirmed} disabled={!ready || !configured}
          onToggle={() => setPrivateConfirmed(value => !value)} />
        <Action label="產生一次性綁定連結" disabled={!ready || !configured || !privateConfirmed} onPress={() => submit({ kind: "begin" })} />
        {challenge && <>
          <Text style={styles.hint}>連結到期：{dateText(challenge.expiresAt)}</Text>
          {!expires && <Text style={styles.warning}>綁定連結已到期，請重新確認私人渠道並產生新連結。</Text>}
          {!startUrl && <Text style={styles.warning}>未能核對 Telegram 綁定連結，請重新讀取。</Text>}
          <Action label="打開 Telegram 私人對話並按 Start" disabled={!ready || !configured || !expires || !startUrl}
            onPress={() => {
              if (!status || !status.configured || !status.challenge || Date.parse(status.challenge.expiresAt) <= Date.now()) return;
              const url = safeStartUrl(status);
              const started = generation.current;
              if (url) void Linking.openURL(url).catch(() => {
                if (availableRef.current && generation.current === started) setNotice("未能打開 Telegram，請稍後再試。");
              });
            }} />
          {challenge.state === "waiting" && <Text style={styles.hint}>尚未收到 Start。按 Start 後請使用上方按鈕手動重新讀取。</Text>}
          {challenge.state === "seen" && challenge.candidate && <View style={styles.confirmation}>
            <Text style={styles.body}>待核對帳號：{challenge.candidate.label || "未提供帳號名稱"}</Text>
            <Text style={styles.body}>帳號提示：{challenge.candidate.chatIdHint}</Text>
            <Confirmation label="我已核對以上帳號及提示，確認這是本人接收帳號" checked={!!accountKey && accountConfirmed === accountKey} disabled={!ready || !configured || !expires}
              onToggle={() => setAccountConfirmed(value => value === accountKey ? "" : accountKey)} />
            <Action label="確認綁定以上帳號" disabled={!ready || !configured || !expires || !accountKey || accountConfirmed !== accountKey}
              onPress={() => submit({ kind: "confirm", id: challenge.id, version: challenge.version, accountKey })} />
          </View>}
        </>}
      </View>}
      {binding?.status === "active" && <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.subheading}>一次一般測試</Text>
        <Text style={styles.warning}>確認後會立即交由渠道外發一則固定一般測試訊息，不含孩子正文。每人每日最多 3 次，兩次最少相隔 60 秒。</Text>
        {awaitingDelivery && <Text style={styles.warning}>現有投遞仍在排隊、發送中或結果未知。請先手動重新讀取及在 Telegram 核對，系統不會盲目重送。</Text>}
        <Confirmation label="我確認現在向以上本人 Telegram 帳號外發一次一般測試" checked={testConfirmed === currentBindingKey}
          disabled={!ready || !configured || !status.workerEnabled || awaitingDelivery}
          onToggle={() => setTestConfirmed(value => value === currentBindingKey ? "" : currentBindingKey)} />
        <Action label="確認立即發送一次一般測試" disabled={!ready || !configured || !status.workerEnabled || awaitingDelivery || testConfirmed !== currentBindingKey}
          onPress={() => submit({ kind: "test", id: binding.id, version: binding.version })} />
      </View>}
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.subheading}>近期投遞</Text>
        <Text style={styles.hint}>Telegram API 接受不代表已讀。「我已收到」只確認收到訊息，不代表照護任務完成。</Text>
        {status.deliveries.length === 0 && <Text style={styles.body}>尚無一般測試投遞。</Text>}
        {status.deliveries.map(delivery => <View key={delivery.id} style={styles.delivery}>
          <Text style={styles.label}>{deliveryText[delivery.status]}</Text>
          <Text style={styles.hint}>建立時間：{dateText(delivery.createdAt)}</Text>
          {delivery.attemptedAt && <Text style={styles.hint}>發送嘗試：{dateText(delivery.attemptedAt)}</Text>}
          {delivery.acknowledgedAt && <Text style={styles.body}>按「我已收到」時間：{dateText(delivery.acknowledgedAt)}</Text>}
          {delivery.status === "unknown" && <Text style={styles.warning}>結果未知，請自行核對 Telegram；這筆投遞不會自動重送。</Text>}
          {delivery.status === "rejected" && <Text style={styles.warning}>Telegram 未接納此投遞，請核對私人對話及綁定狀態。</Text>}
        </View>)}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  confirmation: { padding: 10, borderWidth: 1, borderColor: "#a8b9b0", borderRadius: 6 },
  delivery: { gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  heading: { fontSize: 20, fontWeight: "700", color: "#183f35" },
  subheading: { fontSize: 17, fontWeight: "600", color: "#183f35" },
  label: { fontSize: 15, fontWeight: "600", color: "#203e35" },
  body: { fontSize: 15, color: "#24352e" },
  hint: { fontSize: 13, color: "#465c52" },
  warning: { fontSize: 14, color: "#80501b" },
  button: { backgroundColor: "#275e4e", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, alignSelf: "flex-start" },
  buttonText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
