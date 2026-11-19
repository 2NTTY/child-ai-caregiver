import JSZip from 'jszip';
import { fetchLibraryArchive } from '../../../src/client/library-archive.ts';
import type { LibraryArchiveSelection } from '../../../src/shared/source-series.ts';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readBlobBytes } from '../../../src/client/blob-bytes.ts';
import { selectedLibraryEditions, type PersonalLibraryItem } from '../../../src/shared/personal-library.ts';
import { sourceSeries } from '../../../src/shared/source-series.ts';
import type { SelectedPackage } from './HandoverImportOwner';

const hash = z.string().regex(/^[a-f0-9]{64}$/u), id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const entry = z.strictObject({ sourceId: id, versionHash: hash, sha256: hash });
const manifest = z.strictObject({ format: z.literal('yuyoufang-public-knowledge'), version: z.literal(1), entries: z.array(entry).min(1).max(100) });
const reference = z.strictObject({ kind: z.literal('published_reference'), sourceId: id, versionHash: hash });
export const libraryPickLimit = 8 * 1024 * 1024;

export async function shareLibraryArchive(input: {
  baseUrl: string; fetcher: typeof fetch; childId: string; userId: string; selection: LibraryArchiveSelection;
  signal: AbortSignal; current(): boolean;
}, save: (response: Response, filename: string, bytes: number, current: () => boolean) => Promise<{ message: string; share?: () => Promise<void> }>) {
  const { selection, signal, current } = input;
  if (!current()) throw Error('登入或孩子已改變。');
  const archive = await fetchLibraryArchive(input.baseUrl, input.fetcher, input.childId, input.userId, selection, signal);
  const result = await save(archive.response, selection.seriesId + '.zip', archive.bytes, current);
  return { ...result, sha256: archive.sha256 };
}

export async function exportSeriesReferences(items: readonly PersonalLibraryItem[]) {
  const zip = new JSZip(), entries = [];
  for (const item of selectedLibraryEditions(items)) {
    const ref = reference.parse({ kind: 'published_reference', ...item });
    const bytes = new TextEncoder().encode(JSON.stringify(ref));
    entries.push({ sourceId: ref.sourceId, versionHash: ref.versionHash, sha256: bytesToHex(sha256(bytes)) });
    zip.file('editions/' + ref.sourceId + '.json', bytes, { createFolders: false });
  }
  zip.file('manifest.json', JSON.stringify(manifest.parse({ format: 'yuyoufang-public-knowledge', version: 1, entries })));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

async function member(zip: JSZip, path: string, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const file = zip.file(path);
  if (!file || file.dir || file.unsafeOriginalName !== path) throw Error('invalid_library_package');
  // Bound actual expanded output while reading both small references and complete operator editions.
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let total = 0;
    // JSZip 3 exposes this streaming reader on members but omits it from JSZipObject's declarations.
    const stream = (file as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > limit) { stream.pause(); reject(Error('library_package_too_large')); return; }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => {
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    }).resume();
  });
}

export async function readSeriesReferences(file: SelectedPackage, catalog: readonly PersonalLibraryItem[]) {
  if (file.bytes > libraryPickLimit) throw Error('library_package_too_large');
  const bytes = file.body instanceof Uint8Array ? file.body : await readBlobBytes(file.body as Blob);
  if (bytes.byteLength !== file.bytes) throw Error('invalid_library_package');
  const zip = await JSZip.loadAsync(bytes), decode = (value: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
  const declared = manifest.parse(decode(await member(zip, 'manifest.json', 32000)));
  if (Object.keys(zip.files).length !== declared.entries.length + 1 || new Set(declared.entries.map(row => row.sourceId)).size !== declared.entries.length)
    throw Error('invalid_library_package');
  let total = 0;
  const items = [];
  for (const row of declared.entries) {
    const item = catalog.find(item => item.sourceId === row.sourceId);
    if (!item) throw Error('library_reference_unavailable');
    const data = await member(zip, 'editions/' + row.sourceId + '.json', Math.min(2 * 1024 * 1024, libraryPickLimit - total));
    total += data.length;
    if (bytesToHex(sha256(data)) !== row.sha256) throw Error('invalid_library_package');
    const payload = decode(data);
    if (payload.kind === 'published_reference') reference.parse(payload);
    const sourceId = payload.kind === 'published_reference' ? payload.sourceId : payload.source?.sourceId;
    if (sourceId !== row.sourceId || payload.versionHash !== row.versionHash) throw Error('invalid_library_package');
    items.push(item);
  }
  const series = items[0]!.series ?? sourceSeries(items[0]!);
  if (items.some(item => (item.series ?? sourceSeries(item)).id !== series.id)) throw Error('library_package_multiple_series');
  // Only these immutable references reach the personal endpoint. It resolves them against its own reviewed editions.
  return { series, revision: items[0]!.preference?.revision ?? 0, editions: declared.entries.map(({ sourceId, versionHash }) => ({ sourceId, versionHash })) };
}
