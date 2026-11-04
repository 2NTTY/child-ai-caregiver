import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { DateTime } from 'luxon';
import { useProduction } from '../../production/ProductionProvider';
import { handoverErrorText } from '../../production/HandoverOwner';
import { HandoverApiError } from '../../../../src/client/handover-api';
import { HANDOVER_MODULES, supportsHandoverPeriodModules } from '../../../../src/shared/handover';
import type { HandoverExportCommand, HandoverExportView, HandoverPreviewItem } from '../../../../src/shared/handover-jobs';
import { exportPackage, useFileExportAvailable } from '../../platform/file-export';
import { AppCheckbox } from '../AppCheckbox';
import { AppDateField } from '../DateTimeFields';
import { hongKongTimeZone } from '../date-time';
import { FormDialog } from '../FormDialog';
import { AppButton } from '../ui';
import { HandoverImportControls } from './HandoverImportControls';
import { chineseFont, colors, readingType, spacing } from '../../theme';

const moduleLabels: Record<typeof HANDOVER_MODULES[number], string> = {
  profile: '孩子資料', care: '照護記錄', chat: '私人聊天', memory: '記憶與摘要', tasks: '待辦',
  documents: '準備單與文件', attachments: '照片、錄音與附件', sources: '私人來源', concerns: '持續關注', growth: '成長整理',
};
const stateLabels: Record<HandoverExportView['state'], string> = { queued: '已排隊', building: '正在整理', ready: '可下載', failed: '未能完成', cancelled: '已取消', expired: '已到期' };
const dateText = (value: string) => new Date(value).toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const reviewLabels: Record<HandoverPreviewItem['section'], string> = { documents: '文件', visit_preparation: '備診準備單',
  files: '檔案', photos: '照片', voices: '錄音', child_avatar: '孩子頭像' };
const reasonLabels: Record<HandoverPreviewItem['reason'], string> = { all: '全部期間', inside: '完全在指定日期內', crosses: '跨越指定日期',
  outside: '在指定日期之外', uncertain: '日期未能確定', metadata_only: '只有資料，沒有可讀原檔' };

