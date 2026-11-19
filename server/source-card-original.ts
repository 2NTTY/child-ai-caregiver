import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readChatFile } from './chat-file-reader.ts';
import { extractKnowledgePdf } from './knowledge-pdf.ts';
import { CHAT_FILE_LIMITS } from '../src/shared/chat-files.ts';

export interface SourceCardOriginal {
  url: string; mimeType: string; bytes: Buffer; sha256: string;
  preview: string | null; totalPages?: number;
}
const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function sourceFileOriginal(url: string, type: string, bytes: Buffer, signal: AbortSignal): Promise<SourceCardOriginal | null> {
  const path = new URL(url).pathname.toLowerCase();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const base = { url, bytes, sha256, preview: null };
  if (bytes.subarray(0, 5).toString() === '%PDF-') {
    const pdf = await extractKnowledgePdf(bytes, { startPage: 1, pageLimit: 1, expectedHash: sha256, signal });
    return { ...base, mimeType: 'application/pdf', totalPages: pdf.totalPages, preview: pdf.pages[0]?.text.slice(0, 12000) || null };
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([80,75,3,4]))) {
    if (bytes.length > CHAT_FILE_LIMITS.bytes) throw Error('source_file_too_large');
    const preview = await readChatFile({ buffer: bytes, fileName: 'original.docx', mimeType: docx, sha256 }, {}, signal);
    if (preview.state !== 'read' && preview.reason !== 'no_readable_text') throw Error('unreadable');
    return { ...base, mimeType: docx, preview: preview.state === 'read' ? preview.text : null };
  }
  if ((type === 'application/msword' || path.endsWith('.doc')) && bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
    return { ...base, mimeType: 'application/msword' };
  if (/^image\/(?:png|jpeg|webp)$/u.test(type) || /\.(?:png|jpe?g|webp)$/iu.test(path) || type === 'application/octet-stream') {
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > 40_000_000 || !['jpeg','png','webp'].includes(meta.format)) throw Error('unreadable');
    return { ...base, mimeType: 'image/' + meta.format };
  }
  return null;
}
