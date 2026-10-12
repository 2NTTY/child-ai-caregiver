import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { firestoreUsageRecoverySchemas as usage } from './firestore-ai-usage.ts';
import { firestoreRootBudgetRecoverySchema as budget } from './firestore-root-budget.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirebaseBackupDocument } from './firestore-backup.ts';

const envelopeSchema = z.object({ format: z.string(), version: z.literal(1), ciphertext: z.string().min(1) }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function check(ok: boolean) { if (!ok) throw Object.assign(new Error('Restore usage binding rejected'), { code: 'restore_usage_binding', status: 409 }); }
export function isRestoreProtocolOrUsage(namespace: string, path: string) {
  return ['_sessions/', '_adk/', '_root_budget/', '_ai_usage/'].some(suffix => path.startsWith(namespace + suffix));
}
/** Keep spent quota, including operations after the snapshot. Protocol sessions are deliberately not resumed. */
export function restoreFirestoreUsage(options: FirestoreDomainOptions, snapshots: readonly FirebaseBackupDocument[],
  current: readonly FirebaseBackupDocument[], businessRunIds: readonly string[]): FirebaseBackupDocument[] {
  const { cipher, projectId, namespace } = options, roots = new Map(businessRunIds.map(id => [hash(id), id]));
  const records = new Map<string, FirebaseBackupDocument>();
  const open = (row: FirebaseBackupDocument, format: string, aad: string) => {
    const env = envelopeSchema.parse(row.data); check(env.format === format);
    return JSON.parse(cipher.decrypt(env.ciphertext, aad)) as unknown;
  };
  const seal = (path: string, format: string, aad: string, value: unknown) => ({ path,
    data: { format, version: 1, ciphertext: cipher.encrypt(canonical(value), aad) } });
  for (const row of [...snapshots, ...current]) {
    const [collection, id, extra] = row.path.split('/'); if (collection !== namespace + '_ai_usage') continue;
    check(extra === undefined && /^(attempt|daily)_[a-f0-9]{64}$/u.test(id));
    const format = 'yuban-ai-daily-usage', aad = canonical([format, 1, projectId, collection, id]);
    const raw = open(row, format, aad), old = records.get(row.path);
    if (id.startsWith('attempt_')) {
      const value = usage.attempt.parse(raw); check(id === 'attempt_' + hash(canonical([value.request.rootRunId, value.request.attemptKey])));
      roots.set(hash(value.request.rootRunId), value.request.rootRunId);
      if (old) {
        const prior = usage.attempt.parse(open(old, format, aad));
        check(canonical(prior.request) === canonical(value.request) && prior.day === value.day && prior.billingSource === value.billingSource);
        check(!prior.record || !value.record || canonical(prior.record) === canonical(value.record));
        if (prior.record && !value.record) continue;
      }
      records.set(row.path, seal(row.path, format, aad, value));
    } else {
      const value = usage.counter.parse(raw), prior = old ? usage.counter.parse(open(old, format, aad)) : value;
      const merged = Object.fromEntries(Object.keys(value).map(key => [key, Math.max(value[key as keyof typeof value], prior[key as keyof typeof prior])]));
      records.set(row.path, seal(row.path, format, aad, usage.counter.parse(merged)));
    }
  }
  for (const row of [...snapshots, ...current]) {
    const [collection, id, extra] = row.path.split('/'); if (collection !== namespace + '_root_budget') continue;
    check(extra === undefined && /^[a-f0-9]{64}$/u.test(id));
    const rootId = roots.get(id);
    if (rootId === undefined) {
      // Legacy adapter-only budgets have no business run. Preserve their pinned ciphertext, never issue a new admission.
      const saved = envelopeSchema.parse(row.data); check(saved.format === 'yuban-root-budget');
      records.set(row.path, { path: row.path, data: saved }); continue;
    }
    const format = 'yuban-root-budget', aad = JSON.stringify([format, 1, projectId, collection, rootId]);
    const value = budget.parse(open(row, format, aad)), old = records.get(row.path);
    if (old) {
      const prior = budget.parse(open(old, format, aad)); check(prior.bindingFingerprint === value.bindingFingerprint);
      check(value.used.modelCalls >= prior.used.modelCalls && value.used.toolCalls >= prior.used.toolCalls && value.used.queryEmbeddings >= prior.used.queryEmbeddings);
    }
    records.set(row.path, seal(row.path, format, aad, { ...value, status: 'stopped' }));
  }
  return [...records.values()];
}
