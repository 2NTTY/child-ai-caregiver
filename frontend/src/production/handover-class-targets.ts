import type { HandoverImportModule } from '../../../src/shared/handover-imports.ts';
import type { SharedGrantView } from '../../../src/shared/sharing-control.ts';
import type { SharingState } from './SharingController.ts';

export interface HandoverClassDestination {
  value: string; label: string; childId: string; spaceId: string; modules: HandoverImportModule[];
  scopeBasis: string; basis: string;
}
export interface HandoverClassEnrolmentDestination extends Omit<HandoverClassDestination, 'childId'> {
  createInClassId: string;
}
export const handoverClassFeatureModules = ['concerns', 'growth'] as const;
export type HandoverClassImportFeatures = Partial<Record<typeof handoverClassFeatureModules[number], boolean>>;
export const handoverClassFeatures = (state: { classConcernImportsEnabled?: boolean; classGrowthImportsEnabled?: boolean }) =>
  ({ concerns: state.classConcernImportsEnabled === true, growth: state.classGrowthImportsEnabled === true });
// Negotiated class modules remain independent. Private source/chat writes are unavailable.
const writable = new Set<HandoverImportModule>(['care', 'profile', 'tasks', 'memory', 'documents', 'attachments']);
const allowed = (module: HandoverImportModule, features: HandoverClassImportFeatures) => writable.has(module)
  || handoverClassFeatureModules.some(feature => module === feature && features[feature] === true);
const featureBasis = (features: HandoverClassImportFeatures) => handoverClassFeatureModules.map(module => features[module] === true);
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
export function handoverClassDestination(state: SharingState, grant: SharedGrantView, teachers?: SharingState, features: HandoverClassImportFeatures = {}): HandoverClassDestination | null {
  const scopeBasis = handoverClassScope(state, teachers), room = state.selected;
  if (!scopeBasis || !room) return null;
  const modules = grant.modules.filter(module => allowed(module, features));
  return { value: `class:${room.id}:${grant.childId}`, label: `${grant.childName}（${room.name}）`, childId: grant.childId, spaceId: room.id, modules,
    scopeBasis, basis: JSON.stringify([scopeBasis, grant.childId, grant.version, [...grant.modules].sort(), featureBasis(features)]) };
}
/** A verified capability permits an explicit plan, never a fabricated student identity. */
export function handoverClassEnrolmentDestination(state: SharingState, teachers: SharingState, enabled: boolean, features: HandoverClassImportFeatures = {}): HandoverClassEnrolmentDestination | null {
  const scopeBasis = handoverClassScope(state, teachers), room = state.selected;
  if (enabled !== true || !scopeBasis || !room || state.busy || !state.rosterLoaded) return null;
  return { value: `class-new:${room.id}`, label: `在此班新增（${room.name}）`, createInClassId: room.id, spaceId: room.id,
    modules: [...writable, ...handoverClassFeatureModules.filter(module => features[module] === true)], scopeBasis, basis: JSON.stringify(['class-enrolment', scopeBasis, featureBasis(features)]) };
}
/** Retain only explicitly selected students across searches, under the same current class admission. */
export function handoverClassDestinations(state: SharingState, retained: readonly HandoverClassDestination[], teachers?: SharingState, features: HandoverClassImportFeatures = {}): HandoverClassDestination[] {
  const scope = handoverClassScope(state, teachers);
  if (!scope || state.busy || !state.rosterLoaded) return [];
  const students = new Map(retained.filter(row => row.scopeBasis === scope && row.modules.every(module => allowed(module, features))).map(row => [row.childId, row]));
  for (const grant of state.shares.items) {
    const row = handoverClassDestination(state, grant, teachers, features);
    if (row) students.set(row.childId, row);
  }
  return [...students.values()].filter(row => row.modules.length > 0);
}
