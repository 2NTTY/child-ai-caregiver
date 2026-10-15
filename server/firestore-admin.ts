import { z } from 'zod';
import type { AiConfig } from './ai-config.ts';
import { AGENT_LIMITS, AGENT_INTERACTIVE_INPUT, PLATFORM_AGENT_RUN_LIMITS } from './agent-budget.ts';
import { adminCommandSchema, adminInvitationSchema, adminReceiptSchema, platformPolicySchema,
  type AdminInvitation, type AdminReceipt, type PlatformPolicy } from '../src/shared/admin.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { FirestoreAiUsage } from './firestore-ai-usage.ts';
const NIL = '00000000-0000-0000-0000-000000000000';
const scope = { ownerUserId: 'system:admin', workspaceId: NIL, childId: NIL, storageEpoch: NIL };
export const adminDirectorySchema = z.object({ email: z.email() }).strict();
const cursorSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Control-plane data only. No family records, keys, or arbitrary Firestore access. */
export function createFirestoreAdmin(options: FirestoreDomainOptions, config: AiConfig) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const policyRef = data.ref('admin_policy', 'platform-policy', 'current');
  const defaults = domainParse(platformPolicySchema, { enabled: config.enabled, model: config.model,
    dailyUserAttempts: config.dailyUserAttempts, dailyGlobalAttempts: config.dailyGlobalAttempts,
    personalDailyGlobalAttempts: config.personalDailyGlobalAttempts ?? 1000,
    maxModelCalls: PLATFORM_AGENT_RUN_LIMITS.modelCalls, maxQueryEmbeddings: PLATFORM_AGENT_RUN_LIMITS.queryEmbeddings, version: 0, updatedAt: null }, 'admin_configuration', 500);
  const readPolicyIn = async (tx: import('@google-cloud/firestore').Transaction) => {
    const row = await tx.get(policyRef);
    return row.exists ? data.open('platform-policy', 'current', scope, platformPolicySchema, row) : { ...defaults };
  };
  const readPolicy = () => options.database.runTransaction(readPolicyIn, { readOnly: true });
  async function receipt(actorId: string, rawOpId: string) {
    const opId = domainParse(z.uuid(), rawOpId);
    return options.database.runTransaction(async tx => {
      const row = await tx.get(data.ref('admin_operations', 'admin-receipt', opId));
      if (!row.exists) return null;
      const saved = data.open('admin-receipt', opId, scope, adminReceiptSchema, row);
      if (saved.actorId !== actorId) domainReject('forbidden', 403); return saved;
    }, { readOnly: true });
  }
  return { readPolicy,
    async overview() { return { policy: await readPolicy(), serverEnabled: config.enabled, platformConfigured: !!config.project,
      toolCalls: AGENT_LIMITS.toolCalls, deadlineMs: AGENT_LIMITS.deadlineMs,
      outputTokens: Math.min(config.maxOutputTokens, AGENT_LIMITS.outputTokens), inputCharacters: config.agentMaxInputCharacters ?? AGENT_INTERACTIVE_INPUT.default }; },
    receipt,
    async submit(actorId: string, raw: unknown): Promise<AdminReceipt> {
      const command = domainParse(adminCommandSchema, raw), fingerprint = firestoreDomainHash(command);
      return options.database.runTransaction(async tx => {
        const ref = data.ref('admin_operations', 'admin-receipt', command.opId), row = await tx.get(ref);
        if (row.exists) {
          const prior = data.open('admin-receipt', command.opId, scope, adminReceiptSchema, row);
          if (prior.actorId !== actorId || prior.fingerprint !== fingerprint) domainReject('operation_conflict'); return prior;
        }
        const at = new Date().toISOString(); let before: AdminReceipt['before'], result: AdminReceipt['result'];
        if (command.kind === 'policy') {
          const current = await readPolicyIn(tx);
          if (current.version !== command.expectedVersion) domainReject('version_conflict');
          before = current; result = domainParse(platformPolicySchema, { ...command.values, version: current.version + 1, updatedAt: at });
          tx.set(policyRef, data.seal('platform-policy', 'current', scope, platformPolicySchema, result));
        } else {
          ({ before, result } = await authority.adminInvitationIn(tx, command));
          const id = firestoreDomainHash(command.email), ref = data.ref('admin_invitations', 'admin-invitation', id);
          tx.set(ref, { sortKey: firestoreDomainHash(id), entityId: id, ...data.seal('admin-invitation', id, scope, adminDirectorySchema, { email: command.email }) });
        }
        const saved = { opId: command.opId, actorId, at, fingerprint, command, before, result };
        tx.create(ref, { sortKey: at + ':' + command.opId, operationId: command.opId, ...data.seal('admin-receipt', command.opId, scope, adminReceiptSchema, saved) });
        return saved;
      });
    },
    async lookup(email: string): Promise<AdminInvitation | null> {
      return options.database.runTransaction(tx => authority.readAdminInvitation(tx, email), { readOnly: true });
    },
    async invitations(cursor?: string | null) {
      const after = cursor ? domainParse(cursorSchema, cursor) : null;
      return options.database.runTransaction(async tx => {
        let q = data.collection('admin_invitations').orderBy('sortKey').limit(21); if (after) q = q.startAfter(after);
        const rows = (await tx.get(q)).docs, page = rows.slice(0, 20), items: AdminInvitation[] = [];
        for (const row of page) {
          // Directory is rebuildable. The encrypted locator is never a grant of invitation status.
          const id = domainParse(cursorSchema, row.get('entityId'));
          const entry = data.open('admin-invitation', id, scope, adminDirectorySchema, row);
          const current = await authority.readAdminInvitation(tx, entry.email); if (current) items.push(domainParse(adminInvitationSchema, current));
        }
        return { items, nextCursor: rows.length > 20 ? page.at(-1)!.get('sortKey') as string : null };
      }, { readOnly: true });
    },
    async audit(cursor?: string | null) {
      if (cursor && !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z:[a-f0-9-]{36}$/.test(cursor)) domainReject('invalid_cursor', 400);
      return options.database.runTransaction(async tx => {
        let q = data.collection('admin_operations').orderBy('sortKey', 'desc').limit(21); if (cursor) q = q.startAfter(cursor);
        const rows = (await tx.get(q)).docs, page = rows.slice(0, 20);
        return { items: page.map(row => data.open('admin-receipt', domainParse(z.uuid(), row.get('operationId')), scope, adminReceiptSchema, row)),
          nextCursor: rows.length > 20 ? page.at(-1)!.get('sortKey') as string : null };
      }, { readOnly: true });
    },
    async usage(day: string) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) domainReject('invalid_day', 400);
      const usage = (source: 'platform' | 'personal') => new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: source }).getGlobal(day);
      return { platform: await usage('platform'), personal: await usage('personal') };
    },
  };
}
export type FirestoreAdmin = ReturnType<typeof createFirestoreAdmin>;
