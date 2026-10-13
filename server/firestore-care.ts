import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Query } from '@google-cloud/firestore';
import { z } from 'zod';
import type { CareStore } from './care.ts';
import type { CareRecord, CareValues, ChildProfile } from '../src/shared/care.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { careValuesSchema, profileDataSchema, careCreateSchema, careReviseSchema, careSearchSchema,
  deleteCareSchema, profileSaveSchema } from './care-validation.ts';
import { validateCreateTextRecord } from '../src/shared/inputs.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import { prepareContextChange } from './firestore-context-basis.ts';

const uuid = z.uuid(), version = z.number().int().min(0).max(2147483646), time = z.iso.datetime({ offset: true });
const user = z.string().min(1).max(256);
export const firestoreCareSchema = careValuesSchema.extend({ id: uuid, childId: uuid, authorUserId: user, createdAt: time,
  version: version.min(1), confirmedBy: user, confirmedAt: time, reason: z.string().max(500),
  confirmationBasis: z.enum(['explicit', 'preauthorized_user_statement']).optional() }).strict();
export const firestoreProfileSchema = z.object({ childId: uuid, version, data: profileDataSchema.nullable(),
  confirmedBy: user.nullable(), confirmedAt: time.nullable(), reason: z.string().max(500).nullable() }).strict();
const tombstoneSchema = z.object({ id: uuid, childId: uuid, version: version.min(1), operationId: uuid, deletedAt: time }).strict();
const pathPattern = /^\/api\/children\/([0-9a-f-]{36})\/(records|care(?:\/([0-9a-f-]{36})\/(revise|delete))?|profile(?:\/(delete))?)$/iu;
type Binding = FirestoreAuthorityTransaction;
type Prepared<T> = { value: T; changeSeq: string; commit(): void };
export interface FirestoreCareStore extends CareStore {
  mutation: FirestoreOnlineMutation;
  listRecords(userId: string, childId: string): Promise<{ records: CareRecord[]; limit: number }>;
  readRecord(binding: Binding, id: string): Promise<CareRecord | null>;
  readProfile(binding: Binding): Promise<ChildProfile>;
  readReportSource(binding: Binding): Promise<{ profile: ChildProfile; records: CareRecord[] }>;
  prepareDeletion(binding: Binding, id: string, expectedVersion: number, operationId: string): Promise<Prepared<boolean>>;
  prepareRecord(binding: Binding, operationId: string, values: CareValues, options?: {
    id?: string; expectedVersion?: number; reason?: string; basis?: 'explicit' | 'preauthorized_user_statement';
  }): Promise<Prepared<CareRecord>>;
}

