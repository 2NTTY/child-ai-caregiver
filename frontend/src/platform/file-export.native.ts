import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { useEffect, useState } from "react";
import { readBlobBytes } from "../../../src/client/blob-bytes";
import { boundedPackageStream } from '../../../src/client/package-download';

export function useFileExportAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try { const supported = await isAvailableAsync(); if (mounted) setAvailable(supported); }
      catch { if (mounted) setAvailable(false); }
    })();
    return () => { mounted = false; };
  }, []);
  return available;
}

const directory = () => new Directory(Paths.cache, "yuyoufang-exports");
let sharing = false;
async function share(content: string | Uint8Array | { stream: ReadableStream<Uint8Array>; bytes: number }, filename: string, mimeType: string, isCurrent: () => boolean, maxBytes = 16 * 1024 * 1024): Promise<string> {
  if (sharing || !isCurrent()) throw new Error("Export unavailable");
  sharing = true;
  let file: File | null = null, handedOut = false;
  try {
    if (!await isAvailableAsync() || !isCurrent()) throw new Error("Sharing unavailable");
    const folder = directory(); folder.create({ intermediates: true, idempotent: true });
    // A chooser may return before its recipient reads the file. Retain bounded cache files
    // for one day, rather than deleting the source immediately after shareAsync resolves.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const item of folder.list()) if (item instanceof File && (item.creationTime ?? item.lastModified ?? 0) < cutoff) item.delete();
    if (folder.list().length >= 16) throw new Error("Export cache full; retry after previous exports expire");
    if (!filename || filename.length > 200 || /[\/\\\u0000-\u001f\u007f]/u.test(filename) || !isCurrent()) throw new Error("Invalid export");
    const streamed = typeof content === 'object' && 'stream' in content;
    const size = typeof content === "string" ? new TextEncoder().encode(content).byteLength : streamed ? content.bytes : content.byteLength;
    if (size > maxBytes) throw new Error("Export too large");
    if (streamed && folder.list().reduce((total, item) => total + (item instanceof File ? item.size : 0), 0) + size > 512 * 1024 * 1024)
      throw new Error('Export cache full; retry after previous exports expire');
    file = new File(folder, `${crypto.randomUUID()}-${filename}`); file.create();
    if (streamed) await content.stream.pipeTo(file.writableStream()); else file.write(content);
    if (!isCurrent()) throw new Error("Export scope changed");
    await shareAsync(file.uri, { mimeType, dialogTitle: "保存或分享育有方資料" }); handedOut = true;
    return "已開啟系統保存／分享；請核對是否已保存，取消不代表完成。";
  } finally {
    try { if (!handedOut && file?.exists) file.delete(); } finally { sharing = false; }
  }
}
export async function exportPackage(response: Response, filename: string, bytes: number, isCurrent: () => boolean): Promise<string> {
  const stream = boundedPackageStream(response, bytes, isCurrent);
  try { return await share({ stream, bytes }, filename, 'application/zip', isCurrent, 256 * 1024 * 1024); }
  finally { if (!stream.locked) await stream.cancel().catch(() => {}); }
}
export async function exportBlob(blob: Blob, filename: string, isCurrent: () => boolean = () => true): Promise<string> {
  if (!isCurrent()) throw new Error("Export scope changed");
  if (blob.size > 16 * 1024 * 1024) throw new Error("Export too large");
  return share(await readBlobBytes(blob), filename, blob.type || "application/pdf", isCurrent);
}
export async function exportText(text: string, filename: string, isCurrent: () => boolean = () => true): Promise<void> {
  await share(text, filename, "application/json", isCurrent);
}

export async function exportAttachment(bytes: Uint8Array<ArrayBuffer>, mimeType: string, filename: string, isCurrent: () => boolean) {
  const safeName = filename.replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/gu, '_').slice(0, 200).trim() || 'attachment';
  return share(bytes, safeName, mimeType, isCurrent, 20 * 1024 * 1024);
}
