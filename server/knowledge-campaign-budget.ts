import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { z } from 'zod';

export const campaign = 'fhs-child-initial-20261120';
export const campaignModel = 'gemini-3.8-flash';
export const campaignLimitMicros = 30_000_000;
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

export function createKnowledgeCampaignBudget(database: Firestore, namespace: string) {
  const ref = database.collection(namespace + '_knowledge_campaigns').doc(campaign);
  async function status() {
    const doc = await database.runTransaction(tx => tx.get(ref));
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
      if (row.held || row.reconciliationRequired) throw Error('knowledge_campaign_reconcile_before_next_attempt');
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
  return { status, initialize, reserve };
}
