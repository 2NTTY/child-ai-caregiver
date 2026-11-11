import { z } from 'zod';
import { mixedRoomPinSchema } from '../src/shared/mixed-chat-transfer.ts';
import type { HandoverImportCommand } from '../src/shared/handover-imports.ts';
import type { HandoverHeader } from '../src/shared/handover.ts';
import { domainReject } from './firestore-domain-data.ts';

export const mixedImportSelectionSchema = z.strictObject({
  authorAccountId: z.string().min(1).max(256),
  rooms: z.array(mixedRoomPinSchema).min(1).max(100),
});
export type MixedImportSelection = z.infer<typeof mixedImportSelectionSchema>;
type Mapping = { sourceChildId: string; target: { childId: string; spaceId: string | null }; sections: string[] };

export function mixedImportDestination(pin: z.infer<typeof mixedRoomPinSchema>, targets: Mapping[]) {
  const pairs = pin.childIds.map(source => {
    const match = targets.find(target => target.sourceChildId === source);
    if (!match) domainReject('package_scope_unavailable', 400);
    return { source, ...match.target };
  }).sort((a, b) => a.source.localeCompare(b.source));
  const spaceId = pairs[0]!.spaceId;
  if (new Set(pairs.map(pair => pair.childId)).size !== pairs.length || pairs.some(pair => pair.spaceId !== spaceId))
    domainReject('mixed_import_target_mismatch', 400);
  return { pairs, childIds: pairs.map(pair => pair.childId).sort(),
    scope: spaceId === null ? { kind: 'personal' as const } : { kind: 'class' as const, spaceId } };
}

export function selectMixedImports(header: Pick<HandoverHeader,'selection'|'mixedAuthorAccountId'>,
  command: HandoverImportCommand, targets: Mapping[]): MixedImportSelection | undefined {
  if (!command.mixedRoomIds) return undefined;
  if (!header.mixedAuthorAccountId) domainReject('package_scope_unavailable', 400);
  const rooms = command.mixedRoomIds.map(id => {
    const room = header.selection.mixedRooms?.find(pin => pin.id === id);
    if (!room) domainReject('package_scope_unavailable', 400);
    mixedImportDestination(room, targets);
    return room;
  });
  if (targets.some(target => !target.sections.length && !rooms.some(room => room.childIds.includes(target.sourceChildId))))
    domainReject('package_scope_unavailable', 400);
  return { authorAccountId: header.mixedAuthorAccountId, rooms };
}

/** Version one creates the room. Subsequent versions each name exactly one source message. */
export function mixedImportStep(selection: MixedImportSelection | undefined, position: number) {
  if (position < 0) return null;
  for (const room of selection?.rooms ?? []) {
    if (position < room.version) return { room, version: position + 1 };
    position -= room.version;
  }
  return null;
}
