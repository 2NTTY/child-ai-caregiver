import { z } from 'zod';
import { PHOTO_LIMITS } from '../src/shared/photos.ts';
import type { FirestorePhotoCursor, FirestorePhotoStore } from './firestore-photos.ts';
import { FirestoreDomainError, domainParse, domainReject } from './firestore-domain-data.ts';
import type { PhotoAgent } from './photo-agent.ts';

export type FirebasePhotoApiPort = Pick<FirestorePhotoStore, 'list' | 'get' | 'content' | 'upload'>;
const cursorSchema = z.object({ scopeTag: z.string().regex(/^[a-f0-9]{64}$/u), sortKey: z.string().min(1).max(80) }).strict();
const MAX_BASE64 = Math.ceil(PHOTO_LIMITS.bytes / 3) * 4, MAX_BODY = MAX_BASE64 + 1024;
const uploadSchema = z.object({ base64: z.string().min(1).max(MAX_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/u) }).strict();
function decodeCursor(value: string | null): FirestorePhotoCursor | null {
  if (value === null) return null;
  if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(value)) domainReject('invalid_cursor', 400);
  try {
    const bytes = Buffer.from(value, 'base64url'); if (bytes.toString('base64url') !== value) domainReject('invalid_cursor', 400);
    return domainParse(cursorSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'invalid_cursor', 400);
  } catch { domainReject('invalid_cursor', 400); }
}
async function uploadJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) domainReject('unsupported_media_type', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > MAX_BODY)) domainReject('request_body_too_large', 413);
  const reader = request.body?.getReader(); if (!reader) domainReject('invalid_json', 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > MAX_BODY) { await reader.cancel(); domainReject('request_body_too_large', 413); }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) { if (error instanceof FirestoreDomainError) throw error; domainReject('invalid_json', 400); }
  finally { reader.releaseLock(); }
}

/** Reads and immutable upload keep their existing wire. Reservation/deletion use only original online receipts. */
export async function handleFirebasePhotoRequest(request: Request, userId: string, photos: FirebasePhotoApiPort,
  isCurrentUser: (userId: string) => Promise<boolean>, agent?: PhotoAgent): Promise<Response> {
  const expected = request.headers.get('x-expected-user-id');
  if (!expected) domainReject('account_precondition_required', 428);
  if (expected !== userId) domainReject('session_changed', 409);
  const url = new URL(request.url), match = /^\/api\/children\/([^/]+)\/photos(?:\/([^/]+)(?:\/(content|extract|confirm|delete))?)?$/u.exec(url.pathname);
  if (!match || !z.uuid().safeParse(match[1]).success || match[2] && !z.uuid().safeParse(match[2]).success) domainReject('not_found', 404);
  const childId = match[1].toLowerCase(), id = match[2]?.toLowerCase(), action = match[3];
  const queryKeys = request.method === 'GET' && !id ? ['cursor', 'limit'] : [];
  if ([...url.searchParams.keys()].some(key => !queryKeys.includes(key)) || queryKeys.some(key => url.searchParams.getAll(key).length > 1)) domainReject('invalid_input', 400);
  if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
  let response: Response;
  if (request.method === 'GET' && !id) {
    const rawLimit = url.searchParams.get('limit');
    if (rawLimit !== null && !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit)) domainReject('invalid_input', 400);
    const page = await photos.list(userId, childId, { limit: rawLimit === null ? 50 : Number(rawLimit), cursor: decodeCursor(url.searchParams.get('cursor')) });
    const nextCursor = page.nextCursor === null ? null : Buffer.from(JSON.stringify(domainParse(cursorSchema, page.nextCursor, 'photo_integrity', 503))).toString('base64url');
    if (typeof page.complete !== 'boolean' || page.complete !== (nextCursor === null)) domainReject('photo_integrity', 503);
    response = Response.json({ ...page, nextCursor });
  } else if (request.method === 'GET' && id && !action) {
    response = Response.json({ photo: await photos.get(userId, childId, id) });
  } else if (request.method === 'GET' && id && action === 'content') {
    const content = await photos.content(userId, childId, id);
    response = new Response(new Uint8Array(content.bytes), { headers: { 'Content-Type': content.mimeType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename=photo', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } else if (request.method === 'POST' && id && action === 'extract') {
    if (!agent) domainReject('firebase_domain_not_ready', 503);
    const input = domainParse(z.object({ expectedVersion: z.number().int().positive(), confirmModel: z.literal(true) }).strict(), await uploadJson(request));
    response = Response.json({ photo: await agent.extract(userId, childId, id, input.expectedVersion, request.signal, () => isCurrentUser(userId)) });
  } else if (request.method === 'POST' && action === 'confirm') domainReject('operation_required', 428);
  else if (request.method === 'POST' && (!id || action === 'delete')) domainReject('operation_required', 428);
  else if (request.method === 'POST' && id && action === 'content') {
    const input = domainParse(uploadSchema, await uploadJson(request));
    const bytes = Buffer.from(input.base64, 'base64');
    if (!bytes.length || bytes.length > PHOTO_LIMITS.bytes || bytes.toString('base64') !== input.base64) domainReject('invalid_photo', 400);
    if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
    response = Response.json({ photo: await photos.upload(userId, childId, id, input.base64) });
  } else domainReject('method_not_allowed', 405);
  if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
  return response;
}
