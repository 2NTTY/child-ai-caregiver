import type { DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { privateSummaryScanSchema, privateSummaryScanId, type PrivateSummaryScan } from './private-summary-scan.ts';
import { privateSummaryWorkSchema, privateSummaryWorkProjection, summaryLineageRecordSchema, summarySourceRevisionSchema,
  type PrivateSummaryWork } from './private-summary-work.ts';
import { readContextBasis, firestoreContextRecoverySchema } from './firestore-context-basis.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';

export type SummaryScanLane = 'fresh' | 'repair';
export type SummaryRepairScanDecision<T> = { kind: 'resolved' } | { kind: 'blocked' } | { kind: 'candidate'; value: T };
export interface SummaryScanVisitors<T> {
  /** Read-only eligibility, not a dispatch permit. Fresh must remain the oldest uncovered source. */
  readFresh(): Promise<T | null>;
  readRepair(summaryId: string, source: { id: string; sortKey: string; version: number }): Promise<SummaryRepairScanDecision<T>>;
  /** Only validated repair-batch works are supplied. */
  readWork(work: PrivateSummaryWork): Promise<T | null>;
}
const same = (a: unknown, b: unknown) => firestoreDomainHash(a) === firestoreDomainHash(b);
function requirePrivate(b: Binding) {
  if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('private_summary_scope_changed');
}
function scoped(data: FirestoreDomainData, b: Binding) {
  const tags = data.tags(b.scope);
  return data.collection('private_summary_works').where('workspaceTag', '==', tags.workspaceTag)
    .where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
}
async function readScan(data: FirestoreDomainData, b: Binding) {
  requirePrivate(b);
  const id = privateSummaryScanId(b.scope), ref = data.ref('private_summary_scans', 'private-summary-scan', id);
  const row = await b.transaction.get(ref);
  if (!row.exists) return { ref, scan: null };
  const scan = data.open('private-summary-scan', id, b.scope, privateSummaryScanSchema, row);
  if (scan.id !== id || !same(scan.scope, b.scope) || row.get('recordVersion') !== scan.version
    || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('private_summary_scan_binding', 500);
  return { ref, scan };
}
function envelope(data: FirestoreDomainData, scan: PrivateSummaryScan) {
  return { ...data.tags(scan.scope), ...data.seal('private-summary-scan', scan.id, scan.scope, privateSummaryScanSchema, scan, scan.version) };
}
/** Call only in the same authority transaction as a genuinely new committed source/part/publication.
 * lane comes from that operation's validated source manifest, never from request/model data. */
export async function preparePrivateSummaryScanProgress(data: FirestoreDomainData, b: Binding, lane: SummaryScanLane) {
  domainParse(z.enum(['fresh', 'repair']), lane);
  const { ref, scan } = await readScan(data, b);
  if (!scan || scan.authorizationVersion !== b.authorizationVersion || scan.workerGeneration !== b.generation) return () => {};
  const next = privateSummaryScanSchema.parse({ ...scan, version: scan.version + 1, prefer: lane === 'fresh' ? 'repair' : 'fresh' });
  const sealed = envelope(data, next);
  return () => b.transaction.set(ref, sealed);
}

export function createFirestorePrivateSummaryScan(options: FirestoreDomainOptions & {
  memory: Pick<FirestoreMemoryStore, 'readSummaryScanHead' | 'readSummaryScanPage'>; pageSize?: number;
}) {
  const data = new FirestoreDomainData(options), pageSize = domainParse(z.number().int().min(1).max(4), options.pageSize ?? 4);
  function readWorkRow(b: Binding, row: DocumentSnapshot): PrivateSummaryWork | null {
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('private_summary_scan_binding', 500);
    if (row.get('format') !== 'yuban-firestore-domain' || row.get('version') !== 1) domainReject('private_summary_scan_binding', 500);
    const opened = openRecoveryEnvelope({ ...options, envelope: { family: 'domain', version: 1,
      recordVersion: row.get('recordVersion'), ciphertext: row.get('ciphertext') }, locator: row.get('recovery') });
    const { context } = opened;
    if (!same(context.scope, b.scope) || row.id !== data.ref('private_summary_works', context.kind, context.id).id)
      domainReject('private_summary_scan_binding', 500);
    if (context.kind === 'private-summary-lineage') {
      const lineage = domainParse(summaryLineageRecordSchema, opened.value, 'private_summary_scan_binding', 500);
      if (lineage.id !== context.id || lineage.version !== context.recordVersion || !same(lineage.scope, b.scope))
        domainReject('private_summary_scan_binding', 500);
      return null;
    }
    if (context.kind !== 'private-summary-work') domainReject('private_summary_scan_binding', 500);
    const work = domainParse(privateSummaryWorkSchema, opened.value, 'private_summary_scan_binding', 500);
    if (work.id !== context.id || work.version !== context.recordVersion || !same(work.scope, b.scope)) domainReject('private_summary_scan_binding', 500);
    if (Object.entries(privateSummaryWorkProjection(work)).some(([key, value]) => row.get(key) !== value))
      domainReject('private_summary_work_projection', 500);
    return work;
  }
  async function isRepair(b: Binding, work: PrivateSummaryWork) {
    const row = await b.transaction.get(data.ref('private_summary_revisions', 'private-summary-revision', work.sourceRevisionId));
    if (!row.exists || row.get('recordVersion') !== 1 || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value))
      domainReject('private_summary_scan_binding', 500);
    const revision = data.open('private-summary-revision', work.sourceRevisionId, b.scope, summarySourceRevisionSchema, row);
    if (revision.id !== work.sourceRevisionId || revision.workId !== work.id || revision.sourceRevision !== work.sourceRevision
      || revision.manifestHash !== work.manifestHash || !same(revision.scope, work.scope)
      || revision.authorizationVersion !== work.authorizationVersion || revision.workerGeneration !== work.workerGeneration)
      domainReject('private_summary_scan_binding', 500);
    return revision.manifest.kind === 'repair_batch';
  }
  return {
    async prepare<T>(b: Binding, visitors: SummaryScanVisitors<T>) {
      const current = await readScan(data, b), head = await options.memory.readSummaryScanHead(b);
      let scan: PrivateSummaryScan = current.scan && current.scan.authorizationVersion === b.authorizationVersion
        && current.scan.workerGeneration === b.generation ? structuredClone(current.scan) : {
          format: 'private-summary-scan/v1', id: privateSummaryScanId(b.scope), scope: b.scope,
          authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, version: current.scan?.version ?? 0,
          repairAfterSortKey: null, repairAfterId: null, cycleUpperSortKey: null, repairWorkAfterId: null, prefer: 'fresh',
          cycle: { number: 0, state: 'idle', sourceBasis: null, sourceExhausted: false, workUpperDocumentId: null, workExhausted: false, hasUnresolvedRepair: false } };
      if (scan.cycle.state !== 'scanning') {
        const rows = await b.transaction.get(scoped(data, b).orderBy('__name__', 'desc').limit(1));
        if (rows.docs[0]) readWorkRow(b, rows.docs[0]);
        const upper = rows.docs[0]?.id ?? null;
        scan = { ...scan, repairAfterSortKey: null, repairAfterId: null, repairWorkAfterId: null, cycleUpperSortKey: head.upperSortKey,
          cycle: { number: scan.cycle.number + 1, state: 'scanning', sourceBasis: head.basis,
            sourceExhausted: head.upperSortKey === null, workUpperDocumentId: upper, workExhausted: upper === null, hasUnresolvedRepair: false } };
      }
      let selected: T | null = null;
      const repair = async () => {
        if (!scan.cycle.workExhausted) {
          let query = scoped(data, b).where('__name__', '<=', scan.cycle.workUpperDocumentId!).orderBy('__name__', 'asc').limit(pageSize);
          if (scan.repairWorkAfterId) query = query.startAfter(scan.repairWorkAfterId);
          const rows = await b.transaction.get(query);
          let inspected = 0;
          for (const row of rows.docs) {
            const work = readWorkRow(b, row); inspected++;
            if (work && await isRepair(b, work)) selected = await visitors.readWork(work);
            scan.repairWorkAfterId = row.id;
            if (selected !== null) break;
          }
          if (inspected === rows.size && rows.size < pageSize) scan.cycle.workExhausted = true;
        }
        if (selected === null && !scan.cycle.sourceExhausted) {
          const page = await options.memory.readSummaryScanPage(b, { upperSortKey: scan.cycleUpperSortKey!,
            after: scan.repairAfterId ? { id: scan.repairAfterId, sortKey: scan.repairAfterSortKey! } : null, limit: pageSize });
          let inspected = 0;
          for (const source of page.items) {
            const decision = await visitors.readRepair(source.id, source);
            if (!decision || !['resolved', 'blocked', 'candidate'].includes(decision.kind)) domainReject('private_summary_scan_decision');
            if (decision.kind !== 'resolved') scan.cycle.hasUnresolvedRepair = true;
            if (decision.kind === 'candidate') {
              if (decision.value === null || decision.value === undefined) domainReject('private_summary_scan_decision');
              selected = decision.value;
            }
            inspected++;
            scan.repairAfterId = source.id; scan.repairAfterSortKey = source.sortKey;
            if (selected !== null) break;
          }
          if (inspected === page.items.length && page.exhausted) scan.cycle.sourceExhausted = true;
        }
      };
      if (scan.prefer === 'fresh') { selected = await visitors.readFresh(); if (selected === null) await repair(); }
      else { await repair(); if (selected === null) selected = await visitors.readFresh(); }
      if (scan.cycle.sourceExhausted && scan.cycle.workExhausted) scan.cycle.state = 'complete';
      scan.version++;
      const checked = privateSummaryScanSchema.parse(scan), sealed = envelope(data, checked);
      return { scan: checked, selected, commit() { b.transaction.set(current.ref, sealed); } };
    },
    prepareProgress: (b: Binding, lane: SummaryScanLane) => preparePrivateSummaryScanProgress(data, b, lane),
    async prepareClearPending(b: Binding, request: number) {
      domainParse(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), request);
      const { scan } = await readScan(data, b), head = await options.memory.readSummaryScanHead(b), context = await readContextBasis(data, b);
      const unfinished = privateSummaryWorkSchema.shape.state.options.filter(state => state !== 'completed' && state !== 'suppressed');
      const works = await b.transaction.get(scoped(data, b).where('workState', 'in', unfinished).limit(1));
      const wakes = await b.transaction.get(scoped(data, b).where('completionWakeState', '==', 'pending_schedule').limit(1));
      for (const row of [...works.docs, ...wakes.docs]) if (!readWorkRow(b, row)) domainReject('private_summary_work_projection', 500);
      const canClear = !!scan && scan.authorizationVersion === b.authorizationVersion && scan.workerGeneration === b.generation
        && scan.cycle.state === 'complete' && !scan.cycle.hasUnresolvedRepair && scan.cycle.sourceBasis === head.basis && head.freshCaughtUp
        && works.empty && wakes.empty && !context.value.summaryBlocked && context.value.summaryRequest === request;
      const value = { ...context.value, summaryPending: false, summaryBlocked: false, summaryBlockedReference: null,
        summaryRequest: request, summaryAfter: new Date(Date.now() + 300000).toISOString() };
      const sealed = canClear ? { ...data.tags(b.scope), summaryPending: false,
        ...data.seal('context-version', context.id, b.scope, firestoreContextRecoverySchema, value) } : null;
      return { canClear, commit() { if (sealed) b.transaction.set(context.ref, sealed); } };
    },
  };
}
