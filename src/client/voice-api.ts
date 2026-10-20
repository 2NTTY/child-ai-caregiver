import { z } from 'zod';
import { voiceTranscriptSchema } from '../shared/voice-transcript.ts';
import { VOICE_LIMITS, voiceAttachmentSchema, voiceReservationSchema, type VoiceAttachment, type VoiceReservation } from '../shared/voice.ts';
import { readBlobBytes, sha256Bytes } from './blob-bytes.ts';

export class VoiceApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super('Voice operation could not be confirmed'); this.name = 'VoiceApiError'; this.status = status; this.code = code; }
}
export function createVoiceApi(fetcher: typeof fetch, origin = '', hash: typeof sha256Bytes = sha256Bytes) {
  const apiRoot=origin.replace(/\/$/u,'').replace(/\/api$/u,'')+'/api';
  const base = (childId: string, id?: string) => apiRoot + '/children/' + z.uuid().parse(childId) + '/voices' + (id ? '/' + z.uuid().parse(id) : '');
  async function request(url: string, userId: string, signal: AbortSignal, payload?: unknown) {
    if (!userId || signal.aborted) throw new VoiceApiError(0, 'identity_changed');
    let response: Response;
    try { response = await fetcher(url, { method: payload === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
      headers: { 'x-expected-user-id': userId, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
    catch { throw new VoiceApiError(0, 'voice_operation_unknown'); }
    if (signal.aborted) throw new VoiceApiError(0, 'identity_changed');
    if (!response.ok) {
      let code = 'voice_unavailable';
      try { const body = await response.json(); const candidate = body?.code ?? body?.error?.code; if (typeof candidate === 'string' && /^[a-z_]{1,80}$/u.test(candidate)) code = candidate; } catch { /* Status remains available. */ }
      throw new VoiceApiError(response.status, code);
    }
    return response;
  }
  async function checked(response: Response, childId: string, id: string, signal: AbortSignal): Promise<VoiceAttachment> {
    let raw: unknown; try { raw = await response.json(); } catch { throw new VoiceApiError(0, 'voice_operation_unknown'); }
    const parsed = z.object({ voice: voiceAttachmentSchema }).strict().safeParse(raw);
    if (signal.aborted) throw new VoiceApiError(0, 'identity_changed');
    if (!parsed.success || parsed.data.voice.id !== id || parsed.data.voice.childId !== childId) throw new VoiceApiError(0, 'voice_response_invalid');
    return parsed.data.voice;
  }
  return {
    // The owner retains opId across unknown submissions. Never generate a replacement ID here.
    async reserve(childId: string, input: VoiceReservation, signal: AbortSignal, userId: string) {
      const payload = voiceReservationSchema.parse(input);
      return checked(await request(base(childId), userId, signal, payload), childId, payload.opId, signal);
    },
    async get(childId: string, id: string, signal: AbortSignal, userId: string) {
      return checked(await request(base(childId, id), userId, signal), childId, id, signal);
    },
    async upload(voice: VoiceAttachment, base64: string, signal: AbortSignal, userId: string) {
      return checked(await request(base(voice.childId, voice.id) + '/content', userId, signal, { expectedVersion: voice.version, base64 }), voice.childId, voice.id, signal);
    },
    async resolve(childId: string, id: string, signal: AbortSignal, userId: string) {
      return checked(await request(base(childId, id) + '/resolve', userId, signal, {}), childId, id, signal);
    },
    async delete(voice: VoiceAttachment, opId: string, signal: AbortSignal, userId: string) {
      const response = await request(base(voice.childId, voice.id) + '/delete', userId, signal, { opId: z.uuid().parse(opId), expectedVersion: voice.version });
      const result = z.object({ operationId: z.uuid(), deleted: z.literal(true), cleanupPending: z.boolean() }).strict().safeParse(await response.json());
      if (signal.aborted || !result.success || result.data.operationId !== opId) throw new VoiceApiError(0, 'voice_operation_unknown');
      return result.data;
    },
    async transcript(childId: string, id: string, signal: AbortSignal, userId: string) {
      const response = await request(base(childId, id) + '/transcript', userId, signal);
      const parsed = z.object({ transcript: voiceTranscriptSchema }).strict().safeParse(await response.json());
      if (signal.aborted) throw new VoiceApiError(0, 'identity_changed');
      if (!parsed.success || parsed.data.transcript.voice.id !== id) throw new VoiceApiError(0, 'voice_response_invalid');
      return parsed.data.transcript;
    },
    async content(voice: VoiceAttachment, signal: AbortSignal, userId: string) {
      if (voice.state !== 'ready' || !voice.bytes || !voice.sha256 || !voice.mimeType) throw new VoiceApiError(409, 'voice_not_available');
      const response = await request(base(voice.childId, voice.id) + '/content', userId, signal);
      if (response.headers.get('content-type') !== voice.mimeType || response.headers.get('x-content-sha256') !== voice.sha256
        || response.headers.get('content-length') !== String(voice.bytes)) throw new VoiceApiError(0, 'voice_response_invalid');
      const blob = await response.blob();
      if (blob.size !== voice.bytes || blob.size > VOICE_LIMITS.bytes) throw new VoiceApiError(0, 'voice_response_invalid');
      const bytes = await readBlobBytes(blob);
      if (await hash(bytes) !== voice.sha256 || signal.aborted) throw new VoiceApiError(0, 'voice_response_invalid');
      return { bytes, mimeType: voice.mimeType };
    },
  };
}
export type VoiceApi = ReturnType<typeof createVoiceApi>;
