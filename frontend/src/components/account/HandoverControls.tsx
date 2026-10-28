import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useProduction } from '../../production/ProductionProvider';
import { handoverErrorText } from '../../production/HandoverOwner';
import { HandoverApiError } from '../../../../src/client/handover-api';
import { HANDOVER_MODULES } from '../../../../src/shared/handover';
import type { HandoverExportCommand, HandoverExportView } from '../../../../src/shared/handover-jobs';
import { exportPackage, useFileExportAvailable } from '../../platform/file-export';
import { AppCheckbox } from '../AppCheckbox';
import { FormDialog } from '../FormDialog';
import { AppButton } from '../ui';
import { chineseFont, colors, readingType, spacing } from '../../theme';

const moduleLabels: Record<typeof HANDOVER_MODULES[number], string> = {
  profile: '孩子資料', care: '照護記錄', chat: '私人聊天', memory: '記憶與摘要', tasks: '待辦',
  documents: '準備單與文件', attachments: '照片、錄音與附件', sources: '私人來源', concerns: '持續關注', growth: '成長整理',
};
const stateLabels: Record<HandoverExportView['state'], string> = { queued: '已排隊', building: '正在整理', ready: '可下載', failed: '未能完成', cancelled: '已取消', expired: '已到期' };
const dateText = (value: string) => new Date(value).toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** One shared account-level entry; the controller owns requests, the Server owns contents and authority. */
export function HandoverControls() {
  const { owner, userId, identityKey, recordsState, account, online } = useProduction();
  const controller = owner.handoverOwner;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [open, setOpen] = useState(false), [purpose, setPurpose] = useState<HandoverExportCommand['purpose']>('handover');
  const [children, setChildren] = useState<string[]>([]), [modules, setModules] = useState<(typeof HANDOVER_MODULES)[number][]>([]);
  const canDownload = useFileExportAvailable();
  const current = !!identityKey && state.identityKey === identityKey && state.userId === userId && account.gate === 'ready';
  const locked = !current || !online || !!state.busy || account.deletion.phase !== 'idle';
  const selectable = recordsState.children.filter(child => child.accessRole === 'owner' || child.accessRole === undefined);
  useLayoutEffect(() => { setOpen(false); setChildren([]); setModules([]); }, [identityKey]);
  useEffect(() => { if (current && online) void controller.load(); }, [controller, identityKey, current, online]);
  const waitingId = current ? state.items.find(item => item.state === 'queued' || item.state === 'building')?.id : undefined;
  useEffect(() => {
    if (!waitingId || !current || !online) return;
    const timer = setInterval(() => {
      const foreground = Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'visible' : AppState.currentState === 'active';
      if (foreground) void controller.refresh(waitingId);
    }, 15_000);
    return () => clearInterval(timer);
  }, [controller, waitingId, current, online]);
  if (!current) return null;
  const pending = state.pending;
  const chooseChild = (id: string, checked: boolean) => setChildren(before => checked ? [...before.filter(value => value !== id), id] : before.filter(value => value !== id));
  const chooseModule = (id: typeof HANDOVER_MODULES[number], checked: boolean) => setModules(before => checked ? [...before.filter(value => value !== id), id] : before.filter(value => value !== id));
  return <View style={styles.group}>
    <Text style={styles.title}>交接與備份資料包</Text>
    <Text style={styles.body}>選擇孩子及資料，以 ZIP 保存結構化內容、附件與閱讀摘要。檔案保留 24 小時，可稍後回來下載。</Text>
    <Text style={styles.body}>目前可匯出所選孩子的全部期間；匯入、班級及整個帳戶備份仍待接通。</Text>
    <AppButton label="選擇要匯出的資料" variant="secondary" disabled={locked || !!pending || !selectable.length}
      onPress={() => { setChildren([]); setModules([]); setPurpose('handover'); setOpen(true); }} />
    {!selectable.length ? <Text style={styles.body}>未有可匯出的本人孩子資料。</Text> : null}
    {pending ? <View style={styles.group}>
      <Text style={styles.body}>{pending.checked ? '原狀態已查回，可繼續同一次請求。' : '提交結果尚未確認，請先查回原請求。'}</Text>
      <AppButton label="查回原請求" variant="quiet" loading={state.busy === 'check'} disabled={locked} onPress={() => { void controller.checkOriginal(); }} />
      {pending.checked ? <AppButton label="繼續原請求" variant="secondary" disabled={locked} onPress={() => { void controller.retryOriginal(); }} /> : null}
    </View> : null}
    <AppButton label={state.busy === 'read' ? '正在讀取資料包' : '重新讀取資料包'} variant="quiet" loading={state.busy === 'read'} disabled={locked}
      onPress={() => { void controller.load(); }} />
    {state.loaded && !state.items.length ? <Text style={styles.body}>尚未建立資料包。</Text> : null}
    {state.items.map(row => <View key={row.id} style={styles.item}>
      <Text style={styles.title}>{row.purpose === 'backup' ? '本人備份' : '交接資料'} · {stateLabels[row.state]}</Text>
      <Text style={styles.body}>{dateText(row.createdAt)} · {row.selection.childIds.length} 位孩子 · {row.selection.modules.map(module => moduleLabels[module]).join('、')}</Text>
      {row.state === 'ready' ? <Text style={styles.body}>{row.bytes === null ? '' : `${(row.bytes / 1024 / 1024).toFixed(1)} MiB · `}至 {dateText(row.expiresAt)}</Text> : null}
      {row.error ? <Text style={styles.body}>{handoverErrorText(new HandoverApiError(409, row.error))}</Text> : null}
      <View style={styles.actions}>
        {row.state === 'ready' ? <AppButton label="下載資料包" variant="secondary" disabled={locked || !canDownload} onPress={() => { void controller.download(row.id, exportPackage); }} /> : null}
        {row.error === 'package_object_unknown' ? <AppButton label="查回原檔案" variant="quiet" disabled={locked} onPress={() => { void controller.refresh(row.id, true); }} /> : null}
        {!['cancelled', 'expired'].includes(row.state) ? <AppButton label="取消此資料包" variant="quiet" disabled={locked || !!pending} onPress={() => { void controller.cancel(row.id); }} /> : null}
      </View>
    </View>)}
    {state.nextCursor ? <AppButton label="載入更多資料包" variant="quiet" disabled={locked} onPress={() => { void controller.load(true); }} /> : null}
    {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
    <FormDialog visible={open} scopeKey={identityKey!} title="選擇匯出資料" dismissMode="local" onClose={() => setOpen(false)}>
      <View style={styles.group}>
        <Text style={styles.body}>只包含勾選範圍。私人聊天、記憶及來源如需交給別人，請按需要選取；交出後對方保留獨立副本。</Text>
        <View style={styles.actions}>
          <AppButton label="用作交接" variant={purpose === 'handover' ? 'primary' : 'quiet'} disabled={locked} onPress={() => setPurpose('handover')} />
          <AppButton label="本人備份" variant={purpose === 'backup' ? 'primary' : 'quiet'} disabled={locked} onPress={() => setPurpose('backup')} />
        </View>
        <Text style={styles.title}>孩子</Text>
        {selectable.map(child => <AppCheckbox key={child.id} label={child.displayName} checked={children.includes(child.id)} disabled={locked} onChange={value => chooseChild(child.id, value)} />)}
        <Text style={styles.title}>資料內容</Text>
        {HANDOVER_MODULES.map(module => <AppCheckbox key={module} label={moduleLabels[module]} checked={modules.includes(module)} disabled={locked} onChange={value => chooseModule(module, value)} />)}
        <AppButton label="建立資料包" loading={state.busy === 'write'} disabled={locked || !!pending || !children.length || !modules.length}
          onPress={() => { void controller.create({ childIds: children, modules, period: null }, purpose); setOpen(false); }} />
      </View>
    </FormDialog>
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
