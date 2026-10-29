import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { AvatarLane, AvatarSnapshot } from '../../production/AvatarOwner';
import { chineseFont, colors, readingType, spacing } from '../../theme';
import { AppButton } from '../ui';
import { FormDialog } from '../FormDialog';
import { StatusAnnouncement } from '../StatusAnnouncement';
import { AvatarPicker } from './AvatarPicker';
import { AvatarView } from './AvatarView';
import { AvatarCropPreview } from './AvatarCropPreview';

export function AvatarEditor({ lane, state, name, kind }: { lane: AvatarLane; state: AvatarSnapshot; name: string; kind: 'self' | 'child' }) {
  const [openKey, setOpenKey] = useState<string | null>(null), [removeVersion, setRemoveVersion] = useState<number | null>(null);
  const open = !!state.key && openKey === state.key;
  const trigger = useRef<View>(null);
  useEffect(() => { setOpenKey(null); setRemoveVersion(null); }, [state.key]);
  useEffect(() => { setRemoveVersion(null); }, [state.avatar?.version, state.avatar?.canManage, state.available]);
  const removeReview = removeVersion !== null && removeVersion === state.avatar?.version && !!state.avatar?.canManage && state.available;
  const locked = state.busy || state.unknown;
  const selected = state.selected;
  const previewKey = selected ? `${state.key}:${selected.uri}` : null;
  const [readyPreview, setReadyPreview] = useState<string | null>(null);
  const onPreviewReady = useCallback((ready: boolean) => {
    setReadyPreview(current => ready ? previewKey : current === previewKey ? null : current);
  }, [previewKey]);
  const previewReady = Platform.OS !== 'web' || !!previewKey && readyPreview === previewKey;
  const close = () => { if (!locked && lane.cancelSelection()) { setOpenKey(null); setRemoveVersion(null); } };
  return <>
    <AppButton ref={trigger} label={kind === 'self' ? '調整本人頭像' : '調整孩子頭像'} variant="quiet" density="compact" disabled={!state.key}
      onPress={() => { setOpenKey(state.key); setRemoveVersion(null); if (!state.available && !locked) void lane.load(); }} />
    {state.notice && !open ? <Text style={styles.note}>{state.notice}</Text> : null}
    <FormDialog visible={open && !!state.key} scopeKey={state.key ?? 'no-avatar'} title={kind === 'self' ? '本人頭像' : `${name}的頭像`} returnFocusRef={trigger} onClose={close}>
      <Text style={styles.note}>{kind === 'self' ? '只供本人查看，不會顯示為其他家庭成員的真人頭像。' : '只供目前有權查看這位孩子的成員使用。'}圖片不會加入聊天、照片或模型分析。</Text>
      <StatusAnnouncement eventKey={`${state.key}:${state.busy}:${state.unknown}:${state.notice}`} message={state.busy ? '正在核對頭像操作…' : state.notice ?? ''} urgent={state.unknown} />
      {state.loading ? <Text style={styles.note}>正在讀取頭像…</Text> : null}
      {selected ? <AvatarCropPreview key={selected.uri} image={selected} crop={state.crop} maxZoom={state.policy?.maxCropZoom ?? 1}
        locked={locked} onReady={onPreviewReady} onChange={crop => lane.setCrop(crop)} /> : <AvatarView name={name} uri={state.uri} size={88} />}
      {state.notice ? <Text style={styles.note}>{state.notice}</Text> : null}
      {!state.available && !locked ? <AppButton label="重新連接頭像服務" variant="secondary" disabled={!state.online || state.loading} onPress={() => { void lane.load(); }} /> : null}
      {state.available && !state.avatar?.canManage ? <Text style={styles.note}>目前只可查看頭像，沒有修改權限。</Text> : null}
      <View style={styles.actions}>
        <AvatarPicker lane={lane} state={state} />
        {selected ? <><AppButton label="保存頭像" disabled={!previewReady || locked || state.conflict || !state.online || !state.available || !state.avatar?.canManage} loading={state.busy} onPress={() => { setRemoveVersion(null); void lane.save(); }} />
          <AppButton label="取消選圖" variant="quiet" disabled={locked} onPress={() => lane.cancelSelection()} /></> : null}
        {state.avatar?.asset && state.avatar.canManage && !selected ? <AppButton label="移除頭像" variant="danger-secondary" disabled={locked || !state.online || !state.available} onPress={() => setRemoveVersion(state.avatar!.version)} /> : null}
      </View>
      {removeReview ? <View style={styles.confirm}><Text style={styles.note}>移除後會顯示名字首字。確定移除{name || '目前對象'}的頭像？</Text><View style={styles.actions}>
        <AppButton label="確認移除頭像" variant="danger" disabled={locked || !state.online || !state.available} onPress={() => { setRemoveVersion(null); if (removeVersion !== null) void lane.remove(removeVersion); }} />
        <AppButton label="保留頭像" variant="quiet" disabled={locked} onPress={() => setRemoveVersion(null)} /></View></View> : null}
      {state.conflict && !locked ? <AppButton label="讀取現況並重新核對選圖" disabled={!state.online || state.loading} onPress={() => { void lane.acceptCurrentBasis(); }} /> : null}
      {state.unknown ? <View style={styles.actions}><AppButton label="查核原頭像操作" disabled={state.busy || !state.online} onPress={() => { void lane.check(); }} />
        {state.retryAvailable ? <AppButton label="繼續同一原操作" variant="secondary" disabled={state.busy || !state.online} onPress={() => { void lane.retry(); }} /> : null}</View> : null}
      {locked ? <Text style={styles.note}>原操作未確認前，請先查核結果；暫時不能取消、切換或另行保存。</Text> : null}
      {state.policy ? <Text style={styles.note}>JPG／PNG · 最多 {Math.floor(state.policy.maxInputBytes / 1024 / 1024)} MiB。只在按下保存後上傳。</Text> : null}
      <AppButton label="取消並關閉" variant="quiet" disabled={locked} onPress={close} />
    </FormDialog>
  </>;
}
const styles = StyleSheet.create({ note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, confirm: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.paleAmber } });
