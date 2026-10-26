import { randomBytes, randomUUID } from 'node:crypto';
import type { Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreAuthority, type FirestoreAuthorityOptions, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreChangeSchema } from './firestore-domain-data.ts';
import { sharedChangesQuerySchema, type SharedChangesQuery, type SharedChangesPage } from '../src/shared/sharing.ts';
import { SHARING_SCOPE, sharedSpaceSchema, sharedMembershipSchema, resourceShareSchema, sharedInvitationSchema,
  sharedOperationSchema, sharedAccessBasisSchema, sharedModuleSchema, sharingRestoreSchemas, sharingMetadata,
  type SharingKind } from './firestore-sharing-records.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

type Space = z.infer<typeof sharedSpaceSchema>;
type Member = z.infer<typeof sharedMembershipSchema>;
type Basis = z.infer<typeof sharedAccessBasisSchema>;
type MutationResult<T> = { value: T; writes: (() => void)[] };
type ExitResult = { spaceId: string; version: number; state: 'left' | 'dissolved' };
const operation = z.object({ operationId: z.uuid() });
const change = operation.extend({ spaceId: z.uuid(), expectedVersion: z.number().int().positive().max(2147483647) });
const resourceRequest = z.object({ spaceId: z.uuid(), childId: z.uuid(), module: sharedModuleSchema,
  mode: z.enum(['read', 'write']), expectedBasis: sharedAccessBasisSchema.optional() }).strict();
const changeCursorSchema = z.object({fence:z.string().regex(/^[a-f0-9]{64}$/u),after:firestoreChangeSchema.shape.changeSeq}).strict();
export interface SharedResourceAccess {
  readonly transaction: Transaction;
  readonly actorUserId: string;
  readonly scope: Readonly<WorkRecoveryScope>;
  readonly role: Member['role'];
  readonly module: z.infer<typeof sharedModuleSchema>;
  readonly includePrivate: false;
  readonly basis: Readonly<Basis>;
  readonly binding: FirestoreAuthorityTransaction;
}

