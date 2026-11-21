import { randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore, Transaction } from '@google-cloud/firestore';
import type { AgentModelProvider } from './agent-model-gateway.ts';
import type { EmbeddingProvider } from './embedding-gateway.ts';
import { z } from 'zod';
import { knowledgeOperationId, knowledgeReviewHash } from './knowledge-review-assessment.ts';
import type { ManualPublicationPin } from './fhs-manual-publication.ts';

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
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const nativeRejection = z.strictObject({ httpStatus: z.int().min(400).max(599), evidenceSha256: hash });
const balance = z.strictObject({ campaign: z.literal(campaign), limit: z.literal(campaignLimitMicros),
  model: z.literal(campaignModel), location: z.literal('global'), held: count, spent: count, attempts: count, settled: count,
  reconciliationRequired: z.literal(true).optional() }).refine(row => row.held + row.spent <= row.limit && row.settled <= row.attempts);
const attempt = z.strictObject({ kind: z.enum(['generation','embedding']), sourceId: z.string().regex(/^[a-z0-9-]{1,80}$/u),
  ceiling: count, state: z.enum(['reserved','settled']), at: z.iso.datetime(), inputTokens: count.optional(), outputTokens: count.optional(), cost: count.optional(),
  operationFingerprint: hash.optional(), stageHash: hash.optional(),
  rejection: nativeRejection.extend({ legacyReceiptHash: hash.optional() }).optional(),
}).refine(row => row.rejection
  ? row.kind === 'generation' && !!row.operationFingerprint && (Boolean(row.stageHash) !== Boolean(row.rejection.legacyReceiptHash)) && row.state === 'settled'
    && row.cost === 0 && row.inputTokens === undefined && row.outputTokens === undefined
  : (!row.stageHash || !!row.operationFingerprint) && (row.state === 'settled'
  ? row.cost !== undefined && row.cost <= row.ceiling && row.inputTokens !== undefined && row.outputTokens !== undefined : row.cost === undefined));
const rejectedGeneration = z.strictObject({ ticketId: z.uuid(), sourceId: attempt.shape.sourceId,
  operationFingerprint: hash, stageHash: hash.optional(), at: attempt.shape.at, ceiling: count.positive(), rejection: nativeRejection });
const publicationBinding = z.strictObject({ sourceId: attempt.shape.sourceId, lane: z.enum(['C1', 'C2', 'C3']), sha256: hash,
  pages: z.int().positive(), operationFingerprint: hash, revision: z.uuid(), workerGeneration: z.uuid() });
