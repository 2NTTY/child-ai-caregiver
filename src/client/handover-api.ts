import { z } from 'zod';
import { resolveApiBaseUrl } from '../config/api-base-url.ts';
import { handoverCancelCommandSchema, handoverExportCommandSchema, handoverExportPageSchema, handoverExportViewSchema,
  type HandoverExportCommand, type HandoverExportView } from '../shared/handover-jobs.ts';
import { handoverUploadCommandSchema, handoverUploadViewSchema, type HandoverUploadCommand, type HandoverUploadView } from '../shared/handover-uploads.ts';
import { handoverImportCommandSchema, handoverImportControlSchema, handoverImportViewSchema, handoverImportPageSchema,
  type HandoverImportCommand, type HandoverImportView } from '../shared/handover-imports.ts';

type CancelCommand = z.infer<typeof handoverCancelCommandSchema>;
type ExportPage = z.infer<typeof handoverExportPageSchema>;
type ImportControl = z.infer<typeof handoverImportControlSchema>;
type ImportPage = z.infer<typeof handoverImportPageSchema>;
type RequestOptions = { collection?: 'packages' | 'package-uploads' | 'package-imports'; rawBody?: boolean; timeoutMs?: number };
export interface HandoverApi {
  setIdentity(userId: string | null): void;
  create(userId: string, command: HandoverExportCommand, signal: AbortSignal): Promise<HandoverExportView>;
  list(userId: string, signal: AbortSignal, cursor?: string): Promise<ExportPage>;
  get(userId: string, id: string, signal: AbortSignal): Promise<HandoverExportView>;
  cancel(userId: string, id: string, command: CancelCommand, signal: AbortSignal): Promise<HandoverExportView>;
  reconcile(userId: string, id: string, signal: AbortSignal): Promise<HandoverExportView>;
  download<T>(userId: string, id: string, expectedBytes: number, signal: AbortSignal,
    consume: (response: Response, isCurrent: () => boolean) => Promise<T>): Promise<T>;
  reserveUpload(userId: string, command: HandoverUploadCommand, signal: AbortSignal): Promise<HandoverUploadView>;
  getUpload(userId: string, id: string, signal: AbortSignal): Promise<HandoverUploadView>;
  cancelUpload(userId: string, id: string, command: CancelCommand, signal: AbortSignal): Promise<HandoverUploadView>;
  uploadContent(userId: string, id: string, body: BodyInit, signal: AbortSignal): Promise<HandoverUploadView>;
  createImport(userId: string, command: HandoverImportCommand, signal: AbortSignal): Promise<HandoverImportView>;
  getImport(userId: string, id: string, signal: AbortSignal): Promise<HandoverImportView>;
  listImports(userId: string, signal: AbortSignal, cursor?: string): Promise<ImportPage>;
  cancelImport(userId: string, id: string, command: ImportControl, signal: AbortSignal): Promise<HandoverImportView>;
  resumeImport(userId: string, id: string, command: ImportControl, signal: AbortSignal): Promise<HandoverImportView>;
}
export class HandoverApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status = 0, code = 'handover_unavailable') {
    super('Data package request could not be confirmed'); this.name = 'HandoverApiError'; this.status = status; this.code = code;
  }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidResponse = () => new HandoverApiError(0, 'handover_response_invalid');
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); if (!parsed.success) throw invalidResponse(); return parsed.data;
}
function identifier(value: string) {
  if (!z.uuid().safeParse(value).success) throw new HandoverApiError(400, 'invalid_input'); return value;
}

