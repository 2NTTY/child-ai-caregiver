import { z } from 'zod';
import { preparationInput, summaryQuery, type CareSummary, type SummaryQuery, type VisitPreparation } from '../src/shared/care-summary.ts';
import { summarizeCare } from './care-summary-policy.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';

export const firestorePreparationSchema = preparationInput.pick({ appointmentTaskId: true, questions: true, checklist: true, reviewed: true }).extend({
  childId: z.uuid(), version: z.number().int().min(1).max(2147483647),
  reviewedBasis: z.string().min(3).max(128).nullable(), period: summaryQuery,
  updatedBy: z.string().min(1).max(256), updatedAt: z.iso.datetime({ offset: true }),
}).strict();
const empty = (): VisitPreparation => ({ version: 0, appointmentTaskId: null, questions: [], checklist: [],
  reviewed: false, reviewedBasis: null, period: null, updatedBy: null, updatedAt: null });
const path = /^\/api\/children\/([0-9a-f-]{36})\/visit-preparation$/iu;
type Binding = FirestoreAuthorityTransaction;

/** Deterministic summary and the existing shared preparation, in one authorized snapshot. */
export function createFirestoreCareSummary(options: FirestoreDomainOptions, care: Pick<FirestoreCareStore, 'readReportSource'>) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const basis = (b: Binding, sequence = b.changeSeq) => b.scope.storageEpoch + ':' + sequence;
  async function readPreparation(b: Binding): Promise<VisitPreparation> {
    const id = b.scope.childId, row = await b.transaction.get(data.ref('visit_preparations', 'visit-preparation', id));
    if (!row.exists) return empty();
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const value = data.open('visit-preparation', id, b.scope, firestorePreparationSchema, row);
    if (value.childId !== id || value.version !== row.get('recordVersion') || value.updatedBy !== b.scope.ownerUserId)
      domainReject('preparation_binding', 500);
    const { childId: _childId, ...preparation } = value;
    return preparation;
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
      const input = domainParse(preparationInput, submission.payload), old = await readPreparation(b);
      if (old.version !== input.expectedVersion || input.basisVersion !== basis(b)) domainReject('summary_basis_changed');
      if (old.version >= 2147483646) domainReject('version_conflict');
      const report = await snapshot(b, input.period);
      if (input.appointmentTaskId && !report.appointments.some(t => t.id === input.appointmentTaskId)) domainReject('appointment_changed');
      const revisionId = JSON.stringify([childId, old.version + 1]);
      const revisionRef = data.ref('visit_preparation_revisions', 'visit-preparation-revision', revisionId);
      if ((await b.transaction.get(revisionRef)).exists) domainReject('revision_conflict');
      const change = await b.prepareChange(submission.operation.opId, 'care', false);
      const value = domainParse(firestorePreparationSchema, { childId, version: old.version + 1,
        appointmentTaskId: input.appointmentTaskId, questions: input.questions, checklist: input.checklist,
        reviewed: input.reviewed, reviewedBasis: input.reviewed ? basis(b, change.changeSeq) : null,
        period: input.period, updatedBy: b.scope.ownerUserId, updatedAt: new Date().toISOString() });
      const { childId: _childId, ...preparation } = value;
      const metadata = { ...data.tags(b.scope), entityId: childId, entityVersion: value.version };
      const current = { ...metadata, ...data.seal('visit-preparation', childId, b.scope, firestorePreparationSchema, value, value.version) };
      const revision = { ...metadata, ...data.seal('visit-preparation-revision', revisionId, b.scope, firestorePreparationSchema, value, value.version) };
      return { childId, changeSeq: change.changeSeq, statusCode: 200, result: { preparation }, commit() {
        change.commit(); b.transaction.set(data.ref('visit_preparations', 'visit-preparation', childId), current);
        b.transaction.create(revisionRef, revision);
      } };
    },
  };
  return { get: (userId: string, childId: string, input: SummaryQuery) =>
    authority.runTransaction(userId, childId, b => snapshot(b, domainParse(summaryQuery, input))), mutation };
}
export type FirestoreCareSummary = ReturnType<typeof createFirestoreCareSummary>;