export const campaignRecoverySchemas = { balance, attempt, publicationBinding };
export function matchesCampaignPublicationBinding(raw: unknown, pin: ManualPublicationPin, operation: string, revision: string, generation: string) {
  const parsed = publicationBinding.safeParse(raw);
  if (!parsed.success) return false;
  const row = parsed.data;
  return row.sourceId === pin.sourceId && row.lane === pin.lane && row.sha256 === pin.sha256 && row.pages === pin.pages
    && row.operationFingerprint === operation && row.revision === revision && row.workerGeneration === generation;
}
const prices = { input: 1.5, output: 7.5, embedding: 0.15 };
export type CampaignKind = 'generation' | 'embedding';
const retainedReceipt = z.strictObject({
  kind: attempt.shape.kind, sourceId: attempt.shape.sourceId, ceiling: attempt.shape.ceiling, at: attempt.shape.at,
  ticketId: z.uuid(), operationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const retainedCampaignReceipts = z.object({ campaign: z.literal(campaign), retained: z.array(retainedReceipt).min(1).max(251) });
type RetainedReceipt = z.infer<typeof retainedReceipt>;
export interface CampaignDispatch {
  sourceId: string;
  operationFingerprint: string;
  stageKey: string;
  assertLease(tx: Transaction): Promise<void>;
}
export function campaignTicketId(kind: CampaignKind, sourceId: string, operationFingerprint: string, stageHash: string) {
  return knowledgeOperationId('fhs-campaign-attempt/1', knowledgeReviewHash([kind, sourceId, operationFingerprint, stageHash]));
}
function legacyReceiptHash(ticketId: string, entry: Pick<RetainedReceipt, 'sourceId' | 'at' | 'ceiling'> & { operationFingerprint?: string }) {
  return knowledgeReviewHash(['fhs-inspected-generation/1', ticketId, entry.sourceId, entry.operationFingerprint, entry.at, entry.ceiling]);
}
export function matchesCampaignAttempt(ticketId: string, entry: z.infer<typeof attempt>) {
  if (entry.stageHash) return ticketId === campaignTicketId(entry.kind, entry.sourceId, entry.operationFingerprint!, entry.stageHash);
  if (entry.rejection) return z.uuidv4().safeParse(ticketId).success && entry.rejection.legacyReceiptHash === legacyReceiptHash(ticketId, entry);
  return z.uuid().safeParse(ticketId).success;
}
function ceilingFor(kind: CampaignKind, maxOutputTokens: number) {
  return kind === 'embedding' ? Math.ceil(2048 * prices.embedding)
    : Math.ceil(1_048_576 * prices.input + count.max(65536).parse(maxOutputTokens) * prices.output);
}

export function createKnowledgeCampaignBudget(database: Firestore, namespace: string, inspected: RetainedReceipt[] = []) {
  const ref = database.collection(namespace + '_knowledge_campaigns').doc(campaign);
  const retained = inspected.map(receipt => retainedReceipt.parse(receipt));
  const excluded = new Set(retained.map(receipt => receipt.sourceId));
  if (new Set(retained.map(receipt => receipt.ticketId)).size !== retained.length || excluded.size !== retained.length)
    throw Error('knowledge_campaign_retained_receipt_mismatch');
  const tickets = retained.map(receipt => ref.collection('attempts').doc(receipt.ticketId));
  function canAdvance(row: z.infer<typeof balance> | null, sourceId: string, pending = retained) {
    return Boolean(row && !row.reconciliationRequired && !excluded.has(sourceId) && row.held === pending.reduce((sum, item) => sum + item.ceiling, 0)
      && row.attempts === row.settled + pending.length);
  }
  async function verifyRetained(tx: Transaction) {
    const pending: RetainedReceipt[] = [];
    if (!tickets.length) return pending;
    const docs = await tx.getAll(...tickets);
    for (const [index, receipt] of retained.entries()) {
      const saved = attempt.safeParse(docs[index]?.data());
      if (!saved.success || saved.data.sourceId !== receipt.sourceId
        || saved.data.kind !== receipt.kind || saved.data.at !== receipt.at || saved.data.ceiling !== receipt.ceiling
        || saved.data.operationFingerprint && saved.data.operationFingerprint !== receipt.operationFingerprint)
        throw Error('knowledge_campaign_retained_receipt_mismatch');
      if (saved.data.state === 'reserved') pending.push(receipt);
      else if (!saved.data.rejection?.legacyReceiptHash || !matchesCampaignAttempt(receipt.ticketId, saved.data))
        throw Error('knowledge_campaign_retained_receipt_mismatch');
    }
    return pending;
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
  // The query and balance are read in the reservation transaction. Old unbound tickets
  // remain a global stop until their original operator has verified and attached the work.
  async function openReservations(tx: Transaction) {
    const [root, pending] = await Promise.all([tx.get(ref), tx.get(ref.collection('attempts').where('state', '==', 'reserved'))]);
    const row = balance.parse(root.data());
    const open = pending.docs.map(doc => ({ ticketId: doc.id, ...attempt.parse(doc.data()) }));
    if (row.held !== open.reduce((sum, item) => sum + item.ceiling, 0) || row.attempts - row.settled !== open.length)
      throw Error('knowledge_campaign_balance_mismatch');
    for (const item of open) {
      if (item.stageHash && item.ticketId !== campaignTicketId(item.kind, item.sourceId, item.operationFingerprint!, item.stageHash))
        throw Error('knowledge_campaign_attempt_changed');
    }
    return { row, open };
  }
  async function retainInspected() {
    await database.runTransaction(async tx => {
      await verifyRetained(tx);
      const { open } = await openReservations(tx);
      const byTicket = new Map(retained.map(item => [item.ticketId, item]));
      for (const item of open) {
        if (item.operationFingerprint) continue;
        const pin = byTicket.get(item.ticketId);
        if (!pin) throw Error('knowledge_campaign_reconcile_before_next_source');
        tx.update(ref.collection('attempts').doc(item.ticketId), { operationFingerprint: pin.operationFingerprint });
      }
    });
  }
  async function sourceStatus(sourceId: string) {
    return database.runTransaction(async tx => {
      await verifyRetained(tx);
      const { row, open } = await openReservations(tx);
      const reservations = open.filter(item => item.sourceId === sourceId);
      return { admissible: !row.reconciliationRequired && !excluded.has(sourceId) && !reservations.length && open.every(item => item.operationFingerprint),
        reservations, balance: row };
    }, {readOnly:true});
  }
  async function reserveShared(kind: CampaignKind, binding: CampaignDispatch, maxOutputTokens: number) {
    const sourceId = attempt.shape.sourceId.parse(binding.sourceId);
    const operationFingerprint = hash.parse(binding.operationFingerprint);
    const stageHash = knowledgeReviewHash(z.string().min(1).max(220).parse(binding.stageKey));
    const ticket = ref.collection('attempts').doc(campaignTicketId(kind, sourceId, operationFingerprint, stageHash));
    const ceiling = ceilingFor(kind, maxOutputTokens);
    await database.runTransaction(async tx => {
      await binding.assertLease(tx);
      await verifyRetained(tx);
      const { row, open } = await openReservations(tx);
      if ((await tx.get(ticket)).exists) throw Error('knowledge_campaign_attempt_recorded');
      if (row.reconciliationRequired || open.some(item => !item.operationFingerprint)) throw Error('knowledge_campaign_reconcile_before_next_attempt');
      if (excluded.has(sourceId) || open.some(item => item.sourceId === sourceId)) throw Error('knowledge_campaign_source_reserved');
      if (row.spent + row.held + ceiling > row.limit) throw Error('knowledge_campaign_budget_exhausted');
      tx.update(ref, { held: row.held + ceiling, attempts: row.attempts + 1 });
      tx.create(ticket, { kind, sourceId, operationFingerprint, stageHash, ceiling, state: 'reserved', at: new Date().toISOString() });
    });
    return settlement(ticket, kind, ceiling, true);
  }
  async function reserve(kind: CampaignKind, sourceId: string, maxOutputTokens: number) {
    const ticket = ref.collection('attempts').doc(randomUUID());
    // Reserve the entire model context even for a small prompt. An unknown response stays fully covered.
    const ceiling = ceilingFor(kind, maxOutputTokens);
    await database.runTransaction(async tx => {
      const row = balance.parse((await tx.get(ref)).data());
      const pending = await verifyRetained(tx);
      if (!canAdvance(row, sourceId, pending)) throw Error('knowledge_campaign_reconcile_before_next_attempt');
      if (row.held + row.spent + ceiling > row.limit) throw Error('knowledge_campaign_budget_exhausted');
      tx.update(ref, { held: row.held + ceiling, attempts: row.attempts + 1 });
      tx.create(ticket, { kind, sourceId, ceiling, state: 'reserved', at: new Date().toISOString() });
    });
    return settlement(ticket, kind, ceiling, false);
  }
  function settlement(ticket: DocumentReference, kind: CampaignKind, ceiling: number, shared: boolean) {
    return async (input: unknown, output: unknown) => {
      if (!count.safeParse(input).success || !count.safeParse(output).success) throw Error('knowledge_campaign_usage_unknown');
      const cost = Math.ceil(Number(input) * (kind === 'embedding' ? prices.embedding : prices.input) + Number(output) * prices.output);
      await database.runTransaction(async tx => {
        const [root, saved] = await tx.getAll(ref, ticket), row = balance.parse(root!.data());
        const entry = attempt.parse(saved!.data());
        if (entry.kind !== kind || entry.ceiling !== ceiling || (shared && (!entry.stageHash || !entry.operationFingerprint
          || ticket.id !== campaignTicketId(kind, entry.sourceId, entry.operationFingerprint, entry.stageHash))))
          throw Error('knowledge_campaign_attempt_changed');
        if (shared && entry.state === 'settled' && entry.inputTokens === input && entry.outputTokens === output && entry.cost === cost) return;
        if (entry.state !== 'reserved') throw Error('knowledge_campaign_attempt_changed');
        if (cost > ceiling || row.held < ceiling) throw Error('knowledge_campaign_settlement_invalid');
        tx.update(ref, { held: row.held - ceiling, spent: row.spent + cost, settled: row.settled + 1 });
        tx.update(ticket, { state: 'settled', inputTokens: input, outputTokens: output, cost });
      });
    };
  }
  // Operator reconciliation of reviewed, attributable native HTTP evidence. No provider call or work lease is started.
  async function settleRejectedGeneration(raw: unknown) {
    const proof = rejectedGeneration.parse(raw);
    let legacyHash: string | undefined;
    if (proof.stageHash) {
      if (proof.ticketId !== campaignTicketId('generation', proof.sourceId, proof.operationFingerprint, proof.stageHash))
        throw Error('knowledge_campaign_attempt_changed');
    } else {
      const pin = retained.find(receipt => receipt.ticketId === proof.ticketId);
      if (!pin || pin.kind !== 'generation' || !z.uuidv4().safeParse(proof.ticketId).success
        || pin.sourceId !== proof.sourceId || pin.operationFingerprint !== proof.operationFingerprint || pin.at !== proof.at || pin.ceiling !== proof.ceiling)
        throw Error('knowledge_campaign_retained_receipt_mismatch');
      legacyHash = legacyReceiptHash(proof.ticketId, pin);
    }
    const ticket = ref.collection('attempts').doc(proof.ticketId);
    await database.runTransaction(async tx => {
      const { row, open } = await openReservations(tx);
      const entry = attempt.parse((await tx.get(ticket)).data());
      if (entry.kind !== 'generation' || entry.sourceId !== proof.sourceId || entry.operationFingerprint !== proof.operationFingerprint
        || entry.stageHash !== proof.stageHash || entry.at !== proof.at || entry.ceiling !== proof.ceiling)
        throw Error('knowledge_campaign_attempt_changed');
      if (entry.state === 'settled') {
        if (entry.rejection?.httpStatus === proof.rejection.httpStatus && entry.rejection.evidenceSha256 === proof.rejection.evidenceSha256
          && entry.rejection.legacyReceiptHash === legacyHash) return;
        throw Error('knowledge_campaign_attempt_changed');
      }
      if (row.reconciliationRequired || entry.inputTokens !== undefined || entry.outputTokens !== undefined)
        throw Error('knowledge_campaign_reconcile_before_settlement');
      if (open.some(item => item.sourceId === proof.sourceId && item.ticketId !== proof.ticketId))
        throw Error('knowledge_campaign_source_reserved');
      tx.update(ref, { held: row.held - entry.ceiling, settled: row.settled + 1 });
      const rejection = legacyHash ? { ...proof.rejection, legacyReceiptHash: legacyHash } : proof.rejection;
      tx.update(ticket, { state: 'settled', cost: 0, rejection });
    });
  }
  function meter(binding: Omit<CampaignDispatch, 'stageKey'>, maxOutputTokens: number) {
    async function before(kind: CampaignKind, stageKey: string) {
      try { return await reserveShared(kind, { ...binding, stageKey }, kind === 'generation' ? maxOutputTokens : 0); }
      catch (error) {
        if (error instanceof Error && /^knowledge_campaign_[a-z_]+$/u.test(error.message)) Object.assign(error, { code: error.message });
        throw error;
      }
    }
    return {
      generation(provider: AgentModelProvider, stageKey: string): AgentModelProvider {
        return { ...provider, async generate(input, signal) {
          const settle = await before('generation', stageKey);
          const reply = await provider.generate(input, signal);
          const prompt = reply.usageMetadata?.promptTokenCount, total = reply.usageMetadata?.totalTokenCount;
          await settle(prompt, typeof prompt === 'number' && typeof total === 'number' ? total - prompt : null);
          return reply;
        }};
      },
      embedding(provider: EmbeddingProvider, documentHash: string): EmbeddingProvider {
        return { async embed(input, signal) {
          if (input.task !== 'RETRIEVAL_DOCUMENT') throw Error('knowledge_campaign_embedding_scope');
          const settle = await before('embedding', documentHash);
          const reply = await provider.embed(input, signal);
          await settle(reply.inputTokens, 0);
          return reply;
        }};
      },
    };
  }
  return { status, initialize, reserve, canAdvance, sourceStatus, retainInspected, reserveShared, settleRejectedGeneration, meter };
}
