import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
import { chineseFont, colors, spacing } from "../../theme";
import { AppButton } from "../ui";
import { LocalAudioPreview } from "./LocalAudioPreview";
import { createLocalVoiceCapture, type VoiceCaptureState } from "./local-voice-capture";
import { AssistantAttachmentPicker } from "./AssistantAttachmentPicker";
import { CompanionVoiceControls } from "./CompanionVoiceControls";
import { VoiceRecordingTimer, type VoiceCaptureHandle } from "./VoiceRecordingTimer";

export function VoiceCapture({ onPick, visible, onDismiss, ref, sendRecording = false, confirmDisabled = false }: { onPick(attachment: AssistantAttachment): void; visible: boolean; onDismiss(): void; sendRecording?: boolean; confirmDisabled?: boolean; ref?: Ref<VoiceCaptureHandle> }) {
  const [state, setState] = useState<VoiceCaptureState>("idle"), [error, setError] = useState<string>();
  const [recording, setRecording] = useState<AssistantAttachment | null>(null);
  const current = useRef<AssistantAttachment | null>(null), active = useRef(true), engaged = useRef(false);
  const controller = useRef(createLocalVoiceCapture({
    requestStream: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
    createRecorder: stream => {
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("unsupported_recording_format");
      return new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
    },
    createUrl: blob => URL.createObjectURL(blob), revokeUrl: uri => URL.revokeObjectURL(uri),
  }, (nextState, message) => { if (active.current) { setState(nextState); setError(message); } }, attachment => {
    if (!active.current) { attachment.dispose?.(); return; }
    current.current?.dispose?.(); current.current = attachment; setRecording(attachment);
  })).current;
  function discard(close = true) {
    controller.cancel(); current.current?.dispose?.(); current.current = null; setRecording(null); setState("idle"); setError(undefined);
    engaged.current = false; if (close) onDismiss();
  }
  useEffect(() => {
    active.current = true;
    const hidden = () => { if (document.hidden && engaged.current) discard(false); };
    document.addEventListener("visibilitychange", hidden);
    return () => { active.current = false; controller.cancel(); current.current?.dispose?.(); current.current = null; document.removeEventListener("visibilitychange", hidden); };
  }, [controller]);
  const available = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia && globalThis.isSecureContext;
  const busy = state === "permission" || state === "recording" || state === "stopping";
  function start() { engaged.current = true; setError(undefined); void controller.start(); }
  useImperativeHandle(ref, () => ({ cancel: () => discard(false), start() {
    if (!active.current || engaged.current) return;
    engaged.current = true;
    if (available) start();
  } }), [controller, available]);
  function pick(attachment: AssistantAttachment) {
    if (current.current === attachment) current.current = null;
    discard(); onPick(attachment);
  }
  if (!visible) return null;
  if (sendRecording) return <CompanionVoiceControls state={state} uri={recording?.localUri} error={error} available={available} confirmDisabled={confirmDisabled}
    start={start} stop={() => controller.stop()} cancel={() => discard()} confirm={() => { if (current.current) pick(current.current); }} />;
  return <View testID="voice-capture" style={styles.stack}>
    {state === "permission" || state === "stopping" ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state === "permission" ? "等候咪高峰權限…" : "正在準備錄音…"}</Text> : null}
    {state === "recording" ? <VoiceRecordingTimer /> : null}
    {!available ? <Text style={styles.note}>這個瀏覽器不支援本地錄音或缺少安全連線，可改選已錄音訊。</Text> : null}
    {recording?.localUri ? <LocalAudioPreview uri={recording.localUri} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <View style={styles.actions}>{state === "recording" ? <AppButton label="停止並試聽" onPress={() => controller.stop()} /> :
      !recording ? <AppButton label="開始錄音" disabled={!available || busy} onPress={start} /> :
      <AppButton label="使用錄音" onPress={() => { const attachment = current.current; if (attachment) pick(attachment); }} />}
      <AppButton label={recording ? "捨棄錄音" : "取消錄音"} variant="quiet" onPress={() => discard()} />
    </View>{!recording && state === "idle" ? <AssistantAttachmentPicker kind="voice" disabled={busy} onPick={pick} onError={setError} /> : null}
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: spacing.sm }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: 14, lineHeight: 22 }, note: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18 }, error: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 14, lineHeight: 22 } });
