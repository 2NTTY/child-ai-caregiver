import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Transaction } from '@google-cloud/firestore';
import type { PlatformPolicy } from '../src/shared/admin.ts';
import { AGENT_HIGH_WATERMARK_DEFAULTS } from '../src/shared/agent-run-limits.ts';
import { budgetAlertKeySchema, budgetAlertSchema, type BudgetAlert } from '../src/shared/budget-alerts.ts';
import { AGENT_HIGH_WATERMARK_SCOPE as scope, agentHighWatermarkDocSchema, evaluateSustainedHighWatermark,
  mergeHighWatermarkSamples, type HighWatermarkSample } from './agent-high-watermark.ts';
import { FirestoreDomainData, domainParse, domainReject } from './firestore-domain-data.ts';

const alertKind = 'agent-budget-alert';
const metricKind = 'agent-high-watermark';
const cursorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\/[a-f0-9-]{36}$/);
export type MaintainerAlertSender = () => Promise<'accepted' | 'rejected' | 'unknown' | 'not_sent'>;

export function createFirestoreBudgetAlerts(data: FirestoreDomainData, readPolicyIn: (tx: Transaction) => Promise<PlatformPolicy>) {
  const { database } = data.options;
  const alertRef = (id: string) => data.ref('agent_budget_alerts', alertKind, id);
  const envelope = (alert: BudgetAlert) => ({ sortKey: alert.openedAt + '/' + alert.id, entityId: alert.id,
    ...data.seal(alertKind, alert.id, scope, budgetAlertSchema, alert) });

  async function load(tx: Transaction, category: string) {
    const ref = data.ref('agent_metrics', metricKind, category);
    const [row, policy] = await Promise.all([tx.get(ref), readPolicyIn(tx)]);
    const prior = row.exists ? data.open(metricKind, category, scope, agentHighWatermarkDocSchema, row) : { samples: [] };
    return { ref, prior, policy: policy.highWatermark ?? AGENT_HIGH_WATERMARK_DEFAULTS, version: policy.version };
  }
  return {
    async evaluate(category: string) {
      return database.runTransaction(async tx => {
        const {prior, policy} = await load(tx, category);
        return evaluateSustainedHighWatermark(prior.samples, category, policy);
      }, {readOnly: true});
    },
    async record(sample: HighWatermarkSample, send?: MaintainerAlertSender) {
      const category = domainParse(budgetAlertKeySchema.shape.category, sample.runCategory);
      const id = randomUUID(), openedAt = new Date().toISOString();
      const result = await database.runTransaction(async tx => {
        const { ref, prior, policy, version } = await load(tx, category);
        const samples = mergeHighWatermarkSamples(prior.samples, sample, policy.windowSize);
        const evaluation = evaluateSustainedHighWatermark(samples, category, policy);
        const opening = evaluation.triggered && !prior.activeIncident;
        let activeIncident = evaluation.triggered ? prior.activeIncident ?? id : null;
        if (opening && evaluation.recommendedAction !== 'none') {
          const incident: BudgetAlert = { id, category, openedAt, policyVersion: version, policy,
            recommendedAction: evaluation.recommendedAction, triggeredDimensions: evaluation.triggeredDimensions,
            windowCount: evaluation.windowCount, highWatermarkCount: evaluation.highWatermarkCount,
            delivery: send ? 'unknown' : 'not_sent', receivedAt: null };
          tx.create(alertRef(id), envelope(incident));
        }
        tx.set(ref, data.seal(metricKind, category, scope, agentHighWatermarkDocSchema, { samples, activeIncident }));
        return { opening, evaluation };
      });
      // Only the successful opening transaction owns a send. A lost commit reply or
      // provider response leaves it unknown. Reconstructed workers never replay it.
      if (result.opening && send) {
        let delivery: BudgetAlert['delivery'];
        try { delivery = await send(); } catch { delivery = 'unknown'; }
        if (delivery !== 'unknown') await database.runTransaction(async tx => {
          const ref = alertRef(id), row = await tx.get(ref);
          if (!row.exists) return;
          const alert = data.open(alertKind, id, scope, budgetAlertSchema, row);
          if (alert.delivery === 'unknown') tx.set(ref, envelope({ ...alert, delivery }));
        });
      }
      return result.evaluation;
    },
    async list(cursor: string | null = null) {
      const after = cursor === null ? null : domainParse(cursorSchema, cursor);
      return database.runTransaction(async tx => {
        let query = data.collection('agent_budget_alerts').orderBy('sortKey', 'desc').limit(21);
        if (after) query = query.startAfter(after);
        const rows = (await tx.get(query)).docs, page = rows.slice(0, 20);
        return { items: page.map(row => data.open(alertKind, domainParse(z.uuid(), row.get('entityId')), scope, budgetAlertSchema, row)),
          nextCursor: rows.length > 20 ? String(page.at(-1)!.get('sortKey')) : null };
      }, { readOnly: true });
    },
    async ack(raw: unknown) {
      const { id, category } = domainParse(budgetAlertKeySchema, raw);
      return database.runTransaction(async tx => {
        const ref = alertRef(id), row = await tx.get(ref);
        if (!row.exists) domainReject('not_found', 404);
        const alert = data.open(alertKind, id, scope, budgetAlertSchema, row);
        if (alert.category !== category) domainReject('not_found', 404);
        if (alert.receivedAt !== null) return alert;
        const saved = { ...alert, receivedAt: new Date().toISOString() };
        tx.set(ref, envelope(saved));
        return saved;
      });
    },
  };
}
