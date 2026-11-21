import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Headphones from 'lucide-react-native/icons/headphones';
import { colors } from '../../theme';
import { AppIcon } from '../AppIcon';
import { LocalAudioPreview } from './LocalAudioPreview';
import type { VoiceCaptureState } from './local-voice-capture';
import { VoiceRecordingTimer } from './VoiceRecordingTimer';

const fromStart = { seconds: 0, request: 1 };

export function CompanionVoiceControls({ state, uri, error, available = true, confirmDisabled, stop, start, cancel, confirm }: {
  state: VoiceCaptureState; uri?: string; error?: string; available?: boolean; confirmDisabled: boolean;
  stop(): void; start(): void; cancel(): void; confirm(): void;
}) {
  const sendOnStop = useRef(false), [previewRequested, setPreviewRequested] = useState(false);
  const ready = state === 'ready' && !!uri, live = state === 'recording';
  useEffect(() => {
    if (state === 'idle' || state === 'error') sendOnStop.current = false;
    if (!ready || !sendOnStop.current) return;
    sendOnStop.current = false;
    if (!confirmDisabled) confirm();
  }, [ready, state, confirmDisabled, confirm]);
  const canSend = (live || ready) && !confirmDisabled;
  function send() {
    if (!canSend || sendOnStop.current) return;
    if (ready) { confirm(); return; }
    sendOnStop.current = true; stop();
  }
  return <View testID="voice-capture">
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <View style={s.row}>
      <View style={s.leading}>{live ? <VoiceRecordingTimer compact /> : ready && uri ?
        <LocalAudioPreview uri={uri} compact seek={previewRequested ? fromStart : undefined} /> :
        <Text accessibilityLiveRegion="polite" style={s.caption}>{state === 'permission' ? '等候咪高峰權限…' : state === 'stopping' ? '正在處理…' : available ? '尚未錄音' : '咪高峰未能使用'}</Text>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={ready ? '捨棄錄音' : '取消錄音'} style={s.action}
        onPress={() => { sendOnStop.current = false; cancel(); }}><AppIcon name="delete-outline" size={18} /></Pressable>
      {live && <Pressable accessibilityRole="button" accessibilityLabel="停止並試聽" style={s.action}
        onPress={() => { if (!sendOnStop.current) { setPreviewRequested(true); stop(); } }}><Headphones size={19} color={colors.ink} /></Pressable>}
      {available && (state === 'idle' || state === 'error') && <Pressable accessibilityRole="button" accessibilityLabel="重新錄音"
        style={s.action} onPress={() => { setPreviewRequested(false); start(); }}><AppIcon name="microphone-outline" size={19} /></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="送出語音" disabled={!canSend} accessibilityState={{ disabled: !canSend }}
        onPress={send} style={[s.action, !canSend && s.disabled]}><View style={s.send}><AppIcon name="send" size={16} color={colors.white} /></View></Pressable>
    </View>
  </View>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' }, leading: { flex: 1, minWidth: 0 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: .35 }, caption: { color: colors.muted, fontSize: 12 }, error: { color: colors.warningInk, fontSize: 13 },
});
