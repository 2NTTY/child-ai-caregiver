import { z } from 'zod';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema, workRecoverySchemas, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { canonical } from './firestore-session-codec.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/u), sortKey = z.string().regex(/^[0-9]{19}$/u);
const authority = { scope: workRecoveryScopeSchema, authorizationVersion: workRecoverySchemas.workspace.shape.accessVersion,
  workerGeneration: z.uuid(), version: uint.min(1) };
export const privateSummarySuppressedTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fresh_message'), messageId: z.uuid() }).strict(),
  z.object({ kind: z.literal('repair_batch'), summaryId: z.uuid() }).strict(),
]);
export type PrivateSummarySuppressedTarget = z.infer<typeof privateSummarySuppressedTargetSchema>;
export function privateSummaryScanId(scope: WorkRecoveryScope): string {
  return firestoreDomainHash(['private-summary-scan/v1', workRecoveryScopeSchema.parse(scope)]);
}
export function privateSummarySuppressedSourceId(scope: WorkRecoveryScope, target: PrivateSummarySuppressedTarget): string {
  return firestoreDomainHash(['private-summary-suppressed-source/v1', workRecoveryScopeSchema.parse(scope), privateSummarySuppressedTargetSchema.parse(target)]);
}
export function privateSummaryCutoverId(scope: WorkRecoveryScope): string {
  return firestoreDomainHash(['private-summary-cutover/v1', workRecoveryScopeSchema.parse(scope)]);
}
export function privateSummaryInventoryGenesis(scope: WorkRecoveryScope, authorizationVersion: string, workerGeneration: string,
  inventoryVersion: number): string {
  return firestoreDomainHash(['private-summary-inventory/v1', workRecoveryScopeSchema.parse(scope),
    authority.authorizationVersion.parse(authorizationVersion), z.uuid().parse(workerGeneration), uint.min(1).parse(inventoryVersion)]);
}
export const privateSummaryScanSchema = z.object({ format: z.literal('private-summary-scan/v1'), id: digest, ...authority,
  repairAfterSortKey: sortKey.nullable(), repairAfterId: z.uuid().nullable(), cycleUpperSortKey: sortKey.nullable(),
  repairWorkAfterId: digest.nullable(), prefer: z.enum(['fresh', 'repair']), cycle: z.object({ number: uint,
    state: z.enum(['idle', 'scanning', 'complete']), sourceBasis: digest.nullable(), sourceExhausted: z.boolean(),
    workUpperDocumentId: digest.nullable(), workExhausted: z.boolean(), hasUnresolvedRepair: z.boolean() }).strict(),
}).strict().refine(value => {
  if (value.id !== privateSummaryScanId(value.scope)
    || (value.repairAfterSortKey === null) !== (value.repairAfterId === null)) return false;
  const cycle = value.cycle;
  if (cycle.state === 'idle') return cycle.number === 0 && value.repairAfterSortKey === null
    && value.repairAfterId === null && value.cycleUpperSortKey === null && value.repairWorkAfterId === null
    && cycle.sourceBasis === null && !cycle.sourceExhausted && cycle.workUpperDocumentId === null && !cycle.workExhausted
    && !cycle.hasUnresolvedRepair;
  if (cycle.number === 0 || cycle.sourceBasis === null
    || value.cycleUpperSortKey === null && (!cycle.sourceExhausted || value.repairAfterSortKey !== null)
    || cycle.workUpperDocumentId === null && (!cycle.workExhausted || value.repairWorkAfterId !== null)
    || value.repairAfterSortKey !== null && value.cycleUpperSortKey !== null && value.repairAfterSortKey > value.cycleUpperSortKey
    || value.repairWorkAfterId !== null && cycle.workUpperDocumentId !== null && value.repairWorkAfterId > cycle.workUpperDocumentId) return false;
  return cycle.state !== 'complete' || cycle.sourceExhausted && cycle.workExhausted;
});
export type PrivateSummaryScan = z.infer<typeof privateSummaryScanSchema>;
export const privateSummarySuppressedSourceSchema = z.object({ format: z.literal('private-summary-suppressed-source/v1'), id: digest,
  ...authority, target: privateSummarySuppressedTargetSchema, sourceVersion: uint, sourceBasis: digest,
  reason: z.enum(['dependency_suppressed', 'dependency_expired', 'source_missing']) }).strict()
  .refine(value => value.id === privateSummarySuppressedSourceId(value.scope, value.target));
