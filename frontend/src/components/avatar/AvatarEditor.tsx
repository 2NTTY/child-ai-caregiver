import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { avatarCropRect, defaultAvatarCrop } from '../../avatar-image';
import type { AvatarLane, AvatarSnapshot } from '../../production/AvatarOwner';
import { chineseFont, colors, readingType, spacing } from '../../theme';
import { AppButton } from '../ui';
import { FormDialog } from '../FormDialog';
import { StatusAnnouncement } from '../StatusAnnouncement';
import { AvatarPicker } from './AvatarPicker';
import { AvatarView } from './AvatarView';

export function AvatarEditor({ lane, state, name, kind }: { lane: AvatarLane; state: AvatarSnapshot; name: string; kind: 'self' | 'child' }) {
  const [openKey, setOpenKey] = useState<string | null>(null), [removeVersion, setRemoveVersion] = useState<number | null>(null);
  const open = !!state.key && openKey === state.key;
  const trigger = useRef<View>(null), [side, setSide] = useState(240);
  useEffect(() => { setOpenKey(null); setRemoveVersion(null); }, [state.key]);
  useEffect(() => { setRemoveVersion(null); }, [state.avatar?.version, state.avatar?.canManage, state.available]);
  const removeReview = removeVersion !== null && removeVersion === state.avatar?.version && !!state.avatar?.canManage && state.available;
  const locked = state.busy || state.unknown;
  const latest = useRef({ state, side }); latest.current = { state, side };
  const start = useRef({ crop: state.crop, distance: 0 });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!latest.current.state.selected && !latest.current.state.busy && !latest.current.state.unknown,
    onMoveShouldSetPanResponder: () => !!latest.current.state.selected && !latest.current.state.busy && !latest.current.state.unknown,
    onPanResponderGrant: event => { const touches = event.nativeEvent.touches; start.current = { crop: latest.current.state.crop,
      distance: touches.length === 2 ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0 }; },
    onPanResponderMove: (event, gesture) => {
      const { state: current, side: width } = latest.current, image = current.selected; if (!image) return;
      const crop = start.current.crop, rect = avatarCropRect(image.width, image.height, crop), touches = event.nativeEvent.touches;
      if (touches.length === 2 && start.current.distance > 0) {
        const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        lane.setCrop({ ...crop, zoom: crop.zoom * distance / start.current.distance });
      } else lane.setCrop({ ...crop, centerX: crop.centerX - gesture.dx * rect.size / width / image.width, centerY: crop.centerY - gesture.dy * rect.size / width / image.height });
    },
  }), [lane]);
  const selected = state.selected, rect = selected ? avatarCropRect(selected.width, selected.height, state.crop) : null;
  const shift = (x: number, y: number) => { if (selected && rect) lane.setCrop({ ...state.crop, centerX: state.crop.centerX + x * rect.size / selected.width, centerY: state.crop.centerY + y * rect.size / selected.height }); };
  const close = () => { if (!locked && lane.cancelSelection()) { setOpenKey(null); setRemoveVersion(null); } };
  return <>
    <AppButton ref={trigger} label={kind === 'self' ? '調整本人頭像' : '調整孩子頭像'} variant="quiet" density="compact" disabled={!state.key}
      onPress={() => { setOpenKey(state.key); setRemoveVersion(null); if (!state.available && !locked) void lane.load(); }} />
    {state.notice && !open ? <Text style={styles.note}>{state.notice}</Text> : null}
    <FormDialog visible={open && !!state.key} scopeKey={state.key ?? 'no-avatar'} title={kind === 'self' ? '本人頭像' : `${name}的頭像`} returnFocusRef={trigger} onClose={close}>
      <Text style={styles.note}>{kind === 'self' ? '只供本人查看，不會顯示為其他家庭成員的真人頭像。' : '只供目前有權查看這位孩子的成員使用。'}圖片不會加入聊天、照片或模型分析。</Text>
      <StatusAnnouncement eventKey={`${state.key}:${state.busy}:${state.unknown}:${state.notice}`} message={state.busy ? '正在核對頭像操作…' : state.notice ?? ''} urgent={state.unknown} />
      {state.loading ? <Text style={styles.note}>正在讀取頭像…</Text> : null}
      {selected && rect ? <>
        <View style={styles.crop} onLayout={event => setSide(event.nativeEvent.layout.width)} {...pan.panHandlers} accessibilityLabel="方形裁切預覽；可拖曳，亦可使用下方方向與縮放按鈕">
          <Image accessible={false} source={{ uri: selected.uri }} style={{ position: 'absolute', width: selected.width * side / rect.size,
            height: selected.height * side / rect.size, left: -rect.left * side / rect.size, top: -rect.top * side / rect.size }} />
        </View>
        <Text style={styles.note}>放大 {state.crop.zoom.toFixed(1)} 倍；預覽為方形，保存時由服務端裁切及移除圖片資訊。</Text>
        <View style={styles.actions}>
          <AppButton label="放大" accessibilityLabel="放大頭像裁切" variant="quiet" disabled={locked || state.crop.zoom >= (state.policy?.maxCropZoom ?? 1)} onPress={() => lane.setCrop({ ...state.crop, zoom: state.crop.zoom + .25 })} />
          <AppButton label="縮小" accessibilityLabel="縮小頭像裁切" variant="quiet" disabled={locked || state.crop.zoom <= 1} onPress={() => lane.setCrop({ ...state.crop, zoom: state.crop.zoom - .25 })} />
          <AppButton label="重設裁切" variant="quiet" disabled={locked} onPress={() => lane.setCrop({ ...defaultAvatarCrop })} />
        </View>
        <View style={styles.actions}>
          <AppButton label="向左" accessibilityLabel="裁切範圍向左" variant="quiet" disabled={locked} onPress={() => shift(-.1, 0)} />
          <AppButton label="向右" accessibilityLabel="裁切範圍向右" variant="quiet" disabled={locked} onPress={() => shift(.1, 0)} />
          <AppButton label="向上" accessibilityLabel="裁切範圍向上" variant="quiet" disabled={locked} onPress={() => shift(0, -.1)} />
          <AppButton label="向下" accessibilityLabel="裁切範圍向下" variant="quiet" disabled={locked} onPress={() => shift(0, .1)} />
        </View>
      </> : <AvatarView name={name} uri={state.uri} size={88} />}
      {state.notice ? <Text style={styles.note}>{state.notice}</Text> : null}
      {!state.available && !locked ? <AppButton label="重新連接頭像服務" variant="secondary" disabled={!state.online || state.loading} onPress={() => { void lane.load(); }} /> : null}
      {state.available && !state.avatar?.canManage ? <Text style={styles.note}>目前只可查看頭像，沒有修改權限。</Text> : null}
      <View style={styles.actions}>
        <AvatarPicker lane={lane} state={state} />
        {selected ? <><AppButton label="保存頭像" disabled={locked || state.conflict || !state.online || !state.available || !state.avatar?.canManage} loading={state.busy} onPress={() => { setRemoveVersion(null); void lane.save(); }} />
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
  crop: { width: '100%', maxWidth: 280, aspectRatio: 1, overflow: 'hidden', backgroundColor: colors.white, alignSelf: 'center', borderWidth: 1, borderColor: colors.line },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, confirm: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.paleAmber } });
