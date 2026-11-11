import { Readable } from 'node:stream';
import { z } from 'zod';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { HandoverObjectError } from './firebase-handover-objects.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';
import type { HandoverUploadView } from '../src/shared/handover-uploads.ts';
import { supportsAccountPreferencePackage, supportsMixedConversationPackage } from '../src/shared/handover.ts';

export async function handleHandoverUpload(request: Request, owner: string, service: ReturnType<typeof createHandoverUploadService>,
  readJson: (request: Request) => Promise<unknown>, sameIdentity: () => Promise<void>) {
  const url = new URL(request.url), root = '/api/account/package-uploads';
  const route = /^\/api\/account\/package-uploads\/([0-9a-f-]{36})(?:\/(content|cancel))?$/iu.exec(url.pathname);
  if (url.search && !(request.method === 'GET' && url.pathname === root)) domainReject('invalid_input', 400);
  const json = (value: unknown, status = 200) => Response.json(value, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
  const accountBackup = request.headers.get('x-handover-account-backup') === '1';
  const notificationPreferencesBackup = supportsAccountPreferencePackage(request.headers);
  const mixedConversations = supportsMixedConversationPackage(request.headers);
  async function respond(view: HandoverUploadView, status = 200) {
    await sameIdentity();
    if (view.preview?.header.selection.mixedRooms && !mixedConversations) domainReject('unsupported_package_format', 409);
    if (view.preview?.header.selection.accountAvatar && !accountBackup) domainReject('unsupported_package_format', 409);
    if (view.preview?.header.selection.notificationPreferences && !notificationPreferencesBackup) domainReject('unsupported_package_format', 409);
    return json(view, status);
  }
  try {
    if (request.method === 'GET' && url.pathname === root) {
      const entries = [...url.searchParams];
      const history = url.searchParams.get('history');
      if (entries.some(([key]) => !['cursor', 'history'].includes(key) || url.searchParams.getAll(key).length !== 1)
        || history !== null && history !== 'cleaned') domainReject('invalid_input', 400);
      const result = await service.list(owner, url.searchParams.get('cursor') ?? undefined, history ?? undefined);
      await sameIdentity(); return json(result);
    }
    if (request.method === 'POST' && url.pathname === root) {
      return respond(await service.create(owner, await readJson(request)), 201);
    }
    if (!route) domainReject('not_found', 404);
    const id = domainParse(z.uuid(), route[1]);
    if (request.method === 'GET' && !route[2]) return respond(await service.get(owner, id));
    if (request.method === 'POST' && route[2] === 'cancel') {
      return respond(await service.cancel(owner, id, await readJson(request)));
    }
    if (request.method === 'POST' && route[2] === 'content') {
      if (request.headers.get('content-type') !== 'application/zip' || !request.body) domainReject('invalid_package_content', 400);
      const source = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream);
      try {
        return respond(await service.receive(owner, id, source, request.signal, accountBackup, notificationPreferencesBackup, mixedConversations));
      } finally { source.destroy(); }
    }
    domainReject('not_found', 404);
  } catch (error) {
    if (error instanceof HandoverArchiveError) domainReject(error.code, error.code === 'package_size_exceeded' ? 413 : 400);
    if (error instanceof HandoverObjectError) domainReject(error.code, error.code === 'package_object_conflict' ? 409 : 503);
    throw error;
  }
}
