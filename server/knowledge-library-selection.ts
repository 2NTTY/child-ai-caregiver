import { z } from 'zod';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import type { StorageCipher } from './storage-crypto.ts';
import { FirestoreDomainData } from './firestore-domain-data.ts';
import { FamilyError } from './family-access.ts';
import type { LibraryPreferenceChange } from '../src/shared/source-series.ts';

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const saved = z.strictObject({
  revision: z.int().positive(), seriesId: key, enabled: z.boolean(), mode: z.enum(['fixed', 'follow']),
  editions: z.array(z.strictObject({ sourceId: key, versionId: z.uuid(), scopeHash: z.string().regex(/^[a-f0-9]{64}$/u) })).min(1).max(100),
});
const preferences = z.array(saved).max(100);
export const librarySelectionRecord = z.strictObject({ series: preferences });
const nil = '00000000-0000-0000-0000-000000000000';
export const librarySelectionScope = (ownerUserId: string) => ({ ownerUserId, workspaceId: nil, childId: nil, storageEpoch: nil });
export type SavedSeries = z.infer<typeof saved>;
export interface SelectionEdition { sourceId: string; versionId: string; seriesId: string; scopeHash: string }

export function explicitlyDisabled(rows: SavedSeries[], seriesId: string, sourceId: string) {
  return rows.some(row => !row.enabled && (row.seriesId === seriesId || row.editions.some(item => item.sourceId === sourceId)));
}

export function selectedEdition(rows: SavedSeries[], document: SelectionEdition) {
  const series = rows.find(row => row.seriesId === document.seriesId);
  const entry = rows.find(row => row.editions.some(item => item.sourceId === document.sourceId)) ?? series;
  const pin = entry?.editions.find(item => item.sourceId === document.sourceId);
  const eligible = !entry && rows.length === 0 || !!entry && !!pin && entry.seriesId === document.seriesId && pin.scopeHash === document.scopeHash
    && (pin.versionId === document.versionId || entry.mode === 'follow');
  return { revision: series?.revision ?? 0, enabled: entry?.enabled ?? (rows.length === 0), mode: entry?.mode ?? 'fixed' as const,
    selectedVersionId: pin?.versionId ?? null, eligible };
}

export function createLibrarySelections(options: { database: Firestore; projectId: string; namespace: string; cipher: StorageCipher }) {
  const data = new FirestoreDomainData(options), kind = 'library-preferences';
  const ref = (owner: string) => data.ref('library_preferences', kind, owner);
  async function read(tx: Transaction, owner: string) {
    const snapshot = await tx.get(ref(owner));
    if (!snapshot.exists) return [];
    return data.open(kind, owner, librarySelectionScope(owner), librarySelectionRecord, snapshot).series;
  }
  function write(tx: Transaction, owner: string, rows: SavedSeries[]) {
    const scope = librarySelectionScope(owner);
    tx.set(ref(owner), { ...data.tags(scope), ...data.seal(kind, owner, scope, librarySelectionRecord, { series: rows }) });
  }
  return { read, async prepare(tx: Transaction, owner: string, available: SelectionEdition[]) {
    const rows = await read(tx, owner);
    if (rows.length || !available.length) return { rows, persist() {} };
    const grouped = new Map<string, SavedSeries>();
    for (const { seriesId, sourceId, scopeHash, versionId } of available) {
      let group = grouped.get(seriesId);
      if (!group) {
        if (grouped.size >= 100) continue;
        group = { seriesId, revision: 1, enabled: true, mode: 'fixed', editions: [] };
        grouped.set(seriesId, group);
      }
      if (group.editions.length < 100) group.editions.push({ sourceId, scopeHash, versionId });
    }
    const initial = [...grouped.values()];
    // The enclosing transaction completes all historical-edition reads before persisting its first snapshot.
    return { rows: initial, persist: () => write(tx, owner, initial) };
  }, async save(tx: Transaction, owner: string, change: LibraryPreferenceChange, available: SelectionEdition[]) {
    const rows = await read(tx, owner), prior = rows.find(row => row.seriesId === change.seriesId);
    const editions = available.filter(row => row.seriesId === change.seriesId);
    if (change.expectedRevision !== (prior?.revision ?? 0) || editions.length !== change.editions.length
      || editions.some(row => !change.editions.some(item => item.sourceId === row.sourceId && item.versionId === row.versionId)))
      throw new FamilyError(409, 'library_selection_changed');
    const next = saved.parse({ seriesId: change.seriesId, revision: change.expectedRevision + 1, enabled: change.enabled, mode: change.mode,
      editions: prior && !change.adopt ? prior.editions : editions.map(({ sourceId, versionId, scopeHash }) => ({ sourceId, versionId, scopeHash })) });
    const others = rows.filter(row => row.seriesId !== change.seriesId).map(row => ({ ...row,
      editions: row.editions.filter(item => !editions.some(current => current.sourceId === item.sourceId)) })).filter(row => row.editions.length);
    write(tx, owner, [...others, next]);
    return { revision: next.revision };
  } };
}