export function createHandoverApi(baseUrl = '', fetcher: typeof fetch = fetch): HandoverApi {
  const base = resolveApiBaseUrl(baseUrl), api = (base.endsWith('/api') ? base : base + '/api') + '/account';
  let identity: string | null = null, generation = 0;
  const active = new Set<AbortController>();
  function setIdentity(userId: string | null) {
    if (identity === userId) return;
    identity = userId; generation++;
    for (const controller of active) controller.abort(); active.clear();
  }
  async function request<T>(userId: string, path: string, signal: AbortSignal, body: unknown, accept: string, timeoutMs: number,
    consume: (response: Response, isCurrent: () => boolean) => Promise<T>, options: RequestOptions = {}): Promise<T> {
    if (typeof userId !== 'string' || !userId || userId.length > 256) throw new HandoverApiError(400, 'invalid_input');
    if (identity !== userId) throw new HandoverApiError(409, 'session_changed');
    const ticket = generation, controller = new AbortController();
    const isCurrent = () => ticket === generation && identity === userId && !controller.signal.aborted && !signal.aborted;
    const stale = () => ticket !== generation || identity !== userId;
    const failure = () => stale() ? new HandoverApiError(409, 'session_changed') : new HandoverApiError();
    let response: Response | undefined, rejectAbort!: (reason: HandoverApiError) => void;
    const release = () => { if (response?.body && !response.body.locked && !response.bodyUsed) void response.body.cancel().catch(() => {}); };
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => { release(); rejectAbort(failure()); }, abort = () => controller.abort();
    active.add(controller); controller.signal.addEventListener('abort', onAbort, { once: true });
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const pending = (async () => {
        if (!isCurrent()) throw failure();
        response = await fetcher(api + '/' + (options.collection ?? 'packages') + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store',
          headers: { Accept: accept, 'x-expected-user-id': userId, ...(body === undefined ? {} : { 'Content-Type': options.rawBody ? 'application/zip' : 'application/json' }) },
          ...(body === undefined ? {} : { body: options.rawBody ? body as BodyInit : JSON.stringify(body) }), signal: controller.signal });
        if (!isCurrent()) { release(); throw failure(); }
        if (!response.ok) {
          let code = 'handover_unavailable';
          try {
            const value: unknown = await response.json();
            const candidate = object(value) && object(value.error) ? value.error.code : object(value) ? value.code : null;
            if (typeof candidate === 'string' && /^[a-z_]{1,80}$/u.test(candidate)) code = candidate;
          } catch { /* Remote error bodies are never exposed. */ }
          if (!isCurrent()) throw failure();
          throw new HandoverApiError(response.status, code);
        }
        const result = await consume(response, isCurrent);
        if (!isCurrent()) throw failure(); return result;
      })();
      return await Promise.race([pending, aborted]);
    } catch (error) {
      if (stale()) throw new HandoverApiError(409, 'session_changed');
      if (error instanceof HandoverApiError) throw error; throw new HandoverApiError();
    } finally {
      clearTimeout(timer); active.delete(controller); signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort); release();
    }
  }
  function json<T>(userId: string, path: string, signal: AbortSignal, schema: z.ZodType<T>, body?: unknown, matches?: (value: T) => boolean,
    options: RequestOptions = {}): Promise<T> {
    return request(userId, path, signal, body, 'application/json', options.timeoutMs ?? 20_000, async response => {
      let value: unknown;
      try { value = await response.json(); } catch { throw invalidResponse(); }
      const result = checked(schema, value); if (matches && !matches(result)) throw invalidResponse(); return result;
    }, options);
  }
  async function view(userId: string, id: string, signal: AbortSignal, suffix = '', body?: unknown) {
    return json(userId, '/' + identifier(id) + suffix, signal, handoverExportViewSchema, body, result => result.id === id);
  }
  async function resourceView<T extends { id: string }>(collection: RequestOptions['collection'], schema: z.ZodType<T>, userId: string,
    id: string, signal: AbortSignal, suffix = '', body?: unknown, options: Pick<RequestOptions, 'rawBody' | 'timeoutMs'> = {}) {
    return json(userId, '/' + identifier(id) + suffix, signal, schema, body, result => result.id === id,
      { collection, ...options });
  }
  return {
    setIdentity,
    async create(userId, input, signal) {
      const parsed = handoverExportCommandSchema.safeParse(input); if (!parsed.success) throw new HandoverApiError(400, 'invalid_input');
      return json(userId, '', signal, handoverExportViewSchema, parsed.data, result => result.id === parsed.data.opId);
    },
    async list(userId, signal, cursor) {
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 2048)) throw new HandoverApiError(400, 'invalid_input');
      return json(userId, cursor === undefined ? '' : '?' + new URLSearchParams({ cursor }), signal, handoverExportPageSchema,
        undefined, result => result.nextCursor !== '' && (cursor === undefined || result.nextCursor !== cursor));
    },
    get: (userId, id, signal) => view(userId, id, signal),
    cancel(userId, id, input, signal) {
      const parsed = handoverCancelCommandSchema.safeParse(input);
      if (!parsed.success) return Promise.reject(new HandoverApiError(400, 'invalid_input'));
      return view(userId, id, signal, '/cancel', parsed.data);
    },
    reconcile: (userId, id, signal) => view(userId, id, signal, '/reconcile', {}),
    async reserveUpload(userId, input, signal) {
      const parsed = handoverUploadCommandSchema.safeParse(input); if (!parsed.success) throw new HandoverApiError(400, 'invalid_input');
      return json(userId, '', signal, handoverUploadViewSchema, parsed.data, result => result.id === parsed.data.opId, { collection: 'package-uploads' });
    },
    getUpload: (userId, id, signal) => resourceView('package-uploads', handoverUploadViewSchema, userId, id, signal),
    async cancelUpload(userId, id, input, signal) {
      const parsed = handoverCancelCommandSchema.safeParse(input); if (!parsed.success) throw new HandoverApiError(400, 'invalid_input');
      return resourceView('package-uploads', handoverUploadViewSchema, userId, id, signal, '/cancel', parsed.data);
    },
    async uploadContent(userId, id, body, signal) {
      if (body === undefined || body === null) throw new HandoverApiError(400, 'invalid_input');
      return resourceView('package-uploads', handoverUploadViewSchema, userId, id, signal, '/content', body, { rawBody: true, timeoutMs: 300_000 });
    },
    async createImport(userId, input, signal) {
      const parsed = handoverImportCommandSchema.safeParse(input); if (!parsed.success) throw new HandoverApiError(400, 'invalid_input');
      return json(userId, '', signal, handoverImportViewSchema, parsed.data,
        result => result.id === parsed.data.opId && result.uploadId === parsed.data.uploadId, { collection: 'package-imports', timeoutMs: 300_000 });
    },
    getImport: (userId, id, signal) => resourceView('package-imports', handoverImportViewSchema, userId, id, signal),
    async listImports(userId, signal, cursor) {
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 2048)) throw new HandoverApiError(400, 'invalid_input');
      return json(userId, cursor === undefined ? '' : '?' + new URLSearchParams({ cursor }), signal, handoverImportPageSchema,
        undefined, result => result.nextCursor !== '' && (cursor === undefined || result.nextCursor !== cursor), { collection: 'package-imports' });
    },
    async cancelImport(userId, id, input, signal) {
      const parsed = handoverImportControlSchema.safeParse(input); if (!parsed.success) throw new HandoverApiError(400, 'invalid_input');
      return resourceView('package-imports', handoverImportViewSchema, userId, id, signal, '/cancel', parsed.data);
    },
    async resumeImport(userId, id, input, signal) {
      const parsed = handoverImportControlSchema.safeParse(input); if (!parsed.success) throw new HandoverApiError(400, 'invalid_input');
      return resourceView('package-imports', handoverImportViewSchema, userId, id, signal, '/resume', parsed.data, { timeoutMs: 300_000 });
    },
    async download(userId, id, expectedBytes, signal, consume) {
      identifier(id);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 256 * 1024 * 1024) throw new HandoverApiError(400, 'invalid_input');
      return request(userId, '/' + id + '/download', signal, undefined, 'application/zip', 300_000, async (response, isCurrent) => {
        const length = response.headers.get('content-length');
        if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/zip'
          || !length || !/^[1-9][0-9]{0,9}$/u.test(length) || Number(length) !== expectedBytes || !response.body) throw invalidResponse();
        try { return await consume(response, isCurrent); }
        catch (error) {
          if (error instanceof Error && ['package_download_incomplete', 'package_download_invalid', 'session_changed'].includes(error.message))
            throw new HandoverApiError(error.message === 'session_changed' ? 409 : 0, error.message);
          throw error;
        }
      });
    },
  };
}
