import { Readable } from 'node:stream';
import { parentPort, workerData } from 'node:worker_threads';
import { extractRawText } from 'mammoth';
import JSZip from 'jszip';

const maxExpandedBytes = 32 * 1024 * 1024;
const maxTextCharacters = 2 * 1024 * 1024;
const input = workerData as { bytes: Uint8Array; kind: 'docx' | 'text'; offset: number; limit: number };
async function extract() {
  const bytes = Buffer.from(input.bytes);
  let text: string;
  if (input.kind === 'docx') {
    const archive = await JSZip.loadAsync(bytes);
    const entries = Object.values(archive.files).filter(entry => !entry.dir);
    if (entries.length > 1024) throw new Error('extraction_limit');
    if (!archive.file('word/document.xml') || !archive.file('[Content_Types].xml')) throw new Error('protected_or_invalid');
    let expanded = 0;
    // Bound decompression before passing the same immutable bytes to the Word parser.
    for (const entry of entries) {
      const stream = new Readable({ read() {} }).wrap(entry.nodeStream('nodebuffer'));
      try {
        for await (const chunk of stream) {
          expanded += (chunk as Buffer).length;
          if (expanded > maxExpandedBytes) throw new Error('extraction_limit');
        }
      } finally { stream.destroy(); }
    }
    // Raw text only: no HTML rendering, image converter, external file access or execution.
    text = (await extractRawText({ buffer: bytes })).value;
  } else {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(text)) throw new Error('protected_or_invalid');
  }
  if (text.length > maxTextCharacters) throw new Error('extraction_limit');
  if (input.offset > text.length) throw new Error('invalid_range');
  if (!text.trim()) return { reason: 'no_readable_text' };
  // Do not split UTF-16 surrogate pairs; the continuation uses the exact returned boundary.
  const start = input.offset > 0 && /[\uDC00-\uDFFF]/u.test(text[input.offset] ?? '') ? input.offset - 1 : input.offset;
  let end = Math.min(text.length, start + input.limit);
  if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
  return { text: text.slice(start, end), start, end, totalCharacters: text.length, nextOffset: end < text.length ? end : null };
}
try { parentPort!.postMessage(await extract()); }
catch (error) {
  const code = error instanceof Error ? error.message : '';
  parentPort!.postMessage({ reason: ['extraction_limit', 'invalid_range'].includes(code) ? code : 'protected_or_invalid' });
}