/** Persistent space authority. No copy of the shared child's facts or credentials is created. */
export function createFirestoreSharingStore(options: FirestoreAuthorityOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const now = () => new Date((options.serverClock ?? Date.now)()).toISOString();
  const key = (spaceId: string, resourceId: string) => JSON.stringify([spaceId, resourceId]);
  function ref(kind: SharingKind, id: string) { return data.ref(sharingRestoreSchemas[kind].suffix, kind, id); }
  async function read<T>(tx: Transaction, kind: SharingKind, id: string, schema: z.ZodType<T>, optional = false): Promise<T | null> {
    const snapshot = await tx.get(ref(kind, id));
    if (!snapshot.exists) { if (optional) return null; domainReject('space_access_denied', 403); }
    return data.open(kind, id, SHARING_SCOPE, schema, snapshot);
  }
  function write(tx: Transaction, kind: SharingKind, id: string, value: any, create = false) {
    const record = domainParse(sharingRestoreSchemas[kind].schema as z.ZodType<any>, value, 'sharing_record_invalid', 500);
    const envelope = { ...sharingMetadata(kind, record), ...data.seal(kind, id, SHARING_SCOPE,
      sharingRestoreSchemas[kind].schema as z.ZodType<any>, record, record.version ?? 1) };
    return () => { if (create) tx.create(ref(kind, id), envelope); else tx.set(ref(kind, id), envelope); };
  }
  async function space(tx: Transaction, id: string): Promise<Space> {
    const value = (await read(tx, 'shared-space', id, sharedSpaceSchema))!;
    if (value.id !== id || value.storageIdentity.workspaceId !== id || value.storageIdentity.ownerUserId !== 'space:' + id) domainReject('sharing_binding', 500);
    if (value.state !== 'active') domainReject('space_inactive', 403);
    return value;
  }
  async function member(tx: Transaction, spaceId: string, userId: string): Promise<Member> {
    const value = await read(tx, 'shared-membership', key(spaceId, userId), sharedMembershipSchema, true);
    if (!value || value.state !== 'active') domainReject('space_access_denied', 403);
    if (value.spaceId !== spaceId || value.userId !== userId) domainReject('sharing_binding', 500);
    return value;
  }
  function manager(s: Space, m: Member) {
    if (s.managerUserId !== m.userId || m.role !== 'owner') domainReject('space_manager_required', 403);
  }
  function basisVersion(s: Space, expected: number) { if (s.version !== expected) domainReject('version_conflict'); }
  function updated(s: Space, fields: Partial<Space> = {}): Space {
    return domainParse(sharedSpaceSchema, { ...s, ...fields, version: s.version + 1, updatedAt: now() });
  }
  async function mutate<T>(userId: string, action: string, input: { operationId: string },
    prepare: (binding: FirestoreAuthorityTransaction) => Promise<MutationResult<T>>): Promise<T> {
    return authority.runTransaction(userId, null, async b => {
      const id = key(userId, input.operationId), fingerprint = firestoreDomainHash([action, input]);
      const old = await b.transaction.get(ref('shared-operation', id));
      if (old.exists) {
        const receipt = data.open('shared-operation', id, b.scope, sharedOperationSchema, old);
        if (receipt.actorUserId !== userId || receipt.operationId !== input.operationId || receipt.action !== action || receipt.fingerprint !== fingerprint)
          domainReject('operation_conflict');
        if (action !== 'leave-space' && action !== 'dissolve-space') {
          const saved = receipt.result as Space | { space: Space };
          const id = 'space' in saved ? saved.space.id : saved.id;
          const s = await space(b.transaction, id), m = await member(b.transaction, id, userId);
          if (action === 'invite-member') manager(s, m);
        }
        return receipt.result as T;
      }
      const prepared = await prepare(b);
      const event = await b.prepareChange(input.operationId, 'family', false);
      const receipt = data.seal('shared-operation', id, b.scope, sharedOperationSchema,
        { actorUserId: userId, operationId: input.operationId, action, fingerprint, result: prepared.value, at: now() });
      for (const commit of prepared.writes) commit();
      event.commit(); b.transaction.create(ref('shared-operation', id), { ...data.tags(b.scope), ...receipt });
      return prepared.value;
    });
  }
  async function current(b: FirestoreAuthorityTransaction, input: { spaceId: string; expectedVersion: number }) {
    const s = await space(b.transaction, input.spaceId), m = await member(b.transaction, s.id, b.actorUserId);
    basisVersion(s, input.expectedVersion); return { s, m };
  }
  async function inResourceTransaction<T>(b: FirestoreAuthorityTransaction, raw: z.infer<typeof resourceRequest>, use: (access: SharedResourceAccess) => Promise<T>): Promise<T> {
    const input = domainParse(resourceRequest, raw), userId = b.actorUserId;
    const s = await space(b.transaction, input.spaceId), m = await member(b.transaction, s.id, userId);
    if (input.mode === 'write' && m.role === 'viewer') domainReject('read_only', 403);
    const grant = await read(b.transaction, 'resource-share', key(s.id, input.childId), resourceShareSchema, true);
    if (!grant || grant.state !== 'active' || !grant.modules.includes(input.module)) domainReject('module_not_shared', 403);
    if (grant.spaceId !== s.id || grant.childId !== input.childId || grant.source.childId !== input.childId || grant.sharedBy !== grant.source.ownerUserId)
      domainReject('sharing_binding', 500);
    const sourceMember = await member(b.transaction, s.id, grant.sharedBy);
    if (sourceMember.membershipId !== grant.sourceMembershipId) domainReject('module_not_shared', 403);
    const source = await authority.assertPersonalSource(b.transaction, grant.source);
    const basis: Basis = { spaceVersion: s.version, membershipVersion: m.version, shareVersion: grant.version,
      actorAuthorizationVersion: b.authorizationVersion, sourceAuthorizationVersion: source.authorizationVersion };
    if (input.expectedBasis && firestoreDomainHash(input.expectedBasis) !== firestoreDomainHash(basis)) domainReject('sharing_scope_changed');
    return authority.withSharedSource(b, grant.source, { spaceId: s.id, basis: Object.freeze(basis), role: m.role, module: input.module,
      modules: Object.freeze([...grant.modules]), mode: input.mode }, binding =>
      use(Object.freeze({ transaction: b.transaction, actorUserId: userId, scope: binding.scope, binding,
        role: m.role, module: input.module, includePrivate: false as const, basis: Object.freeze(basis) })));
  }
  return {
    inResourceTransaction,
    changes(userId:string, raw:SharedChangesQuery):Promise<SharedChangesPage> {
      const input=domainParse(sharedChangesQuerySchema,raw),{cursor,...selection}=input;
      return authority.runTransaction(userId,null,b=>inResourceTransaction(b,{...selection,mode:'read'},async access=>{
        const source=access.binding, id=JSON.stringify([input.spaceId,input.childId,input.module]);
        const fence=firestoreDomainHash([b.actorUserId,access.scope,b.generation,access.basis,source.childAccessVersion]);
        let previous:z.infer<typeof changeCursorSchema>|null=null;
        if(cursor) {
          try {previous=data.open('shared-change-cursor',id,b.scope,changeCursorSchema,
            {exists:true,data:()=>JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))} as any);}
          catch {domainReject('invalid_cursor',400);}
        }
        const page=(after:string,changed:boolean,hasMore=false):SharedChangesPage=>({...selection,changed,hasMore,
          cursor:Buffer.from(JSON.stringify(data.seal('shared-change-cursor',id,b.scope,changeCursorSchema,{fence,after}))).toString('base64url')});
        // A first read or new grant refreshes current resources, not another member's event history.
        if(!previous || previous.fence!==fence)return page(source.changeSeq,true);
        if(BigInt(previous.after)>BigInt(source.changeSeq))domainReject('invalid_cursor',400);
        if(previous.after===source.changeSeq)return page(source.changeSeq,false);
        const tags=data.tags(source.scope),query=data.collection('changes')
          .where('workspaceTag','==',tags.workspaceTag).where('epochTag','==',tags.epochTag).where('userTag','==',tags.userTag)
          .where('childTag','==',tags.childTag).where('sortKey','>',data.sortKey(previous.after)).where('sortKey','<=',data.sortKey(source.changeSeq))
          .orderBy('sortKey','asc').limit(101);
        const rows=await b.transaction.get(query);let changed=false,after=previous.after;
        for(const row of rows.docs.slice(0,100)) {
          const sequence=BigInt(row.get('sortKey')).toString();
          if(BigInt(sequence)<=BigInt(after)||BigInt(sequence)>BigInt(source.changeSeq)
            ||Object.entries(tags).some(([key,value])=>row.get(key)!==value))domainReject('projection_binding',500);
          const projectionId=JSON.stringify([source.scope.workspaceId,source.scope.storageEpoch,sequence]);
          const value=data.open('change-projection',projectionId,source.scope,firestoreChangeSchema,row);
          if(row.ref.path!==data.ref('changes','change-projection',projectionId).path || value.changeSeq!==sequence
            ||value.childId!==input.childId ||row.get('childId')!==input.childId)domainReject('projection_binding',500);
          changed ||= value.kind==='children'||value.kind===input.module
            ||input.module==='concerns'&&value.kind==='growth'
            ||input.module==='attachments'&&(value.kind==='chat'||value.kind==='care')
            // Derived views must recheck source validity even when the changed source module is not itself shared.
            ||['memory','documents','growth','concerns'].includes(input.module)
              &&['care','profile','memory','tasks','chat','growth','documents'].includes(value.kind);
          after=sequence;
        }
        const hasMore=rows.docs.length>100;
        return page(hasMore?after:source.changeSeq,changed,hasMore);
      }));
    },
    create(userId: string, raw: { operationId: string; name: string; kind: 'family' | 'teachers' }): Promise<Space> {
      const input = domainParse(operation.extend({ name: sharedSpaceSchema.shape.name, kind: sharedSpaceSchema.shape.kind }).strict(), raw), id = randomUUID();
      return mutate(userId, 'create-space', input, async b => {
        const value: Space = { id, kind: input.kind, name: input.name, version: 1, state: 'active', managerUserId: userId, managerGeneration: randomUUID(),
          storageIdentity: { ownerUserId: 'space:' + id, workspaceId: id }, transferTargetUserId: null, createdAt: now(), updatedAt: now() };
        return { value, writes: [write(b.transaction, 'shared-space', id, value, true),
          write(b.transaction, 'shared-membership', key(id, userId), { spaceId: id, userId, membershipId: randomUUID(), role: 'owner', state: 'active', version: 1, stateVersion: 1, joinedAt: now() }, true)] };
      });
    },
    get(userId: string, spaceId: string): Promise<Space> {
      domainParse(z.uuid(), spaceId);
      return authority.runTransaction(userId, null, async b => { const s = await space(b.transaction, spaceId); await member(b.transaction, s.id, userId); return s; });
    },
    invite(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number; email: string;
      role: 'caregiver' | 'viewer'; expiresAt: string }): Promise<{ token: string; space: Space }> {
      const input = domainParse(change.extend({ email: z.email().max(320).transform(v => v.toLowerCase()),
        role: z.enum(['caregiver', 'viewer']), expiresAt: z.iso.datetime({ offset: true }) }).strict(), raw);
      const token = randomBytes(32).toString('base64url'), id = firestoreDomainHash(token);
      return mutate(userId, 'invite-member', input, async b => {
        const { s, m } = await current(b, input); manager(s, m);
        if (Date.parse(input.expiresAt) <= Date.parse(now())) domainReject('invitation_expired');
        const value = updated(s);
        return { value: { token, space: value }, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'shared-invitation', id, { id, spaceId: s.id, email: input.email, role: input.role, expiresAt: input.expiresAt,
            issuedVersion: value.version, managerGeneration: s.managerGeneration, state: 'issued', consumedBy: null, issuedBy: userId }, true)] };
      });
    },
    acceptInvitation(userId: string, raw: { token: string; operationId: string }): Promise<Space> {
      const input = domainParse(operation.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict(), raw), id = firestoreDomainHash(input.token);
      return mutate(userId, 'accept-invitation', input, async b => {
        const invitation = (await read(b.transaction, 'shared-invitation', id, sharedInvitationSchema))!;
        if (invitation.id !== id || invitation.email !== b.identityEmail.toLowerCase()) domainReject('invitation_recipient', 403);
        if (invitation.state !== 'issued' || Date.parse(invitation.expiresAt) <= Date.parse(now())) domainReject('invitation_expired');
        const s = await space(b.transaction, invitation.spaceId);
        if (s.managerUserId !== invitation.issuedBy || s.managerGeneration !== invitation.managerGeneration) domainReject('invitation_revoked', 403);
        const old = await read(b.transaction, 'shared-membership', key(s.id, userId), sharedMembershipSchema, true);
        if (old?.state === 'active') domainReject('already_member');
        if (old && invitation.issuedVersion <= old.stateVersion) domainReject('invitation_revoked', 403);
        const value = updated(s);
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'shared-membership', key(s.id, userId), { spaceId: s.id, userId, membershipId: randomUUID(), role: invitation.role,
            state: 'active', version: (old?.version ?? 0) + 1, stateVersion: value.version, joinedAt: now() }),
          write(b.transaction, 'shared-invitation', id, { ...invitation, state: 'consumed', consumedBy: userId })] };
      });
    },
    share(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number; childId: string;
      modules: z.infer<typeof sharedModuleSchema>[] }): Promise<Space> {
      const input = domainParse(change.extend({ childId: z.uuid(), modules: z.array(sharedModuleSchema).min(1).max(8)
        .transform(values => [...new Set(values)].sort()) }).strict(), raw);
      return mutate(userId, 'share-resource', input, async b => {
        const { s, m } = await current(b, input); if (m.role === 'viewer') domainReject('read_only', 403);
        const child = await b.readChild(input.childId); if (!child) domainReject('not_found', 404);
        const source = { ...b.scope, childId: child.id };
        const id = key(s.id, child.id), old = await read(b.transaction, 'resource-share', id, resourceShareSchema, true);
        if (old && old.sharedBy !== userId) domainReject('sharing_binding', 403);
        const value = updated(s);
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value), write(b.transaction, 'resource-share', id,
          { spaceId: s.id, childId: child.id, source, modules: input.modules, version: (old?.version ?? 0) + 1, state: 'active', sharedBy: userId,
            sourceMembershipId: m.membershipId })] };
      });
    },
    unshare(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number; childId: string }): Promise<Space> {
      const input = domainParse(change.extend({ childId: z.uuid() }).strict(), raw);
      return mutate(userId, 'unshare-resource', input, async b => {
        const { s, m } = await current(b, input), id = key(s.id, input.childId);
        const grant = (await read(b.transaction, 'resource-share', id, resourceShareSchema))!;
        if (grant.sharedBy !== userId) manager(s, m);
        const value = updated(s);
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'resource-share', id, { ...grant, state: 'revoked', version: grant.version + 1 })] };
      });
    },
    proposeTransfer(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number; targetUserId: string }): Promise<Space> {
      const input = domainParse(change.extend({ targetUserId: sharedMembershipSchema.shape.userId }).strict(), raw);
      return mutate(userId, 'propose-transfer', input, async b => {
        const { s, m } = await current(b, input); manager(s, m);
        if (input.targetUserId === userId) domainReject('transfer_target');
        await member(b.transaction, s.id, input.targetUserId);
        const value = updated(s, { transferTargetUserId: input.targetUserId });
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value)] };
      });
    },
    acceptTransfer(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number }): Promise<Space> {
      const input = domainParse(change.strict(), raw);
      return mutate(userId, 'accept-transfer', input, async b => {
        const { s, m } = await current(b, input);
        if (s.transferTargetUserId !== userId) domainReject('transfer_target', 403);
        const previous = await member(b.transaction, s.id, s.managerUserId);
        const value = updated(s, { managerUserId: userId, managerGeneration: randomUUID(), transferTargetUserId: null });
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'shared-membership', key(s.id, previous.userId), { ...previous, role: 'caregiver', version: previous.version + 1 }),
          write(b.transaction, 'shared-membership', key(s.id, userId), { ...m, role: 'owner', version: m.version + 1 })] };
      });
    },
    leave(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number }): Promise<ExitResult> {
      const input = domainParse(change.strict(), raw);
      return mutate(userId, 'leave-space', input, async b => {
        const { s, m } = await current(b, input);
        if (s.managerUserId === userId) domainReject('space_transfer_or_dissolve_required');
        const value = updated(s, { transferTargetUserId: s.transferTargetUserId === userId ? null : s.transferTargetUserId });
        return { value: { spaceId: s.id, version: value.version, state: 'left' as const }, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'shared-membership', key(s.id, userId), { ...m, state: 'revoked', version: m.version + 1, stateVersion: value.version })] };
      });
    },
    updateMember(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number;
      targetUserId: string; role: 'caregiver' | 'viewer' | null }): Promise<Space> {
      const input = domainParse(change.extend({ targetUserId: sharedMembershipSchema.shape.userId,
        role: z.enum(['caregiver', 'viewer']).nullable() }).strict(), raw);
      return mutate(userId, 'update-member', input, async b => {
        const { s, m } = await current(b, input); manager(s, m);
        if (input.targetUserId === s.managerUserId) domainReject('space_transfer_or_dissolve_required');
        const target = await member(b.transaction, s.id, input.targetUserId);
        const value = updated(s, { transferTargetUserId: input.role === null && s.transferTargetUserId === input.targetUserId ? null : s.transferTargetUserId });
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'shared-membership', key(s.id, target.userId), { ...target, role: input.role ?? target.role,
            state: input.role === null ? 'revoked' : 'active', stateVersion: input.role === null ? value.version : target.stateVersion,
            version: target.version + 1 })] };
      });
    },
    revokeInvitation(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number; invitationId: string }): Promise<Space> {
      const input = domainParse(change.extend({ invitationId: sharedInvitationSchema.shape.id }).strict(), raw);
      return mutate(userId, 'revoke-invitation', input, async b => {
        const { s, m } = await current(b, input); manager(s, m);
        const invitation = (await read(b.transaction, 'shared-invitation', input.invitationId, sharedInvitationSchema))!;
        if (invitation.spaceId !== s.id) domainReject('space_access_denied', 403);
        if (invitation.state !== 'issued') domainReject('invitation_already_used');
        const value = updated(s);
        return { value, writes: [write(b.transaction, 'shared-space', s.id, value),
          write(b.transaction, 'shared-invitation', invitation.id, { ...invitation, state: 'revoked' })] };
      });
    },
    dissolve(userId: string, raw: { operationId: string; spaceId: string; expectedVersion: number }): Promise<ExitResult> {
      const input = domainParse(change.strict(), raw);
      return mutate(userId, 'dissolve-space', input, async b => {
        const { s, m } = await current(b, input); manager(s, m);
        const value = updated(s, { state: 'dissolved', transferTargetUserId: null });
        return { value: { spaceId: s.id, version: value.version, state: 'dissolved' as const }, writes: [write(b.transaction, 'shared-space', s.id, value)] };
      });
    },
    withResource<T>(userId: string, raw: z.infer<typeof resourceRequest>, use: (access: SharedResourceAccess) => Promise<T>): Promise<T> {
      return authority.runTransaction(userId, null, b => inResourceTransaction(b, raw, use));
    },
  };
}
