import { createHash } from 'node:crypto';
import { photoMessageReferenceSchema, type PhotoMessageReference } from '../src/shared/photos.ts';
import { decodePhoto } from './photo-files.ts';
import { AgentStopped } from './agent-budget.ts';

export const AGENT_IMAGE_LIMIT = 4;
export interface AgentImageInput { data: string; mimeType: PhotoMessageReference['mimeType']; reference: PhotoMessageReference }
export interface AuthorizedAgentImage { image: AgentImageInput; authorize: () => Promise<boolean> }

/** Per-run originals only. No bytes enter tool responses, ADK events or saved chat. */
export function createAgentImages() {
  const images = new Map<string, AuthorizedAgentImage>();
  return {
    add(input: AuthorizedAgentImage) {
      const reference = photoMessageReferenceSchema.parse(input.image.reference);
      const bytes = decodePhoto(input.image.data, input.image.mimeType);
      if (input.image.mimeType !== reference.mimeType || bytes.length !== reference.bytes
        || createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new AgentStopped('input_limit');
      const previous = images.get(reference.id);
      if (previous && previous.image.reference.sha256 !== reference.sha256) throw new AgentStopped('unauthorized');
      if (!previous && images.size >= AGENT_IMAGE_LIMIT) throw new AgentStopped('input_limit');
      images.set(reference.id, { image: Object.freeze({ ...input.image, reference: Object.freeze(reference) }), authorize: input.authorize });
      return reference;
    },
    references(): PhotoMessageReference[] { return [...images.values()].map(item => ({ ...item.image.reference })); },
    inputs(ids?: readonly string[]): AgentImageInput[] {
      if (ids && (new Set(ids).size !== ids.length || ids.some(id => !images.has(id)))) throw new AgentStopped('unauthorized');
      return (ids ? ids.map(id => images.get(id)!) : [...images.values()]).map(item => item.image);
    },
    async authorize() { for (const item of images.values()) if (!await item.authorize()) return false; return true; },
  };
}
export type AgentImages = ReturnType<typeof createAgentImages>;
