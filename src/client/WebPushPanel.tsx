import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PushBinding, PushDelivery, WebPushStatus } from "../shared/web-push.ts";

export interface WebPushPanelProps {
  status: WebPushStatus | null;
  currentBindingId: string | null;
  browserSupported: boolean;
  permission: "default" | "granted" | "denied" | "unsupported";
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onRevoke: (binding: PushBinding) => void;
  onTest: (binding: PushBinding) => void;
  onRefresh: () => void;
  onReconcile: () => void;
  hasPending: boolean;
}

const permissionName = { default: "尚未允許", granted: "已允許", denied: "已拒絕", unsupported: "不支援" };
const bindingName = { active: "已啟用", revoked: "已撤銷", expired: "已失效" };
const deliveryName = {
  queued: "排隊中", sending: "正在嘗試發送", accepted: "Push 服務已接受",
  rejected: "Push 服務拒絕", unknown: "發送結果未知", stopped: "已停止",
};
const reasonName: Record<NonNullable<PushDelivery["reason"]>, string> = {
  subscription_expired: "瀏覽器訂閱已失效", provider_rejected: "Push 服務拒絕請求",
  rate_limited: "已達發送限制", transport_unknown: "連線中斷，未能確認發送結果",
  revoked: "訂閱或發送授權已失效", worker_paused: "背景發送已暫停", configuration_unavailable: "通知服務尚未可用",
  request_invalid: "通知請求無效", worker_interrupted: "背景發送中斷，未能確認結果",
};
const time = (value: string) => new Date(value).toLocaleString("zh-HK", { hour12: false });

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

export function WebPushPanel({ status, currentBindingId, browserSupported, permission, busy, error,
  onEnable, onRevoke, onTest, onRefresh, onReconcile, hasPending }: WebPushPanelProps) {
  const ready = !busy && !hasPending && status !== null;
  const canEnable = ready && status.available && browserSupported && permission !== "denied" && permission !== "unsupported";
  const testTimeReady = status?.nextTestAt === null || status?.nextTestAt !== undefined && Date.parse(status.nextTestAt) <= Date.now();
  const canTest = ready && status.available && status.workerEnabled && status.testsRemaining > 0 && testTimeReady;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>我的瀏覽器通知</Text>
    <Text style={styles.hint}>目前初步支援 HTTPS 上的 Chromium／Firefox。</Text>
    <Text style={styles.hint}>啟用只綁定你自己的瀏覽器訂閱，不會授予家庭資料權限，也不會自動開啟照顧任務聯絡。</Text>
    <Text style={styles.body}>此瀏覽器的通知權限：{permissionName[permission]}</Text>
    {(!browserSupported || permission === "unsupported") && <Text style={styles.warning}>此瀏覽器或目前連線不支援通知，請使用受支援的瀏覽器及 HTTPS。</Text>}
    {permission === "denied" && <Text style={styles.warning}>通知權限已被拒絕，請先在瀏覽器網站設定中調整，再重新讀取狀態。</Text>}
    <View style={styles.row}>
      <Action label="啟用此瀏覽器通知" onPress={onEnable} disabled={!canEnable} />
      <Action label={busy ? "正在處理…" : "重新讀取通知狀態"} onPress={onRefresh} disabled={busy} />
    </View>
    {hasPending && <View style={styles.confirmation}>
      <Text style={styles.warning}>原操作結果尚未確認。請先查核／重試原操作；只會重試同一提交，不會建立另一通知。核對結果後才可啟用、撤銷或測試。</Text>
      <Action label="查核／重試原操作" onPress={onReconcile} disabled={busy} />
    </View>}
    {error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}
    {!status && <Text style={styles.body}>尚未讀取通知狀態。</Text>}
    {status && <>
      {!status.available && <Text style={styles.warning}>通知服務目前未能啟用或測試；仍可撤銷已有訂閱。</Text>}
      {!status.workerEnabled && <Text style={styles.warning}>背景發送目前已暫停；排隊不代表已發送。</Text>}
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>我的訂閱</Text>
        <Text style={styles.hint}>最多顯示 20 項。撤銷後停止新的投遞；已開始的發送可能仍到達。</Text>
        {status.bindings.length === 0 && <Text style={styles.body}>尚未綁定任何瀏覽器。</Text>}
        {status.bindings.slice(0, 20).map(binding => <View key={binding.id} style={styles.item}>
          <Text style={styles.label}>{binding.label}{binding.id === currentBindingId ? "（此瀏覽器）" : ""}</Text>
          <Text style={styles.body}>狀態：{bindingName[binding.status]}；Push 服務：{binding.provider === "fcm" ? "FCM" : "Mozilla"}</Text>
          {binding.expiresAt && <Text style={styles.hint}>訂閱到期：{time(binding.expiresAt)}</Text>}
          {binding.status === "active" && <View style={styles.row}>
            <Action label="撤銷此訂閱" onPress={() => onRevoke(binding)} disabled={!ready} />
            <Action label="立即發送一般測試通知（不含照顧資料）" onPress={() => onTest(binding)} disabled={!canTest} />
          </View>}
        </View>)}
        <Text style={styles.hint}>測試只核對通知渠道，不會自動聯絡照顧任務。每人於滾動 24 小時內最多 3 次，兩次測試至少相隔 60 秒。</Text>
        <Text style={styles.body}>目前尚餘測試次數：{status.testsRemaining}</Text>
        {status.nextTestAt && <Text style={styles.hint}>下一次可測試時間：{time(status.nextTestAt)}；到時可重新讀取狀態。</Text>}
      </View>
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>最近投遞狀態</Text>
        <Text style={styles.hint}>最多顯示 20 項。Push 服務已接受不代表裝置已收到、使用者已讀或回應，也不代表任務已完成。</Text>
        {status.deliveries.length === 0 && <Text style={styles.body}>尚未有投遞記錄。</Text>}
        {status.deliveries.slice(0, 20).map(delivery => <View key={delivery.id} style={styles.item}>
          <Text style={styles.label}>{status.bindings.find(binding => binding.id === delivery.bindingId)?.label ?? "未列於目前清單的訂閱"}</Text>
          <Text style={styles.body}>狀態：{deliveryName[delivery.status]}</Text>
          {delivery.reason && <Text style={styles.warning}>{reasonName[delivery.reason]}</Text>}
          {delivery.status === "unknown" && <Text style={styles.warning}>未能確認是否已被服務接受，請核對狀態，避免重複發送。</Text>}
          <Text style={styles.hint}>建立時間：{time(delivery.createdAt)}</Text>
          {delivery.attemptedAt && <Text style={styles.hint}>嘗試發送時間：{time(delivery.attemptedAt)}</Text>}
          {delivery.finishedAt && <Text style={styles.hint}>本次處理結束時間：{time(delivery.finishedAt)}</Text>}
        </View>)}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  item: { gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  confirmation: { gap: 8, padding: 10, borderWidth: 1, borderColor: "#b88132", borderRadius: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heading: { fontSize: 20, fontWeight: "700", color: "#183f35" },
  label: { fontSize: 15, fontWeight: "600", color: "#203e35" },
  body: { fontSize: 15, color: "#24352e" },
  hint: { fontSize: 13, color: "#465c52" },
  warning: { fontSize: 14, color: "#80501b" },
  button: { backgroundColor: "#275e4e", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, alignSelf: "flex-start" },
  buttonText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
