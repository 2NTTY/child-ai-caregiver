import { z } from 'zod';
import { sourceReadingViewSchema, type SourceReading } from '../../../src/shared/source-card-reading.ts';
import { registeredSourceCardSchema, registeredSourceSettingsSchema, type RegisteredSourceCommand, type RegisteredSourceSettings } from '../../../src/shared/registered-source-card.ts';

export const sourceCardSettingsSchema = registeredSourceSettingsSchema;
export type SourceCardSettings = RegisteredSourceSettings;
export type SourceCardMutation = RegisteredSourceCommand;
export type SourceCardCredentialMutation = { operationId: string; expectedRevision: number } & ({ action: 'replace'; username: string; password: string; loginUrl?: string } | { action: 'clear' });
export class RegisteredSourceCardsError extends Error {
  readonly status: number;
  readonly unknownResult: boolean;
  readonly code: string | null;
  constructor(status = 0, unknownResult = false, code: string | null = null) { super('Source card request could not be confirmed'); this.status = status; this.unknownResult = unknownResult; this.code = code; }
}
export function createRegisteredSourceCardsApi(baseUrl: string, fetcher: typeof fetch) {
  const base = baseUrl.replace(/\/$/u, ''), endpoint = (base.endsWith('/api') ? base : base + '/api') + '/account/source-cards';
  async function request<T>(userId: string, signal: AbortSignal, path: string, schema: z.ZodType<T>, input?: unknown): Promise<T> {
    const controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
    const timer = setTimeout(cancel, 20_000), writing = input !== undefined;
    try {
      const response = await fetcher(endpoint + path, { method: writing ? 'POST' : 'GET', cache: 'no-store', credentials: 'include', signal: controller.signal,
        headers: { Accept: 'application/json', 'x-expected-user-id': userId, ...(writing ? { 'Content-Type': 'application/json' } : {}) },
        ...(writing ? { body: JSON.stringify(input) } : {}) });
      if (!response.ok) {
        let code: string | null = null;
        try { const body = await response.json(); if (['identity_changed', 'operation_conflict', 'source_card_changed', 'source_card_paused', 'source_card_not_found'].includes(body?.error?.code)) code = body.error.code; } catch { /* Only fixed error codes leave the transport. */ }
        throw new RegisteredSourceCardsError(response.status, writing && (response.status >= 500 || response.status === 408), code);
      }
      const value = schema.parse(await response.json());
      if (controller.signal.aborted) throw new RegisteredSourceCardsError(0, writing);
      return value;
    } catch (error) { throw error instanceof RegisteredSourceCardsError ? error : new RegisteredSourceCardsError(0, writing); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  const one = z.object({ card: registeredSourceCardSchema }), mutation = z.object({ card: registeredSourceCardSchema.nullable() });
  return {
    reading(userId: string, signal: AbortSignal, target: SourceReading) {
      const params = new URLSearchParams({ documentId: target.documentId, version: target.version, offset: String(target.offset) });
      if (target.page !== undefined) params.set('page', String(target.page));
      if (target.fact) {
        params.set('kind', target.fact.type);
        params.set('hash', target.fact.hash);
        params.set('incarnation', target.fact.incarnation);
      }
      return request(userId, signal, '/' + encodeURIComponent(target.cardId) + '/reading?' + params.toString(), sourceReadingViewSchema);
    },
    list: (userId: string, signal: AbortSignal, cursor?: string) => request(userId, signal, cursor ? '?cursor=' + encodeURIComponent(cursor) : '', z.object({ items: z.array(registeredSourceCardSchema), nextCursor: z.string().nullable() })),
    get: (userId: string, signal: AbortSignal, cardId: string) => request(userId, signal, '/' + encodeURIComponent(cardId), one),
    mutate: (userId: string, signal: AbortSignal, input: SourceCardMutation) => request(userId, signal, '', mutation, input),
    credential: (userId: string, signal: AbortSignal, cardId: string, input: SourceCardCredentialMutation) => request(userId, signal, '/' + encodeURIComponent(cardId) + '/credential', one, input),
  };
}
