import { Readable } from 'node:stream';
import { z } from 'zod';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { HandoverObjectError } from './firebase-handover-objects.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';

export async function handleHandoverUpload(request: Request, owner: string, service: ReturnType<typeof createHandoverUploadService>,
  readJson: (request: Request) => Promise<unknown>, sameIdentity: () => Promise<void>) {
  const url = new URL(request.url), root = '/api/account/package-uploads';
  const route = /^\/api\/account\/package-uploads\/([0-9a-f-]{36})(?:\/(content|cancel))?$/iu.exec(url.pathname);
  if (url.search && !(request.method === 'GET' && url.pathname === root)) domainReject('invalid_input', 400);
  const json = (value: unknown, status = 200) => Response.json(value, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
  try {
    if (request.method === 'GET' && url.pathname === root) {
      const entries = [...url.searchParams];
      if (entries.some(([key]) => key !== 'cursor') || entries.length > 1) domainReject('invalid_input', 400);
      const result = await service.list(owner, url.searchParams.get('cursor') ?? undefined); await sameIdentity(); return json(result);
    }
    if (request.method === 'POST' && url.pathname === root) {
      const result = await service.create(owner, await readJson(request)); await sameIdentity(); return json(result, 201);
    }
    if (!route) domainReject('not_found', 404);
    const id = domainParse(z.uuid(), route[1]);
    if (request.method === 'GET' && !route[2]) { const result = await service.get(owner, id); await sameIdentity(); return json(result); }
    if (request.method === 'POST' && route[2] === 'cancel') {
      const result = await service.cancel(owner, id, await readJson(request)); await sameIdentity(); return json(result);
    }
    if (request.method === 'POST' && route[2] === 'content') {
      if (request.headers.get('content-type') !== 'application/zip' || !request.body) domainReject('invalid_package_content', 400);
      const source = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream);
      try {
        const result = await service.receive(owner, id, source, request.signal); await sameIdentity(); return json(result);
      } finally { source.destroy(); }
    }
    domainReject('not_found', 404);
  } catch (error) {
    if (error instanceof HandoverArchiveError) domainReject(error.code, error.code === 'package_size_exceeded' ? 413 : 400);
    if (error instanceof HandoverObjectError) domainReject(error.code, error.code === 'package_object_conflict' ? 409 : 503);
    throw error;
  }
}
