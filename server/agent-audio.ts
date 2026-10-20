import { createHash } from 'node:crypto';
import { voiceFileMetadataSchema, type VoiceFileMetadata } from '../src/shared/voice.ts';
import { decodeVoiceBase64 } from './voice-files.ts';
import { AgentStopped } from './agent-budget.ts';

/** Only a currently authorized, previously media-validated Storage object enters this port. */
export interface AgentAudioInput { readonly data: string; readonly mimeType: VoiceFileMetadata['mimeType']; readonly metadata: Readonly<VoiceFileMetadata> }
export function checkedAgentAudio(raw: AgentAudioInput): AgentAudioInput {
  try {
    const metadata = voiceFileMetadataSchema.parse(raw.metadata), bytes = decodeVoiceBase64(raw.data);
    if (raw.mimeType !== metadata.mimeType || bytes.length !== metadata.bytes
      || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw new Error('Invalid audio binding');
    return Object.freeze({ data: raw.data, mimeType: metadata.mimeType, metadata: Object.freeze(metadata) });
  } catch { throw new AgentStopped('input_limit'); }
}

/** Persist the identity only; the provider receives ephemeral bytes after fresh authorization. */
export function agentAudioMarker(audio: AgentAudioInput) {
  return "Server-authorized current audio: " + JSON.stringify(audio.metadata);
}
