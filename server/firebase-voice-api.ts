import { attachmentReadSelection } from './firestore-attachment-access.ts';
import { attachmentListQuery } from './firestore-attachment-list.ts';
import { z } from 'zod';
import { VOICE_LIMITS, voiceReservationSchema } from '../src/shared/voice.ts';
import type { FirestoreVoiceTranscripts } from './firestore-voice-transcripts.ts';
import type { FirestoreVoiceStore } from './firestore-voice.ts';
import { FirestoreDomainError, domainParse, domainReject } from './firestore-domain-data.ts';

export type FirebaseVoiceApiPort = Pick<FirestoreVoiceStore, 'reserve' | 'get' | 'upload' | 'reconcile' | 'content' | 'delete'> & Partial<Pick<FirestoreVoiceStore, 'list' | 'forSharedSpace'>> & { transcripts?: Pick<FirestoreVoiceTranscripts, 'get'> & Partial<Pick<FirestoreVoiceTranscripts, 'forSharedSpace'>> };
export const VOICE_UPLOAD_BODY_BYTES = Math.ceil(VOICE_LIMITS.bytes / 3) * 4 + 1024;
const version = z.number().int().positive();
const uploadSchema = z.object({ expectedVersion: version, base64: z.string().min(1).max(VOICE_UPLOAD_BODY_BYTES - 1024) }).strict();
async function json(request: Request, maximum = 2048): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) domainReject('unsupported_media_type', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > maximum)) domainReject('request_body_too_large', 413);
  const reader = request.body?.getReader(); if (!reader) domainReject('invalid_json', 400);
  const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break;
      total += next.value.length; if (total > maximum) { await reader.cancel(); domainReject('request_body_too_large', 413); }
      parts.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } catch (error) { if (error instanceof FirestoreDomainError) throw error; domainReject('invalid_json', 400); }
  finally { reader.releaseLock(); }
}
/** Caller supplies the same authenticated transport and origin policy used by the existing photo API. */
export async function handleFirebaseVoiceRequest(request: Request, userId: string, voice: FirebaseVoiceApiPort,
  isCurrentUser: (userId: string) => Promise<boolean>): Promise<Response> {
  const expected = request.headers.get('x-expected-user-id');
  if (!expected) domainReject('account_precondition_required', 428);
  if (expected !== userId) domainReject('session_changed', 409);
  const url = new URL(request.url), match = /^\/api\/children\/([^/]+)\/voices(?:\/([^/]+)(?:\/(content|resolve|delete|transcript))?)?$/u.exec(url.pathname);
  if (!match || !z.uuid().safeParse(match[1]).success || match[2] && !z.uuid().safeParse(match[2]).success) domainReject('not_found', 404);
  const selection = attachmentReadSelection(request, url);
  const reads = selection ? voice.forSharedSpace?.(selection) : voice;
  if (!reads) domainReject('shared_attachment_unavailable', 503);
  const listing = request.method === 'GET' && !match[2];
  const listQuery = listing ? attachmentListQuery(url) : undefined;
  if (!listing && url.search) domainReject('invalid_input', 400);
  const childId = match[1].toLowerCase(), id = match[2]?.toLowerCase(), action = match[3];
  const active = async () => { if (!await isCurrentUser(userId)) domainReject('identity_changed', 409); };
  await active(); let response: Response;
  if (listing) {
    if (!reads.list) domainReject('attachment_list_unavailable', 503);
    response = Response.json(await reads.list(userId, childId, listQuery));
  } else if (request.method === 'POST' && !id) {
    const input = domainParse(voiceReservationSchema, await json(request)); await active();
    response = Response.json({ voice: await voice.reserve(userId, childId, input) }, { status: 201 });
  } else if (request.method === 'GET' && id && !action) response = Response.json({ voice: await reads.get(userId, childId, id) });
  else if (request.method === 'GET' && id && action === 'transcript') {
    const transcripts = selection ? voice.transcripts?.forSharedSpace?.(selection) : voice.transcripts;
    if (!transcripts) domainReject('voice_transcript_unavailable', 503);
    response = Response.json({ transcript: await transcripts.get(userId, childId, id) });
  } else if (request.method === 'POST' && id && action === 'content') {
    const input = domainParse(uploadSchema, await json(request, VOICE_UPLOAD_BODY_BYTES)); await active();
    response = Response.json({ voice: await voice.upload(userId, childId, id, input.expectedVersion, input.base64, request.signal) });
  } else if (request.method === 'POST' && id && action === 'resolve') {
    domainParse(z.object({}).strict(), await json(request)); await active();
    response = Response.json({ voice: await voice.reconcile(userId, childId, id) });
  } else if (request.method === 'POST' && id && action === 'delete') {
    const input = domainParse(z.object({ expectedVersion: version, opId: z.uuid() }).strict(), await json(request)); await active();
    response = Response.json(await voice.delete(userId, childId, id, input.expectedVersion, input.opId));
  } else if (request.method === 'GET' && id && action === 'content') {
    const value = await reads.content(userId, childId, id);
    response = new Response(new Uint8Array(value.buffer), { headers: { 'Content-Type': value.descriptor.mimeType,
      'Content-Length': String(value.buffer.length), 'X-Content-SHA256': value.descriptor.sha256,
      'Content-Disposition': 'inline; filename=recording', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } else domainReject('method_not_allowed', 405);
  await active(); response.headers.set('Cache-Control', 'private, no-store'); return response;
}
