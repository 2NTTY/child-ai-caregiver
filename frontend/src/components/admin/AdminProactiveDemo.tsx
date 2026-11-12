import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { AdminOwner } from '../../production/AdminOwner';
import { demoAwaitingDelivery, demoDeliveryLabel, demoReasonLabel, type AdminDemoState } from '../../production/admin-proactive-demo';
import { AppButton, SectionHeader } from '../ui';
import { colors, spacing } from '../../theme';

export function AdminProactiveDemo({ admin, state, online, writeLocked, visible = true }: {
  admin: AdminOwner; state: AdminDemoState; online: boolean; writeLocked: boolean; visible?: boolean;
}) {
  useEffect(() => { if (online && state.status === 'unread') void admin.loadDemo(); }, [admin, online, state.status]);
  const opId = state.pending ?? state.receipt?.opId;
  const awaitingDelivery = demoAwaitingDelivery(state.receipt);
  useEffect(() => {
    if (!online || !visible || !opId || !awaitingDelivery) return;
    let stop: (() => void) | undefined;
    const sync = () => {
      stop?.(); stop = undefined;
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') stop = admin.watchDemoReceipt(opId);
    };
    sync();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync);
    return () => { stop?.(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync); };
  }, [admin, online, visible, opId, awaitingDelivery]);
  return <View style={styles.card}>
    <SectionHeader title="主動訊息示範" subtitle="向部署預先綁定的示範帳戶及孩子建立訊息，並查看通知交送收據。" />
    <Text style={styles.note}>本頁不能選擇收件帳戶。交送服務的回覆不代表真實裝置已收到或已閱讀；請在示範帳戶及裝置另行核對。</Text>
    {state.status === 'loading' ? <Text accessibilityLiveRegion="polite">正在讀取示範配置…</Text> : null}
    {state.status === 'ready' && !state.enabled ? <Text>此部署未啟用示範或未配置完整示範對象，暫不能發送。</Text> : null}
    <View style={styles.actions}>
      <AppButton label="立即示範主動通知" disabled={writeLocked || state.busy || !!state.pending || state.status !== 'ready' || !state.enabled}
        onPress={() => { void admin.sendDemo(); }} />
      <AppButton label="重新讀取示範配置" variant="quiet" disabled={!online || state.busy || state.status === 'loading'} onPress={() => { void admin.loadDemo(); }} />
    </View>
    {state.busy ? <Text accessibilityLiveRegion="polite">正在核對示範操作…</Text> : null}
    {state.notice ? <Text accessibilityLiveRegion="polite">{state.notice}</Text> : null}
    {opId ? <Text selectable style={styles.note}>操作 ID：{opId}</Text> : null}
    {state.pending ? <Text>原操作仍待確認，暫不能開始另一項示範。查回不會建立新訊息；重送沿用原操作 ID。</Text> : null}
    {state.pending && !state.recoveryStored ? <Text>瀏覽器未能保留此操作 ID；離開或重新載入前請先查回收據，避免重複示範。</Text> : null}
    {opId ? <AppButton label="查回原示範收據及狀態" variant="secondary" disabled={!online || state.busy} onPress={() => { void admin.recoverDemo(); }} /> : null}
    {state.pending ? <AppButton label="以原 ID 重送示範操作" variant="secondary" disabled={writeLocked || state.busy || state.status !== 'ready' || !state.enabled}
      onPress={() => { void admin.retryDemo(); }} /> : null}
    {state.receipt ? <View style={styles.row}>
      <Text selectable style={styles.note}>訊息 ID：{state.receipt.messageId}</Text>
      <Text selectable>{state.receipt.text}</Text>
      <Text>交送收據 {state.receipt.deliveries.length} 項</Text>
      {!state.receipt.deliveries.length ? <Text>沒有通知交送項目，可能沒有已綁定的通知裝置；請在示範帳戶核對聊天訊息。</Text> : null}
      {state.receipt.deliveries.map(item => <View key={item.id} style={styles.row}>
        <Text>{demoDeliveryLabel(item.status)}（{item.status}）</Text>
        <Text selectable style={styles.note}>交送 ID：{item.id}</Text>
        {item.reason ? <Text selectable style={styles.note}>原因：{demoReasonLabel(item.reason)}（{item.reason}）</Text> : null}
      </View>)}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine },
  row: { gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.softLine },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }, note: { color: colors.muted },
});
