import { z } from 'zod';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import type { StorageCipher } from './storage-crypto.ts';
import { FirestoreDomainData } from './firestore-domain-data.ts';
import { FamilyError } from './family-access.ts';
import { librarySelectionMode, type LibrarySelectionCommand, type ManagedSeriesView, type ManageSeries } from '../src/shared/source-series.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';
import { isChildHealthSourceId } from './platform-materials.ts';

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const saved = z.strictObject({
  revision: z.int().positive(), seriesId: key, enabled: z.boolean(), mode: librarySelectionMode,
  editions: z.array(z.strictObject({ sourceId: key, versionId: z.uuid(), scopeHash: z.string().regex(/^[a-f0-9]{64}$/u),
    mode: z.enum(['fixed', 'follow']).optional(), enabled: z.boolean().optional() })).max(512),
});
const preferences = z.array(saved).max(512);
export const librarySelectionRecord = z.strictObject({ series: preferences });
const nil = '00000000-0000-0000-0000-000000000000';
export const librarySelectionScope = (ownerUserId: string) => ({ ownerUserId, workspaceId: nil, childId: nil, storageEpoch: nil });
export type SavedSeries = z.infer<typeof saved>;
export interface SelectionEdition { sourceId: string; versionId: string; seriesId: string; scopeHash: string; legacyScopeHash?: string }
export interface ListedPlatformCard {
  seriesId: string; name: string; publisher: string; mode: SavedSeries['mode']; enabled: boolean;
  sourceId: string; versionId: string; revision: number;
  childHealth?: ManagedSeriesView;
}

export function explicitlyDisabled(rows: SavedSeries[], seriesId: string) {
  return rows.some(row => row.seriesId === seriesId && !row.enabled);
}

export function selectedEdition(rows: SavedSeries[], document: SelectionEdition) {
  const series = rows.find(row => row.seriesId === document.seriesId);
  const pin = series?.editions.find(item => item.sourceId === document.sourceId);
  const mode = pin?.mode ?? series?.mode ?? 'platform';
  // A moved snapshot can still answer from its original reviewed edition. Adopting the new series is explicit.
  const previous = !pin ? rows.find(row => row.seriesId !== document.seriesId
    && row.editions.some(item => item.sourceId === document.sourceId)) : undefined;
  const eligible = mode !== 'platform' && !!pin && (pin.scopeHash === document.scopeHash || pin.scopeHash === document.legacyScopeHash)
    && (pin.versionId === document.versionId || mode === 'follow');
  const view = { revision: series?.revision ?? 0, enabled: pin?.enabled ?? series?.enabled ?? true, mode, selectedVersionId: pin?.versionId ?? null, eligible };
  const oldPin = previous?.editions.find(item => item.sourceId === document.sourceId);
  const historical = (oldPin?.enabled ?? previous?.enabled) && (oldPin?.mode ?? previous?.mode) === 'fixed' ? oldPin : undefined;
  const previousChoice = oldPin && previous ? { revision: previous.revision, enabled: oldPin.enabled ?? previous.enabled,
    mode: oldPin.mode ?? previous.mode, selectedVersionId: oldPin.versionId, eligible: false } : undefined;
  return { view, previousChoice, snapshotVersionId: (mode === 'fixed' ? view.selectedVersionId : null) ?? historical?.versionId ?? null };
}

export function childHealthSelection(rows: SavedSeries[], members: SelectionEdition[]): ManagedSeriesView {
  const visible = new Set(members.map(item => item.sourceId));
  const pins = rows.flatMap(row => row.editions.filter(pin => visible.has(pin.sourceId)).map(pin => ({
    enabled: pin.enabled ?? row.enabled, mode: pin.mode ?? row.mode,
  })));
  const nativeIds = new Set(members.map(item => item.seriesId));
  const revisions = rows.filter(row => nativeIds.has(row.seriesId) || row.editions.some(pin => isChildHealthSourceId(pin.sourceId)))
    .map(row => [row.seriesId, row.revision] as const).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const versions = members.map(item => [item.sourceId, item.versionId] as const).sort(([a], [b]) => a.localeCompare(b, 'en'));
  return { total: visible.size, adopted: pins.length, enabled: pins.filter(pin => pin.enabled).length,
    fixed: pins.filter(pin => pin.mode === 'fixed').length, revision: revisions.reduce((sum, [, revision]) => sum + revision, 0),
    stateHash: knowledgeReviewHash([versions, revisions]) };
}

