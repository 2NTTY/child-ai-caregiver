import { z } from 'zod';
import { preparationInput, summaryQuery, type CareSummary, type SummaryQuery, type VisitPreparation } from '../src/shared/care-summary.ts';
import { summarizeCare } from './care-summary-policy.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import { makeImportProvenance } from './handover-provenance.ts';

export const firestorePreparationSchema = preparationInput.pick({ appointmentTaskId: true, questions: true, checklist: true, reviewed: true }).extend({
  childId: z.uuid(), version: z.number().int().min(1).max(2147483647),
  reviewedBasis: z.string().min(3).max(128).nullable(), period: summaryQuery,
  updatedBy: z.string().min(1).max(256), updatedAt: z.iso.datetime({ offset: true }),
  importedFrom: importProvenanceSchema.optional(),
}).strict().refine(value => !value.importedFrom || value.importedFrom.current.source.section === 'visit_preparation');
const empty = (): VisitPreparation => ({ version: 0, appointmentTaskId: null, questions: [], checklist: [],
  reviewed: false, reviewedBasis: null, period: null, updatedBy: null, updatedAt: null });
const path = /^\/api\/children\/([0-9a-f-]{36})\/visit-preparation$/iu;
type Binding = FirestoreAuthorityTransaction;
type StoredPreparation = z.infer<typeof firestorePreparationSchema>;