/** Shared care/profile authority for pages and Agent tools; no unencrypted private search index. */
export function createFirestoreCareStore(options: FirestoreDomainOptions): FirestoreCareStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  function scoped(binding: Binding, suffix: string): Query {
    const tags = data.tags(binding.scope);
    return data.collection(suffix).where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function open<T>(binding: Binding, kind: string, id: string, schema: z.ZodType<T>, row: DocumentSnapshot): T {
    if (Object.entries(data.tags(binding.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, binding.scope, schema, row);
  }
  const recordRef = (id: string) => data.ref('care_records', 'care-record', id);
  async function readRecord(binding: Binding, id: string): Promise<CareRecord | null> {
    domainParse(uuid, id);
    const row = await binding.transaction.get(recordRef(id)); if (!row.exists) return null;
    if (row.get('live') === false) {
      const deleted = open(binding, 'care-tombstone', id, tombstoneSchema, row);
      if (deleted.id !== id || deleted.childId !== binding.scope.childId || deleted.version !== row.get('recordVersion')) domainReject('care_binding', 500);
      return null;
    }
    const value = open(binding, 'care-record', id, firestoreCareSchema, row);
    if (value.id !== id || value.childId !== binding.scope.childId || value.version !== row.get('recordVersion')
      || value.createdAt !== row.get('createdAt') || value.authorUserId !== binding.scope.ownerUserId || row.get('live') !== true)
      domainReject('care_binding', 500);
    return value;
  }
  async function readProfile(binding: Binding): Promise<ChildProfile> {
    const id = binding.scope.childId, row = await binding.transaction.get(data.ref('child_profiles', 'child-profile', id));
    if (!row.exists) return { childId: id, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null };
    const value = open(binding, 'child-profile', id, firestoreProfileSchema, row);
    if (value.childId !== id || value.version !== row.get('recordVersion')) domainReject('profile_binding', 500);
    return value;
  }
  async function prepareRecord(binding: Binding, operationId: string, raw: CareValues, input: {
    id?: string; expectedVersion?: number; reason?: string; basis?: 'explicit' | 'preauthorized_user_statement';
  } = {}): Promise<Prepared<CareRecord>> {
    const values = domainParse(careValuesSchema, raw), id = input.id ?? randomUUID(), current = input.id ? await readRecord(binding, id) : null;
    if (input.id && !current) domainReject('not_found', 404);
    if (current && current.version !== input.expectedVersion) domainReject('version_conflict');
    if (!current && (await binding.transaction.get(recordRef(id))).exists) domainReject('record_conflict');
    const basis = input.basis ?? 'explicit', now = new Date().toISOString();
    const value = domainParse(firestoreCareSchema, { ...values, id, childId: binding.scope.childId,
      authorUserId: current?.authorUserId ?? binding.scope.ownerUserId, createdAt: current?.createdAt ?? now,
      version: (current?.version ?? 0) + 1, confirmedBy: binding.scope.ownerUserId, confirmedAt: now, confirmationBasis: basis,
      reason: input.reason ?? (basis === 'explicit' ? '首次確認' : '依本人預先授權，由 Agent 整理保存的使用者陳述；未逐項確認為事實') });
    const revisionId = JSON.stringify([id, value.version]), ref = data.ref('care_revisions', 'care-revision', revisionId);
    if ((await binding.transaction.get(ref)).exists) domainReject('revision_conflict');
    const contextChange = await prepareContextChange(data, binding);
    const change = await binding.prepareChange(operationId, 'care', false);
    const envelope = { ...data.tags(binding.scope), entityId: id, entityVersion: value.version, createdAt: value.createdAt, live: true,
      ...data.seal('care-record', id, binding.scope, firestoreCareSchema, value, value.version) };
    const revision = { ...data.tags(binding.scope), entityId: id, entityVersion: value.version,
      ...data.seal('care-revision', revisionId, binding.scope, firestoreCareSchema, value, value.version) };
    return { value, changeSeq: change.changeSeq, commit() {
      change.commit(); contextChange(); binding.transaction.set(recordRef(id), envelope); binding.transaction.create(ref, revision);
    } };
  }
  async function prepareDelete(binding: Binding, id: string, expectedVersion: number, operationId: string): Promise<Prepared<boolean>> {
    const current = await readRecord(binding, id); if (!current) domainReject('not_found', 404);
    if (current.version !== expectedVersion) domainReject('version_conflict');
    const value = { id, childId: binding.scope.childId, version: expectedVersion + 1, operationId, deletedAt: new Date().toISOString() };
    const contextChange = await prepareContextChange(data, binding);
    const change = await binding.prepareChange(operationId, 'care', true);
    const envelope = { ...data.tags(binding.scope), entityId: id, entityVersion: value.version, createdAt: current.createdAt, live: false,
      ...data.seal('care-tombstone', id, binding.scope, tombstoneSchema, value, value.version) };
    return { value: true, changeSeq: change.changeSeq, commit() { change.commit(); contextChange(); binding.transaction.set(recordRef(id), envelope); } };
  }
  async function prepareProfile(binding: Binding, raw: ChildProfile['data'], expectedVersion: number, reason: string | null,
    operationId: string): Promise<Prepared<ChildProfile>> {
    const current = await readProfile(binding);
    if (current.version !== expectedVersion) domainReject('version_conflict');
    const parsed = raw === null ? null : domainParse(profileDataSchema, raw);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (parsed?.age.kind === 'birth_date' && parsed.age.date > today || parsed?.age.kind === 'approximate' && parsed.age.asOf > today)
      domainReject('invalid_age_date', 400);
    const value = domainParse(firestoreProfileSchema, { childId: binding.scope.childId, version: expectedVersion + 1,
      data: parsed, confirmedBy: parsed ? binding.scope.ownerUserId : null, confirmedAt: parsed ? new Date().toISOString() : null, reason });
    const id = binding.scope.childId, ref = data.ref('child_profiles', 'child-profile', id), row = await binding.transaction.get(ref);
    const floor = parsed === null ? value.version : row.get('historyFloor') ?? 1;
    const revisionId = JSON.stringify([id, value.version]), revisionRef = data.ref('profile_revisions', 'profile-revision', revisionId);
    if ((await binding.transaction.get(revisionRef)).exists) domainReject('revision_conflict');
    const contextChange = await prepareContextChange(data, binding);
    const change = await binding.prepareChange(operationId, 'profile', parsed === null);
    const envelope = { ...data.tags(binding.scope), historyFloor: floor,
      ...data.seal('child-profile', id, binding.scope, firestoreProfileSchema, value, value.version) };
    const revision = { ...data.tags(binding.scope), entityId: id, entityVersion: value.version,
      ...data.seal('profile-revision', revisionId, binding.scope, firestoreProfileSchema, value, value.version) };
    return { value, changeSeq: change.changeSeq, commit() {
      change.commit(); contextChange(); binding.transaction.set(ref, envelope); binding.transaction.create(revisionRef, revision);
    } };
  }
  async function revisions<T>(binding: Binding, suffix: string, kind: string, id: string, schema: z.ZodType<T>,
    before: number, floor = 1) {
    domainParse(version.min(1), Math.min(before, 2147483646));
    const rows = await binding.transaction.get(scoped(binding, suffix).where('entityId', '==', id)
      .where('entityVersion', '>=', floor).where('entityVersion', '<', before).orderBy('entityVersion', 'desc').limit(51));
    return { revisions: rows.docs.slice(0, 50).map(row => open(binding, kind, JSON.stringify([id, row.get('entityVersion')]), schema, row)),
      nextBeforeVersion: rows.size > 50 ? rows.docs[49].get('entityVersion') as number : null };
  }
  async function direct<T>(userId: string, childId: string, fn: (binding: Binding, opId: string) => Promise<Prepared<T>>) {
    const opId = randomUUID();
    return authority.runTransaction(userId, childId, async binding => { const prepared = await fn(binding, opId); prepared.commit(); return prepared.value; });
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => pathPattern.test(path),
    async prepare(root, submission) {
      const match = pathPattern.exec(submission.path); if (!match) domainReject('not_found', 404);
      const childId = domainParse(uuid, match[1].toLowerCase()); if (!await root.readChild(childId)) domainReject('not_found', 404);
      // Same transaction and change accumulator; only the canonical validated child scope changes.
      const binding: Binding = { ...root, scope: { ...root.scope, childId },
        prepareChange: (op, kind, deleted) => root.prepareChange(op, kind, deleted, childId) };
      const [, , section, recordId, action, profileDelete] = match, op = submission.operation.opId;
      let prepared: Prepared<unknown>, key: string, statusCode: 200 | 201 = 200;
      if (section.startsWith('profile')) {
        if (profileDelete) { const input = domainParse(deleteCareSchema, submission.payload);
          prepared = await prepareProfile(binding, null, input.expectedVersion, null, op);
        } else { const input = domainParse(profileSaveSchema, submission.payload);
          prepared = await prepareProfile(binding, input.data, input.expectedVersion, input.reason, op); }
        key = 'profile';
      } else if (action === 'delete') {
        const input = domainParse(deleteCareSchema, submission.payload);
        prepared = await prepareDelete(binding, recordId.toLowerCase(), input.expectedVersion, op); key = 'deleted';
      } else {
        if (section === 'records') {
          const raw = domainParse(z.object({ text: z.string() }).strict(), submission.payload);
          const input = validateCreateTextRecord({ ...raw, childId }); if (!input.ok) domainReject('invalid_input', 400);
          prepared = await prepareRecord(binding, op, { text: input.value.text, details: emptyCareDetails(), source: '使用者原文記錄' }); statusCode = 201;
        } else if (action === 'revise') {
          const input = domainParse(careReviseSchema, submission.payload);
          prepared = await prepareRecord(binding, op, { text: input.text, details: input.details, source: input.source },
            { id: recordId.toLowerCase(), expectedVersion: input.expectedVersion, reason: input.reason });
        } else {
          const input = domainParse(careCreateSchema, submission.payload);
          prepared = await prepareRecord(binding, op, { text: input.text, details: input.details, source: input.source }); statusCode = 201;
        }
        key = 'record';
      }
      return { childId, changeSeq: prepared.changeSeq, result: { [key]: prepared.value }, statusCode, commit: prepared.commit };
    },
  };
  async function readReportSource(binding: Binding) {
    const profile = await readProfile(binding);
    const rows = await binding.transaction.get(scoped(binding, 'care_records').where('live', '==', true)
      .orderBy('createdAt', 'asc').orderBy('entityId', 'asc').limit(2001));
    if (rows.size > 2000) domainReject('summary_scope_too_large');
    return { profile, records: rows.docs.map(row => open(binding, 'care-record', row.get('entityId'), firestoreCareSchema, row)) };
  }
  const store: FirestoreCareStore = {
    prepareDeletion: prepareDelete,
    async listRecords(userId, childId) {
      return authority.runTransaction(userId, childId, async binding => {
        const rows = await binding.transaction.get(scoped(binding, 'care_records').where('live', '==', true)
          .orderBy('createdAt', 'desc').orderBy('entityId', 'desc').limit(100));
        return { records: rows.docs.map(row => open(binding, 'care-record', row.get('entityId'), firestoreCareSchema, row)), limit: 100 };
      });
    },
    mutation, readRecord, readProfile, prepareRecord,
    async search(userId, childId, raw) {
      const input = domainParse(careSearchSchema, raw);
      return authority.runTransaction(userId, childId, async binding => {
        if (input.cursor?.changeSeq !== undefined && input.cursor.changeSeq !== binding.changeSeq) domainReject('cursor_stale');
        let query = scoped(binding, 'care_records').where('live', '==', true)
          .orderBy('createdAt', 'desc').orderBy('entityId', 'desc').limit(201);
        if (input.cursor) query = query.startAfter(input.cursor.createdAt, input.cursor.id);
        const rows = await binding.transaction.get(query), records: CareRecord[] = [], search = input.query?.toLocaleLowerCase('zh-HK') ?? '';
        let scanned = 0;
        for (const row of rows.docs.slice(0, 200)) {
          scanned++;
          const value = open(binding, 'care-record', row.get('entityId'), firestoreCareSchema, row);
          if (value.childId !== childId || value.version !== row.get('recordVersion')) domainReject('care_binding', 500);
          const haystack = [value.text, value.source, value.details.eventTime.rawText, value.details.quantity?.rawValue, value.details.quantity?.unit].join('\n').toLocaleLowerCase('zh-HK');
          if ((!input.kind || value.details.kind === input.kind) && haystack.includes(search)) records.push(value);
          if (records.length === 50) break;
        }
        const last = rows.docs[scanned - 1];
        return { records, scanned, limit: 50, nextCursor: scanned < rows.size && last
          ? { createdAt: last.get('createdAt'), id: last.get('entityId'), changeSeq: binding.changeSeq } : null };
      });
    },
    get: (userId, childId, id) => authority.runTransaction(userId, childId, binding => readRecord(binding, id)),
    profile: (userId, childId) => authority.runTransaction(userId, childId, readProfile),
    create: (u, c, values, basis) => direct(u, c, (binding, op) => prepareRecord(binding, op, values, { basis })),
    revise: (u, c, id, values, expectedVersion, reason, basis) => direct(u, c, (binding, op) => prepareRecord(binding, op, values, { id, expectedVersion, reason, basis })),
    delete: (u, c, id, expectedVersion) => direct(u, c, (binding, op) => prepareDelete(binding, id, expectedVersion, op)),
    saveProfile: (u, c, values, expectedVersion, reason) => direct(u, c, (binding, op) => prepareProfile(binding, values, expectedVersion, reason, op)),
    deleteProfile: (u, c, expectedVersion) => direct(u, c, (binding, op) => prepareProfile(binding, null, expectedVersion, null, op)),
    history: (u, c, id, before = 2147483647) => authority.runTransaction(u, c, async binding => {
      if (!await readRecord(binding, id)) return null;
      return revisions(binding, 'care_revisions', 'care-revision', id, firestoreCareSchema, before);
    }),
    profileHistory: (u, c, before = 2147483647) => authority.runTransaction(u, c, async binding => {
      await readProfile(binding);
      const row = await binding.transaction.get(data.ref('child_profiles', 'child-profile', c));
      return revisions(binding, 'profile_revisions', 'profile-revision', c, firestoreProfileSchema, before, row.get('historyFloor') ?? 1);
    }),
    readReportSource,
    reportSource: (u, c) => authority.runTransaction(u, c, readReportSource),
  };
  return store;
}

/** Persisted schemas reused by isolated recovery; not a second domain model. */
export const firestoreCareRecoverySchemas = { tombstone: tombstoneSchema };
