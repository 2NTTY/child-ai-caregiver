import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
import { chineseFont, colors, spacing } from "../../theme";
import { AppButton } from "../ui";
import { LocalAudioPreview } from "./LocalAudioPreview";
import { createLocalVoiceCapture, type VoiceCaptureState } from "./local-voice-capture";

export function VoiceCapture({ onPick }: { onPick(attachment: AssistantAttachment): void }) {
  const [state, setState] = useState<VoiceCaptureState>("idle"), [error, setError] = useState<string>();
  const [recording, setRecording] = useState<AssistantAttachment | null>(null);
  const current = useRef<AssistantAttachment | null>(null), active = useRef(true);
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
  function discard() {
    controller.cancel(); current.current?.dispose?.(); current.current = null; setRecording(null); setState("idle"); setError(undefined);
  }
  useEffect(() => {
    active.current = true;
    const hidden = () => { if (document.hidden) discard(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { active.current = false; controller.cancel(); current.current?.dispose?.(); current.current = null; document.removeEventListener("visibilitychange", hidden); };
  }, [controller]);
  const available = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia && globalThis.isSecureContext;
  const busy = state === "permission" || state === "recording" || state === "stopping";
  return <View testID="voice-capture" style={styles.stack}>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{state === "permission" ? "等待你允許咪高峰…可隨時取消" : state === "recording" ? "正在本機錄音，尚未送出" : state === "stopping" ? "正在完成本地錄音…" : recording ? "先試聽，再決定是否加入草稿" : "按「開始錄音」才會要求咪高峰權限"}</Text>
    {!available ? <Text style={styles.note}>這個瀏覽器不支援本地錄音或缺少安全連線，可改選已錄音訊。</Text> : null}
    {recording?.localUri ? <LocalAudioPreview uri={recording.localUri} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <View style={styles.actions}>{state === "recording" ? <AppButton label="停止並試聽" onPress={() => controller.stop()} /> :
      !recording ? <AppButton label="開始錄音" disabled={!available || busy} onPress={() => { setError(undefined); void controller.start(); }} /> :
      <AppButton label="加入未送出草稿" onPress={() => { const attachment = current.current; if (!attachment) return; current.current = null; setRecording(null); onPick(attachment); }} />}
      {busy || recording ? <AppButton label={recording ? "捨棄錄音" : "取消錄音"} variant="quiet" onPress={discard} /> : null}
    </View><Text style={styles.note}>每段最多兩分鐘／5 MiB。錄音及試聽只在本機；按聊天的送出才會上傳。</Text>
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: spacing.sm }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: 14, lineHeight: 22 }, note: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18 }, error: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 14, lineHeight: 22 } });