export type PrivateSummarySuppressedSource = z.infer<typeof privateSummarySuppressedSourceSchema>;
export const privateSummaryCutoverSchema = z.object({ format: z.literal('private-summary-cutover/v1'), id: digest, ...authority,
  inventoryVersion: uint.min(1), phase: z.enum(['inventory', 'complete', 'blocked', 'restore_suspended']),
  entryFenceVersion: z.literal('private-summary-entry/v1'), upperCaptured: z.boolean(), upperRunDocumentId: digest.nullable(),
  afterRunDocumentId: digest.nullable(), inspectedRuns: uint, unresolvedMappedRuns: uint, unmappedRuns: uint,
  inventoryHash: digest, exhausted: z.boolean(), restoreId: z.uuid().nullable() }).strict().refine(value => {
  if (value.id !== privateSummaryCutoverId(value.scope) || value.unresolvedMappedRuns + value.unmappedRuns > value.inspectedRuns
    || value.afterRunDocumentId !== null && (value.upperRunDocumentId === null || value.afterRunDocumentId > value.upperRunDocumentId)
    || value.upperRunDocumentId === null && value.inspectedRuns !== 0
    || value.afterRunDocumentId === null && value.inspectedRuns !== 0) return false;
  if (!value.upperCaptured && (value.upperRunDocumentId !== null || value.afterRunDocumentId !== null
    || value.inspectedRuns !== 0 || value.unresolvedMappedRuns !== 0 || value.unmappedRuns !== 0 || value.exhausted
    || value.inventoryHash !== privateSummaryInventoryGenesis(value.scope, value.authorizationVersion, value.workerGeneration, value.inventoryVersion))) return false;
  if (value.exhausted && !value.upperCaptured) return false;
  if (value.phase === 'complete' && (!value.upperCaptured || !value.exhausted || value.unmappedRuns !== 0)) return false;
  if (value.phase === 'restore_suspended') return value.restoreId !== null && !value.upperCaptured
    && value.upperRunDocumentId === null && value.afterRunDocumentId === null && value.inspectedRuns === 0
    && value.unresolvedMappedRuns === 0 && value.unmappedRuns === 0 && !value.exhausted;
  return value.restoreId === null;
});
export type PrivateSummaryCutover = z.infer<typeof privateSummaryCutoverSchema>;
export const privateSummaryScanRestoreSchemas = {
  'private-summary-scan': { suffix: 'private_summary_scans', schema: privateSummaryScanSchema },
  'private-summary-suppressed-source': { suffix: 'private_summary_scans', schema: privateSummarySuppressedSourceSchema },
  'private-summary-cutover': { suffix: 'private_summary_scans', schema: privateSummaryCutoverSchema },
} as const;
export type PrivateSummaryScanKind = keyof typeof privateSummaryScanRestoreSchemas;
export function isPrivateSummaryScanKind(kind: string): kind is PrivateSummaryScanKind { return Object.hasOwn(privateSummaryScanRestoreSchemas, kind); }
export function assertPrivateSummaryScanRecord(context: FirestoreRecoveryContext, raw: unknown): void {
  const reject: () => never = () => { throw Object.assign(new Error('Restore private summary scan rejected'), { code: 'restore_summary_scan_binding', status: 409 }); };
  if (!isPrivateSummaryScanKind(context.kind) || context.family !== 'domain' || context.envelopeVersion !== 1) reject();
  const parsed = privateSummaryScanRestoreSchemas[context.kind as PrivateSummaryScanKind].schema.safeParse(raw);
  if (!parsed.success) reject();
  const value = parsed.data!;
  if (context.id !== value.id || canonical(context.scope) !== canonical(value.scope) || context.recordVersion !== value.version) reject();
}
