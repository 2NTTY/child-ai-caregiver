import { z } from 'zod';
import { supportsAccountPreferencePackage } from '../src/shared/handover.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { HandoverObjectError } from './firebase-handover-objects.ts';
import type { createHandoverImportService } from './handover-import-service.ts';

export async function handleHandoverImport(request: Request, owner: string, service: ReturnType<typeof createHandoverImportService>,
  readJson: (request: Request) => Promise<unknown>, sameIdentity: () => Promise<void>) {
  const url = new URL(request.url), root = '/api/account/package-imports';
  const mixed = request.headers.get('x-handover-mixed-import') === '1';
  const route = /^\/api\/account\/package-imports\/([0-9a-f-]{36})(?:\/(cancel|resume|items|mixed-items|enrolments|summary))?$/iu.exec(url.pathname);
  if (url.search && !(request.method === 'GET' && (url.pathname === root || url.pathname === root + '/source-history' || route?.[2] === 'items' || route?.[2] === 'mixed-items')))
    domainReject('invalid_input', 400);
  const respond = async (result: unknown, status = 200) => { await sameIdentity(); return Response.json(result, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } }); };
  try {
    if (request.method === 'GET' && url.pathname === root + '/capabilities') {
      const classFeatures = (request.headers.get('x-handover-class-features') ?? '').split(/[\s,]+/u);
      const originalFeatures = (request.headers.get('x-handover-original-features') ?? '').split(/[\s,]+/u);
      return respond({ classEnrolment: true, ...(mixed ? {mixedConversationImport:true} : {}),
        ...(originalFeatures.includes('memory-resources') ? { originalMemoryResources: true } : {}),
        ...(service.originalAttachmentResources && originalFeatures.includes('attachment-resources') ? { originalAttachmentResources: true } : {}),
        ...(classFeatures.includes('concerns') ? { classConcernImports: true } : {}),
        ...(classFeatures.includes('growth') ? { classGrowthImports: true } : {}),
        ...(request.headers.get('x-handover-original-modules') === '1' ? { originalModules: service.originalModules.filter(module =>
          (module !== 'concerns' || originalFeatures.includes('concerns'))
          && (module !== 'growth' || originalFeatures.includes('growth'))
          && (module !== 'memory' || originalFeatures.includes('private-instructions'))) } : {}),
        ...(service.accountAvatarRestore && request.headers.get('x-handover-account-backup') === '1'
        ? { accountAvatarRestore: true } : {}),
        ...(service.notificationPreferencesRestore && supportsAccountPreferencePackage(request.headers) ? { notificationPreferencesRestore: true } : {}) });
    }
    if (request.method === 'GET' && url.pathname === root) {
      const entries = [...url.searchParams];
      if (entries.some(([key]) => key !== 'cursor') || entries.length > 1) domainReject('invalid_input', 400);
      const page=await service.list(owner, url.searchParams.get('cursor') ?? undefined);
      return respond(mixed ? page : {...page,items:page.items.map(compatibleView)});
    }
    if (request.method === 'GET' && url.pathname === root + '/source-history') {
      const entries = [...url.searchParams]; if (new Set(entries.map(([key]) => key)).size !== entries.length) domainReject('invalid_input', 400);
      return respond(await service.history(owner, Object.fromEntries(entries)));
    }
    if (request.method === 'POST' && url.pathname === root + '/compare-original')
      return respond(await service.compareOriginal(owner, await readJson(request), request.signal));
    if (request.method === 'POST' && url.pathname === root + '/compare-account-avatar')
      return respond(await service.compareSelfAvatar(owner, await readJson(request), request.signal));
    if (request.method === 'POST' && url.pathname === root + '/compare-notification-preferences' && supportsAccountPreferencePackage(request.headers))
      return respond(await service.compareNotificationPreferences(owner, await readJson(request), request.signal));
    if (request.method === 'POST' && url.pathname === root) {
      const input = await readJson(request);
      if (input && typeof input==='object' && 'mixedRoomIds' in input && !mixed) domainReject('unsupported_package_format',409);
      if (input && typeof input === 'object' && 'notificationPreferences' in input && !supportsAccountPreferencePackage(request.headers))
        domainReject('unsupported_package_format', 409);
      return respond(await service.create(owner, input, request.signal), 201);
    }
    if (!route) domainReject('not_found', 404);
    const id = domainParse(z.uuid(), route[1]);
    if (request.method==='GET' && route[2]==='mixed-items' && mixed) {
      const query=domainParse(z.strictObject({offset:z.string().regex(/^(0|[1-9]\d{0,9})$/u).optional()}),Object.fromEntries(url.searchParams));
      if (url.searchParams.size>1) domainReject('invalid_cursor',400);
      return respond(await service.mixedResults(owner,id,Number(query.offset??0)));
    }
    if (request.method === 'GET' && route[2] === 'summary') return respond(await service.summary(owner, id,
      request.headers.get('x-handover-account-backup') === '1', supportsAccountPreferencePackage(request.headers)));
    if (request.method === 'GET' && route[2] === 'enrolments') return respond(await service.enrolments(owner, id));
    if (request.method === 'GET' && route[2] === 'items') {
      const entries = [...url.searchParams];
      if (new Set(entries.map(([key]) => key)).size !== entries.length) domainReject('invalid_input', 400);
      return respond(await service.results(owner, id, Object.fromEntries(entries)));
    }
    if (request.method === 'GET' && !route[2]) return respond(compatibleView(await service.get(owner, id)));
    if (request.method === 'POST' && route[2] === 'cancel') return respond(compatibleView(await service.cancel(owner, id, await readJson(request))));
    if (request.method === 'POST' && route[2] === 'resume') return respond(compatibleView(await service.resume(owner, id, await readJson(request), request.signal)));
    domainReject('not_found', 404);
  } catch (error) {
    if (error instanceof HandoverArchiveError) domainReject(error.code, 400);
    if (error instanceof HandoverObjectError) domainReject(error.code, error.code === 'package_object_conflict' ? 409 : 503);
    throw error;
  }
  function compatibleView(view:Awaited<ReturnType<typeof service.get>>) {
    return mixed ? view : {...view,targets:view.targets.filter(target=>target.sections.length>0)};
  }
}
