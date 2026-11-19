import type { FirebaseAuthPort } from './firebase-auth.ts';
import type { FirestoreAdmin } from './firestore-admin.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { adminTransferControlSchema, adminTransferDigestSchema } from '../src/shared/admin-knowledge-transfer.ts';
import { archiveContentPath } from './admin-knowledge-archive.ts';
import { adminTransferView } from './knowledge-transfer-records.ts';
import { z } from 'zod';
import { adminTreatmentPath, treatmentReviewMaxBytes } from '../src/shared/admin-knowledge-treatment.ts';
import { FirestoreKnowledgeError } from './firestore-knowledge.ts';

async function transferRequest<T>(read: () => Promise<T>) {
  try { return await read(); } catch (error) {
    if (error instanceof FirestoreKnowledgeError && ['knowledge_transfer_unknown', 'knowledge_transfer_changed',
      'knowledge_transfer_maintenance'].includes(error.code)) domainReject(error.code, error.status);
    throw error;
  }
}
/** Deployment-only UID. Empty is deliberately locked, never first-user or email-based promotion. */
export function readAdminUid(env: Record<string, string | undefined>): string | null {
  const value = env.YUBAN_ADMIN_UID;
  if (!value) return null;
  if (!/^[^\s/]{1,128}$/.test(value)) throw new Error('invalid_admin_configuration');
  return value;
}
export async function handleAdminRequest(request: Request, options: { auth: FirebaseAuthPort; admin: FirestoreAdmin;
  adminUid: string | null; proactiveDemo?: ReturnType<typeof import('./proactive-demo.ts').createProactiveDemo>; publicOrigin: string; readJson(request: Request,limit?:number): Promise<unknown> }) {
  const { auth, admin, adminUid } = options, url = new URL(request.url);
  const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
  if (!userId) domainReject('unauthorized', 401);
  if (request.headers.get('x-expected-user-id') !== userId) domainReject('identity_changed', 409);
  const permitted = adminUid !== null && userId === adminUid;
  if (url.pathname === '/api/admin/session' && request.method === 'GET') return Response.json({ administrator: permitted });
  if (!permitted) domainReject('forbidden', 403);
  let result: unknown;
  const groupBase='/api/admin/knowledge-index-groups';
  const groupPath=/^\/api\/admin\/knowledge-index-groups\/([a-f0-9-]+)(?:\/(stop|resume))?$/u.exec(url.pathname);
  const batchBase = '/api/admin/knowledge-index-batches';
  const batchPath = /^\/api\/admin\/knowledge-index-batches\/([a-f0-9-]+)(?:\/(stop|resume))?$/.exec(url.pathname);
  const transfersBase = '/api/admin/knowledge-transfers';
  const transferPath = /^\/api\/admin\/knowledge-transfers\/([a-f0-9]{64})(?:\/(stop|resume))?$/u.exec(url.pathname);
  const treatmentPath = adminTreatmentPath.exec(url.pathname);
  const archivePath = archiveContentPath.exec(url.pathname);
  const demoPath = '/api/admin/proactive-demo';
  const alertsPath = '/api/admin/budget-alerts';
  if (request.method === 'POST' && (url.pathname === alertsPath + '/ack' || url.pathname === demoPath || url.pathname === '/api/admin/operations' || url.pathname === batchBase || batchPath?.[2] || url.pathname === groupBase || groupPath?.[2] || transferPath?.[2] || archivePath || treatmentPath)) {
    if (request.headers.get('origin') !== options.publicOrigin) domainReject('origin_rejected', 403);
    if ((await auth.assertRecentReauthentication(request.headers)).user.id !== userId) domainReject('identity_changed', 409);
    const input = archivePath ? undefined : await options.readJson(request,treatmentPath ? treatmentReviewMaxBytes : url.pathname===groupBase ? 64*1024 : undefined);
    if (url.pathname === '/api/admin/operations') result = await admin.submit(userId, input);
    else if ([...url.searchParams].length) domainReject('invalid_input', 400);
    else if (treatmentPath) {
      if (!admin.treatments) domainReject('knowledge_treatments_unavailable',503);
      try { result = await admin.treatments.submit(treatmentPath[1]!,input,'web-' + firestoreDomainHash(['knowledge-treatment-reviewer',userId])); }
      catch (error) {
        if (error instanceof FirestoreKnowledgeError) domainReject(error.code,error.status);
        if (error instanceof z.ZodError) domainReject('knowledge_treatment_invalid',400);
        if (error instanceof Error && /^knowledge_review_[a-z_]+$/u.test(error.message)) domainReject(error.message,409);
        throw error;
      }
    } else if (url.pathname === alertsPath + '/ack') result = await admin.budgetAlerts.ack(input);
    else if (url.pathname === demoPath) {
      if (!options.proactiveDemo) domainReject('demo_not_configured',409);
      result = await options.proactiveDemo.publish(input);
    } else if (archivePath) {
      if (!admin.receiveArchive) domainReject('knowledge_transfers_unavailable',503);
      const operator = 'web-' + firestoreDomainHash(['knowledge-transfer-operator',userId]);
      const batch = await admin.receiveArchive(request,archivePath[1],operator,async () => {
        if ((await auth.getSession({headers:request.headers}))?.user.id !== userId) domainReject('identity_changed',409);
      });
      result = {batch:adminTransferView(batch)};
    }
    else if (transferPath) {
      const { expectedRevision } = domainParse(adminTransferControlSchema, input);
      const operator = 'web-' + firestoreDomainHash(['knowledge-transfer-operator', userId]);
      const batch = await transferRequest(() => admin.knowledgeTransfers().control(transferPath[1], transferPath[2] as 'stop' | 'resume', expectedRevision, operator));
      result = { batch: adminTransferView(batch) };
    }
    else if (url.pathname===groupBase) result=await admin.knowledgeIndexes().createGroup(userId,input);
    else if (groupPath?.[2]) result=await admin.knowledgeIndexes().controlGroup(userId,groupPath[1],groupPath[2] as 'stop'|'resume',input);
    else if (url.pathname === batchBase) result = await admin.knowledgeIndexes().create(userId, input);
    else result = await admin.knowledgeIndexes().control(userId, batchPath![1], batchPath![2] as 'stop'|'resume', input);
  } else if (request.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    if (treatmentPath) {
      if (!admin.treatments) domainReject('knowledge_treatments_unavailable',503);
      const query = [...url.searchParams];
      if(query.length>1 || query.some(([key])=>key!=='version')) domainReject('invalid_input',400);
      const version = url.searchParams.get('version');
      try { result=await admin.treatments.view(treatmentPath[1]!,version===null ? undefined : domainParse(z.uuid(),version)); }
      catch(error) { if(error instanceof FirestoreKnowledgeError) domainReject(error.code,error.status); throw error; }
    } else if (url.pathname === demoPath) result = {enabled: options.proactiveDemo?.enabled === true};
    else if (url.pathname.startsWith(demoPath + '/') && options.proactiveDemo) result = await options.proactiveDemo.get(url.pathname.slice(demoPath.length + 1));
    else if (url.pathname === '/api/admin/policy') result = await admin.overview();
    else if (url.pathname === alertsPath) {
      if ([...url.searchParams].length > 1 || [...url.searchParams.keys()].some(key => key !== 'cursor')) domainReject('invalid_input', 400);
      result = await admin.budgetAlerts.list(cursor);
    }
    else if (url.pathname === '/api/admin/invitations') result = await admin.invitations(cursor);
    else if (url.pathname === '/api/admin/invitation') result = { invitation: await admin.lookup(url.searchParams.get('email') ?? '') };
    else if (url.pathname === '/api/admin/usage/month') result = await admin.monthUsage(url.searchParams.get('month') ?? '');
    else if (url.pathname === '/api/admin/usage') result = await admin.usage(url.searchParams.get('day') ?? new Date().toISOString().slice(0, 10));
    else if (url.pathname === '/api/admin/audit') result = await admin.audit(cursor);
    else if (url.pathname === transfersBase || (transferPath && !transferPath[2])) {
      const entries = [...url.searchParams];
      if (entries.length > 1 || entries.some(([key]) => key !== (transferPath ? 'from' : 'cursor'))) domainReject('invalid_input', 400);
      if (transferPath) {
        const raw = url.searchParams.get('from') ?? '0';
        if (!/^(0|[1-9][0-9]{0,3})$/u.test(raw) || Number(raw) > 4096) domainReject('invalid_input', 400);
        result = await transferRequest(() => admin.knowledgeTransfers().page(transferPath[1], Number(raw)));
      } else {
        if (cursor !== null) domainParse(adminTransferDigestSchema, cursor);
        result = await admin.knowledgeTransfers().list(cursor);
      }
    }
    else if (groupPath && !groupPath[2]) {
      if ([...url.searchParams].length) domainReject('invalid_input',400);
      result=await admin.knowledgeIndexes().getGroup(groupPath[1]);
    }
    else if (url.pathname === '/api/admin/knowledge-versions' || url.pathname === batchBase || (batchPath && !batchPath[2])) {
      const entries = [...url.searchParams];
      if (entries.length > 1 || entries.some(([key]) => key !== 'cursor') || (batchPath && entries.length)) domainReject('invalid_input', 400);
      const indexes = admin.knowledgeIndexes();
      result = batchPath ? await indexes.get(batchPath[1]) : url.pathname === batchBase ? await indexes.list(cursor) : await indexes.versions(cursor);
    }
    else if (url.pathname === '/api/admin/knowledge-status') {
      const entries = [...url.searchParams];
      if (entries.length > 1 || entries.some(([key]) => key !== 'cursor')) domainReject('invalid_input', 400);
      result = await admin.knowledgeStatus(cursor);
    }
    else if (/^\/api\/admin\/operations\/[a-f0-9-]+$/.test(url.pathname)) result = { receipt: await admin.receipt(userId, url.pathname.split('/').at(-1)!) };
    else domainReject('not_found', 404);
  } else domainReject('method_not_allowed', 405);
  try {
    if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) domainReject('identity_changed', 409);
  } catch (error) {
    // A committed command must not become an apparently rejected operation when final session validation fails.
    if (request.method === 'POST') domainReject('operation_result_unknown', 503);
    throw error;
  }
  return Response.json(result);
}