export function applyChildHealthSelection(rows: SavedSeries[], members: SelectionEdition[], change: ManageSeries) {
  const state = childHealthSelection(rows, members);
  if (change.operation === 'join' && state.total && state.adopted === state.total) return rows;
  if (!state.total || state.stateHash !== change.expectedState) throw new FamilyError(409, 'library_selection_changed');
  const current = new Map(members.map(item => [item.sourceId, item]));
  const selectedIds = new Set(rows.flatMap(row => row.editions.map(pin => pin.sourceId)));
  if (change.operation === 'fixed') return fixSnapshots(rows, members.filter(item => selectedIds.has(item.sourceId)));
  const bySeries = new Map(rows.map(row => [row.seriesId, row]));
  if (change.operation === 'join') {
    for (const member of members) {
      if (selectedIds.has(member.sourceId)) continue;
      const prior = bySeries.get(member.seriesId);
      const mode = prior?.mode === 'fixed' ? 'fixed' : 'follow';
      const pin = { sourceId: member.sourceId, versionId: member.versionId, scopeHash: member.scopeHash,
        ...(mode === 'fixed' ? { mode: 'follow' as const } : {}) };
      bySeries.set(member.seriesId, { seriesId: member.seriesId, mode, enabled: prior?.enabled ?? true,
        revision: (rows.find(row => row.seriesId === member.seriesId)?.revision ?? 0) + 1, editions: [...prior?.editions ?? [], pin] });
    }
  } else for (const row of rows) {
    const editions = row.editions.flatMap(pin => {
      if (!isChildHealthSourceId(pin.sourceId)) return [pin];
      if (change.operation === 'remove') return [];
      const member = current.get(pin.sourceId);
      if (!member) return [pin];
      if (change.operation === 'enable' || change.operation === 'disable') {
        const enabled = change.operation === 'enable';
        return (pin.enabled ?? row.enabled) === enabled ? [pin] : [{ ...pin, enabled }];
      }
      if (member.seriesId !== row.seriesId) return [pin];
      return (pin.mode ?? row.mode) === 'follow' ? [pin] : [{ ...pin, mode: 'follow' as const }];
    });
    if (editions.length !== row.editions.length || editions.some((pin, index) => pin !== row.editions[index])) {
      bySeries.set(row.seriesId, normalizeSelection({ ...row, revision: row.revision + 1, editions }));
    }
  }
  return [...bySeries.values()];
}

function fixSnapshots(rows: SavedSeries[], snapshots: SelectionEdition[], enableImported = false) {
  const next = new Map(rows.map(row => [row.seriesId, row]));
  const choices = new Map(rows.flatMap(row => row.editions.map(pin => [pin.sourceId, { row, pin }] as const)));
  const changed = snapshots.filter(item => {
    const old = choices.get(item.sourceId);
    return !old || old.row.seriesId !== item.seriesId || old.pin.versionId !== item.versionId || old.pin.scopeHash !== item.scopeHash
      || (old.pin.mode ?? old.row.mode) !== 'fixed' || enableImported && !(old.pin.enabled ?? old.row.enabled);
  });
  const replacing = new Set(changed.map(item => item.sourceId));
  const touched = new Set(changed.flatMap(item => [item.seriesId, choices.get(item.sourceId)?.row.seriesId ?? item.seriesId]));
  for (const seriesId of touched) {
    const old = next.get(seriesId);
    const editions = old?.editions.filter(pin => !replacing.has(pin.sourceId)) ?? [];
    for (const { sourceId, scopeHash, versionId } of changed.filter(item => item.seriesId === seriesId)) {
      const prior = choices.get(sourceId);
      editions.push({ sourceId, scopeHash, versionId, mode: 'fixed', enabled: enableImported || (prior?.pin.enabled ?? prior?.row.enabled ?? true) });
    }
    next.set(seriesId, normalizeSelection({ seriesId, mode: old?.mode === 'follow' ? 'follow' : 'fixed', enabled: old?.enabled ?? true,
      revision: (old?.revision ?? 0) + 1, editions }));
  }
  return [...next.values()];
}

// Keep the native series defaults meaningful for older clients. Mixed rows carry only exceptions.
function normalizeSelection(row: SavedSeries): SavedSeries {
  const first = row.editions[0];
  if (!first) return { ...row, mode: 'platform' };
  const firstMode = first.mode ?? row.mode, firstEnabled = first.enabled ?? row.enabled;
  const mode = row.editions.every(pin => (pin.mode ?? row.mode) === firstMode) ? firstMode : row.mode;
  const enabled = row.editions.every(pin => (pin.enabled ?? row.enabled) === firstEnabled) ? firstEnabled : row.enabled;
  return { ...row, mode, enabled, editions: row.editions.map(({ mode: pinMode, enabled: pinEnabled, ...pin }) => ({
    ...pin, ...((pinMode ?? row.mode) !== mode && pinMode ? { mode: pinMode } : {}),
    ...((pinEnabled ?? row.enabled) !== enabled ? { enabled: pinEnabled ?? row.enabled } : {}),
  })) };
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
  return { read, async manage(tx: Transaction, owner: string, change: ManageSeries, available: SelectionEdition[]) {
    const rows = await read(tx, owner), next = applyChildHealthSelection(rows, available, change);
    if (next.some((row, index) => row !== rows[index])) write(tx, owner, next);
    return { revision: childHealthSelection(next, available).revision };
  }, async importChildHealth(tx: Transaction, owner: string, expected: number, available: SelectionEdition[], snapshots: SelectionEdition[]) {
    const rows = await read(tx, owner);
    if (childHealthSelection(rows, available).revision !== expected) throw new FamilyError(409, 'library_selection_changed');
    const next = fixSnapshots(rows, snapshots, true);
    if (next.some((row, index) => row !== rows[index])) write(tx, owner, next);
    return { revision: childHealthSelection(next, available).revision };
  }, async save(tx: Transaction, owner: string, change: Exclude<LibrarySelectionCommand, ManageSeries>, available: SelectionEdition[]) {
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
    const displayed = prior?.editions.find(pin => pin.sourceId === change.editions[0]?.sourceId);
    const selected = change.mode === 'platform' ? [] : retain ? prior.editions.map(pin => {
      const { enabled, mode, ...identity } = pin;
      const keepEnabled = change.enabled === (displayed?.enabled ?? prior.enabled);
      const keepMode = change.mode === (displayed?.mode ?? prior.mode);
      return { ...identity, ...(keepEnabled && (enabled ?? prior.enabled) !== change.enabled ? { enabled: enabled ?? prior.enabled } : {}),
        ...(keepMode && (mode ?? prior.mode) !== change.mode ? { mode: mode ?? prior.mode } : {}) };
    })
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
