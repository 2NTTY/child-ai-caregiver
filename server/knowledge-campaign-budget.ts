import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

export const campaign = 'fhs-child-initial-20261120';
export const campaignModel = 'gemini-3.8-flash';
export const campaignLimitMicros = 30_000_000;
export const campaignCredentials = knowledgeReviewHash(['platform', 'fhs-initial-20261120', campaignModel, 'global', 'gemini-embedding-001', 'us-central1']);
// The operator selects this reviewed grant by date. No caller supplies a numeric override.
export const campaignDayAdmission = Object.freeze({ campaign, day: '2026-11-20', policyVersion: 3, attempts: 300 } as const);
export type CampaignDayAdmission = typeof campaignDayAdmission;
export function selectCampaignDayAdmission(selector: string | undefined) {
  if (selector === undefined) return undefined;
  if (selector !== campaignDayAdmission.day) throw Error('knowledge_campaign_day_not_approved');
  return campaignDayAdmission;
}
const count = z.int().nonnegative();
const balance = z.strictObject({ campaign: z.literal(campaign), limit: z.literal(campaignLimitMicros),
  model: z.literal(campaignModel), location: z.literal('global'), held: count, spent: count, attempts: count, settled: count,
  reconciliationRequired: z.literal(true).optional() }).refine(row => row.held + row.spent <= row.limit && row.settled <= row.attempts);
const attempt = z.strictObject({ kind: z.enum(['generation','embedding']), sourceId: z.string().regex(/^[a-z0-9-]{1,80}$/u),
  ceiling: count, state: z.enum(['reserved','settled']), at: z.iso.datetime(), inputTokens: count.optional(), outputTokens: count.optional(), cost: count.optional()
}).refine(row => row.state === 'settled' ? row.cost !== undefined && row.cost <= row.ceiling && row.inputTokens !== undefined && row.outputTokens !== undefined : row.cost === undefined);
export const campaignRecoverySchemas = { balance, attempt };
const prices = { input: 1.5, output: 7.5, embedding: 0.15 };
export type CampaignKind = 'generation' | 'embedding';
const retainedReceipt = z.strictObject({
  kind: attempt.shape.kind, sourceId: attempt.shape.sourceId, ceiling: attempt.shape.ceiling, at: attempt.shape.at,
  ticketId: z.uuid(), operationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const retainedCampaignReceipts = z.object({ campaign: z.literal(campaign), retained: z.array(retainedReceipt).min(1).max(251) });
type RetainedReceipt = z.infer<typeof retainedReceipt>;

export function createKnowledgeCampaignBudget(database: Firestore, namespace: string, inspected: RetainedReceipt[] = []) {
  const ref = database.collection(namespace + '_knowledge_campaigns').doc(campaign);
  const retained = inspected.map(receipt => retainedReceipt.parse(receipt));
  const excluded = new Set(retained.map(receipt => receipt.sourceId));
  if (new Set(retained.map(receipt => receipt.ticketId)).size !== retained.length || excluded.size !== retained.length)
    throw Error('knowledge_campaign_retained_receipt_mismatch');
  const retainedCeiling = retained.reduce((sum, receipt) => sum + receipt.ceiling, 0);
  const tickets = retained.map(receipt => ref.collection('attempts').doc(receipt.ticketId));
  function canAdvance(row: z.infer<typeof balance> | null, sourceId: string) {
    return Boolean(row && !row.reconciliationRequired && !excluded.has(sourceId) && row.held === retainedCeiling
      && row.attempts === row.settled + retained.length);
  }
  async function verifyRetained(tx: Transaction) {
    if (!tickets.length) return;
    const docs = await tx.getAll(...tickets);
    for (const [index, receipt] of retained.entries()) {
      const saved = attempt.safeParse(docs[index]?.data());
      if (!saved.success || saved.data.state !== 'reserved' || saved.data.sourceId !== receipt.sourceId
        || saved.data.kind !== receipt.kind || saved.data.at !== receipt.at || saved.data.ceiling !== receipt.ceiling)
        throw Error('knowledge_campaign_retained_receipt_mismatch');
    }
  }
  async function status() {
    const doc = await database.runTransaction(async tx => {
      await verifyRetained(tx);
      return tx.get(ref);
    });
    return doc.exists ? balance.parse(doc.data()) : null;
  }
  async function initialize() {
    await database.runTransaction(async tx => {
      const saved = await tx.get(ref);
      if (saved.exists) { balance.parse(saved.data()); return; }
      const earlier = await tx.get(ref.collection('attempts').limit(1));
      if (!earlier.empty) throw Error('knowledge_campaign_balance_missing');
      tx.create(ref, balance.parse({ campaign, limit: campaignLimitMicros, model: campaignModel, location: 'global',
        held: 0, spent: 0, attempts: 0, settled: 0 }));
    });
  }
  async function reserve(kind: CampaignKind, sourceId: string, maxOutputTokens: number) {
    const ticket = ref.collection('attempts').doc(randomUUID());
    // Reserve the entire model context even for a small prompt. An unknown response stays fully covered.
    const ceiling = kind === 'embedding' ? Math.ceil(2048 * prices.embedding)
      : Math.ceil(1_048_576 * prices.input + count.max(65536).parse(maxOutputTokens) * prices.output);
    await database.runTransaction(async tx => {
      const row = balance.parse((await tx.get(ref)).data());
      await verifyRetained(tx);
      if (!canAdvance(row, sourceId)) throw Error('knowledge_campaign_reconcile_before_next_attempt');
      if (row.held + row.spent + ceiling > row.limit) throw Error('knowledge_campaign_budget_exhausted');
      tx.update(ref, { held: row.held + ceiling, attempts: row.attempts + 1 });
      tx.create(ticket, { kind, sourceId, ceiling, state: 'reserved', at: new Date().toISOString() });
    });
    return async (input: unknown, output: unknown) => {
      if (!count.safeParse(input).success || !count.safeParse(output).success) throw Error('knowledge_campaign_usage_unknown');
      const cost = Math.ceil(Number(input) * (kind === 'embedding' ? prices.embedding : prices.input) + Number(output) * prices.output);
      await database.runTransaction(async tx => {
        const [root, attempt] = await tx.getAll(ref, ticket), row = balance.parse(root!.data());
        if (attempt!.get('state') !== 'reserved') throw Error('knowledge_campaign_attempt_changed');
        if (cost > ceiling || row.held < ceiling) throw Error('knowledge_campaign_settlement_invalid');
        tx.update(ref, { held: row.held - ceiling, spent: row.spent + cost, settled: row.settled + 1 });
        tx.update(ticket, { state: 'settled', inputTokens: input, outputTokens: output, cost });
      });
    };
  }
  return { status, initialize, reserve, canAdvance };
}
