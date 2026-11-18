import { boundedPackageStream } from './package-download.ts';

export async function readCitationPdf(input: {
  apiBaseUrl: string; fetcher: typeof fetch; userId: string; childId: string; runId: string; chunkId: string; current(): boolean;
}) {
  const { apiBaseUrl, fetcher, userId, childId, runId, chunkId, current } = input;
  const base = apiBaseUrl.replace(/\/$/u, '');
  const path = [childId, runId, chunkId].map(encodeURIComponent);
  if (!current()) throw new Error('登入或孩子已改變。');
  const response = await fetcher(`${base.endsWith('/api') ? base : base + '/api'}/children/${path[0]}/agent/runs/${path[1]}/citations/${path[2]}/original`, {
    credentials: 'include', cache: 'no-store', headers: { accept: 'application/pdf', 'x-expected-user-id': userId }, signal: AbortSignal.timeout(30000),
  });
  if (!current()) throw new Error('登入或孩子已改變。');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('現時沒有權限開啟這份原件。');
    if (response.status === 404 || response.status === 409 || response.status === 410 || response.status === 412)
      throw new Error('當時版本的 PDF 現時未能取得。回答中的頁碼及原文仍可核對。');
    throw new Error('暫未能讀取原件，請稍後重試。');
  }
  const size = Number(response.headers.get('content-length'));
  if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/pdf' || !Number.isSafeInteger(size) || size < 1 || size > 32 * 1024 * 1024)
    throw new Error('未能核對回傳的 PDF。');
  // Some native fetch transports supply a Blob without exposing a web stream.
  if (!response.body) {
    const blob = await response.blob();
    if (!current() || blob.size !== size) throw new Error('原件未完整讀取。');
    return blob;
  }
  return new Response(boundedPackageStream(response, size, current), { headers: { 'content-type': 'application/pdf' } }).blob();
}
