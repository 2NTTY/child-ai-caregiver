/// <reference lib="es2024.string" />
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, Transaction, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { SERVICE_POLICY_VERSION, SERVICE_DATA_NOTICE, type AccountServiceStatus } from '../src/shared/account-service.ts';
import { agentWorkValuesSchema, agentWorkSchema, saveAgentWorkSchema, type AgentWork, type AgentWorkValues } from '../src/shared/agent-work.ts';
import type { Child } from '../src/shared/records.ts';
import type { OnlineChange } from '../src/shared/online.ts';
import { validateCreateChild } from '../src/shared/inputs.ts';
import type { StorageCipher } from './storage-crypto.ts';
import { FirestoreDomainData, firestoreChildSchema, firestoreChangeSchema } from './firestore-domain-data.ts';
import { canonical } from './firestore-session-codec.ts';
import { sealRecoveryLocator } from './firestore-recovery-envelope.ts';
import { workRecoveryAad, workRecoveryDocumentId, workRecoverySchemas as schemas,
  workRecoveryScopeSchema, type WorkRecoveryKind, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { prepareFirestoreBackgroundWork } from './firestore-background-work.ts';

const FORMAT = 'yuban-work-recovery', MAX_BYTES = 192 * 1024;
const NIL = '00000000-0000-0000-0000-000000000000';
const bounded = (max: number) => z.string().min(1).max(max).refine(value => value.isWellFormed());
const userIdSchema = bounded(256), uuid = z.uuid(), datetime = z.iso.datetime({ offset: true });
const decimal = schemas.workspace.shape.accessVersion;
const authorityScopeSchema = workRecoveryScopeSchema.extend({ authorizationVersion: decimal }).strict();
const identitySchema = z.object({ userId: userIdSchema, email: z.email().max(320),
  state: z.enum(['active', 'revoked', 'deleting', 'deleted']) }).strict();
const ownerSchema = z.object({ userId: userIdSchema, workspaceId: uuid, workspaceCreatedAt: datetime.optional() }).strict();
const invitationSchema = z.object({ email: z.email().max(320), expiresAt: datetime,
  state: z.enum(['issued', 'consumed', 'revoked']), consumedBy: userIdSchema.nullable() }).strict();
const childDetailSchema = z.object({ id: uuid, workspaceId: uuid, displayName: bounded(160),
  createdAt: datetime, accessRole: z.literal('owner') }).strict();
const workDetailSchema = z.object({ id: uuid, version: schemas.work.shape.version, createdAt: datetime, updatedAt: datetime }).strict();
const receiptSchema = z.object({ ownerUserId: userIdSchema, childId: uuid.nullable(), operationId: uuid,
  action: bounded(64), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), result: z.unknown(), changeSeq: decimal.optional(),
  erased: z.literal(true).optional() }).strict();
const childCreationChangeSchema = z.object({ workspaceId: uuid, storageEpoch: uuid, changeSeq: decimal,
  kind: z.literal('children'), childId: uuid, privateUserId: userIdSchema, ownerOnly: z.literal(true), deleted: z.literal(false),
  suppressWorkWake: z.literal(true), operationId: uuid }).strict();
const changeKindSchema = z.enum(['children', 'care', 'profile', 'chat', 'family', 'preferences', 'memory', 'tasks', 'growth', 'documents']);
const childProjectionTagSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const childProjectionBindingSchema = z.object({ workspaceTag: childProjectionTagSchema, epochTag: childProjectionTagSchema,
  userTag: childProjectionTagSchema, childTag: childProjectionTagSchema, childId: uuid }).strict();
type AuxiliaryKind = 'authority-invitation' | 'authority-identity' | 'authority-owner' | 'authority-operation' | 'authority-child-detail' | 'authority-work-detail';
type Kind = WorkRecoveryKind | AuxiliaryKind;
type Workspace = z.infer<typeof schemas.workspace>;
type AuthorityChild = z.infer<typeof schemas.child>;
type Invitation = z.infer<typeof invitationSchema>;
export type FirestoreAuthorityScope = z.infer<typeof authorityScopeSchema>;
export interface FirestoreAuthorityBinding { scope: WorkRecoveryScope; authorizationVersion: string }
export interface FirestoreIdentityAdmission { userId: string; workspaceId: string; storageEpoch: string; emailVerified: boolean }
export interface FirestoreChildCreation extends FirestoreAuthorityBinding { child: Child }
export interface FirestoreAuthorityPreparedChange { readonly changeSeq: string; commit(): void }
export interface FirestoreAuthorityPreparedChild extends FirestoreAuthorityPreparedChange { readonly result: FirestoreChildCreation }
export interface FirestoreAuthorityTransaction {
  readonly transaction: Transaction;
  readonly scope: Readonly<WorkRecoveryScope>;
  readonly authorizationVersion: string;
  readonly changeSeq: string;
  readonly generation: string;
  readonly identityEmail: string;
  readonly workspaceCreatedAt: string | null;
  readChild(childId: string): Promise<Child | null>;
  prepareChange(operationId: string, kind: OnlineChange['kind'], deleted: boolean, childId?: string): Promise<FirestoreAuthorityPreparedChange>;
  prepareChildCreation(raw: { operationId: string; displayName: string }): Promise<FirestoreAuthorityPreparedChild>;
  /** Admission barrier only. Independent journal and bounded physical cleanup belong to erasure service. */
  prepareErasure(operationId: string, type: 'child' | 'account', childId?: string): Promise<FirestoreAuthorityPreparedChange>;
  readWork(id: string): Promise<AgentWork | null>;
  /** Domain caller validates source/resource references before preparing this canonical write. */
  prepareWork(raw: z.infer<typeof saveAgentWorkSchema>): Promise<FirestoreAuthorityPreparedChange & { value: AgentWork }>;
}
export type FirestoreAuthorityAccountStatus = Omit<AccountServiceStatus, 'mailConfigured'>;
export interface FirestoreAuthorityOptions {
  database: Firestore; cipher: StorageCipher; projectId: string; namespace: string; serverClock?: () => number;
}
export class FirestoreAuthorityError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super('Firestore authority request rejected'); this.name = 'FirestoreAuthorityError'; this.code = code; this.status = status; }
}
function fail(code: string, status = 409): never { throw new FirestoreAuthorityError(code, status); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = 'invalid_input', status = 400): T {
  const result = schema.safeParse(value); if (!result.success) fail(code, status); return result.data;
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const ownerScope = (ownerUserId: string, workspaceId = NIL, storageEpoch = NIL, childId = NIL): WorkRecoveryScope =>
  ({ ownerUserId, workspaceId, childId, storageEpoch });
function plainScope(scope: FirestoreAuthorityScope): WorkRecoveryScope {
  const { ownerUserId, workspaceId, childId, storageEpoch } = scope; return { ownerUserId, workspaceId, childId, storageEpoch };
}
function email(raw: string): string { return parse(z.email().max(320), typeof raw === 'string' ? raw.trim().toLowerCase() : raw); }
function size(value: unknown) { if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_BYTES) fail('document_too_large', 413); }
function increment(value: string): string {
  const next = (BigInt(value) + 1n).toString(); if (!decimal.safeParse(next).success) fail('sequence_exhausted'); return next;
}

