import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { adminTransferDigestSchema } from '../../../../src/shared/admin-knowledge-transfer';
import type { AdminOwner } from '../../production/AdminOwner';
import type { AdminTransferState } from '../../production/admin-knowledge-transfer';
import { AppButton, AppTextField, SectionHeader } from '../ui';
import { colors, spacing } from '../../theme';

const states = { ready: '可接續匯入', stopped: '已停止', failed: '匯入失敗', completed: '所有項目已入庫' };
const editions = { draft: '草稿', reviewed: '已審核', withdrawn: '已撤回' };
const when = (value: string) => new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });

export function AdminKnowledgeTransfers({ admin, state, online, writeLocked }: {
  admin: AdminOwner; state: AdminTransferState; online: boolean; writeLocked: boolean;
}) {
  const [fingerprint, setFingerprint] = useState('');
  const detail = state.detail, batch = detail.batch;
  return <View style={styles.card}>
    <SectionHeader title="公共知識 ZIP 匯入台帳" subtitle="按包指紋查看已入庫版本、失敗紀錄及接續狀態。" />
    <Text style={styles.note}>只在開啟或按下讀取時查詢。恢復只使同一 ZIP 可接續，匯入執行者仍須取得原包；不代表已重新執行或發布知識。</Text>
    <AppButton label={state.open ? '收起 ZIP 匯入台帳' : state.pending ? '查看 ZIP 匯入台帳（有操作待核對）' : '查看 ZIP 匯入台帳'}
      variant="quiet" expanded={state.open} disabled={!online && !state.open} onPress={() => { void admin.setTransfersOpen(!state.open); }} />
    {state.open ? <>
      {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.note}>{state.notice}</Text> : null}
      {state.pending ? <View style={styles.row}>
        <Text>匯入控制仍待核對，暫不能提交其他匯入控制。請先查回原批次。</Text>
        <Text selectable style={styles.note}>原包指紋：{state.pending.digest}</Text>
        <AppButton label="查回原 ZIP 匯入批次" variant="secondary" disabled={!online || state.busy}
          onPress={() => { void admin.recoverTransferOperation(); }} />
      </View> : null}
      <AppTextField label="完整 ZIP SHA-256 指紋（64 位小寫）" value={fingerprint} onChangeText={setFingerprint}
        autoCapitalize="none" autoCorrect={false} />
      <AppButton label="按完整指紋查找匯入批次" variant="secondary"
        disabled={!online || !adminTransferDigestSchema.safeParse(fingerprint).success}
        onPress={() => { void admin.loadTransfer(fingerprint); }} />
      <Text accessibilityRole="header">已登記批次</Text>
      <AppButton label="重新讀取 ZIP 匯入批次列表" variant="secondary" disabled={!online || state.batches.status === 'loading'}
        onPress={() => { void admin.loadTransfers(); }} />
      {state.batches.status === 'loading' ? <Text accessibilityLiveRegion="polite">正在讀取匯入批次…</Text> : null}
      {state.batches.notice ? <Text accessibilityRole="alert">{state.batches.notice} 已讀內容保留，可重試。</Text> : null}
      {state.batches.status === 'ready' && !state.batches.items.length ? <Text>未查到已登記批次；舊包可按完整指紋查找。</Text> : null}
      {state.batches.items.map(value => <View key={value.id} style={styles.row}>
        <Text>{states[value.state]} · 已入庫 {value.next}／{value.total} 項</Text>
        <Text selectable style={styles.note}>ZIP 指紋：{value.id}</Text>
        <Text style={styles.note}>更新於 {when(value.updatedAt)}</Text>
        <AppButton label={detail.digest === value.id ? '重新讀取此包詳情' : '查看此包詳情'} variant="quiet" disabled={!online}
          onPress={() => { void admin.loadTransfer(value.id); }} />
      </View>)}
      {state.batches.nextCursor ? <AppButton label={state.batches.status === 'error' ? '重試載入更多匯入批次' : '載入更多匯入批次'} variant="secondary"
        disabled={!online || state.batches.status === 'loading'} onPress={() => { void admin.loadTransfers(true); }} /> : null}
      {detail.digest ? <View style={styles.row}>
        <Text accessibilityRole="header">所選 ZIP 匯入批次</Text>
        <Text selectable style={styles.note}>{detail.digest}</Text>
        {detail.status === 'loading' ? <Text accessibilityLiveRegion="polite">正在讀取批次及已入庫版本…</Text> : null}
        {detail.notice ? <Text accessibilityRole="alert">{detail.notice}</Text> : null}
        <AppButton label="讀回所選 ZIP 匯入批次" variant="quiet" disabled={!online || detail.status === 'loading'}
          onPress={() => { void admin.loadTransfer(detail.digest!); }} />
        {batch ? <>
          <Text>{states[batch.state]} · 已入庫 {batch.next}／{batch.total} 項 · 台帳版本 {batch.revision}</Text>
          <Text style={styles.note}>更新於 {when(batch.updatedAt)}；入庫與審核、發布分開。</Text>
          {batch.lastFailure ? <View style={styles.row}>
            <Text>最近一次失敗：第 {batch.lastFailure.index + 1} 項 · {when(batch.lastFailure.at)}</Text>
            <Text selectable style={styles.note}>來源：{batch.lastFailure.sourceId} · 原因：{batch.lastFailure.reason}</Text>
          </View> : null}
          <View style={styles.actions}>
            {batch.state === 'ready' || batch.state === 'failed' ? <AppButton label="停止此 ZIP 匯入批次" variant="secondary"
              disabled={writeLocked || detail.status !== 'ready'} onPress={() => { void admin.controlTransfer('stop'); }} /> : null}
            {batch.state === 'stopped' || batch.state === 'failed' ? <AppButton label="使原 ZIP 可接續匯入" variant="secondary"
              disabled={writeLocked || detail.status !== 'ready'} onPress={() => { void admin.controlTransfer('resume'); }} /> : null}
          </View>
          <Text accessibilityRole="header">已入庫版本</Text>
          {!detail.items.length && detail.status === 'ready' ? <Text>此頁未查到已入庫版本。</Text> : null}
          {detail.items.map(item => <View key={item.index} style={styles.row}>
            <Text>第 {item.index + 1} 項 · 入庫時{editions[item.editionState]} · {item.unchanged ? '沿用既有版本' : '已入庫'}</Text>
            <Text selectable style={styles.note}>來源：{item.sourceId} · 版本：{item.versionId}</Text>
            <Text selectable style={styles.note}>內容指紋：{item.versionHash}</Text>
            <Text style={styles.note}>入庫紀錄：{when(item.at)}</Text>
          </View>)}
          {detail.nextFrom !== null ? <AppButton label={detail.status === 'error' ? '重試載入更多已入庫版本' : '載入更多已入庫版本'} variant="secondary"
            disabled={!online || detail.status === 'loading'} onPress={() => { void admin.loadTransfer(detail.digest!, true); }} /> : null}
        </> : null}
      </View> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({ card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine },
  row: { gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.softLine },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }, note: { color: colors.muted } });