/** Deterministic summary and the existing shared preparation, in one authorized snapshot. */
export function createFirestoreCareSummary(options: FirestoreDomainOptions, care: Pick<FirestoreCareStore, 'readReportSource'>) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const basis = (b: Binding, sequence = b.changeSeq) => b.scope.storageEpoch + ':' + sequence;
  async function readStored(b: Binding): Promise<StoredPreparation | null> {
    const id = b.scope.childId, row = await b.transaction.get(data.ref('visit_preparations', 'visit-preparation', id));
    if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const value = data.open('visit-preparation', id, b.scope, firestorePreparationSchema, row);
    if (value.childId !== id || value.version !== row.get('recordVersion') || value.updatedBy !== b.scope.ownerUserId)
      domainReject('preparation_binding', 500);
    return value;
  }
  const publicPreparation = ({ childId: _childId, importedFrom: _source, ...value }: StoredPreparation): VisitPreparation => value;
  async function readPreparation(b: Binding): Promise<VisitPreparation> {
    const value = await readStored(b); return value ? publicPreparation(value) : empty();
  }
  async function prepareSave(b: Binding, opId: string, raw: StoredPreparation) {
    const revisionId = JSON.stringify([b.scope.childId, raw.version]);
    const revisionRef = data.ref('visit_preparation_revisions', 'visit-preparation-revision', revisionId);
    if ((await b.transaction.get(revisionRef)).exists) domainReject('revision_conflict');
    const change = await b.prepareChange(opId, 'care', false);
    const value = domainParse(firestorePreparationSchema, { ...raw, reviewedBasis: raw.reviewed ? basis(b, change.changeSeq) : null });
    const metadata = { ...data.tags(b.scope), entityId: value.childId, entityVersion: value.version };
    const current = { ...metadata, ...data.seal('visit-preparation', value.childId, b.scope, firestorePreparationSchema, value, value.version) };
    const revision = { ...metadata, ...data.seal('visit-preparation-revision', revisionId, b.scope, firestorePreparationSchema, value, value.version) };
    return { value, changeSeq: change.changeSeq, commit() {
      change.commit(); b.transaction.set(data.ref('visit_preparations', 'visit-preparation', value.childId), current);
      b.transaction.create(revisionRef, revision);
    } };
  }
  async function snapshot(b: Binding, query: SummaryQuery): Promise<CareSummary> {
    const child = await b.readChild(b.scope.childId); if (!child) domainReject('not_found', 404);
    const source = await care.readReportSource(b), tags = data.tags(b.scope);
    const rows = await b.transaction.get(data.collection('tasks').where('workspaceTag', '==', tags.workspaceTag)
      .where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag)
      .orderBy('taskId', 'asc').limit(501));
    if (rows.size > 500) domainReject('summary_scope_too_large');
    const tasks = rows.docs.map(row => {
      const id = domainParse(z.uuid(), row.get('taskId'), 'invalid_document', 500);
      const task = data.open('task', id, b.scope, firestoreTaskSchema, row);
      if (task.id !== id || task.childId !== child.id || task.version !== row.get('recordVersion')) domainReject('task_binding', 500);
      return task;
    });
    const preparation = await readPreparation(b), basisVersion = basis(b);
    let summary: ReturnType<typeof summarizeCare>;
    try { summary = summarizeCare(source.records, query); }
    catch (error) { if (error instanceof Error && error.message === 'summary_range_too_large') domainReject('summary_range_too_large'); throw error; }
    return { childId: child.id, childName: child.displayName, profile: source.profile, canManage: true, period: query,
      ...summary, generatedAt: new Date().toISOString(), basisVersion,
      appointments: tasks.filter(t => t.kind === 'appointment' && t.occurrence.state === 'scheduled'),
      conflicts: tasks.filter(t => t.occurrence.state === 'needs_review'), preparation,
      reviewCurrent: preparation.reviewed && preparation.reviewedBasis === basisVersion
        && JSON.stringify(preparation.period) === JSON.stringify(query) };
  }
  const mutation: FirestoreOnlineMutation = {
    supports: target => path.test(target),
    async prepare(root, submission) {
      const match = path.exec(submission.path); if (!match) domainReject('not_found', 404);
      const childId = domainParse(z.uuid(), match[1].toLowerCase());
      if (!await root.readChild(childId)) domainReject('not_found', 404);
      const b: Binding = { ...root, scope: { ...root.scope, childId },
        prepareChange: (op, kind, deleted) => root.prepareChange(op, kind, deleted, childId) };
      const input = domainParse(preparationInput, submission.payload), stored = await readStored(b), old = stored ?? empty();
      if (old.version !== input.expectedVersion || input.basisVersion !== basis(b)) domainReject('summary_basis_changed');
      if (old.version >= 2147483646) domainReject('version_conflict');
      const report = await snapshot(b, input.period);
      if (input.appointmentTaskId && !report.appointments.some(t => t.id === input.appointmentTaskId)) domainReject('appointment_changed');
      const saved = await prepareSave(b, submission.operation.opId, { childId, version: old.version + 1,
        appointmentTaskId: input.appointmentTaskId, questions: input.questions, checklist: input.checklist,
        reviewed: input.reviewed, reviewedBasis: null,
        period: input.period, updatedBy: b.scope.ownerUserId, updatedAt: new Date().toISOString(),
        ...(stored?.importedFrom ? { importedFrom: stored.importedFrom } : {}) });
      return { childId, changeSeq: saved.changeSeq, statusCode: 200, result: { preparation: publicPreparation(saved.value) }, commit: saved.commit };
    },
  };
  return { get: (userId: string, childId: string, input: SummaryQuery) =>
    authority.runTransaction(userId, childId, b => snapshot(b, domainParse(summaryQuery, input))), mutation,
    async readImportState(b: Binding) {
      if (!await b.readChild(b.scope.childId)) domainReject('not_found', 404);
      const value = await readStored(b); return { value, version: value?.version ?? 0 };
    },
    async prepareImported(b: Binding, opId: string, row: HandoverImportRow, integrity: HandoverIntegrity, expectedVersion: number,
      appointment?: { sourceTaskId: string; targetTaskId: string; expectedVersion: number }) {
      domainParse(z.uuid(), opId);
      if (row.section !== 'visit_preparation') domainReject('invalid_package_data', 400);
      const source = domainParse(firestorePreparationSchema, row.value, 'invalid_package_data', 400);
      if (source.childId !== row.childId) domainReject('invalid_package_scope', 400);
      if (b.sharedAccess && (b.sharedAccess.mode !== 'write' || b.sharedAccess.role === 'viewer'
        || b.sharedAccess.module !== 'documents')) domainReject('forbidden', 403);
      if (!await b.readChild(b.scope.childId)) domainReject('not_found', 404);
      const old = await readStored(b);
      if ((old?.version ?? 0) !== expectedVersion || expectedVersion >= 2147483646) domainReject('version_conflict');
      let appointmentTaskId: string | null = null;
      if (appointment) {
        domainParse(z.uuid(), appointment.targetTaskId);
        if (appointment.sourceTaskId !== source.appointmentTaskId) domainReject('appointment_changed');
        const found = await b.transaction.get(data.ref('tasks', 'task', appointment.targetTaskId));
        if (!found.exists) domainReject('appointment_changed');
        const task = data.open('task', appointment.targetTaskId, b.scope, firestoreTaskSchema, found);
        if (task.id !== appointment.targetTaskId || task.childId !== b.scope.childId || task.version !== found.get('recordVersion')
          || task.version !== appointment.expectedVersion || task.kind !== 'appointment' || task.occurrence.state !== 'scheduled') domainReject('appointment_changed');
        appointmentTaskId = task.id;
      }
      const at = new Date().toISOString(), importedFrom = makeImportProvenance(row, integrity, b.actorUserId, at);
      const saved = await prepareSave(b, opId, { childId: b.scope.childId, version: expectedVersion + 1, appointmentTaskId,
        questions: source.questions, checklist: source.checklist, reviewed: false, reviewedBasis: null,
        period: source.period, updatedBy: b.scope.ownerUserId, updatedAt: at, importedFrom });
      return { value: { id: b.scope.childId, version: saved.value.version }, changeSeq: saved.changeSeq, commit: saved.commit };
    },
  };
}
export type FirestoreCareSummary = ReturnType<typeof createFirestoreCareSummary>;
