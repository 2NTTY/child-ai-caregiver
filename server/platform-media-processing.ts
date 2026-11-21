import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { mediaCue, mediaUrlSchema, platformCardMedia, type MediaCue } from '../src/shared/platform-media.ts';
import { loadMediaOriginals, type MediaOriginal } from './platform-media-evidence.ts';
import type { PlatformMediaStore } from './firestore-platform-media.ts';
import { platformMaterials } from './platform-materials.ts';

const savedCues = z.array(mediaCue).min(1).max(200);
export const mediaEditionRecord = z.strictObject({ url: mediaUrlSchema, sourceId: z.string().regex(/^[a-z0-9-]{1,80}$/u),
  at: z.iso.datetime(), state: z.enum(['reserved','ready']), cues: savedCues.optional(), method: z.enum(['captions','aligned_script','media']).optional()
}).refine(row => row.state === 'ready' ? !!row.cues && !!row.method : !row.cues && !row.method);
export type MediaAnalyzer = (original: MediaOriginal, signal: AbortSignal, authorize: () => Promise<boolean>) => Promise<MediaCue[]>;
export function createPlatformMediaProcessor(store: PlatformMediaStore, namespace: string, analyze: MediaAnalyzer,
  loadOriginals = loadMediaOriginals) {
  const { database } = store;
  return async function processCard(id: string, signal: AbortSignal) {
    if (!platformMaterials.has(id)) return;
    const read = () => database.runTransaction(tx => store.read(tx, id), { readOnly: true });
    const card = await read();
    if (!card.enabled) return;
    let unavailable: Error | undefined;
    for (const link of card.links) {
      signal.throwIfAborted();
      const before = await read();
      if (!before.enabled || !before.links.includes(link)) continue;
      const allowed = async () => {
        const state = await read();
        return !signal.aborted && state.enabled && state.revision === before.revision && state.links.includes(link);
      };
      let originals: MediaOriginal[];
      try {
        originals = await loadOriginals(link, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof Error) || error.message !== 'knowledge_media_source_unavailable') throw error;
        unavailable ??= error;
        continue;
      }
      const clips: NonNullable<typeof card.clips> = [];
      const pendingUrls = new Set<string>();
      for (const original of originals) {
        // Untimed publisher dialogue is reviewed in the text edition. Retain only existing clips bound to this original.
        if (!original.captions.length && original.transcript.trim()) {
          clips.push(...(before.clips ?? []).filter(clip => clip.link === link && clip.url === original.url && clip.evidenceHash === original.hash));
          continue;
        }
        const ref = database.collection(namespace + '_platform_media_editions').doc(original.hash);
        const claim = await database.runTransaction(async tx => {
          const state = await store.read(tx, id), snap = await tx.get(ref);
          if (!state.enabled || state.revision !== before.revision || !state.links.includes(link)) return null;
          if (snap.exists) {
            if (snap.get('url') !== original.url) throw Error('knowledge_media_binding_invalid');
            if (snap.get('state') !== 'ready') return 'pending' as const;
            return { cues: savedCues.parse(snap.get('cues')) };
          }
          tx.create(ref, { state: 'reserved', url: original.url, sourceId: id, at: new Date().toISOString() });
          return { cues: null };
        });
        if (!claim) return;
        if (claim === 'pending') {
          // Keep the last confirmed clips for this stream while its original claim is unresolved.
          pendingUrls.add(original.url);
          continue;
        }
        let result = claim.cues;
        if (!result) {
          try {
            result = savedCues.parse(original.captions.length ? original.captions : await analyze(original, signal, allowed));
            if (original.duration && result.some(cue => cue.end > original.duration! + 1)) throw Error('knowledge_media_time_invalid');
            await database.runTransaction(async tx => {
              const current = await tx.get(ref);
              if (current.get('state') !== 'reserved') throw Error('knowledge_media_binding_invalid');
              tx.update(ref, { state: 'ready', cues: result, method: original.captions.length ? 'captions' : 'media' });
            });
          } catch (error) {
            // These failures happen before provider dispatch. An ambiguous request remains reserved.
            if (error instanceof Error && ['knowledge_media_not_authorized','knowledge_media_daily_capacity'].includes(error.message))
              await database.runTransaction(async tx => { if ((await tx.get(ref)).get('state') === 'reserved') tx.delete(ref); });
            throw error;
          }
        }
        clips.push(...result.map(cue => ({ ...cue, link, url: original.url, evidenceHash: original.hash })));
      }
      await database.runTransaction(async tx => {
        const prior = await store.read(tx, id);
        if (!prior.enabled || prior.revision !== before.revision || !prior.links.includes(link)) return;
        const combined = [...(prior.clips ?? []).filter(clip => clip.link !== link || pendingUrls.has(clip.url)), ...clips]
          .sort((a, b) => a.link.localeCompare(b.link) || a.url.localeCompare(b.url) || a.start - b.start);
        if (isDeepStrictEqual(combined, prior.clips ?? [])) return;
        tx.set(store.ref(id), platformCardMedia.parse({ ...prior, clips: combined, revision: prior.revision + 1 }));
      });
    }
    if (unavailable) throw unavailable;
  };
}
