import type { FirebaseAuthPort } from './firebase-auth.ts';
import type { FirestoreAdmin } from './firestore-admin.ts';
import { domainReject } from './firestore-domain-data.ts';
/** Deployment-only UID. Empty is deliberately locked, never first-user or email-based promotion. */
export function readAdminUid(env: Record<string, string | undefined>): string | null {
  const value = env.YUBAN_ADMIN_UID;
  if (!value) return null;
  if (!/^[^\s/]{1,128}$/.test(value)) throw new Error('invalid_admin_configuration');
  return value;
}
export async function handleAdminRequest(request: Request, options: { auth: FirebaseAuthPort; admin: FirestoreAdmin;
  adminUid: string | null; publicOrigin: string; readJson(request: Request): Promise<unknown> }) {
  const { auth, admin, adminUid } = options, url = new URL(request.url);
  const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
  if (!userId) domainReject('unauthorized', 401);
  if (request.headers.get('x-expected-user-id') !== userId) domainReject('identity_changed', 409);
  const permitted = adminUid !== null && userId === adminUid;
  if (url.pathname === '/api/admin/session' && request.method === 'GET') return Response.json({ administrator: permitted });
  if (!permitted) domainReject('forbidden', 403);
  let result: unknown;
  if (request.method === 'POST' && url.pathname === '/api/admin/operations') {
    if (request.headers.get('origin') !== options.publicOrigin) domainReject('origin_rejected', 403);
    if ((await auth.assertRecentReauthentication(request.headers)).user.id !== userId) domainReject('identity_changed', 409);
    result = await admin.submit(userId, await options.readJson(request));
  } else if (request.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    if (url.pathname === '/api/admin/policy') result = await admin.overview();
    else if (url.pathname === '/api/admin/invitations') result = await admin.invitations(cursor);
    else if (url.pathname === '/api/admin/invitation') result = { invitation: await admin.lookup(url.searchParams.get('email') ?? '') };
    else if (url.pathname === '/api/admin/usage') result = await admin.usage(url.searchParams.get('day') ?? new Date().toISOString().slice(0, 10));
    else if (url.pathname === '/api/admin/audit') result = await admin.audit(cursor);
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
