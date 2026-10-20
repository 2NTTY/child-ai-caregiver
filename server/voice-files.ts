import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { VOICE_LIMITS, normalizeVoiceMimeType, voiceFileMetadataSchema, type VoiceFileMetadata } from "../src/shared/voice.ts";

export class VoiceFileError extends Error {
  readonly code: "invalid_voice" | "voice_too_long" | "voice_validation_unavailable";
  constructor(code: VoiceFileError["code"]) { super(code); this.name = "VoiceFileError"; this.code = code; }
}
export function decodeVoiceBase64(base64: string): Buffer {
  if (!base64 || base64.length > Math.ceil(VOICE_LIMITS.bytes / 3) * 4 || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) throw new VoiceFileError("invalid_voice");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > VOICE_LIMITS.bytes || bytes.toString("base64") !== base64) throw new VoiceFileError("invalid_voice");
  return bytes;
}
let activeProbes = 0;
export async function validateVoiceFile(base64: string, declaredMime: string, signal?: AbortSignal): Promise<{ buffer: Buffer; metadata: VoiceFileMetadata }> {
  const buffer = decodeVoiceBase64(base64), mimeType = normalizeVoiceMimeType(declaredMime);
  if (!mimeType) throw new VoiceFileError("invalid_voice");
  if (signal?.aborted || activeProbes >= 2) throw new VoiceFileError("voice_validation_unavailable");
  activeProbes++;
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      let worker: Worker;
      try { worker = new Worker(new URL("./voice-file-probe.mjs", import.meta.url), {
        workerData: { bytes: new Uint8Array(buffer), parserUrl: import.meta.resolve("mediabunny") }, execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      }); } catch { reject(new VoiceFileError("voice_validation_unavailable")); return; }
      let settled = false;
      const end = (error: Error | null, value?: unknown) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
        // Release the concurrency slot only after the parser has really stopped.
        void worker.terminate().then(() => error ? reject(error) : resolve(value), () => reject(new VoiceFileError("voice_validation_unavailable")));
      };
      const abort = () => end(new VoiceFileError("voice_validation_unavailable"));
      const timer = setTimeout(abort, 5_000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      worker.once("message", value => end(null, value));
      worker.once("error", () => end(new VoiceFileError("invalid_voice")));
      worker.once("exit", () => { if (!settled) end(new VoiceFileError("invalid_voice")); });
    });
    if (!result || typeof result !== "object" || !("durationMs" in result) || !("mimeType" in result)
      || result.mimeType !== mimeType || typeof result.durationMs !== "number") throw new VoiceFileError("invalid_voice");
    if (result.durationMs > VOICE_LIMITS.durationMs) throw new VoiceFileError("voice_too_long");
    const parsed = voiceFileMetadataSchema.safeParse({ mimeType, bytes: buffer.length, durationMs: result.durationMs,
      sha256: createHash("sha256").update(buffer).digest("hex") });
    if (!parsed.success) throw new VoiceFileError("invalid_voice");
    return { buffer, metadata: parsed.data };
  } finally { activeProbes--; }
}
