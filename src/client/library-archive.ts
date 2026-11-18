import { libraryArchiveSelectionSchema, type LibraryArchiveSelection } from '../shared/source-series.ts';

export async function fetchLibraryArchive(apiBaseUrl: string, fetcher: typeof fetch, childId: string, userId: string, selection: LibraryArchiveSelection, signal: AbortSignal) {
  const base = apiBaseUrl.replace(/\/$/u, '');
  const path = (base.endsWith('/api') ? base : base + '/api') + '/children/' + encodeURIComponent(childId) + '/library?export=zip';
  const result = await fetcher(path, { method: 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { accept: 'application/zip', 'content-type': 'application/json', 'x-expected-user-id': userId },
    body: JSON.stringify(libraryArchiveSelectionSchema.parse(selection)) });
  if (!result.ok) {
    if (result.status === 403) throw Error('這個系列未獲准分享完整內容，或目前已無權限。');
    if (result.status === 409 || result.status === 404) throw Error('資料或選用版本已改變，請重新讀取來源庫。');
    throw Error('暫未能匯出知識包。');
  }
  const sha256 = result.headers.get('x-archive-sha256'), bytes = Number(result.headers.get('content-length'));
  if (!sha256 || !/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 256 * 1024 * 1024
    || result.headers.get('content-type') !== 'application/zip') throw Error('未能核對 ZIP 的檔案資料。');
  return { response: result, sha256, bytes };
}
