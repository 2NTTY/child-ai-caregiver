import { z } from 'zod';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import type { StorageCipher } from './storage-crypto.ts';
import { FirestoreDomainData } from './firestore-domain-data.ts';
import { FamilyError } from './family-access.ts';
import { librarySelectionMode, type LibrarySelectionCommand } from '../src/shared/source-series.ts';

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const saved = z.strictObject({
  revision: z.int().positive(), seriesId: key, enabled: z.boolean(), mode: librarySelectionMode,
  editions: z.array(z.strictObject({ sourceId: key, versionId: z.uuid(), scopeHash: z.string().regex(/^[a-f0-9]{64}$/u) })).max(100),
});
const preferences = z.array(saved).max(100);
export const librarySelectionRecord = z.strictObject({ series: preferences });
const nil = '00000000-0000-0000-0000-000000000000';
export const librarySelectionScope = (ownerUserId: string) => ({ ownerUserId, workspaceId: nil, childId: nil, storageEpoch: nil });
export type SavedSeries = z.infer<typeof saved>;
export interface SelectionEdition { sourceId: string; versionId: string; seriesId: string; scopeHash: string; legacyScopeHash?: string }

export function explicitlyDisabled(rows: SavedSeries[], seriesId: string) {
  return rows.some(row => row.seriesId === seriesId && !row.enabled);
}

export function selectedEdition(rows: SavedSeries[], document: SelectionEdition) {
  const series = rows.find(row => row.seriesId === document.seriesId);
  const mode = series?.mode ?? 'platform';
  const pin = series?.editions.find(item => item.sourceId === document.sourceId);
  // A moved snapshot can still answer from its original reviewed edition. Adopting the new series is explicit.
  const previous = !pin ? rows.find(row => row.seriesId !== document.seriesId
    && row.editions.some(item => item.sourceId === document.sourceId)) : undefined;
  const eligible = mode === 'platform' ? !previous : !!pin && (pin.scopeHash === document.scopeHash || pin.scopeHash === document.legacyScopeHash)
    && (pin.versionId === document.versionId || mode === 'follow');
  const view = { revision: series?.revision ?? 0, enabled: series?.enabled ?? true, mode, selectedVersionId: pin?.versionId ?? null, eligible };
  const historical = previous?.enabled && previous.mode === 'fixed' ? previous.editions.find(item => item.sourceId === document.sourceId) : undefined;
  return { view, snapshotVersionId: (mode === 'fixed' ? view.selectedVersionId : null) ?? historical?.versionId ?? null };
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
  return { read, async save(tx: Transaction, owner: string, change: LibrarySelectionCommand, available: SelectionEdition[]) {
    const rows = await read(tx, owner), prior = rows.find(row => row.seriesId === change.seriesId);
    const editions = available.filter(row => row.seriesId === change.seriesId);
    if ('action' in change) {
      if (!editions.length) throw new FamilyError(409, 'library_selection_changed');
      if (prior && prior.mode !== 'platform') return { revision: prior.revision };
      // A free follow cannot take a document away from another saved selection after a series move.
      if (rows.some(row => row.seriesId !== change.seriesId && row.editions.some(pin => editions.some(item => item.sourceId === pin.sourceId))))
        throw new FamilyError(409, 'library_selection_changed');
      change = { seriesId: change.seriesId, expectedRevision: change.expectedRevision, editions: change.editions,
        mode: 'follow', enabled: prior?.enabled ?? true };
    }
    if (change.expectedRevision !== (prior?.revision ?? 0) || editions.length !== change.editions.length
      || editions.some(row => !change.editions.some(item => item.sourceId === row.sourceId && item.versionId === row.versionId)))
      throw new FamilyError(409, 'library_selection_changed');
    const adoptCurrent = change.mode === 'fixed' && change.adopt;
    const retain = prior && prior.mode !== 'platform' && !adoptCurrent;
    const selected = change.mode === 'platform' ? [] : retain ? prior.editions
      : editions.map(({ sourceId, versionId, scopeHash }) => ({ sourceId, versionId, scopeHash }));
    const next = saved.parse({ seriesId: change.seriesId, revision: change.expectedRevision + 1, enabled: change.enabled, mode: change.mode, editions: selected });
    // Explicit adoption moves only the chosen document bindings. Preserve the other card's mode and revision history.
    const others = rows.filter(row => row.seriesId !== change.seriesId).map(row => {
      const kept = row.editions.filter(item => !selected.some(current => current.sourceId === item.sourceId));
      return kept.length === row.editions.length ? row : { ...row, revision: row.revision + 1, editions: kept };
    });
    write(tx, owner, [...others, next]);
    return { revision: next.revision };
  } };
}
