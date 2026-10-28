import { z } from 'zod';
import { accountErasePrepareSchema } from '../src/shared/account-service.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import type { FirebaseAuthPort } from './firebase-auth.ts';
import type { FirestoreErasureStore } from './firestore-erasure.ts';
import type { createFirestoreAccountExport } from './firestore-account-export.ts';
import type { createHandoverService } from './handover-service.ts';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

export interface FirebaseAccountDataPort {
  erasures: FirestoreErasureStore;
  exporter: ReturnType<typeof createFirestoreAccountExport>;
  packages?: ReturnType<typeof createHandoverService>;
}
/** Native Firebase proof replaces server-side password handling; public recovery uses only the secret receipt. */
export async function handleFirebaseAccountData(request: Request, auth: FirebaseAuthPort, services: FirebaseAccountDataPort,
  readJson: (request: Request) => Promise<unknown>) {
  const url = new URL(request.url), path = url.pathname, match = /^\/api\/account\/deletion\/([0-9a-f-]{36})$/iu.exec(path);
  const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  if (request.method === 'GET' && match)
    return json(await services.erasures.receiptStatus(match[1].toLowerCase(), request.headers.get('x-erasure-receipt') ?? ''));
  const user = (await auth.getSession({ headers: request.headers }))?.user;
  if (!user) domainReject('unauthorized', 401);
  if (request.headers.get('x-expected-user-id') !== user.id) domainReject('identity_changed');
  if (path === '/api/account/packages' || path.startsWith('/api/account/packages/')) {
    const packages = services.packages; if (!packages) domainReject('package_service_unavailable', 503);
    const sameIdentity = async () => { if ((await auth.getSession({ headers: request.headers }))?.user.id !== user.id) domainReject('identity_changed'); };
    const route = /^\/api\/account\/packages\/([0-9a-f-]{36})(?:\/(download|cancel|reconcile))?$/iu.exec(path);
    if (request.method === 'POST' && path === '/api/account/packages') {
      const result = await packages.create(user.id, await readJson(request)); await sameIdentity();
      return Response.json(result, { status: 202, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
    }
    if (request.method === 'GET' && path === '/api/account/packages') {
      if ([...url.searchParams.keys()].some(key => key !== 'cursor' || url.searchParams.getAll(key).length !== 1)) domainReject('invalid_cursor', 400);
      const result = await packages.list(user.id, url.searchParams.get('cursor') ?? undefined); await sameIdentity(); return json(result);
    }
    if (!route || url.search) domainReject('not_found', 404);
    const id = domainParse(z.uuid(), route[1]);
    if (request.method === 'GET' && !route[2]) { const result = await packages.get(user.id, id); await sameIdentity(); return json(result); }
    if (request.method === 'POST' && route[2] === 'cancel') return json(await packages.cancel(user.id, id, await readJson(request)));
    if (request.method === 'POST' && route[2] === 'reconcile') {
      domainParse(z.object({}).strict(), await readJson(request));
      const result = await packages.reconcile(user.id, id, request.signal); await sameIdentity(); return json(result);
    }
    if (request.method === 'GET' && route[2] === 'download') {
      const file = await packages.download(user.id, id, request.signal);
      try {
        await sameIdentity(); request.signal.throwIfAborted();
        const stream = createReadStream(file.path, { signal: request.signal });
        stream.once('close', () => { void file.dispose().catch(() => {}); });
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
          'Content-Type': 'application/zip', 'Content-Length': String(file.bytes), 'Cache-Control': 'private, no-store',
          Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': "attachment; filename=data-package.zip; filename*=UTF-8''" + encodeURIComponent(file.filename),
        } });
      } catch (error) { await file.dispose(); throw error; }
    }
    domainReject('not_found', 404);
  }
  if (request.method === 'GET' && path === '/api/account/messages') {
    if ([...url.searchParams.keys()].some(key => !['scopeVersion', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1)) domainReject('invalid_input', 400);
    if (!services.exporter.messages) domainReject('message_history_unavailable', 503);
    const result = await services.exporter.messages(user.id, Object.fromEntries(url.searchParams));
    if ((await auth.getSession({ headers: request.headers }))?.user.id !== user.id) domainReject('identity_changed');
    return json(result);
  }
  if (request.method === 'GET' && path === '/api/account/export') {
    if ([...url.searchParams.keys()].some(key => !['section', 'childId', 'scopeVersion', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1)) domainReject('invalid_export_scope', 400);
    const result = await services.exporter.page(user.id, Object.fromEntries(url.searchParams));
    if ((await auth.getSession({ headers: request.headers }))?.user.id !== user.id) domainReject('identity_changed');
    return json(result);
  }
  if (request.method !== 'POST' || !['/api/account/deletion/prepare', '/api/account/delete'].includes(path)) domainReject('not_found', 404);
  const body = await readJson(request);
  if (path.endsWith('/prepare')) {
    const input = domainParse(accountErasePrepareSchema, body);
    return json(await services.erasures.prepareAccount(user.id, input.operationId));
  }
  const input = domainParse(z.object({ operationId: z.uuid(), receiptToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    confirmation: z.literal('永久刪除我的帳戶') }).strict(), body);
  const fresh = await auth.assertRecentReauthentication(request.headers);
  if (fresh.user.id !== user.id) domainReject('identity_changed');
  return json(await services.erasures.executeAccount(user.id, input));
}
