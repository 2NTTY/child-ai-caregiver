import { AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FirestoreDomainData, domainParse, domainReject, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { AgentRunAdmission } from './agent-runtime.ts';

const uuid = z.uuid(), userId = z.string().min(1).max(256), millis = z.number().int().nonnegative();
const leaseSchema = z.object({ runId: uuid, userId, token: uuid, deadlineAtMs: millis, expiresAtMs: millis }).strict();
const schema = z.object({ leases: z.array(leaseSchema).max(4) }).strict();
export const firestoreAgentAdmissionRecoverySchema = schema;
const scope: WorkRecoveryScope = { ownerUserId: 'system:agent-admission', workspaceId: '00000000-0000-0000-0000-000000000000',
  childId: '00000000-0000-0000-0000-000000000000', storageEpoch: '00000000-0000-0000-0000-000000000000' };

/** Short, bounded global gate replaces process-local capacity. It does not authorize business data. */
export function createFirestoreAgentAdmission(options: FirestoreDomainOptions & { serverClock?: () => number }): AgentRunAdmission {
  const data = new FirestoreDomainData(options), ref = data.ref('agent_admission', 'agent-admission', 'active');
  const now = () => domainParse(millis, (options.serverClock ?? Date.now)(), 'clock', 500);
  return {
    async acquire(input) {
      domainParse(z.object({ runId: uuid, userId, deadlineAtMs: millis }).strict(), input);
      const token = randomUUID();
      const lease = await options.database.runTransaction(async tx => {
        const row = await tx.get(ref), at = now();
        if (input.deadlineAtMs <= at || input.deadlineAtMs > at + AGENT_RUN_LIMITS.deadlineSeconds.max * 1000) domainReject('invalid_run_deadline');
        const state = row.exists ? data.open('agent-admission', 'active', scope, schema, row) : { leases: [] };
        const leases = state.leases.filter(value => value.expiresAtMs > at);
        if (leases.length >= 4 || leases.some(value => value.userId === input.userId || value.runId === input.runId)) return null;
        const next = { ...input, token, expiresAtMs: input.deadlineAtMs + 5000 };
        leases.push(next); tx.set(ref, data.seal('agent-admission', 'active', scope, schema, { leases })); return next;
      });
      if (!lease) return null;
      let released = false;
      return {
        async authorize() {
          if (released || now() >= lease.deadlineAtMs) return false;
          return options.database.runTransaction(async tx => {
            const row = await tx.get(ref); if (!row.exists) return false;
            const current = data.open('agent-admission', 'active', scope, schema, row).leases.find(value => value.token === token);
            return !!current && current.runId === input.runId && current.userId === input.userId
              && current.deadlineAtMs === input.deadlineAtMs && now() < current.deadlineAtMs;
          }, { readOnly: true });
        },
        async release() {
          if (released) return;
          await options.database.runTransaction(async tx => {
            const row = await tx.get(ref); if (!row.exists) return;
            const state = data.open('agent-admission', 'active', scope, schema, row);
            const leases = state.leases.filter(value => value.token !== token);
            if (leases.length !== state.leases.length) tx.set(ref, data.seal('agent-admission', 'active', scope, schema, { leases }));
          });
          released = true;
        },
      };
    },
  };
}
