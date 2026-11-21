import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import { VOICE_LIMITS } from "../../../../src/shared/voice";
import type { AssistantAttachment } from "../../assistant-draft";
import { chineseFont, colors, spacing } from "../../theme";
import { AppButton } from "../ui";
import { LocalAudioPreview } from "./LocalAudioPreview";
import { copyNativeVoice } from "./native-voice-file";
import { AssistantAttachmentPicker } from "./AssistantAttachmentPicker";
import { CompanionVoiceControls } from "./CompanionVoiceControls";
import { VoiceRecordingTimer, type VoiceCaptureHandle } from "./VoiceRecordingTimer";

const options = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, maxFileSize: VOICE_LIMITS.bytes } };
export function VoiceCapture({ onPick, visible, onDismiss, onListening, ref, sendRecording = false, confirmDisabled = false }: { onPick(attachment: AssistantAttachment): void; visible: boolean; onListening?(active: boolean): void; onDismiss(): void; sendRecording?: boolean; confirmDisabled?: boolean; ref?: Ref<VoiceCaptureHandle> }) {
  const recorder = useAudioRecorder(options);
  const [state, setState] = useState<"idle" | "permission" | "recording" | "stopping" | "ready">("idle");
  const [error, setError] = useState<string>(), [recording, setRecording] = useState<AssistantAttachment | null>(null);
  const active = useRef(true), generation = useRef(0), busy = useRef(false), preparing = useRef(false), permissionWaiting = useRef(false), engaged = useRef(false);
  const current = useRef<AssistantAttachment | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const removeRecordedFile = () => { if (recorder.uri) { const file = new File(recorder.uri); if (file.exists) file.delete(); } };
  async function finish(keep: boolean, started: number) {
    if (busy.current) return;
    busy.current = true; clearTimer();
    if (active.current) setState("stopping");
    try {
      await recorder.stop();
      if (!keep || generation.current !== started || !active.current) return;
      if (!recorder.uri) throw new Error("recording_missing");
      const item = await copyNativeVoice(new File(recorder.uri), "audio/mp4", `錄音-${new Date().toISOString().replace(/[:.]/g, "-")}.m4a`);
      if (generation.current !== started || !active.current) { item.dispose?.(); return; }
      current.current?.dispose?.(); current.current = item; setRecording(item);
    } catch {
      if (active.current && generation.current === started && keep) setError("錄音未能完成；請重新錄製或改選已有音訊。");
    } finally {
      try { removeRecordedFile(); } catch { /* Only our recorder's cache file; OS may already have removed it. */ }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false }).catch(() => undefined);
      busy.current = false;
      if (active.current) setState(current.current ? "ready" : "idle");
    }
  }
  function discard(close = true, transferred?: AssistantAttachment) {
    if (!engaged.current && !preparing.current && !busy.current && !current.current) { if (close && active.current) onDismiss(); return; }
    const completed = !!current.current;
    generation.current++; clearTimer(); if (current.current !== transferred) current.current?.dispose?.(); current.current = null;
    engaged.current = false;
    if (active.current) { setRecording(null); setError(undefined); if (close) onDismiss(); }
    if (!preparing.current && !busy.current) {
      if (completed) { if (active.current) setState("idle"); }
      else void finish(false, generation.current);
    }
  }
  useEffect(() => {
    active.current = true;
    const subscription = AppState.addEventListener("change", value => { if (value !== "active" && !permissionWaiting.current && engaged.current) discard(false); });
    return () => { active.current = false; discard(); subscription.remove(); };
  }, [recorder]);
  async function start() {
    if (busy.current || preparing.current || state === "recording") return;
    engaged.current = true;
    const started = ++generation.current; preparing.current = true; setState("permission"); setError(undefined);
    try {
      permissionWaiting.current = true;
      const permission = await requestRecordingPermissionsAsync(); permissionWaiting.current = false;
      if (!active.current || started !== generation.current) return;
      if (AppState.currentState !== "active") return;
      if (!permission.granted) { setError("未獲咪高峰權限。你仍可選取已有音訊或使用文字。"); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false, interruptionMode: "doNotMix" });
      if (!active.current || started !== generation.current) return;
      await recorder.prepareToRecordAsync();
      if (!active.current || started !== generation.current) { await recorder.stop().catch(() => undefined); removeRecordedFile(); return; }
      recorder.record({ forDuration: VOICE_LIMITS.durationMs / 1000 }); setState("recording");
      // Stop slightly before the bound to allow encoder finalisation without truncating an uploaded file.
      timer.current = setTimeout(() => { if (started === generation.current) void finish(true, started); }, VOICE_LIMITS.durationMs - 250);
    } catch { if (active.current && started === generation.current) setError("無法開始錄音。請核對咪高峰權限或改用文字。"); }
    finally {
      preparing.current = false; permissionWaiting.current = false;
      if (!timer.current) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false }).catch(() => undefined);
        if (active.current) setState("idle");
      }
    }
  }
  useImperativeHandle(ref, () => ({ cancel: () => discard(false), start() {
    if (!active.current || engaged.current) return;
    engaged.current = true; void start();
  } }));
  function pick(attachment: AssistantAttachment) {
    discard(true, attachment); onPick(attachment);
  }
  useEffect(() => {
    if (visible && state === 'recording') {
      onListening?.(true);
      return () => onListening?.(false);
    }
  }, [visible, state, onListening]);
  if (!visible) return null;
  if (sendRecording) return <CompanionVoiceControls state={state} uri={recording?.localUri} error={error} confirmDisabled={confirmDisabled}
    start={() => void start()} stop={() => void finish(true, generation.current)} cancel={() => discard()}
    confirm={() => { if (current.current) pick(current.current); }} />;
  return <View testID="voice-capture" style={styles.stack}>
    {state === "permission" || state === "stopping" ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state === "permission" ? "等候咪高峰權限…" : "正在準備錄音…"}</Text> : null}
    {state === "recording" ? <VoiceRecordingTimer /> : null}
    {recording?.localUri ? <LocalAudioPreview uri={recording.localUri} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <View style={styles.actions}>{state === "recording" ? <AppButton label="停止並試聽" onPress={() => { void finish(true, generation.current); }} /> :
      recording ? <AppButton label="使用錄音" disabled={state !== "ready"} onPress={() => { const item = current.current; if (item) pick(item); }} /> :
      <AppButton label="開始錄音" disabled={state !== "idle"} onPress={() => { void start(); }} />}
      <AppButton label={recording ? "捨棄錄音" : "取消錄音"} variant="quiet" onPress={() => discard()} />
    </View>{!recording && state === "idle" ? <AssistantAttachmentPicker kind="voice" disabled={false} onPick={pick} onError={setError} /> : null}
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: spacing.sm }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: 14, lineHeight: 22 }, note: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18 }, error: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 14, lineHeight: 22 } });
