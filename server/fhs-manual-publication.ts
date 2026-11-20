import { readFileSync } from 'node:fs';
import { z } from 'zod';

const pinSchema = z.strictObject({ sourceId: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u), pages: z.int().positive() });
const manifest = z.object({ lanes: z.array(z.object({ id: z.enum(['C1', 'C2', 'C3']), sources: z.array(pinSchema) })) })
  .parse(JSON.parse(readFileSync(new URL('../knowledge/fhs-initial-publication-lanes.json', import.meta.url), 'utf8')));
// The original draft is outside the three new lanes and can only continue existing work.
const continuation = Object.freeze({ sourceId: 'pdf-c79a394b580ec9e870d63319', pages: 4,
  sha256: '8975844f24426a25b264294180a3187cf96280854cb7a9d0f37bd0f6179162e8', lane: 'C', resumeOnly: true });
const pins = new Map(manifest.lanes.flatMap(lane => lane.sources.map(source =>
  [source.sourceId, Object.freeze({ ...source, lane: lane.id, resumeOnly: false })] as const)));

export type ManualPublicationPin = Readonly<z.infer<typeof pinSchema> & { lane: string; resumeOnly: boolean }>;
export function manualPublicationPin(sourceId: string): ManualPublicationPin | undefined {
  return sourceId === continuation.sourceId ? continuation : pins.get(sourceId);
}
