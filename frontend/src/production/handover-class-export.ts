import { classHandoverModuleSchema, type HandoverClassExportCommand } from '../../../src/shared/handover-jobs.ts';
import type { SharingState } from './SharingController.ts';

export type ClassExportModule = HandoverClassExportCommand['selection']['modules'][number];
export type ClassExportPupil = { childId: string; label: string; modules: ClassExportModule[]; scope: string; basis: string };
const eligible = classHandoverModuleSchema.options;

/** Export admission is readable access, including viewers; import's writable admission is deliberately separate. */
export function classExportScope(state: SharingState, teachers: SharingState): string | null {
  const room = state.selected;
  if (!state.identityKey || !state.userId || !state.online || !room || room.kind !== 'class' || state.pending) return null;
  const listed = [...state.spaces.items, ...teachers.teacherClasses.items].find(item => item.id === room.id);
  if (listed && (listed.version > room.version || listed.version === room.version && listed.role !== room.role)) return null;
  if (room.teacherSpaceId) {
    if (!teachers.identityKey || teachers.userId !== state.userId || !teachers.online) return null;
    const parent = [...teachers.spaces.items, ...(teachers.selected ? [teachers.selected] : [])].find(item => item.id === room.teacherSpaceId);
    if (parent && (parent.version > (room.teacherSpaceVersion ?? 0)
      || parent.version === room.teacherSpaceVersion && parent.role !== room.role)) return null;
  }
  return JSON.stringify([state.identityKey, state.userId, room.id, room.version, room.role, room.teacherSpaceId, room.teacherSpaceVersion]);
}

export function classExportPupils(state: SharingState, teachers: SharingState, retained: readonly ClassExportPupil[]): ClassExportPupil[] {
  const scope = classExportScope(state, teachers);
  if (!scope || state.busy || !state.rosterLoaded) return [];
  const rows = new Map(retained.filter(row => row.scope === scope).map(row => [row.childId, row]));
  for (const grant of state.shares.items) rows.set(grant.childId, { childId: grant.childId, label: grant.childName,
    modules: eligible.filter(module => grant.modules.includes(module)), scope,
    basis: JSON.stringify([scope, grant.childId, grant.version, [...grant.modules].sort()]) });
  return [...rows.values()].filter(row => row.modules.length);
}

export function classExportModules(pupils: readonly ClassExportPupil[], capabilities: readonly ClassExportModule[]): ClassExportModule[] {
  return pupils.length ? eligible.filter(module => capabilities.includes(module) && pupils.every(pupil => pupil.modules.includes(module))) : [];
}