/** Trusted server port. Identity claims must come from Firebase Admin verification, never caller/model assertions. */
export class FirestoreAuthority {
  private readonly options: Readonly<FirestoreAuthorityOptions>;
  private readonly domain: FirestoreDomainData;
  constructor(options: FirestoreAuthorityOptions) {
    if (!options || typeof options.database?.runTransaction !== 'function' || typeof options.database?.collection !== 'function'
      || typeof options.cipher?.encrypt !== 'function' || typeof options.cipher?.decrypt !== 'function'
      || !userIdSchema.safeParse(options.projectId).success || options.projectId !== options.projectId.trim()
      || !/^[a-z][a-z0-9_]{0,60}$/u.test(options.namespace)
      || options.serverClock !== undefined && typeof options.serverClock !== 'function') fail('configuration', 500);
    this.options = Object.freeze({ ...options });
    this.domain = new FirestoreDomainData(options);
  }
  private now() {
    const now = (this.options.serverClock ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || now > 253402271909999) fail('clock', 500); return now;
  }
  private ref(kind: Kind, id: string) {
    const documentId = kind.startsWith('authority-') ? createHash('sha256').update(JSON.stringify([kind, id])).digest('hex')
      : workRecoveryDocumentId(kind as WorkRecoveryKind, id);
    return this.options.database.collection(this.options.namespace).doc(documentId);
  }
  private aad(kind: Kind, id: string, scope: WorkRecoveryScope) {
    if (!kind.startsWith('authority-')) return workRecoveryAad(this.options.projectId, this.options.namespace, kind as WorkRecoveryKind, id, parse(workRecoveryScopeSchema, scope));
    const binding = kind === 'authority-invitation' ? null
      : kind === 'authority-identity' || kind === 'authority-owner' || kind === 'authority-operation' && scope.childId === NIL
        ? { ownerUserId: scope.ownerUserId } : scope;
    return JSON.stringify([FORMAT, 2, this.options.projectId, this.options.namespace, kind, id, binding]);
  }
  private seal(kind: Kind, id: string, scope: WorkRecoveryScope, value: unknown) {
    size(value);
    const version: 1 | 2 = kind.startsWith('authority-') ? 2 : 1, aad = this.aad(kind, id, scope);
    const ciphertext = this.options.cipher.encrypt(canonical(value), aad);
    const recovery = sealRecoveryLocator({ cipher: this.options.cipher, projectId: this.options.projectId, namespace: this.options.namespace,
      ciphertext, context: { family: 'authority', kind, id, scope, envelopeVersion: version, aad } });
    const result = { format: FORMAT, version, ciphertext, recovery };
    size(result); return result;
  }
  private open<T>(kind: Kind, id: string, scope: WorkRecoveryScope, snapshot: DocumentSnapshot, schema: z.ZodType<T>): T {
    if (!snapshot.exists) fail('not_found', 404);
    size(snapshot.data());
    const version = kind.startsWith('authority-') ? 2 : 1;
    const envelope = parse(z.object({ format: z.literal(FORMAT), version: z.literal(version), ciphertext: bounded(MAX_BYTES), recovery: z.unknown().optional() }).strict(), snapshot.data(), 'invalid_document', 500);
    let value: unknown;
    try { const text = this.options.cipher.decrypt(envelope.ciphertext, this.aad(kind, id, scope)); size(text); value = JSON.parse(text); }
    catch { fail('invalid_document', 500); }
    return parse(schema, value, 'invalid_document', 500);
  }
  private async read<T>(tx: Transaction, kind: Kind, id: string, scope: WorkRecoveryScope, schema: z.ZodType<T>) {
    return this.open(kind, id, scope, await tx.get(this.ref(kind, id)), schema);
  }
  private canonicalChild(tx: Transaction, scope: WorkRecoveryScope): Promise<AuthorityChild>;
  private canonicalChild(tx: Transaction, scope: WorkRecoveryScope, optional: true): Promise<AuthorityChild | null>;
  private async canonicalChild(tx: Transaction, scope: WorkRecoveryScope, optional = false): Promise<AuthorityChild | null> {
    const id = scope.childId, snapshot = await tx.get(this.ref('child', id));
    if (!snapshot.exists) { if (optional) return null; fail('not_found', 404); }
    const projection = await tx.get(this.domain.ref('children', 'child-projection', id));
    if (projection.exists) {
      const raw = projection.data(), binding = parse(childProjectionBindingSchema, { workspaceTag: raw?.workspaceTag,
        epochTag: raw?.epochTag, userTag: raw?.userTag, childTag: raw?.childTag, childId: raw?.childId }, 'invalid_document', 500);
      if (binding.childId !== id) fail('invalid_document', 500);
      const expected = this.domain.tags(scope);
      // Projection metadata may deny early; only the canonical envelope grants access.
      if (binding.workspaceTag !== expected.workspaceTag || binding.epochTag !== expected.epochTag
        || binding.userTag !== expected.userTag || binding.childTag !== expected.childTag) fail('binding', 403);
    }
    const child = this.open('child', id, scope, snapshot, schemas.child);
    if (child.id !== id || child.workspaceId !== scope.workspaceId) fail('binding', 403);
    if (child.status !== 'active') { if (optional) return null; fail('binding', 403); }
    return child;
  }
  private write(tx: Transaction, kind: Kind, id: string, scope: WorkRecoveryScope, value: unknown, create = false) {
    const ref = this.ref(kind, id), sealed = this.seal(kind, id, scope, value);
    if (create) tx.create(ref, sealed); else tx.set(ref, sealed);
  }
  private async control(tx: Transaction, enabled = true) {
    this.now(); const control = await this.read(tx, 'control', 'current', ownerScope('control'), schemas.control);
    if (enabled && !control.enabled) fail('service_disabled', 403); return control;
  }
  private async account(tx: Transaction, userId: string, business = true) {
    const control = await this.control(tx); const scope = ownerScope(userId);
    const account = await this.read(tx, 'account', userId, scope, schemas.account);
    const identity = await this.read(tx, 'authority-identity', userId, scope, identitySchema);
    const owner = await this.read(tx, 'authority-owner', userId, scope, ownerSchema);
    const invitation = await this.read(tx, 'authority-invitation', identity.email, scope, invitationSchema);
    const workspace = await this.read(tx, 'workspace', owner.workspaceId, ownerScope(userId, owner.workspaceId), schemas.workspace);
    if (account.userId !== userId || identity.userId !== userId || owner.userId !== userId
      || invitation.email !== identity.email || invitation.consumedBy !== userId
      || workspace.id !== owner.workspaceId || workspace.ownerUserId !== userId) fail('binding', 403);
    if (account.status !== 'active' || !account.admitted || !account.invitationLive || identity.state !== 'active'
      || invitation.state !== 'consumed' || workspace.status !== 'active') fail('account_inactive', 403);
    if (business && (!account.emailVerified || account.acknowledgementVersion !== SERVICE_POLICY_VERSION)) fail('account_not_ready', 403);
    return { control, account, identity, owner, invitation, workspace };
  }
  private async scope(tx: Transaction, input: FirestoreAuthorityScope) {
    const current = await this.account(tx, input.ownerUserId), scope = plainScope(input);
    if (current.workspace.id !== scope.workspaceId || current.workspace.storageEpoch !== scope.storageEpoch
      || current.workspace.accessVersion !== input.authorizationVersion) fail('scope_changed');
    const child = await this.canonicalChild(tx, scope);
    return { ...current, scope, child };
  }
  private operationKey(scope: WorkRecoveryScope, operationId: string, child = true) {
    return JSON.stringify([scope.ownerUserId, child ? scope.childId : null, operationId]);
  }
  private async operation<T>(tx: Transaction, scope: WorkRecoveryScope, operationId: string, action: string,
    payload: unknown, resultSchema: z.ZodType<T>, child = true) {
    const key = this.operationKey(scope, operationId, child), fingerprint = digest({ action, payload });
    const snapshot = await tx.get(this.ref('authority-operation', key));
    if (!snapshot.exists) return { key, fingerprint, prior: null, changeSeq: undefined };
    const receipt = this.open('authority-operation', key, scope, snapshot, receiptSchema);
    if (receipt.ownerUserId !== scope.ownerUserId || receipt.childId !== (child ? scope.childId : null)
      || receipt.operationId !== operationId || receipt.action !== action || receipt.fingerprint !== fingerprint) fail('operation_conflict');
    if (receipt.erased) fail('operation_erased');
    return { key, fingerprint, prior: parse(resultSchema, receipt.result, 'invalid_document', 500), changeSeq: receipt.changeSeq };
  }
  private receipt<T>(tx: Transaction, scope: WorkRecoveryScope, operationId: string, action: string,
    op: { key: string; fingerprint: string }, result: T, child = true) {
    this.write(tx, 'authority-operation', op.key, scope, { ownerUserId: scope.ownerUserId,
      childId: child ? scope.childId : null, operationId, action, fingerprint: op.fingerprint, result }, true);
  }
  private changeId(scope: WorkRecoveryScope, operationId: string) {
    return JSON.stringify([scope.workspaceId, scope.storageEpoch, scope.ownerUserId, scope.childId, operationId, 'authority']);
  }
  private async change(tx: Transaction, scope: WorkRecoveryScope, workspace: Workspace, operationId: string, kind: OnlineChange['kind'], deleted: boolean): Promise<FirestoreAuthorityPreparedChange> {
    const id = this.changeId(scope, operationId), ref = this.ref('change', id);
    if ((await tx.get(ref)).exists) fail('change_conflict');
    // Domain writes enqueue their event atomically; projections/background explanation changes do not wake themselves.
    const control = scope.childId !== NIL && ['care', 'profile', 'memory', 'tasks', 'children', 'growth', 'documents'].includes(kind) && !(kind === 'children' && deleted)
      ? await this.readControl(tx) : null;
    const wake = control ? await prepareFirestoreBackgroundWork(this.domain, tx, { kind: 'child-change', scope, resourceId: scope.childId,
      basis: kind + ':' + operationId, generation: control.generation, authorizationVersion: workspace.accessVersion }, new Date(this.now()).toISOString()) : null;
    const changeSeq = increment(workspace.changeSeq);
    const workspaceEnvelope = this.seal('workspace', workspace.id, scope, { ...workspace, changeSeq });
    const changeEnvelope = this.seal('change', id, scope, { workspaceId: scope.workspaceId, storageEpoch: scope.storageEpoch, changeSeq,
      kind, childId: scope.childId === NIL ? null : scope.childId, privateUserId: scope.ownerUserId, ownerOnly: true, deleted,
      suppressWorkWake: true, operationId });
    const projectionId = JSON.stringify([scope.workspaceId, scope.storageEpoch, changeSeq]);
    const projection = { ...this.domain.tags(scope), sortKey: this.domain.sortKey(changeSeq), childId: scope.childId === NIL ? null : scope.childId,
      ...this.domain.seal('change-projection', projectionId, scope, firestoreChangeSchema,
        { changeSeq, kind, childId: scope.childId === NIL ? null : scope.childId, deleted }) };
    return { changeSeq, commit: () => {
      wake?.commit();
      tx.set(this.ref('workspace', workspace.id), workspaceEnvelope); tx.create(ref, changeEnvelope);
      tx.create(this.domain.ref('changes', 'change-projection', projectionId), projection);
    } };
  }
  /** Provider evidence may finish after revocation; publish a change only into the still-live original scope. */
  async prepareReceiptChange(tx: Transaction, scope: WorkRecoveryScope, operationId: string, kind: OnlineChange['kind']) {
    parse(uuid, operationId); parse(changeKindSchema, kind);
    try {
      const { workspace } = await this.account(tx, scope.ownerUserId);
      if (workspace.id !== scope.workspaceId || workspace.storageEpoch !== scope.storageEpoch) return null;
      if (scope.childId !== NIL) await this.canonicalChild(tx, scope);
      return await this.change(tx, scope, workspace, operationId, kind, false);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return null;
      throw error;
    }
  }
  /** Each SDK callback owns a fresh binding. Domain writes use this native transaction after all reads. */
  async runTransaction<T>(userId: string, childId: string | null, operation: (binding: FirestoreAuthorityTransaction) => Promise<T>): Promise<T> {
    parse(userIdSchema, userId); if (childId !== null) parse(uuid, childId);
    if (typeof operation !== 'function') fail('invalid_input', 400);
    const childCandidateId = childId === null ? randomUUID() : null;
    return this.options.database.runTransaction(async tx => {
      let active = true, prepared = false, committed = false;
      const assertActive = () => { if (!active) fail('transaction_closed'); };
      const reserve = () => { assertActive(); if (prepared) fail('transaction_change_conflict'); prepared = true; };
      const guardCommit = (commit: () => void) => () => {
        assertActive(); if (committed) fail('transaction_change_conflict'); committed = true; commit();
      };
      try {
        const { workspace, control, owner, identity } = await this.account(tx, userId);
        const scope = Object.freeze(ownerScope(userId, workspace.id, workspace.storageEpoch, childId ?? NIL));
        if (childId !== null) await this.canonicalChild(tx, scope);
        const binding: FirestoreAuthorityTransaction = Object.freeze({ transaction: tx, scope,
          authorizationVersion: workspace.accessVersion, changeSeq: workspace.changeSeq, generation: control.generation, identityEmail: identity.email, workspaceCreatedAt: owner.workspaceCreatedAt ?? null,
          readChild: async (requestedChildId: string) => {
            assertActive(); parse(uuid, requestedChildId);
            const childScope = ownerScope(userId, workspace.id, workspace.storageEpoch, requestedChildId);
            const child = await this.canonicalChild(tx, childScope, true); assertActive();
            if (child === null) return null;
            const detail = await this.read(tx, 'authority-child-detail', requestedChildId, childScope, childDetailSchema);
            assertActive();
            if (detail.id !== requestedChildId || detail.workspaceId !== workspace.id) fail('binding', 403);
            return detail;
          },
          prepareChange: async (operationId: string, kind: OnlineChange['kind'], deleted: boolean, requestedChildId?: string) => {
            parse(uuid, operationId); parse(changeKindSchema, kind); parse(z.boolean(), deleted); reserve();
            let changeScope = scope;
            if (requestedChildId !== undefined) {
              parse(uuid, requestedChildId);
              if (childId !== null && requestedChildId !== childId) fail('transaction_child_scope');
              changeScope = ownerScope(userId, workspace.id, workspace.storageEpoch, requestedChildId);
              await this.canonicalChild(tx, changeScope); assertActive();
            }
            const change = await this.change(tx, changeScope, workspace, operationId, kind, deleted); assertActive();
            return Object.freeze({ changeSeq: change.changeSeq, commit: guardCommit(change.commit) });
          },
          prepareChildCreation: async (raw: { operationId: string; displayName: string }) => {
            assertActive(); if (childId !== null || childCandidateId === null) fail('transaction_child_scope'); reserve();
            const child = await this.prepareChild(tx, workspace, userId, childCandidateId, raw); assertActive();
            return Object.freeze({ result: child.result, changeSeq: child.changeSeq, commit: guardCommit(child.commit) });
          },
          prepareErasure: async (operationId: string, type: 'child' | 'account', requestedChildId?: string) => {
            parse(uuid, operationId); parse(z.enum(['child', 'account']), type); reserve();
            if (childId !== null) fail('transaction_child_scope');
            const targetScope = type === 'child' ? ownerScope(userId, workspace.id, workspace.storageEpoch, parse(uuid, requestedChildId)) : scope;
            if (type === 'child') await this.canonicalChild(tx, targetScope);
            const account = type === 'account' ? await this.read(tx, 'account', userId, ownerScope(userId), schemas.account) : null;
            const change = await this.change(tx, targetScope, workspace, operationId, 'children', true);
            const barrier = type === 'child'
              ? this.seal('child', targetScope.childId, targetScope, { id: targetScope.childId, workspaceId: workspace.id, status: 'deleting' })
              : this.seal('account', userId, ownerScope(userId), { ...account!, status: 'deleting', admitted: false, invitationLive: false });
            const identityBarrier = type === 'account' ? this.seal('authority-identity', userId, ownerScope(userId), { ...identity, state: 'deleting' }) : null;
            return Object.freeze({ changeSeq: change.changeSeq, commit: guardCommit(() => {
              change.commit();
              if (type === 'child') {
                tx.set(this.ref('child', targetScope.childId), barrier);
                tx.delete(this.domain.ref('children', 'child-projection', targetScope.childId));
              } else {
                tx.set(this.ref('account', userId), barrier);
                tx.set(this.ref('authority-identity', userId), identityBarrier!);
              }
            }) });
          },
          readWork: async (id: string) => {
            assertActive(); parse(uuid, id); if (childId === null) fail('transaction_child_scope');
            if (!(await tx.get(this.ref('work', id))).exists) return null;
            const old = await this.work(tx, scope, id, workspace.accessVersion); assertActive();
            return { ...old.values, id, childId, version: old.work.version,
              createdAt: old.detail.createdAt, updatedAt: old.detail.updatedAt };
          },
          prepareWork: async (raw: z.infer<typeof saveAgentWorkSchema>) => {
            assertActive(); if (childId === null) fail('transaction_child_scope');
            const input = parse(saveAgentWorkSchema, raw), id = input.workId ?? randomUUID();
            const old = await binding.readWork(id);
            if (input.workId && !old) fail('not_found', 404);
            if ((old?.version ?? 0) !== input.expectedVersion) fail('version_conflict');
            if (old?.status === 'cancelled' && input.values.status !== 'cancelled') fail('work_cancelled');
            const at = new Date(this.now()).toISOString(), value = parse(agentWorkSchema, { ...input.values, id, childId,
              version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? at, updatedAt: at });
            if (!schemas.work.shape.version.safeParse(value.version).success) fail('version_exhausted');
            const change = await binding.prepareChange(input.operationId, 'memory', value.status === 'cancelled');
            return { value, changeSeq: change.changeSeq, commit: () => {
              this.writeWork(tx, scope, workspace, value); change.commit();
            } };
          },
        });
        return await operation(binding);
      } finally { active = false; }
    });
  }
  async initializeControl(raw: { generation: string; enabled: boolean }): Promise<{ generation: string; enabled: boolean }> {
    const input = parse(schemas.control, raw), scope = ownerScope('control');
    return this.options.database.runTransaction(async tx => {
      const snapshot = await tx.get(this.ref('control', 'current'));
      if (snapshot.exists) {
        const prior = this.open('control', 'current', scope, snapshot, schemas.control);
        if (!same(prior, input)) fail('control_conflict'); return prior;
      }
      this.write(tx, 'control', 'current', scope, input, true); return input;
    });
  }
  /** Operator-only lifecycle control. Never exposed through a public handler or Agent tool. */
  async readControl(transaction?: Transaction): Promise<{ generation: string; enabled: boolean }> {
    if (transaction) return this.control(transaction, false);
    return this.options.database.runTransaction(tx => this.control(tx, false), { readOnly: true });
  }
  async issueInvitation(raw: { email: string; expiresAt: string; operationId: string }): Promise<Invitation> {
    const input = parse(z.object({ email: z.email().max(320), expiresAt: datetime, operationId: uuid }).strict(), { ...raw, email: email(raw.email) });
    const scope = ownerScope('invitation:' + digest(input.email));
    return this.options.database.runTransaction(async tx => {
      await this.control(tx, false);
      const snapshot = await tx.get(this.ref('authority-invitation', input.email));
      const prior = snapshot.exists ? this.open('authority-invitation', input.email, scope, snapshot, invitationSchema) : null;
      if (prior?.consumedBy || prior?.state === 'revoked') fail('invitation_closed', 403);
      const op = await this.operation(tx, scope, input.operationId, 'issue_invitation', input, invitationSchema, false);
      if (op.prior !== null) return op.prior;
      if (Date.parse(input.expiresAt) <= this.now()) fail('invitation_expired', 403);
      const result: Invitation = { email: input.email, expiresAt: input.expiresAt, state: 'issued', consumedBy: null };
      this.write(tx, 'authority-invitation', input.email, scope, result);
      this.receipt(tx, scope, input.operationId, 'issue_invitation', op, result, false); return result;
    });
  }
  async revokeInvitation(raw: { email: string; operationId: string }): Promise<Invitation> {
    const input = parse(z.object({ email: z.email().max(320), operationId: uuid }).strict(), { ...raw, email: email(raw.email) });
    const scope = ownerScope('invitation:' + digest(input.email));
    return this.options.database.runTransaction(async tx => {
      await this.control(tx, false);
      const invitation = await this.read(tx, 'authority-invitation', input.email, scope, invitationSchema);
      const account = invitation.consumedBy ? await this.read(tx, 'account', invitation.consumedBy, ownerScope(invitation.consumedBy), schemas.account) : null;
      const identity = invitation.consumedBy ? await this.read(tx, 'authority-identity', invitation.consumedBy, ownerScope(invitation.consumedBy), identitySchema) : null;
      if (identity && (identity.email !== input.email || identity.userId !== invitation.consumedBy) || account && account.userId !== invitation.consumedBy) fail('binding', 403);
      const op = await this.operation(tx, scope, input.operationId, 'revoke_invitation', input, invitationSchema, false);
      if (op.prior !== null) return op.prior;
      const result: Invitation = { ...invitation, state: 'revoked' };
      this.write(tx, 'authority-invitation', input.email, scope, result);
      if (account && identity) {
        const accountScope = ownerScope(account.userId);
        this.write(tx, 'account', account.userId, accountScope, { ...account, admitted: false, invitationLive: false });
        this.write(tx, 'authority-identity', account.userId, accountScope, { ...identity, state: identity.state === 'active' ? 'revoked' : identity.state });
      }
      this.receipt(tx, scope, input.operationId, 'revoke_invitation', op, result, false); return result;
    });
  }
  async assertCanRegister(rawEmail: string): Promise<void> {
    const address = email(rawEmail);
    await this.options.database.runTransaction(async tx => {
      await this.control(tx);
      const invitation = await this.read(tx, 'authority-invitation', address, ownerScope('registration'), invitationSchema);
      if (invitation.email !== address || invitation.state !== 'issued' || invitation.consumedBy !== null || Date.parse(invitation.expiresAt) <= this.now()) fail('invitation_unavailable', 403);
    }, { readOnly: true });
  }
  async admitIdentity(raw: { userId: string; email: string; emailVerified: boolean }): Promise<FirestoreIdentityAdmission> {
    const input = parse(z.object({ userId: userIdSchema, email: z.email().max(320), emailVerified: z.boolean() }).strict(), { ...raw, email: email(raw.email) });
    const workspaceId = randomUUID(), storageEpoch = randomUUID(), scope = ownerScope(input.userId);
    return this.options.database.runTransaction(async tx => {
      await this.control(tx);
      const accountSnapshot = await tx.get(this.ref('account', input.userId));
      const identitySnapshot = await tx.get(this.ref('authority-identity', input.userId));
      const ownerSnapshot = await tx.get(this.ref('authority-owner', input.userId));
      if (accountSnapshot.exists || identitySnapshot.exists || ownerSnapshot.exists) {
        if (!accountSnapshot.exists || !identitySnapshot.exists || !ownerSnapshot.exists) fail('invalid_document', 500);
        const current = await this.account(tx, input.userId, false);
        if (current.identity.email !== input.email) fail('identity_email_changed', 403);
        if (current.account.emailVerified !== input.emailVerified)
          this.write(tx, 'account', input.userId, scope, { ...current.account, emailVerified: input.emailVerified });
        return { userId: input.userId, workspaceId: current.workspace.id, storageEpoch: current.workspace.storageEpoch, emailVerified: input.emailVerified };
      }
      const invitation = await this.read(tx, 'authority-invitation', input.email, scope, invitationSchema);
      if (invitation.email !== input.email || invitation.state !== 'issued' || invitation.consumedBy !== null || Date.parse(invitation.expiresAt) <= this.now()) fail('invitation_unavailable', 403);
      if ((await tx.get(this.ref('workspace', workspaceId))).exists) fail('identity_conflict');
      this.write(tx, 'account', input.userId, scope, { userId: input.userId, status: 'active', admitted: true,
        invitationLive: true, emailVerified: input.emailVerified, acknowledgementVersion: null }, true);
      this.write(tx, 'authority-identity', input.userId, scope, { userId: input.userId, email: input.email, state: 'active' }, true);
      this.write(tx, 'authority-owner', input.userId, scope, { userId: input.userId, workspaceId, workspaceCreatedAt: new Date(this.now()).toISOString() }, true);
      this.write(tx, 'workspace', workspaceId, ownerScope(input.userId, workspaceId, storageEpoch),
        { id: workspaceId, ownerUserId: input.userId, storageEpoch, accessVersion: '1', changeSeq: '0', status: 'active' }, true);
      this.write(tx, 'authority-invitation', input.email, scope, { ...invitation, state: 'consumed', consumedBy: input.userId });
      return { userId: input.userId, workspaceId, storageEpoch, emailVerified: input.emailVerified };
    });
  }
  async assertSessionAdmission(userId: string, currentIdentity?: { email: string; emailVerified: boolean }): Promise<void> {
    parse(userIdSchema, userId);
    const identity = currentIdentity === undefined ? null
      : parse(z.object({ email: z.string(), emailVerified: z.boolean() }).strict(), currentIdentity);
    if (identity) identity.email = email(identity.email);
    await this.options.database.runTransaction(async tx => {
      const current = await this.account(tx, userId, false);
      if (identity) {
        if (current.identity.email !== identity.email) fail('identity_email_changed', 403);
        if (current.account.emailVerified !== identity.emailVerified)
          this.write(tx, 'account', userId, ownerScope(userId), { ...current.account, emailVerified: identity.emailVerified });
      }
    }, identity ? undefined : { readOnly: true });
  }
  async accountStatus(userId: string | null): Promise<FirestoreAuthorityAccountStatus> {
    if (userId !== null) parse(userIdSchema, userId);
    return this.options.database.runTransaction(async tx => {
      const control = await this.control(tx, false);
      const account = userId !== null && control.enabled ? (await this.account(tx, userId, false)).account : null;
      const result: FirestoreAuthorityAccountStatus = { enabled: control.enabled, registration: 'invite', policyVersion: SERVICE_POLICY_VERSION, notice: SERVICE_DATA_NOTICE,
        user: account ? { id: account.userId, emailVerified: account.emailVerified,
          acknowledged: account.acknowledgementVersion === SERVICE_POLICY_VERSION, acknowledgementVersion: account.acknowledgementVersion } : null };
      return result;
    }, { readOnly: true });
  }
  async acknowledge(raw: { userId: string; operationId: string; policyVersion: string }): Promise<{ policyVersion: string }> {
    const input = parse(z.object({ userId: userIdSchema, operationId: uuid, policyVersion: z.literal(SERVICE_POLICY_VERSION) }).strict(), raw);
    const scope = ownerScope(input.userId), resultSchema = z.object({ policyVersion: z.literal(SERVICE_POLICY_VERSION) }).strict();
    return this.options.database.runTransaction(async tx => {
      const current = await this.account(tx, input.userId, false);
      if (!current.account.emailVerified) fail('email_not_verified', 403);
      const op = await this.operation(tx, scope, input.operationId, 'acknowledge', input, resultSchema, false);
      if (op.prior !== null) return op.prior;
      const result = { policyVersion: SERVICE_POLICY_VERSION };
      this.write(tx, 'account', input.userId, scope, { ...current.account, acknowledgementVersion: SERVICE_POLICY_VERSION });
      this.receipt(tx, scope, input.operationId, 'acknowledge', op, result, false); return result;
    });
  }
  async setAccountState(raw: { userId: string; operationId: string; state: 'revoked' | 'deleting' | 'deleted' }): Promise<{ state: 'revoked' | 'deleting' | 'deleted' }> {
    const stateSchema = z.enum(['revoked', 'deleting', 'deleted']);
    const input = parse(z.object({ userId: userIdSchema, operationId: uuid, state: stateSchema }).strict(), raw), scope = ownerScope(input.userId);
    return this.options.database.runTransaction(async tx => {
      await this.control(tx, false);
      const account = await this.read(tx, 'account', input.userId, scope, schemas.account);
      const identity = await this.read(tx, 'authority-identity', input.userId, scope, identitySchema);
      if (account.userId !== input.userId || identity.userId !== input.userId) fail('binding', 403);
      const op = await this.operation(tx, scope, input.operationId, 'set_account_state', input, z.object({ state: stateSchema }).strict(), false);
      if (op.prior !== null) return op.prior;
      if (identity.state === 'deleted' && input.state !== 'deleted' || identity.state === 'deleting' && input.state === 'revoked') fail('account_state_conflict');
      const result = { state: input.state };
      this.write(tx, 'account', input.userId, scope, { ...account, status: input.state === 'revoked' ? account.status : input.state,
        admitted: false, invitationLive: false });
      this.write(tx, 'authority-identity', input.userId, scope, { ...identity, state: input.state });
      this.receipt(tx, scope, input.operationId, 'set_account_state', op, result, false); return result;
    });
  }
  private async prepareChild(tx: Transaction, workspace: Workspace, userId: string, childId: string,
    raw: { operationId: string; displayName: string }): Promise<FirestoreAuthorityPreparedChild> {
    const values = parse(z.object({ operationId: uuid, displayName: z.string() }).strict(), raw);
    const input = { userId, ...values };
    const validated = validateCreateChild({ displayName: input.displayName });
    if (!validated.ok || !validated.value.displayName.isWellFormed()) fail('invalid_input', 400);
    input.displayName = validated.value.displayName;
    const resultSchema = z.object({ child: childDetailSchema, scope: workRecoveryScopeSchema, authorizationVersion: decimal }).strict();
    const accountScope = ownerScope(userId), scope = ownerScope(userId, workspace.id, workspace.storageEpoch, childId);
    const op = await this.operation(tx, accountScope, input.operationId, 'create_child', input, resultSchema, false);
    if (op.prior !== null) {
      const originalScope = op.prior.scope;
      if (originalScope.ownerUserId !== userId || originalScope.workspaceId !== workspace.id || originalScope.storageEpoch !== workspace.storageEpoch
        || op.prior.authorizationVersion !== workspace.accessVersion || op.prior.child.id !== originalScope.childId
        || op.prior.child.workspaceId !== workspace.id) fail('receipt_binding', 403);
      await this.canonicalChild(tx, originalScope);
      let changeSeq = op.changeSeq;
      if (changeSeq === undefined) {
        // F01 receipts predate sequence metadata. Only their exact authenticated original marker can supply it.
        const id = this.changeId(op.prior.scope, input.operationId), snapshot = await tx.get(this.ref('change', id));
        if (!snapshot.exists) fail('receipt_sequence_missing');
        const original = this.open('change', id, op.prior.scope, snapshot, childCreationChangeSchema);
        if (original.workspaceId !== op.prior.scope.workspaceId || original.storageEpoch !== op.prior.scope.storageEpoch
          || original.childId !== op.prior.scope.childId || original.privateUserId !== userId || original.operationId !== input.operationId) fail('receipt_sequence_binding');
        changeSeq = original.changeSeq;
      }
      if (BigInt(changeSeq) > BigInt(workspace.changeSeq)) fail('receipt_sequence_binding');
      return { result: op.prior, changeSeq, commit: () => {} };
    }
    if ((await tx.get(this.ref('child', childId))).exists || (await tx.get(this.ref('authority-child-detail', childId))).exists) fail('child_conflict');
    const change = await this.change(tx, scope, workspace, input.operationId, 'children', false);
    const child: Child = { id: childId, workspaceId: workspace.id, displayName: input.displayName, accessRole: 'owner', createdAt: new Date(this.now()).toISOString() };
    const result: FirestoreChildCreation = { child, scope, authorizationVersion: workspace.accessVersion };
    const childEnvelope = this.seal('child', childId, scope, { id: childId, workspaceId: workspace.id, status: 'active' });
    const detailEnvelope = this.seal('authority-child-detail', childId, scope, child);
    const projection = { ...this.domain.tags(scope), childId, createdAt: child.createdAt,
      ...this.domain.seal('child-projection', childId, scope, firestoreChildSchema, child) };
    const receiptEnvelope = this.seal('authority-operation', op.key, accountScope, { ownerUserId: userId, childId: null,
      operationId: input.operationId, action: 'create_child', fingerprint: op.fingerprint, result, changeSeq: change.changeSeq });
    return { result, changeSeq: change.changeSeq, commit: () => {
      tx.create(this.ref('child', childId), childEnvelope); tx.create(this.ref('authority-child-detail', childId), detailEnvelope);
      tx.create(this.domain.ref('children', 'child-projection', childId), projection);
      change.commit(); tx.create(this.ref('authority-operation', op.key), receiptEnvelope);
    } };
  }
  async createChild(raw: { userId: string; operationId: string; displayName: string }): Promise<FirestoreChildCreation> {
    const input = parse(z.object({ userId: userIdSchema, operationId: uuid, displayName: z.string() }).strict(), raw);
    return this.runTransaction(input.userId, null, async binding => {
      const prepared = await binding.prepareChildCreation({ operationId: input.operationId, displayName: input.displayName });
      prepared.commit(); return prepared.result;
    });
  }
  /** Internal erasure preserves operation identity without retaining the erased result. */
  async redactOperation(transaction: Transaction, id: string, scope: WorkRecoveryScope): Promise<void> {
    const snapshot = await transaction.get(this.ref('authority-operation', id));
    if (!snapshot.exists) fail('receipt_binding', 500);
    const receipt = this.open('authority-operation', id, scope, snapshot, receiptSchema);
    if (receipt.ownerUserId !== scope.ownerUserId) fail('receipt_binding', 500);
    this.write(transaction, 'authority-operation', id, scope, { ...receipt, result: null, erased: true });
  }
  async readScope(userId: string, childId: string): Promise<FirestoreAuthorityBinding> {
    parse(userIdSchema, userId); parse(uuid, childId);
    return this.options.database.runTransaction(async tx => {
      const { workspace } = await this.account(tx, userId), scope = ownerScope(userId, workspace.id, workspace.storageEpoch, childId);
      await this.canonicalChild(tx, scope);
      return { scope, authorizationVersion: workspace.accessVersion };
    }, { readOnly: true });
  }
  /** Internal erasure finalizer, after journal-backed cleanup. It cannot reactivate or delete active resources. */
  async finishErasure(scope: WorkRecoveryScope, type: 'child' | 'account'): Promise<void> {
    parse(workRecoveryScopeSchema, scope); parse(z.enum(['child', 'account']), type);
    await this.options.database.runTransaction(async tx => {
      await this.control(tx, false);
      if (type === 'child') {
        const child = await this.read(tx, 'child', scope.childId, scope, schemas.child);
        if (child.id !== scope.childId || child.workspaceId !== scope.workspaceId || child.status === 'active') fail('erasure_not_blocked');
        this.write(tx, 'child', scope.childId, scope, { ...child, status: 'deleted' });
      } else {
        const accountScope = ownerScope(scope.ownerUserId), account = await this.read(tx, 'account', scope.ownerUserId, accountScope, schemas.account);
        const workspace = await this.read(tx, 'workspace', scope.workspaceId, scope, schemas.workspace);
        if (account.userId !== scope.ownerUserId || account.status === 'active' || workspace.ownerUserId !== scope.ownerUserId
          || workspace.storageEpoch !== scope.storageEpoch) fail('erasure_not_blocked');
        this.write(tx, 'account', scope.ownerUserId, accountScope, { ...account, status: 'deleted', admitted: false, invitationLive: false });
        this.write(tx, 'workspace', scope.workspaceId, scope, { ...workspace, status: 'deleted' });
      }
    });
  }
  private supported(values: AgentWorkValues) {
    if (values.sourceMessageIds.length || values.resources.length || values.pending.length || values.followUp?.watchResources || values.followUp?.knowledgeSourceIds.length)
      fail('unsupported_work', 422);
    if (['active', 'waiting'].includes(values.status) && !values.followUp?.dueAt) fail('unsupported_work', 422);
  }
  private async work(tx: Transaction, scope: WorkRecoveryScope, workId: string, accessVersion: string) {
    const work = await this.read(tx, 'work', workId, scope, schemas.work);
    const followup = await this.read(tx, 'followup', workId, scope, schemas.followup);
    const detail = await this.read(tx, 'authority-work-detail', workId, scope, workDetailSchema);
    if (!same(scope, { ownerUserId: work.ownerUserId, workspaceId: work.workspaceId, childId: work.childId, storageEpoch: work.storageEpoch })
      || work.id !== workId || detail.id !== workId || detail.version !== work.version
      || !same(scope, { ownerUserId: followup.ownerUserId, workspaceId: followup.workspaceId, childId: followup.childId, storageEpoch: followup.storageEpoch })
      || followup.authorizationVersion !== accessVersion || followup.workId !== workId || followup.workVersion !== work.version) fail('binding', 403);
    let decrypted: unknown;
    try { decrypted = JSON.parse(this.options.cipher.decrypt(work.payloadEncrypted, `agent-work:${scope.childId}:${scope.ownerUserId}:${workId}:${work.version}`)); }
    catch { fail('invalid_document', 500); }
    const values = parse(agentWorkValuesSchema, decrypted, 'invalid_document', 500);
    if (values.status !== work.status || values.followUp?.dueAt && values.followUp.dueAt !== followup.dueAt) fail('binding', 403);
    return { work, followup, detail, values };
  }
  private writeWork(tx: Transaction, scope: WorkRecoveryScope, workspace: Workspace, result: AgentWork, oldDueAt?: string) {
    const { id, version, createdAt, updatedAt, childId: _childId, ...values } = result;
    const payloadEncrypted = this.options.cipher.encrypt(canonical(values), `agent-work:${scope.childId}:${scope.ownerUserId}:${id}:${version}`);
    this.write(tx, 'work', id, scope, { ...scope, id, version, status: values.status, payloadEncrypted });
    this.write(tx, 'authority-work-detail', id, scope, { id, version, createdAt, updatedAt });
    this.write(tx, 'followup', id, scope, { ...scope, authorizationVersion: workspace.accessVersion, workId: id, workVersion: version,
      enabled: ['active', 'waiting'].includes(values.status) && Boolean(values.followUp),
      dueAt: values.followUp?.dueAt ?? oldDueAt ?? updatedAt, dueConsumed: !values.followUp?.dueAt,
      watchResources: values.followUp?.watchResources ?? false, knowledgeSourceIds: values.followUp?.knowledgeSourceIds ?? [] });
  }
  async saveWork(raw: { scope: FirestoreAuthorityScope; operationId: string; workId?: string | null; expectedVersion: number; values: AgentWorkValues }): Promise<AgentWork> {
    const scopeInput = parse(authorityScopeSchema, raw.scope);
    const input = parse(saveAgentWorkSchema, { operationId: raw.operationId, workId: raw.workId ?? null, expectedVersion: raw.expectedVersion, values: raw.values });
    this.supported(input.values); const workId = input.workId ?? randomUUID();
    return this.options.database.runTransaction(async tx => {
      const { scope, workspace } = await this.scope(tx, scopeInput);
      const op = await this.operation(tx, scope, input.operationId, 'save_work', { ...input, scope: scopeInput }, agentWorkSchema);
      if (op.prior !== null) return op.prior;
      const old = input.workId ? await this.work(tx, scope, input.workId, workspace.accessVersion) : null;
      if (!old && ((await tx.get(this.ref('work', workId))).exists || (await tx.get(this.ref('followup', workId))).exists
        || (await tx.get(this.ref('authority-work-detail', workId))).exists)) fail('work_conflict');
      if ((old?.work.version ?? 0) !== input.expectedVersion) fail('version_conflict');
      if (old?.work.status === 'cancelled' && input.values.status !== 'cancelled') fail('work_cancelled');
      const version = (old?.work.version ?? 0) + 1; if (!schemas.work.shape.version.safeParse(version).success) fail('version_exhausted');
      const commitChange = await this.change(tx, scope, workspace, input.operationId, 'memory', input.values.status === 'cancelled');
      const updatedAt = new Date(this.now()).toISOString(), result: AgentWork = { ...input.values, id: workId, childId: scope.childId,
        version, createdAt: old?.detail.createdAt ?? updatedAt, updatedAt };
      this.writeWork(tx, scope, workspace, result, old?.followup.dueAt); commitChange.commit();
      this.receipt(tx, scope, input.operationId, 'save_work', op, result); return result;
    });
  }
  async cancelWork(raw: { scope: FirestoreAuthorityScope; operationId: string; workId: string; expectedVersion: number }): Promise<AgentWork> {
    const input = parse(z.object({ scope: authorityScopeSchema, operationId: uuid, workId: uuid, expectedVersion: schemas.work.shape.version }).strict(), raw);
    return this.options.database.runTransaction(async tx => {
      const { scope, workspace } = await this.scope(tx, input.scope);
      const op = await this.operation(tx, scope, input.operationId, 'cancel_work', input, agentWorkSchema);
      if (op.prior !== null) return op.prior;
      const old = await this.work(tx, scope, input.workId, workspace.accessVersion);
      if (old.work.version !== input.expectedVersion) fail('version_conflict');
      const version = old.work.version + 1; if (!schemas.work.shape.version.safeParse(version).success) fail('version_exhausted');
      const commitChange = await this.change(tx, scope, workspace, input.operationId, 'memory', true);
      const result: AgentWork = { ...old.values, status: 'cancelled', followUp: null, id: old.work.id, childId: scope.childId,
        version, createdAt: old.detail.createdAt, updatedAt: new Date(this.now()).toISOString() };
      this.writeWork(tx, scope, workspace, result, old.followup.dueAt); commitChange.commit();
      this.receipt(tx, scope, input.operationId, 'cancel_work', op, result); return result;
    });
  }
}

export function createFirestoreAuthority(options: FirestoreAuthorityOptions): FirestoreAuthority { return new FirestoreAuthority(options); }

export const firestoreAuthoritySchemas = { control: schemas.control, account: schemas.account, workspace: schemas.workspace, child: schemas.child,
  invitation: invitationSchema, identity: identitySchema, owner: ownerSchema, operation: receiptSchema, childDetail: childDetailSchema,
  childCreationChange: childCreationChangeSchema, changeKind: changeKindSchema } as const;
