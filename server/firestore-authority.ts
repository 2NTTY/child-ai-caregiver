/// <reference lib="es2024.string" />
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, Transaction, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { SERVICE_POLICY_VERSION, SERVICE_DATA_NOTICE, type AccountServiceStatus } from '../src/shared/account-service.ts';
import { agentWorkValuesSchema, agentWorkSchema, saveAgentWorkSchema, type AgentWork, type AgentWorkValues } from '../src/shared/agent-work.ts';
import type { Child } from '../src/shared/records.ts';
import { validateCreateChild } from '../src/shared/inputs.ts';
import type { StorageCipher } from './storage-crypto.ts';
import { canonical } from './firestore-session-codec.ts';
import { workRecoveryAad, workRecoveryDocumentId, workRecoverySchemas as schemas,
  workRecoveryScopeSchema, type WorkRecoveryKind, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const FORMAT = 'yuban-work-recovery', MAX_BYTES = 192 * 1024;
const NIL = '00000000-0000-0000-0000-000000000000';
const bounded = (max: number) => z.string().min(1).max(max).refine(value => value.isWellFormed());
const userIdSchema = bounded(256), uuid = z.uuid(), datetime = z.iso.datetime({ offset: true });
const decimal = schemas.workspace.shape.accessVersion;
const authorityScopeSchema = workRecoveryScopeSchema.extend({ authorizationVersion: decimal }).strict();
const identitySchema = z.object({ userId: userIdSchema, email: z.email().max(320),
  state: z.enum(['active', 'revoked', 'deleting', 'deleted']) }).strict();
const ownerSchema = z.object({ userId: userIdSchema, workspaceId: uuid }).strict();
const invitationSchema = z.object({ email: z.email().max(320), expiresAt: datetime,
  state: z.enum(['issued', 'consumed', 'revoked']), consumedBy: userIdSchema.nullable() }).strict();
const childDetailSchema = z.object({ id: uuid, workspaceId: uuid, displayName: bounded(160),
  createdAt: datetime, accessRole: z.literal('owner') }).strict();
const workDetailSchema = z.object({ id: uuid, version: schemas.work.shape.version, createdAt: datetime, updatedAt: datetime }).strict();
const receiptSchema = z.object({ ownerUserId: userIdSchema, childId: uuid.nullable(), operationId: uuid,
  action: bounded(64), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), result: z.unknown() }).strict();
