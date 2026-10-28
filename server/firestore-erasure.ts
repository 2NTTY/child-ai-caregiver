import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Transaction } from '@google-cloud/firestore';
import type { OnlineReceipt, OnlineSubmission } from '../src/shared/online.ts';
import { createFirestoreAuthority, sharedSourceOperationId, type FirestoreAuthorityOptions, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { SHARING_SCOPE, sharedSpaceSchema } from './firestore-sharing-records.ts';
import { FirestoreDomainData, domainParse, domainReject } from './firestore-domain-data.ts';
import { createFirestoreOnlineReceipts, isFirestoreOnlinePending } from './firestore-online-receipts.ts';
import { onlineSubmissionSchema } from './online-routing.ts';
import { firebaseErasureIntentSchema, firebaseErasureDescriptorSchema, firebaseErasureIntentHash,
  type FirebaseErasureJournal, type FirebaseErasureIntent } from './firebase-erasure-journal.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const firestoreErasureReceiptPointerSchema = z.object({ ownerUserId: z.string().min(1).max(128), operationId: z.uuid() }).strict();
export const firestoreScopeErasureSchema = z.object({ intent: firebaseErasureIntentSchema,
  authorizationVersion: z.string().max(100), generation: z.uuid(),
  state: z.enum(['prepared', 'requested', 'blocked', 'cleaning', 'completed']),
  journal: firebaseErasureDescriptorSchema.nullable(),
  receiptToken: token.nullable(), expiresAt: z.iso.datetime({ offset: true }).nullable(),
  blockedAt: z.iso.datetime({ offset: true }).nullable(),
  scopeVersion: z.string(), childCount: z.number().int().nonnegative(),
  cleanup: z.object({ stage: z.string().max(100), cursor: z.string().max(2000).nullable() }).strict(),
}).strict().refine(value => ['child-delete', 'account-delete', 'class-delete'].includes(value.intent.type)
  && (value.intent.type === 'account-delete' ? value.intent.scope.childId === NIL && value.intent.assetId === NIL
    : value.intent.type === 'class-delete' ? value.intent.scope.childId===NIL && value.intent.assetId===value.intent.scope.workspaceId
      && value.intent.assetId!==NIL && value.intent.scope.ownerUserId==='space:'+value.intent.assetId
    : value.intent.assetId === value.intent.scope.childId && value.intent.assetId !== NIL));
export type FirestoreScopeErasure = z.infer<typeof firestoreScopeErasureSchema>;
export interface FirestoreErasureOptions extends FirestoreAuthorityOptions {
  journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'>;
}
export interface FirestoreErasureReceipt {
  operationId: string; state: 'prepared' | 'processing' | 'completed'; attachmentsPending: boolean;
}
/** Journal IO never runs in a transaction. A requested operation is durable and resumes with its original identity. */
export function createFirestoreErasureStore(options: FirestoreErasureOptions) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), receipts = createFirestoreOnlineReceipts(options);
  const clock = options.serverClock ?? Date.now;
  const scopeFor = (ownerUserId: string): WorkRecoveryScope => ({ ownerUserId, workspaceId: NIL, childId: NIL, storageEpoch: NIL });
  const key = (owner: string, opId: string) => JSON.stringify([owner, opId]);
  const ref = (owner: string, opId: string) => data.ref('erasures', 'scope-erasure', key(owner, opId));
  function seal(row: FirestoreScopeErasure) {
    const owner = row.intent.scope.ownerUserId, opId = row.intent.operationId;
    return { ...data.tags(scopeFor(owner)), operationId: opId, state: row.state,
      ...data.seal('scope-erasure', key(owner, opId), scopeFor(owner), firestoreScopeErasureSchema, row) };
  }
  async function read(transaction: Transaction, owner: string, opId: string) {
    const snapshot = await transaction.get(ref(owner, opId));
    if (!snapshot.exists) return null;
    const row = data.open('scope-erasure', key(owner, opId), scopeFor(owner), firestoreScopeErasureSchema, snapshot);
    if (row.intent.scope.ownerUserId !== owner || row.intent.operationId !== opId) domainReject('erasure_binding', 500);
    return row;
  }
  function checkToken(row: FirestoreScopeErasure, raw: string) {
    const supplied = domainParse(token, raw), actual = row.receiptToken;
    if (!actual || !timingSafeEqual(Buffer.from(supplied), Buffer.from(actual))) domainReject('erasure_receipt_invalid', 403);
  }
  function result(row: FirestoreScopeErasure): FirestoreErasureReceipt {
    return { operationId: row.intent.operationId, state: row.state === 'prepared' ? 'prepared' : row.state === 'completed' ? 'completed' : 'processing',
      attachmentsPending: row.state !== 'prepared' && row.state !== 'completed' };
  }
  function intent(binding: FirestoreAuthorityTransaction, operationId: string, childId?: string): FirebaseErasureIntent {
    return { scope: { ...binding.scope, childId: childId ?? NIL }, assetId: childId ?? NIL,
      operationId, at: new Date(clock()).toISOString(), type: childId ? 'child-delete' : 'account-delete' };
  }
  function initial(binding: FirestoreAuthorityTransaction, value: FirebaseErasureIntent, receiptToken: string | null, childCount: number): FirestoreScopeErasure {
    return { intent: value, authorizationVersion: binding.authorizationVersion, generation: binding.generation,
      state: receiptToken ? 'prepared' : 'requested', journal: null, receiptToken,
      expiresAt: receiptToken ? new Date(clock() + 15 * 60_000).toISOString() : null,
      scopeVersion: binding.changeSeq, childCount, blockedAt: null, cleanup: { stage: 'photos', cursor: null } };
  }
  async function journal(row: FirestoreScopeErasure) {
    if (row.state === 'prepared') domainReject('erasure_not_confirmed', 409);
    const descriptor = row.journal ?? await options.journal.writeOnce(row.intent);
    const stored = await options.journal.read(row.intent, descriptor);
    if (firebaseErasureIntentHash(stored) !== firebaseErasureIntentHash(row.intent)) domainReject('erasure_binding', 500);
    return descriptor;
  }
  async function submitOnline(owner: string, raw: OnlineSubmission): Promise<OnlineReceipt> {
    const submission = domainParse(onlineSubmissionSchema, raw);
    const match = /^\/api\/children\/([0-9a-f-]{36})\/delete$/iu.exec(submission.path);
    if (!match) domainReject('not_found', 404);
    const childId = domainParse(z.uuid(), match[1].toLowerCase());
    domainParse(z.object({ confirmChildId: z.literal(childId) }).strict(), submission.payload);
    const opId = submission.operation.opId;
    const started = await authority.runTransaction(owner, null, async binding => {
      const old = await receipts.read(binding, opId);
      if (old) {
        receipts.assertSame(binding, old, submission);
        if (!isFirestoreOnlinePending(old)) return { receipt: await receipts.disclose(binding, old) as OnlineReceipt };
        const row = await read(binding.transaction, owner, opId);
        if (!row || row.intent.scope.childId !== childId) domainReject('erasure_binding', 500);
        return { row };
      }
      receipts.assertCurrent(binding, submission);
      if (!await binding.readChild(childId)) domainReject('not_found', 404);
      if (await read(binding.transaction, owner, opId)) domainReject('operation_conflict');
      const row = initial(binding, intent(binding, opId, childId), null, 1), pending = receipts.preparePending(binding, submission, childId);
      const envelope = seal(row);
      pending.commit(); binding.transaction.create(ref(owner, opId), envelope); return { row };
    });
    if (started.receipt) return started.receipt;
    const descriptor = await journal(started.row!);
    return authority.runTransaction(owner, null, async binding => {
      const prior = await receipts.read(binding, opId); if (!prior) domainReject('erasure_binding', 500);
      receipts.assertSame(binding, prior, submission);
      if (!isFirestoreOnlinePending(prior)) return receipts.disclose(binding, prior) as Promise<OnlineReceipt>;
      const row = await read(binding.transaction, owner, opId);
      if (!row || row.authorizationVersion !== binding.authorizationVersion || row.generation !== binding.generation
        || row.intent.scope.storageEpoch !== binding.scope.storageEpoch) domainReject('erasure_scope_changed');
      const barrier = await binding.prepareErasure(opId, 'child', childId);
      // The result deliberately contains no erased child content; the original receipt remains recoverable.
      const confirmed = receipts.prepareConfirmed(binding, submission, { childId: null, changeSeq: barrier.changeSeq,
        statusCode: 200, result: { deleted: true, childId, cleanupPending: true } }, true);
      const envelope = seal({ ...row, state: 'blocked', journal: descriptor, blockedAt: new Date(clock()).toISOString() });
      barrier.commit(); confirmed.commit(); binding.transaction.set(ref(owner, opId), envelope); return confirmed.receipt;
    });
  }
  async function prepareAccount(owner: string, rawOperationId: string) {
    const opId = domainParse(z.uuid(), rawOperationId), newToken = randomBytes(32).toString('base64url');
    // A metadata-only count is rechecked by the workspace sequence when the preparation is committed.
    const scope = await authority.runTransaction(owner, null, binding => Promise.resolve({ scope: binding.scope, seq: binding.changeSeq }));
    const tags = data.tags(scope.scope);
    const aggregate = await data.collection('children').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).count().get();
    return authority.runTransaction(owner, null, async binding => {
      const old = await read(binding.transaction, owner, opId);
      if (old) {
        if (old.intent.type !== 'account-delete' || old.state !== 'prepared' || Date.parse(old.expiresAt!) <= clock()) domainReject('erasure_receipt_expired');
        return { ...result(old), receiptToken: old.receiptToken!, summary: { childCount: old.childCount }, expiresAt: old.expiresAt! };
      }
      if (binding.changeSeq !== scope.seq || binding.scope.storageEpoch !== scope.scope.storageEpoch) domainReject('erasure_scope_changed');
      const row = initial(binding, intent(binding, opId), newToken, aggregate.data().count);
      const pointer = data.ref('erasure_receipts', 'erasure-receipt-pointer', opId);
      if ((await binding.transaction.get(pointer)).exists) domainReject('operation_conflict');
      const pointerEnvelope = data.seal('erasure-receipt-pointer', opId, scopeFor('system:erasure-receipt'),
        firestoreErasureReceiptPointerSchema, { ownerUserId: owner, operationId: opId });
      binding.transaction.create(ref(owner, opId), seal(row));
      binding.transaction.create(pointer, pointerEnvelope);
      return { ...result(row), receiptToken: newToken, summary: { childCount: row.childCount }, expiresAt: row.expiresAt! };
    });
  }
  /** Caller must establish recent Firebase reauthentication before first execution. */
  async function executeAccount(owner: string, raw: { operationId: string; receiptToken: string; confirmation: string }) {
    const input = domainParse(z.object({ operationId: z.uuid(), receiptToken: token, confirmation: z.literal('永久刪除我的帳戶') }).strict(), raw);
    // Once blocked, access is gone; the secret receipt is the only recovery capability.
    const existing = await options.database.runTransaction(tx => read(tx, owner, input.operationId));
    if (!existing) domainReject('not_found', 404); checkToken(existing, input.receiptToken);
    if (['blocked', 'cleaning', 'completed'].includes(existing.state)) return result(existing);
    const requested = await authority.runTransaction(owner, null, async binding => {
      const old = await read(binding.transaction, owner, input.operationId);
      if (!old || old.intent.type !== 'account-delete') domainReject('not_found', 404); checkToken(old, input.receiptToken);
      if (old.state === 'prepared' && (Date.parse(old.expiresAt!) <= clock() || old.scopeVersion !== binding.changeSeq)) domainReject('erasure_scope_changed');
      const row: FirestoreScopeErasure = { ...old, state: 'requested' };
      binding.transaction.set(ref(owner, input.operationId), seal(row)); return row;
    });
    const descriptor = await journal(requested);
    return authority.runTransaction(owner, null, async binding => {
      const old = await read(binding.transaction, owner, input.operationId);
      if (!old || old.authorizationVersion !== binding.authorizationVersion || old.generation !== binding.generation
        || old.intent.scope.storageEpoch !== binding.scope.storageEpoch) domainReject('erasure_scope_changed');
      const barrier = await binding.prepareErasure(input.operationId, 'account'), row: FirestoreScopeErasure = {
        ...old, state: 'blocked', journal: descriptor, blockedAt: new Date(clock()).toISOString() };
      const envelope = seal(row); barrier.commit(); binding.transaction.set(ref(owner, input.operationId), envelope); return result(row);
    });
  }
  async function status(owner: string, opId: string, receiptToken: string) {
    domainParse(z.uuid(), opId);
    return options.database.runTransaction(async tx => {
      const row = await read(tx, owner, opId); if (!row) domainReject('not_found', 404);
      checkToken(row, receiptToken); return result(row);
    });
  }
  async function receiptStatus(opId: string, receiptToken: string) {
    domainParse(z.uuid(), opId); domainParse(token, receiptToken);
    return options.database.runTransaction(async tx => {
      const pointer = await tx.get(data.ref('erasure_receipts', 'erasure-receipt-pointer', opId));
      if (!pointer.exists) domainReject('not_found', 404);
      const identity = data.open('erasure-receipt-pointer', opId, scopeFor('system:erasure-receipt'), firestoreErasureReceiptPointerSchema, pointer);
      if (identity.operationId !== opId) domainReject('erasure_binding', 500);
      const row = await read(tx, identity.ownerUserId, opId); if (!row) domainReject('not_found', 404);
      checkToken(row, receiptToken); return result(row);
    });
  }
  async function resumeRequested(row: FirestoreScopeErasure) {
    if (row.state !== 'requested') return result(row);
    const owner = row.intent.scope.ownerUserId, opId = row.intent.operationId;
    if(row.intent.type==='class-delete')return resumeClass(row);
    if (row.intent.type === 'account-delete') {
      if (!row.receiptToken) domainReject('erasure_binding', 500);
      return executeAccount(owner, { operationId: opId, receiptToken: row.receiptToken, confirmation: '永久刪除我的帳戶' });
    }
    const pending = await authority.runTransaction(owner, null, b => receipts.read(b, opId));
    if (!pending || !isFirestoreOnlinePending(pending) || pending.childId !== row.intent.scope.childId) domainReject('erasure_binding', 500);
    await submitOnline(owner, { path: pending.path, operation: pending.operation, payload: { confirmChildId: row.intent.scope.childId } });
    return result((await options.database.runTransaction(tx => read(tx, owner, opId)))!);
  }
  /** Sharing checks the manager and versions; closure and the durable request commit together. */
  async function prepareClass(binding:FirestoreAuthorityTransaction,classId:string,actorOperationId:string) {
    const barrier=await authority.prepareClassErasure(binding,classId);
    const operationId=sharedSourceOperationId(binding.actorUserId,domainParse(z.uuid(),actorOperationId));
    if(await read(binding.transaction,barrier.scope.ownerUserId,operationId))domainReject('operation_conflict');
    const value:FirebaseErasureIntent={type:'class-delete',scope:barrier.scope,assetId:classId,operationId,at:new Date(clock()).toISOString()};
    const row:FirestoreScopeErasure={...initial(binding,value,null,0),authorizationVersion:barrier.authorizationVersion,blockedAt:value.at};
    const envelope=seal(row);
    return {operationId,commit(){barrier.commit();binding.transaction.create(ref(value.scope.ownerUserId,operationId),envelope);}};
  }
  async function resumeClass(requested:FirestoreScopeErasure) {
    const descriptor=await journal(requested),owner=requested.intent.scope.ownerUserId,opId=requested.intent.operationId;
    return options.database.runTransaction(async tx=>{
      const row=await read(tx,owner,opId);
      if(!row || firebaseErasureIntentHash(row.intent)!==firebaseErasureIntentHash(requested.intent))domainReject('erasure_binding',500);
      if(row.state!=='requested')return result(row);
      const id=row.intent.scope.workspaceId,snapshot=await tx.get(data.ref('shared_spaces','shared-space',id));
      const space=data.open('shared-space',id,SHARING_SCOPE,sharedSpaceSchema,snapshot);
      if(space.kind!=='class'||space.state!=='dissolved'||space.erasureOperationId!==opId
        ||space.storageIdentity.ownerUserId!==owner)domainReject('erasure_not_blocked');
      const blocked:FirestoreScopeErasure={...row,state:'blocked',journal:descriptor};
      tx.set(ref(owner,opId),seal(blocked));return result(blocked);
    });
  }
  return { submitOnline, prepareAccount, executeAccount, status, receiptStatus, resumeRequested, prepareClass,
    /** Trusted cleanup port: never exposed as a generic HTTP collection API. */
    read, seal, ref, result, journal, data };
}
export type FirestoreErasureStore = ReturnType<typeof createFirestoreErasureStore>;
