import { z } from 'zod';
import { avatarContentInputSchema, avatarContentQuerySchema, type AvatarReadResult, type AvatarTarget, type AvatarUpload } from '../src/shared/avatars.ts';
import { FirestoreDomainError, domainParse, domainReject } from './firestore-domain-data.ts';

export interface FirebaseAvatarUploadAdmission {
  maxBytes: number; totalTimeoutMs: number;
  /** One-use, authority-bound continuation; parsing failures still release ingress admission. */
  upload(bytes: Buffer, signal: AbortSignal): Promise<AvatarUpload>;
  release(): void;
}
export interface FirebaseAvatarApiPort {
  readonly retryAfterSeconds: number;
  read(userId: string, target: AvatarTarget): Promise<AvatarReadResult>;
  uploadStatus(userId: string, target: AvatarTarget, uploadId: string): Promise<AvatarUpload>;
  /** Acquires bounded ingress admission and checks the original reservation before reading any body bytes. */
  uploadAdmission(userId: string, target: AvatarTarget, uploadId: string): Promise<FirebaseAvatarUploadAdmission>;
  content(userId: string, target: AvatarTarget, assetId: string, version: number): Promise<{ buffer: Buffer }>;
}
export function avatarPath(path: string): { target: AvatarTarget; action: 'read' | 'uploads' | 'upload' | 'upload-content' | 'content' | 'commit' | 'remove'; uploadId?: string } | null {
  const match = /^\/api\/(me|children\/([^/]+))\/avatar(?:\/(uploads)(?:\/([^/]+)(?:\/(content))?)?|\/(content|commit|remove))?$/u.exec(path);
  if (!match || match[2] && !z.uuid().safeParse(match[2]).success || match[4] && !z.uuid().safeParse(match[4]).success) return null;
  const target: AvatarTarget = match[1] === 'me' ? { kind: 'self' } : { kind: 'child', childId: match[2].toLowerCase() };
  return { target, action: match[6] as 'content' | 'commit' | 'remove' || (match[5] ? 'upload-content' : match[4] ? 'upload' : match[3] ? 'uploads' : 'read'),
    ...(match[4] ? { uploadId: match[4].toLowerCase() } : {}) };
}
async function boundedContent(request: Request, maxBytes: number, totalTimeoutMs: number, signal: AbortSignal): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1) domainReject('avatar_unavailable', 503);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) domainReject('unsupported_media_type', 415);
  const maxBase64 = Math.ceil(maxBytes / 3) * 4, maxBody = maxBase64 + 64;
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > maxBody)) domainReject('avatar_input_too_large', 413);
  const reader = request.body?.getReader(); if (!reader) domainReject('invalid_json', 400);
  const parts: Uint8Array[] = []; let size = 0, expired = false;
  const abort = () => { expired = true; void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, totalTimeoutMs);
  try {
    while (!expired) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBody) { await reader.cancel(); domainReject('avatar_input_too_large', 413); }
      parts.push(part.value);
    }
    if (expired) domainReject('avatar_decode_limit', 422);
    const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, size)));
    const body = domainParse(avatarContentInputSchema, json);
    if (body.base64.length > maxBase64) domainReject('avatar_input_too_large', 413);
    const buffer = Buffer.from(body.base64, 'base64');
    if (!buffer.length || buffer.length > maxBytes) domainReject('avatar_input_too_large', 413);
    if (buffer.toString('base64') !== body.base64) domainReject('invalid_input', 400);
    return buffer;
  } catch (error) { if (error instanceof FirestoreDomainError) throw error; domainReject('invalid_json', 400); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); reader.releaseLock(); parts.length = 0; }
}
export async function handleFirebaseAvatarRequest(request: Request, userId: string, avatars: FirebaseAvatarApiPort | undefined,
  isCurrentUser: (userId: string) => Promise<boolean>): Promise<Response> {
  const startedAt = Date.now();
  const expected = request.headers.get('x-expected-user-id');
  if (!expected) domainReject('account_precondition_required', 428);
  if (expected !== userId) domainReject('session_changed', 409);
  const url = new URL(request.url), route = avatarPath(url.pathname); if (!route) domainReject('not_found', 404);
  if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
  const keys = request.method === 'GET' && route.action === 'content' ? ['assetId', 'version'] : [];
  if ([...url.searchParams.keys()].some(key => !keys.includes(key)) || keys.some(key => url.searchParams.getAll(key).length !== 1)) domainReject('invalid_input', 400);
  // Direct commands remain forbidden even when the optional domain has not been assembled.
  if (request.method === 'POST' && ['uploads', 'commit', 'remove'].includes(route.action)) domainReject('operation_required', 428);
  if (!avatars) domainReject('avatar_unavailable', 503);
  let response: Response;
  if (request.method === 'GET' && route.action === 'read') response = Response.json(await avatars.read(userId, route.target));
  else if (request.method === 'GET' && route.action === 'upload') response = Response.json({ upload: await avatars.uploadStatus(userId, route.target, route.uploadId!) });
  else if (request.method === 'GET' && route.action === 'content') {
    const rawVersion = url.searchParams.get('version');
    if (!rawVersion || !/^[1-9][0-9]{0,9}$/u.test(rawVersion)) domainReject('invalid_input', 400);
    const input = domainParse(avatarContentQuerySchema, { assetId: url.searchParams.get('assetId'), version: Number(rawVersion) });
    const value = await avatars.content(userId, route.target, input.assetId, input.version);
    response = new Response(new Uint8Array(value.buffer), { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(value.buffer.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename=avatar.jpg',
      'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } else if (request.method === 'POST' && route.action === 'upload-content') {
    const admission = await avatars.uploadAdmission(userId, route.target, route.uploadId!);
    let bytes: Buffer | undefined;
    try {
      if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
      const remaining = admission.totalTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) domainReject('avatar_decode_limit', 422);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(remaining)]);
      bytes = await boundedContent(request, admission.maxBytes, remaining, signal);
      if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
      const upload = await admission.upload(bytes, signal);
      if (upload.state !== 'ready' && upload.state !== 'committed') domainReject('avatar_upload_not_ready');
      response = Response.json({ upload });
    } finally { bytes?.fill(0); admission.release(); }
  } else domainReject('method_not_allowed', 405);
  if (!await isCurrentUser(userId)) domainReject('identity_changed', 409);
  return response;
}