/** One shared account-level entry; the controller owns requests, the Server owns contents and authority. */
export function HandoverControls() {
  const { owner, userId, identityKey, scopeKey, recordsState, account, online } = useProduction();
  const controller = owner.handoverOwner;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [open, setOpen] = useState(false), [purpose, setPurpose] = useState<HandoverExportCommand['purpose']>('handover');
  const [children, setChildren] = useState<string[]>([]), [modules, setModules] = useState<(typeof HANDOVER_MODULES)[number][]>([]);
  const [periodEnabled, setPeriodEnabled] = useState(false), [fromDay, setFromDay] = useState(''), [toDay, setToDay] = useState('');
  const canDownload = useFileExportAvailable();
  const current = !!identityKey && state.identityKey === identityKey && state.userId === userId && account.gate === 'ready';
  const locked = !current || !online || !!state.busy || account.deletion.phase !== 'idle';
  const selectable = recordsState.children.filter(child => child.accessRole === 'owner' || child.accessRole === undefined);
  useLayoutEffect(() => { setOpen(false); setChildren([]); setModules([]); setPeriodEnabled(false); setFromDay(''); setToDay(''); }, [identityKey]);
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
  const pending = state.pending;
  const chooseChild = (id: string, checked: boolean) => setChildren(before => checked ? [...before.filter(value => value !== id), id] : before.filter(value => value !== id));
  const chooseModule = (id: typeof HANDOVER_MODULES[number], checked: boolean) => setModules(before => checked ? [...before.filter(value => value !== id), id] : before.filter(value => value !== id));
  const from = DateTime.fromISO(fromDay, { zone: hongKongTimeZone }), to = DateTime.fromISO(toDay, { zone: hongKongTimeZone });
  const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(fromDay) && from.isValid, validTo = /^\d{4}-\d{2}-\d{2}$/.test(toDay) && to.isValid;
  const ordered = validFrom && validTo && from.toMillis() <= to.toMillis();
  const periodSupported = supportsHandoverPeriodModules(modules);
  const period = periodEnabled && ordered ? { from: from.startOf('day').toUTC().toISO()!, to: to.endOf('day').toUTC().toISO()! } : null;
  const selection = { childIds: children, modules, period };
  const validSelection = !!children.length && children.every(id => selectable.some(child => child.id === id)) && !!modules.length
    && (!periodEnabled || periodSupported && ordered);
  const needsReview = modules.includes('documents') || modules.includes('attachments');
  const reviewBasis = JSON.stringify([identityKey, scopeKey, selectable.map(child => [child.id, child.workspaceId, child.accessRole])]);
  const reviewKey = open && current && validSelection && needsReview ? JSON.stringify(selection) : null;
  useEffect(() => {
    controller.setReviewSelection(reviewKey ? selection : null, reviewBasis);
    if (reviewKey && online) void controller.loadReview();
    return () => controller.setReviewSelection(null);
  }, [controller, reviewKey, reviewBasis, online]);
  if (!current) return null;
  const review = needsReview && controller.reviewMatches(selection, reviewBasis) ? state.review : null;
  const canCreate = !locked && !pending && validSelection && (!needsReview || !!review && controller.reviewReady(selection));
  return <View style={styles.group}>
    <Text style={styles.title}>交接與備份資料包</Text>
    <Text style={styles.body}>選擇孩子及資料，以 ZIP 保存結構化內容、附件與閱讀摘要。檔案保留 24 小時，可稍後回來下載。</Text>
    <Text style={styles.body}>預設匯出全部期間；可指定開始及結束日期，並在建立前逐份選擇文件及附件。班級匯出及整個帳戶備份仍待接通。</Text>
    <AppButton label="選擇要匯出的資料" variant="secondary" disabled={locked || !!pending || !selectable.length}
      onPress={() => { setChildren([]); setModules([]); setPurpose('handover'); setPeriodEnabled(false); setFromDay(''); setToDay(''); setOpen(true); }} />
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
      {row.selection.period ? <Text style={styles.body}>指定日期（香港時間）：{DateTime.fromISO(row.selection.period.from).setZone(hongKongTimeZone).toISODate()} 至 {DateTime.fromISO(row.selection.period.to).setZone(hongKongTimeZone).toISODate()}</Text> : null}
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
    <HandoverImportControls />
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
        <AppCheckbox label="指定開始及結束日期" checked={periodEnabled} disabled={locked} onChange={setPeriodEnabled} />
        {periodEnabled ? <>
          <Text style={styles.body}>按香港時間（Asia/Hong_Kong），包含開始日零時至結束日最後一刻。</Text>
          <AppDateField label="開始日期" value={fromDay} disabled={locked} onChange={setFromDay} error={validFrom ? undefined : '請填寫有效的開始日期。'} />
          <AppDateField label="結束日期" value={toDay} disabled={locked} onChange={setToDay} error={!validTo ? '請填寫有效的結束日期。' : validFrom && !ordered ? '結束日期不可早於開始日期。' : undefined} />
          {!periodSupported ? <Text accessibilityLiveRegion="polite" style={styles.body}>所選模組未支援日期範圍；請只保留{HANDOVER_MODULES.filter(module => supportsHandoverPeriodModules([module])).map(module => moduleLabels[module]).join('、')}，或取消指定日期。</Text> : null}
        </> : null}
        {needsReview && validSelection ? <View style={styles.group}>
          <Text style={styles.title}>文件與附件清單</Text>
          <Text style={styles.body}>以下列出每位孩子可交接的文件及附件。勾選會交出整份可讀檔案，包含所示的完整日期範圍；跨期項目預設略過，可自行加入。</Text>
          <Text style={styles.body}>這些選擇只影響各份文件或附件，不改其他記錄、待辦或所選日期。未載入的後續頁仍按預設決定處理。</Text>
          {!review || review.groups.some(group => !group.loaded) ? <Text style={styles.body}>{state.reviewBusy
            ? '正在準備每位孩子的清單；首次讀取完成後才可建立資料包。'
            : '清單尚未讀取完成，請重新讀取後建立資料包。'}</Text> : null}
          {review?.groups.map(group => <View key={`${group.childId}:${group.section}`} style={styles.item}>
            <Text style={styles.title}>{selectable.find(child => child.id === group.childId)?.displayName ?? '孩子'} · {reviewLabels[group.section]}</Text>
            {group.loaded && !group.items.length ? <Text style={styles.body}>沒有可列出的項目。</Text> : null}
            {group.items.map(item => {
              const choice = review.choices.find(value => value.childId === item.childId && value.section === item.section && value.id === item.id);
              const included = choice?.include ?? item.defaultIncluded;
              return <View key={item.id} style={styles.group}>
                <AppCheckbox label={item.title || reviewLabels[item.section]} checked={included} disabled={locked || state.reviewBusy || !item.canInclude && !item.defaultIncluded}
                  onChange={include => controller.chooseReviewItem(item, include)} />
                <Text style={styles.body}>{included ? '會加入' : '會略過'} · {reasonLabels[item.reason]}</Text>
                <Text style={styles.body}>{item.reason === 'uncertain' ? '可確定的部分日期' : '涵蓋日期'}：{item.from ?? '未有開始日期'} 至 {item.to ?? '未有結束日期'}</Text>
                {included && !item.defaultIncluded ? <Text style={styles.body}>已明確選擇交出整份內容，包括指定日期以外的部分。</Text> : null}
              </View>;
            })}
            {group.nextCursor ? <AppButton label={`載入更多${reviewLabels[group.section]}`} variant="quiet" disabled={locked || state.reviewBusy}
              onPress={() => { void controller.loadReview(group.childId, group.section); }} /> : null}
          </View>)}
          {review?.error ? <Text accessibilityLiveRegion="polite" style={styles.body}>{review.error}</Text> : null}
          <AppButton label={state.reviewBusy ? '正在讀取清單' : '重新讀取清單'} variant="quiet" loading={state.reviewBusy} disabled={locked || state.reviewBusy}
            onPress={() => { controller.setReviewSelection(null); controller.setReviewSelection(selection, reviewBasis); void controller.loadReview(); }} />
        </View> : null}
        <AppButton label="建立資料包" loading={state.busy === 'write'} disabled={!canCreate}
          onPress={() => { if (!canCreate) return;
            if (needsReview) void controller.create(selection, purpose, controller.documentReview(selection));
            else void controller.create(selection, purpose);
            setOpen(false); }} />
      </View>
    </FormDialog>
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
