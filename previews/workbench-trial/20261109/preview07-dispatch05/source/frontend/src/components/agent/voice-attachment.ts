import { fromByteArray } from "base64-js";
import { readBlobBytes } from "../../../../src/client/blob-bytes";
import { VOICE_LIMITS, normalizeVoiceMimeType } from "../../../../src/shared/voice";
import { localAttachmentId, type AssistantAttachment } from "../../assistant-draft";

export function localVoiceAttachment(input: { fileName: string; mimeType: string; bytes: number; uri: string;
  readBytes(): Promise<Uint8Array>; release(): void }): AssistantAttachment {
  const mimeType = normalizeVoiceMimeType(input.mimeType);
  if (!mimeType || input.bytes < 1 || input.bytes > VOICE_LIMITS.bytes || input.fileName.length > 200) {
    input.release(); throw new Error("invalid_voice");
  }
  let active = true;
  return { id: localAttachmentId(), kind: "voice", fileName: input.fileName, mimeType, bytes: input.bytes, localUri: input.uri,
    async readBase64() {
      if (!active) throw new Error("voice_released");
      const bytes = await input.readBytes();
      if (!active || bytes.length !== input.bytes) throw new Error("voice_changed");
      return fromByteArray(bytes);
    },
    dispose() { if (active) { active = false; input.release(); } },
  };
}
export function voiceFromBlob(blob: Blob, fileName: string, createUrl: (blob: Blob) => string, revokeUrl: (uri: string) => void) {
  const uri = createUrl(blob);
  return localVoiceAttachment({ fileName, mimeType: blob.type, bytes: blob.size, uri,
    readBytes: async () => new Uint8Array(await readBlobBytes(blob)), release: () => revokeUrl(uri) });
}
