import type { FirebaseAuthPort } from './firebase-auth.ts';
import type { FirestoreAdmin } from './firestore-admin.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { adminTransferControlSchema, adminTransferDigestSchema } from '../src/shared/admin-knowledge-transfer.ts';
import { adminTransferView } from './knowledge-transfer-records.ts';
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
  adminUid: string | null; proactiveDemo?: ReturnType<typeof import('./proactive-demo.ts').createProactiveDemo>; publicOrigin: string; readJson(request: Request): Promise<unknown> }) {
  const { auth, admin, adminUid } = options, url = new URL(request.url);
  const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
  if (!userId) domainReject('unauthorized', 401);
  if (request.headers.get('x-expected-user-id') !== userId) domainReject('identity_changed', 409);
  const permitted = adminUid !== null && userId === adminUid;
  if (url.pathname === '/api/admin/session' && request.method === 'GET') return Response.json({ administrator: permitted });
  if (!permitted) domainReject('forbidden', 403);
  let result: unknown;
  const batchBase = '/api/admin/knowledge-index-batches';
  const batchPath = /^\/api\/admin\/knowledge-index-batches\/([a-f0-9-]+)(?:\/(stop|resume))?$/.exec(url.pathname);
  const transfersBase = '/api/admin/knowledge-transfers';
  const transferPath = /^\/api\/admin\/knowledge-transfers\/([a-f0-9]{64})(?:\/(stop|resume))?$/u.exec(url.pathname);
  const demoPath = '/api/admin/proactive-demo';
  if (request.method === 'POST' && (url.pathname === demoPath || url.pathname === '/api/admin/operations' || url.pathname === batchBase || batchPath?.[2] || transferPath?.[2])) {
    if (request.headers.get('origin') !== options.publicOrigin) domainReject('origin_rejected', 403);
    if ((await auth.assertRecentReauthentication(request.headers)).user.id !== userId) domainReject('identity_changed', 409);
    const input = await options.readJson(request);
    if (url.pathname === '/api/admin/operations') result = await admin.submit(userId, input);
    else if ([...url.searchParams].length) domainReject('invalid_input', 400);
    else if (url.pathname === demoPath) {
      if (!options.proactiveDemo) domainReject('demo_not_configured',409);
      result = await options.proactiveDemo.publish(input);
    } else if (transferPath) {
      const { expectedRevision } = domainParse(adminTransferControlSchema, input);
      const operator = 'web-' + firestoreDomainHash(['knowledge-transfer-operator', userId]);
      const batch = await transferRequest(() => admin.knowledgeTransfers().control(transferPath[1], transferPath[2] as 'stop' | 'resume', expectedRevision, operator));
      result = { batch: adminTransferView(batch) };
    }
    else if (url.pathname === batchBase) result = await admin.knowledgeIndexes().create(userId, input);
    else result = await admin.knowledgeIndexes().control(userId, batchPath![1], batchPath![2] as 'stop'|'resume', input);
  } else if (request.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    if (url.pathname === demoPath) result = {enabled: options.proactiveDemo?.enabled === true};
    else if (url.pathname.startsWith(demoPath + '/') && options.proactiveDemo) result = await options.proactiveDemo.get(url.pathname.slice(demoPath.length + 1));
    else if (url.pathname === '/api/admin/policy') result = await admin.overview();
    else if (url.pathname === '/api/admin/invitations') result = await admin.invitations(cursor);
    else if (url.pathname === '/api/admin/invitation') result = { invitation: await admin.lookup(url.searchParams.get('email') ?? '') };
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
