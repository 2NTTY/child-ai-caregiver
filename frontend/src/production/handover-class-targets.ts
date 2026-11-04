import type { HandoverImportModule } from '../../../src/shared/handover-imports.ts';
import type { SharedGrantView } from '../../../src/shared/sharing-control.ts';
import type { SharingState } from './SharingController.ts';

export interface HandoverClassDestination {
  value: string; label: string; childId: string; spaceId: string; modules: HandoverImportModule[];
  scopeBasis: string; basis: string;
}
// Shared concerns/growth and private source/chat writes are not connected by the package worker.
const writable = new Set<HandoverImportModule>(['care', 'profile', 'tasks', 'memory', 'documents', 'attachments']);
export function handoverClassScope(state: SharingState, teachers?: SharingState): string | null {
  const room = state.selected;
  if (!state.identityKey || !state.userId || !state.online || !room || room.kind !== 'class' || room.role === 'viewer' || state.pending) return null;
  if (room.teacherSpaceId && teachers?.identityKey && teachers.userId === state.userId) {
    const parents = [...teachers.spaces.items, ...(teachers.selected ? [teachers.selected] : [])];
    if (parents.some(parent => parent.id === room.teacherSpaceId && parent.kind === 'teachers'
      && (parent.version > (room.teacherSpaceVersion ?? 0) || parent.version === room.teacherSpaceVersion && parent.role !== room.role))) return null;
  }
  return JSON.stringify([state.identityKey, state.userId, room.id, room.version, room.role, room.teacherSpaceId ?? null, room.teacherSpaceVersion ?? null]);
}
export function handoverClassDestination(state: SharingState, grant: SharedGrantView, teachers?: SharingState): HandoverClassDestination | null {
  const scopeBasis = handoverClassScope(state, teachers), room = state.selected;
  if (!scopeBasis || !room) return null;
  const modules = grant.modules.filter(module => writable.has(module));
  return { value: `class:${room.id}:${grant.childId}`, label: `${grant.childName}（${room.name}）`, childId: grant.childId, spaceId: room.id, modules,
    scopeBasis, basis: JSON.stringify([scopeBasis, grant.childId, grant.version, [...grant.modules].sort()]) };
}
/** Retain only explicitly selected students across searches, under the same current class admission. */
export function handoverClassDestinations(state: SharingState, retained: readonly HandoverClassDestination[], teachers?: SharingState): HandoverClassDestination[] {
  const scope = handoverClassScope(state, teachers);
  if (!scope || state.busy || !state.rosterLoaded) return [];
  const students = new Map(retained.filter(row => row.scopeBasis === scope).map(row => [row.childId, row]));
  for (const grant of state.shares.items) {
    const row = handoverClassDestination(state, grant, teachers);
    if (row) students.set(row.childId, row);
  }
  return [...students.values()].filter(row => row.modules.length > 0);
}
