import type { Firestore, Transaction } from '@google-cloud/firestore';
import { platformCardMedia, platformMediaLink, type PlatformCardMedia } from '../src/shared/platform-media.ts';
import { platformMaterials } from './platform-materials.ts';
import { domainReject } from './firestore-domain-data.ts';

/** Public platform metadata only. Concurrent link refreshes and operator settings share a revision. */
export function createPlatformMediaStore(database: Firestore, namespace: string) {
  const ref = (sourceId: string) => database.collection(namespace + '_platform_card_media').doc(sourceId);
  const known = (id: string) => platformMaterials.get(id);
  const normalized = (links: string[]) => [...new Set(links.map(link => platformMediaLink(link)).filter((url): url is string => !!url))].sort();
  async function read(tx: Transaction, id: string): Promise<PlatformCardMedia> {
    const material = known(id);
    if (!material) domainReject('knowledge_source_not_allowed', 403);
    const doc = await tx.get(ref(id));
    return doc.exists ? platformCardMedia.parse(doc.data()) : { enabled: false, revision: 0, links: normalized(material.mediaLinks) };
  }
  async function toggle(tx: Transaction, id: string, enabled: boolean, revision: number) {
    const prior = await read(tx, id);
    if (prior.enabled === enabled) return prior;
    if (prior.revision !== revision) domainReject('knowledge_media_changed', 409);
    const next = { ...prior, enabled, revision: prior.revision + 1 };
    tx.set(ref(id), next);
    return next;
  }
  async function reconcile(tx: Transaction, id: string, urls: string[], verifiedPages?: PlatformCardMedia['pages']) {
    if (!known(id)) return;
    const prior = await read(tx, id), links = normalized(urls);
    const pages = (verifiedPages ?? prior.pages ?? []).filter(page => links.includes(page.url));
    if (JSON.stringify(links) === JSON.stringify(prior.links) && JSON.stringify(pages) === JSON.stringify(prior.pages ?? [])) return;
    // Binding a newly discovered video to a card requires processing that exact link.
    const next = platformCardMedia.parse({ enabled: prior.enabled, revision: prior.revision + 1, links, ...(pages.length ? { pages } : {}),
      ...(prior.clips ? { clips: prior.clips.filter(clip => links.includes(clip.link)) } : {}) });
    tx.set(ref(id), next);
  }
  return { read, toggle, reconcile, database, ref };
}
export type PlatformMediaStore = ReturnType<typeof createPlatformMediaStore>;
