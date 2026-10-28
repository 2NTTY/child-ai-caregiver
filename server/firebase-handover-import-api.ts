import { z } from 'zod';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { HandoverObjectError } from './firebase-handover-objects.ts';
import type { createHandoverImportService } from './handover-import-service.ts';

export async function handleHandoverImport(request: Request, owner: string, service: ReturnType<typeof createHandoverImportService>,
  readJson: (request: Request) => Promise<unknown>, sameIdentity: () => Promise<void>) {
  const url = new URL(request.url), root = '/api/account/package-imports';
  const route = /^\/api\/account\/package-imports\/([0-9a-f-]{36})(?:\/(cancel|resume))?$/iu.exec(url.pathname);
  if (url.search && url.pathname !== root + '/source-history' && !(request.method === 'GET' && url.pathname === root)) domainReject('invalid_input', 400);
  const respond = async (result: unknown, status = 200) => { await sameIdentity(); return Response.json(result, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } }); };
  try {
    if (request.method === 'GET' && url.pathname === root) {
      const entries = [...url.searchParams];
      if (entries.some(([key]) => key !== 'cursor') || entries.length > 1) domainReject('invalid_input', 400);
      return respond(await service.list(owner, url.searchParams.get('cursor') ?? undefined));
    }
    if (request.method === 'GET' && url.pathname === root + '/source-history') {
      const entries = [...url.searchParams]; if (new Set(entries.map(([key]) => key)).size !== entries.length) domainReject('invalid_input', 400);
      return respond(await service.history(owner, Object.fromEntries(entries)));
    }
    if (request.method === 'POST' && url.pathname === root) return respond(await service.create(owner, await readJson(request), request.signal), 201);
    if (!route) domainReject('not_found', 404);
    const id = domainParse(z.uuid(), route[1]);
    if (request.method === 'GET' && !route[2]) return respond(await service.get(owner, id));
    if (request.method === 'POST' && route[2] === 'cancel') return respond(await service.cancel(owner, id, await readJson(request)));
    if (request.method === 'POST' && route[2] === 'resume') return respond(await service.resume(owner, id, await readJson(request), request.signal));
    domainReject('not_found', 404);
  } catch (error) {
    if (error instanceof HandoverArchiveError) domainReject(error.code, 400);
    if (error instanceof HandoverObjectError) domainReject(error.code, error.code === 'package_object_conflict' ? 409 : 503);
    throw error;
  }
}
