import { localAttachmentId, type AssistantAttachment } from "../../assistant-draft.ts";

export type VoiceCaptureState = "idle" | "permission" | "recording" | "stopping" | "ready" | "error";
export type VoiceCapturePorts = {
  requestStream(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): MediaRecorder;
  createUrl(blob: Blob): string; revokeUrl(uri: string): void;
};
// Frontend-only resource guard, not a supported server upload limit.
export const localVoiceLimitBytes = 20 * 1024 * 1024;
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
          if (bytes > localVoiceLimitBytes) { fail("錄音超過本地 20 MiB 預覽限制，已停止並清除；請重新錄製較短片段。"); return; }
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
          let uri: string;
          try { uri = ports.createUrl(blob); } catch { onState("error", "未能建立本地錄音預覽；原有草稿保留，請重新錄製。"); return; }
          const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "audio";
          onState("ready");
          onReady({ id: localAttachmentId(), kind: "voice", fileName: `錄音-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
            mimeType, bytes: blob.size, localUri: uri, dispose: () => ports.revokeUrl(uri) });
        };
        current.start(1000); onState("recording");
        limitTimer = setTimeout(() => { if (generation === started) fail("已達本地 5 分鐘錄音限制，咪高峰已停止，片段已清除。請分段錄製。"); }, 5 * 60 * 1000);
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
