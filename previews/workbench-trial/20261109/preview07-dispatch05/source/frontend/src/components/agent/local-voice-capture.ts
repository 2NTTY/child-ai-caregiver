import type { AssistantAttachment } from "../../assistant-draft.ts";
import { VOICE_LIMITS } from "../../../../src/shared/voice.ts";
import { voiceFromBlob } from "./voice-attachment.ts";

export type VoiceCaptureState = "idle" | "permission" | "recording" | "stopping" | "ready" | "error";
export type VoiceCapturePorts = {
  requestStream(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): MediaRecorder;
  createUrl(blob: Blob): string; revokeUrl(uri: string): void;
};
export const localVoiceLimitBytes = VOICE_LIMITS.bytes;
export function createLocalVoiceCapture(ports: VoiceCapturePorts, onState: (state: VoiceCaptureState, error?: string) => void,
  onReady: (attachment: AssistantAttachment) => void) {
  let generation = 0, stream: MediaStream | null = null, recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [], bytes = 0, requestedStop = false;
  let limitTimer: ReturnType<typeof setTimeout> | null = null;
  const stopTracks = (value: MediaStream | null) => value?.getTracks().forEach(track => track.stop());
  function release() {
    if (limitTimer) clearTimeout(limitTimer); limitTimer = null;
    const current = recorder; recorder = null;
    if (current) {
      current.ondataavailable = null; current.onstop = null; current.onerror = null;
      if (current.state !== "inactive") { try { current.stop(); } catch { /* Tracks are still released below. */ } }
    }
    stopTracks(stream); stream = null; chunks = []; bytes = 0; requestedStop = false;
  }
  function cancel() { generation++; release(); }
  function fail(message: string) { cancel(); onState("error", message); }
  return {
    async start() {
      cancel(); const started = generation; onState("permission");
      try {
        const nextStream = await ports.requestStream();
        if (generation !== started) { stopTracks(nextStream); return; }
        stream = nextStream;
        const current = ports.createRecorder(nextStream); recorder = current;
        current.ondataavailable = event => {
          if (generation !== started || recorder !== current || event.data.size === 0) return;
          bytes += event.data.size;
          if (bytes > localVoiceLimitBytes) { fail("錄音超過 5 MiB 限制，已停止並清除；請重新錄製較短片段。"); return; }
          chunks.push(event.data);
        };
        current.onerror = () => { if (generation === started) fail("錄音遇到錯誤，已停止咪高峰並清除片段；原有草稿保留。"); };
        current.onstop = () => {
          if (generation !== started || recorder !== current) return;
          if (!requestedStop) { fail("咪高峰或錄音已中斷，片段未加入草稿。可重新錄製或選取音訊檔。"); return; }
          // The final dataavailable event is delivered before stop. Build the Blob only here.
          const mimeType = current.mimeType || chunks.find(part => part.type)?.type || "application/octet-stream";
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) { fail("未收到可預覽的錄音資料；請重新錄製或選取音訊檔。"); return; }
          release();
          const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "audio";
          try {
            const attachment = voiceFromBlob(blob, `錄音-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, ports.createUrl, ports.revokeUrl);
            onState("ready"); onReady(attachment);
          } catch { onState("error", "未能建立受支援的錄音預覽；原有草稿保留，請重新錄製。"); }
        };
        current.start(1000); onState("recording");
        limitTimer = setTimeout(() => {
          if (generation !== started || recorder !== current || requestedStop) return;
          requestedStop = true; onState("stopping", "已達兩分鐘，正在停止錄音；請試聽後再送出。");
          try { current.stop(); stopTracks(stream); stream = null; } catch { fail("未能完成錄音，請重新錄製。"); }
        }, VOICE_LIMITS.durationMs - 250);
      } catch (cause) {
        if (generation !== started) return;
        const name = cause instanceof Error ? cause.name : "";
        fail(name === "NotAllowedError" ? "未獲咪高峰權限。可在瀏覽器允許，或改選已錄音訊；原有草稿保留。" :
          name === "NotFoundError" ? "未找到可用咪高峰，可改選已錄音訊。" : "目前無法開始錄音。可稍後再試或改選已錄音訊。");
      }
    },
    stop() {
      if (!recorder || recorder.state === "inactive" || requestedStop) return;
      requestedStop = true; onState("stopping");
      try { recorder.stop(); stopTracks(stream); stream = null; }
      catch { fail("未能完成錄音，咪高峰已停止，片段未加入草稿。"); }
    },
    cancel,
  };
}
