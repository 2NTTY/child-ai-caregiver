import { boundedPackageStream } from '../../../src/client/package-download';

export function useFileExportAvailable(): boolean {
  return typeof document !== "undefined";
}

export async function exportBlob(blob: Blob, filename: string, isCurrent: () => boolean = () => true): Promise<string> {
  if (!isCurrent()) throw new Error("Export scope changed");
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
  return "已交給瀏覽器下載，請核對下載結果。";
}
export async function openCitationPdf(load: () => Promise<Blob>, page: number | undefined, current: () => boolean): Promise<string> {
  const viewer = window.open('about:blank', '_blank');
  if (viewer) viewer.opener = null;
  try {
    const blob = await load();
    if (!current()) throw new Error('登入或孩子已改變。');
    if (!viewer || viewer.closed) return exportBlob(blob, 'citation.pdf', current);
    const url = URL.createObjectURL(blob);
    viewer.location.replace(url + (page ? '#page=' + page : ''));
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return page ? `已開啟當時的 PDF，引用在第 ${page} 頁。` : '已開啟當時的 PDF。';
  } catch (error) { viewer?.close(); throw error; }
}

export async function exportText(text: string, filename: string, isCurrent: () => boolean = () => true): Promise<void> {
  await exportBlob(new Blob([text], { type: "application/json;charset=utf-8" }), filename, isCurrent);
}

export async function exportPackage(response: Response, filename: string, bytes: number, isCurrent: () => boolean): Promise<string> {
  const blob = await new Response(boundedPackageStream(response, bytes, isCurrent), { headers: { 'Content-Type': 'application/zip' } }).blob();
  return exportBlob(blob, filename, isCurrent);
}

export async function exportAttachment(bytes: Uint8Array<ArrayBuffer>, mimeType: string, filename: string, isCurrent: () => boolean) {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Export too large");
  return exportBlob(new Blob([bytes], { type: mimeType }), filename, isCurrent);
}