type AuxiliaryKind = 'authority-invitation' | 'authority-identity' | 'authority-owner' | 'authority-operation' | 'authority-child-detail' | 'authority-work-detail';
type Kind = WorkRecoveryKind | AuxiliaryKind;
type Workspace = z.infer<typeof schemas.workspace>;
type Invitation = z.infer<typeof invitationSchema>;
export type FirestoreAuthorityScope = z.infer<typeof authorityScopeSchema>;
export interface FirestoreAuthorityBinding { scope: WorkRecoveryScope; authorizationVersion: string }
export interface FirestoreIdentityAdmission { userId: string; workspaceId: string; storageEpoch: string; emailVerified: boolean }
export interface FirestoreChildCreation extends FirestoreAuthorityBinding { child: Child }
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
  constructor(options: FirestoreAuthorityOptions) {
    if (!options || typeof options.database?.runTransaction !== 'function' || typeof options.database?.collection !== 'function'
      || typeof options.cipher?.encrypt !== 'function' || typeof options.cipher?.decrypt !== 'function'
      || !userIdSchema.safeParse(options.projectId).success || options.projectId !== options.projectId.trim()
      || !/^[a-z][a-z0-9_]{0,60}$/u.test(options.namespace)
      || options.serverClock !== undefined && typeof options.serverClock !== 'function') fail('configuration', 500);
    this.options = Object.freeze({ ...options });
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
    const result = { format: FORMAT, version: kind.startsWith('authority-') ? 2 : 1,
      ciphertext: this.options.cipher.encrypt(canonical(value), this.aad(kind, id, scope)) };
    size(result); return result;
  }
  private open<T>(kind: Kind, id: string, scope: WorkRecoveryScope, snapshot: DocumentSnapshot, schema: z.ZodType<T>): T {
    if (!snapshot.exists) fail('not_found', 404);
    size(snapshot.data());
    const version = kind.startsWith('authority-') ? 2 : 1;
    const envelope = parse(z.object({ format: z.literal(FORMAT), version: z.literal(version), ciphertext: bounded(MAX_BYTES) }).strict(), snapshot.data(), 'invalid_document', 500);
    let value: unknown;
    try { const text = this.options.cipher.decrypt(envelope.ciphertext, this.aad(kind, id, scope)); size(text); value = JSON.parse(text); }
    catch { fail('invalid_document', 500); }
    return parse(schema, value, 'invalid_document', 500);
  }
  private async read<T>(tx: Transaction, kind: Kind, id: string, scope: WorkRecoveryScope, schema: z.ZodType<T>) {
    return this.open(kind, id, scope, await tx.get(this.ref(kind, id)), schema);
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
    await this.control(tx); const scope = ownerScope(userId);
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
    return { account, identity, owner, invitation, workspace };
  }
  private async scope(tx: Transaction, input: FirestoreAuthorityScope) {
    const current = await this.account(tx, input.ownerUserId), scope = plainScope(input);
    if (current.workspace.id !== scope.workspaceId || current.workspace.storageEpoch !== scope.storageEpoch
      || current.workspace.accessVersion !== input.authorizationVersion) fail('scope_changed');
    const child = await this.read(tx, 'child', scope.childId, scope, schemas.child);
    if (child.id !== scope.childId || child.workspaceId !== scope.workspaceId || child.status !== 'active') fail('binding', 403);
    return { ...current, scope, child };
  }
  private operationKey(scope: WorkRecoveryScope, operationId: string, child = true) {
    return JSON.stringify([scope.ownerUserId, child ? scope.childId : null, operationId]);
  }
  private async operation<T>(tx: Transaction, scope: WorkRecoveryScope, operationId: string, action: string,
    payload: unknown, resultSchema: z.ZodType<T>, child = true) {
    const key = this.operationKey(scope, operationId, child), fingerprint = digest({ action, payload });
    const snapshot = await tx.get(this.ref('authority-operation', key));
    if (!snapshot.exists) return { key, fingerprint, prior: null };
    const receipt = this.open('authority-operation', key, scope, snapshot, receiptSchema);
    if (receipt.ownerUserId !== scope.ownerUserId || receipt.childId !== (child ? scope.childId : null)
      || receipt.operationId !== operationId || receipt.action !== action || receipt.fingerprint !== fingerprint) fail('operation_conflict');
    return { key, fingerprint, prior: parse(resultSchema, receipt.result, 'invalid_document', 500) };
  }
  private receipt<T>(tx: Transaction, scope: WorkRecoveryScope, operationId: string, action: string,
    op: { key: string; fingerprint: string }, result: T, child = true) {
    this.write(tx, 'authority-operation', op.key, scope, { ownerUserId: scope.ownerUserId,
      childId: child ? scope.childId : null, operationId, action, fingerprint: op.fingerprint, result }, true);
  }
  private async change(tx: Transaction, scope: WorkRecoveryScope, workspace: Workspace, operationId: string, kind: 'children' | 'memory', deleted: boolean) {
    const id = JSON.stringify([scope.workspaceId, scope.storageEpoch, scope.ownerUserId, scope.childId, operationId, 'authority']);
    if ((await tx.get(this.ref('change', id))).exists) fail('change_conflict');
    const changeSeq = increment(workspace.changeSeq);
    return () => {
      this.write(tx, 'workspace', workspace.id, scope, { ...workspace, changeSeq });
      this.write(tx, 'change', id, scope, { workspaceId: scope.workspaceId, storageEpoch: scope.storageEpoch, changeSeq,
        kind, childId: scope.childId, privateUserId: scope.ownerUserId, ownerOnly: true, deleted,
        suppressWorkWake: true, operationId }, true);
    };
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
      this.write(tx, 'authority-owner', input.userId, scope, { userId: input.userId, workspaceId }, true);
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
  async createChild(raw: { userId: string; operationId: string; displayName: string }): Promise<FirestoreChildCreation> {
    const input = parse(z.object({ userId: userIdSchema, operationId: uuid, displayName: z.string() }).strict(), raw);
    const validated = validateCreateChild({ displayName: input.displayName });
    if (!validated.ok || !validated.value.displayName.isWellFormed()) fail('invalid_input', 400);
    input.displayName = validated.value.displayName;
    const childId = randomUUID(), resultSchema = z.object({ child: childDetailSchema, scope: workRecoveryScopeSchema, authorizationVersion: decimal }).strict();
    return this.options.database.runTransaction(async tx => {
      const { workspace } = await this.account(tx, input.userId);
      const accountScope = ownerScope(input.userId), scope = ownerScope(input.userId, workspace.id, workspace.storageEpoch, childId);
      const op = await this.operation(tx, accountScope, input.operationId, 'create_child', input, resultSchema, false);
      if (op.prior !== null) {
        await this.scope(tx, { ...op.prior.scope, authorizationVersion: op.prior.authorizationVersion }); return op.prior;
      }
      if ((await tx.get(this.ref('child', childId))).exists || (await tx.get(this.ref('authority-child-detail', childId))).exists) fail('child_conflict');
      const commitChange = await this.change(tx, scope, workspace, input.operationId, 'children', false);
      const child: Child = { id: childId, workspaceId: workspace.id, displayName: input.displayName, accessRole: 'owner', createdAt: new Date(this.now()).toISOString() };
      const result: FirestoreChildCreation = { child, scope, authorizationVersion: workspace.accessVersion };
      this.write(tx, 'child', childId, scope, { id: childId, workspaceId: workspace.id, status: 'active' }, true);
      this.write(tx, 'authority-child-detail', childId, scope, child, true); commitChange();
      this.receipt(tx, accountScope, input.operationId, 'create_child', op, result, false); return result;
    });
  }
  async readScope(userId: string, childId: string): Promise<FirestoreAuthorityBinding> {
    parse(userIdSchema, userId); parse(uuid, childId);
    return this.options.database.runTransaction(async tx => {
      const { workspace } = await this.account(tx, userId), scope = ownerScope(userId, workspace.id, workspace.storageEpoch, childId);
      const child = await this.read(tx, 'child', childId, scope, schemas.child);
      if (child.id !== childId || child.workspaceId !== workspace.id || child.status !== 'active') fail('binding', 403);
      return { scope, authorizationVersion: workspace.accessVersion };
    }, { readOnly: true });
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
      enabled: ['active', 'waiting'].includes(values.status) && Boolean(values.followUp?.dueAt),
      dueAt: values.followUp?.dueAt ?? oldDueAt ?? updatedAt, dueConsumed: false, watchResources: false, knowledgeSourceIds: [] });
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
      this.writeWork(tx, scope, workspace, result, old?.followup.dueAt); commitChange();
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
      this.writeWork(tx, scope, workspace, result, old.followup.dueAt); commitChange();
      this.receipt(tx, scope, input.operationId, 'cancel_work', op, result); return result;
    });
  }
}

export function createFirestoreAuthority(options: FirestoreAuthorityOptions): FirestoreAuthority { return new FirestoreAuthority(options); }
