import { fromByteArray } from "base64-js";
import { readBlobBytes } from "../../../../src/client/blob-bytes";
import { CHAT_FILE_LIMITS, normalizeChatFileMime } from "../../../../src/shared/chat-files";
import { localAttachmentId, type AssistantAttachment } from "../../assistant-draft";

export function localFileAttachment(input: { fileName: string; mimeType: string; bytes: number; uri: string;
  readBytes(): Promise<Uint8Array>; release(): void }): AssistantAttachment {
  const mimeType = normalizeChatFileMime(input.mimeType);
  if (!mimeType || input.bytes < 1 || input.bytes > CHAT_FILE_LIMITS.bytes || input.fileName.length > 200) {
    input.release(); throw new Error("invalid_file");
  }
  let active = true;
  return { id: localAttachmentId(), kind: "file", fileName: input.fileName, mimeType, bytes: input.bytes, localUri: input.uri,
    async readBase64() {
      if (!active) throw new Error("file_released");
      const bytes = await input.readBytes();
      if (!active || bytes.length !== input.bytes) throw new Error("file_changed");
      return fromByteArray(bytes);
    },
    dispose() { if (active) { active = false; input.release(); } },
  };
}
export function fileFromBlob(blob: Blob, fileName: string, createUrl: (blob: Blob) => string, revokeUrl: (uri: string) => void) {
  const uri = createUrl(blob);
  return localFileAttachment({ fileName, mimeType: blob.type, bytes: blob.size, uri,
    readBytes: async () => new Uint8Array(await readBlobBytes(blob)), release: () => revokeUrl(uri) });
}
