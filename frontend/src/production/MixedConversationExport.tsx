import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { MixedChatRoom } from '../../../src/shared/mixed-chat';
import { AppButton, AppSelect } from '../components/ui';
import { AppCheckbox } from '../components/AppCheckbox';
import { usePreviewNavigation } from '../preview/PreviewNavigationGuard';
import { exportPackage, useFileExportAvailable } from '../platform/file-export';
import { colors, readingType, spacing } from '../theme';
import { useProduction } from './ProductionProvider';
import { MotionDisclosure } from '../motion';

const states = { queued: '等候建立', building: '建立中', ready: '可下載', cancelled: '已取消', failed: '建立未完成', expired: '已過期' };
const sameIds = (first: readonly string[], second: readonly string[]) => JSON.stringify([...first].sort()) === JSON.stringify([...second].sort());

/** The existing account package owner keeps the original operation and download authority. */
export function MixedConversationExport({ room, children, contextKey, disabled }: {
  room: MixedChatRoom; children: { id: string; name: string }[]; contextKey: string | null; disabled: boolean;
}) {
  const { owner, userId, identityKey, account, online } = useProduction(), controller = owner.handoverOwner;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const router = useRouter(), leave = usePreviewNavigation(), canDownload = useFileExportAvailable();
  const current = !!identityKey && state.identityKey === identityKey && state.userId === userId && account.gate === 'ready';
  const names = room.childIds.map(id => ({ id, name: children.find(child => child.id === id)?.name }));
  const completeNames = names.every(child => !!child.name);
  const key = JSON.stringify([identityKey, contextKey, room.id, room.version, names]);
  const live = useRef({ key, current }); live.current = { key, current };
  useLayoutEffect(() => {
    live.current.current = current;
    return () => { if (live.current.key === key) live.current.current = false; };
  }, [key, current]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const open = expandedKey === key;
  const [choice, setChoice] = useState<{ key: string; selected: boolean; purpose: 'handover' | 'backup' }>({ key: '', selected: false, purpose: 'handover' });
  const selected = choice.key === key && choice.selected;
  const purpose = room.scope.kind === 'class' || choice.key !== key ? 'handover' : choice.purpose;
  const locked = !current || !online || disabled || !!state.busy || !!state.pending;
  useEffect(() => { if (open && current && online) void controller.readExportCapabilities(); }, [controller, open, current, identityKey, online]);
  if (!current) return null;
  const row = state.items.find(item => item.purpose === purpose && item.selection.modules.length === 0 && item.selection.period === null
    && sameIds(item.selection.childIds, room.childIds) && item.selection.mixedRooms?.length === 1
    && item.selection.mixedRooms[0].id === room.id && item.selection.mixedRooms[0].version === room.version
    && sameIds(item.selection.mixedRooms[0].childIds, room.childIds) && !['cancelled', 'expired'].includes(item.state));
  return <View style={styles.group} testID="mixed-conversation-export">
    <AppButton label={state.pending ? '保存完整私人對話（有資料包請求待查）' : '保存這段完整私人對話'} variant="quiet" expanded={open}
      onPress={() => setExpandedKey(open ? null : key)} />
    <MotionDisclosure expanded={open} scopeKey={key}><View style={styles.group}>
    {state.mixedConversations ? <>
      <Text style={styles.body}>將包含這段完整對話的原留言及已保存回覆，並保留涉及的所有孩子；不會自動發送資料包。</Text>
      <Text selectable style={styles.body}>對話：{room.id} · 版本 {room.version} · {room.version - 1} 則原留言</Text>
      {names.map(child => <Text key={child.id} selectable style={styles.body}>{child.name ?? '孩子姓名尚未載入'} · {child.id}</Text>)}
      {!completeNames ? <Text style={styles.body}>請先載入這段對話所有孩子的名冊資料，核對全部姓名後再匯出。</Text> : null}
      {room.scope.kind === 'personal' ? <AppSelect label="這段對話的資料包用途" value={purpose}
        options={[{ value: 'handover', label: '交接包（只含此對話）' }, { value: 'backup', label: '本人備份（只含此對話）' }]} disabled={locked}
        onChange={value => { if (value === 'handover' || value === 'backup') setChoice({ key, selected: false, purpose: value }); }} />
        : <Text style={styles.body}>班級對話會建立由你本人持有的私人交接包。</Text>}
      <AppCheckbox label="我已核對這段完整對話及上述所有孩子，選擇加入資料包" checked={selected} disabled={locked || !completeNames}
        onChange={checked => setChoice({ key, selected: checked, purpose })} />
      <AppButton label={purpose === 'backup' ? '建立這段對話的本人備份' : '建立這段對話的交接包'} disabled={locked || !selected || !completeNames || !!row}
        onPress={() => {
          const selection = { childIds: [...room.childIds], modules: [], period: null,
            mixedRooms: [{ id: room.id, version: room.version, childIds: [...room.childIds] }] };
          if (room.scope.kind === 'class') void controller.createClass(selection, room.scope.spaceId);
          else void controller.create(selection, purpose);
        }} />
    </> : <>
      <Text style={styles.body}>此服務尚未確認支援完整混合對話資料包。</Text>
      <AppButton label="重新確認對話匯出支援" variant="quiet" disabled={locked} onPress={() => { void controller.readExportCapabilities(); }} />
    </>}
    {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
    {state.pending ? <View style={styles.group}>
      <Text style={styles.body}>原資料包請求仍待核對，請查回原請求，不要另外建立。</Text>
      <AppButton label="查回原資料包請求" variant="secondary" disabled={!online || !!state.busy} onPress={() => { void controller.checkOriginal(); }} />
      {state.pending.checked ? <AppButton label="以原編號接續資料包請求" variant="secondary" disabled={!online || !!state.busy}
        onPress={() => { void controller.retryOriginal(); }} /> : null}
    </View> : null}
    {row ? <View style={styles.group}>
      <Text accessibilityLiveRegion="polite" style={styles.body}>原資料包：{states[row.state]}</Text>
      <Text selectable style={styles.body}>{row.id}</Text>
      <AppButton label="查回這份資料包狀態" variant="quiet" disabled={!online || !!state.busy}
        onPress={() => { void controller.refresh(row.id); }} />
      {row.state === 'ready' ? <AppButton label="下載這份私人資料包" variant="secondary" disabled={locked || !canDownload}
        onPress={() => { void controller.download(row.id, (response, filename, bytes, currentDownload) =>
          exportPackage(response, filename, bytes, () => currentDownload() && live.current.current && live.current.key === key)); }} /> : null}
    </View> : null}
    <AppButton label="到原資料包中心查回及下載" variant="quiet" onPress={() => leave(() => router.push('/settings?section=privacy'), 'workspace')} />
    </View></MotionDisclosure>
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, body: { color: colors.ink, ...readingType.tool } });
