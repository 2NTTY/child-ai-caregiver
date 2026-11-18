import { z } from 'zod';
import type { AdminUsageFinance } from '../src/shared/admin.ts';
import type { ModelBillingSource } from '../src/shared/model-settings.ts';
import type { DurableAiUsageRecord } from './durable-ai-usage.ts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currencyCode = z.string().regex(/^[A-Z]{3}$/u);
const label = z.string().trim().min(1).max(128);
const identifier = z.string().min(1).max(256);
const quota = z.object({ provider: label, project: label, model: label, tier: label, source: label,
  observedAt: z.iso.datetime({ offset: true }), unit: z.enum(['RPM', 'TPM', 'RPD']), limit: count }).strict();
// A trusted operator can publish a dated platform observation without restarting the API.
export const quotaSnapshotSchema = z.object({ day: z.iso.date(), observedAt: z.iso.datetime(),
  providerQuota: z.array(quota).min(1).max(24) }).strict().refine(value =>
  value.observedAt.slice(0, 10) === value.day && value.providerQuota.every(row => row.observedAt === value.observedAt));
const rate = z.discriminatedUnion('kind', [
  // Only use this schedule when the provider prices precisely these reported units.
  z.object({ kind: z.literal('model'), priceVersion: label, uncachedInputMicrosPerMillion: count,
    cachedInputMicrosPerMillion: count, outputMicrosPerMillion: count }).strict(),
  z.object({ kind: z.enum(['embedding_input_tokens', 'embedding_characters']), priceVersion: label, microsPerMillion: count }).strict(),
]);
const lineSchema = z.object({ rootRunId: identifier, attemptKey: identifier, model: identifier, rate: rate.optional(),
  settlement: z.object({ reference: label, micros: count }).strict().optional() }).strict().refine(row => row.rate || row.settlement);

function invoiceReferences(attempts: readonly z.infer<typeof lineSchema>[]): string[] {
  return attempts.flatMap(line => line.settlement ? [line.settlement.reference] : []);
}

export const dayFinancialEvidenceSchema = z.object({ day: z.iso.date(), payer: z.enum(['platform', 'personal']),
  currency: currencyCode.optional(), attempts: z.array(lineSchema).max(100),
  approvedDailyBudget: z.object({ currency: currencyCode, micros: count, approvalReference: label,
    approvedAt: z.iso.datetime({ offset: true }) }).strict().optional(),
  providerQuota: z.array(quota).min(1).max(24).optional(),
}).strict().refine(row => {
  const ids = row.attempts.map(line => JSON.stringify([line.rootRunId, line.attemptKey]));
  const invoiceLines = invoiceReferences(row.attempts);
  return (row.attempts.length === 0 || row.currency !== undefined)
    && (!row.approvedDailyBudget || (row.payer === 'platform'
      && new Date(row.approvedDailyBudget.approvedAt).toISOString().slice(0, 10) <= row.day))
    && new Set(ids).size === ids.length && new Set(invoiceLines).size === invoiceLines.length
    && (row.providerQuota ?? []).every(quota => new Date(quota.observedAt).toISOString().slice(0, 10) === row.day);
});
export type DayFinancialEvidence = z.infer<typeof dayFinancialEvidenceSchema>;

/** Optional operator reconciliation extract. Never read credentials or contact a billing service. */
export function readFinancialEvidence(raw: string | undefined): DayFinancialEvidence[] | undefined {
  if (!raw) return undefined;
  try {
    if (Buffer.byteLength(raw) > 128 * 1024) throw new Error();
    const days = z.array(dayFinancialEvidenceSchema).max(32).parse(JSON.parse(raw));
    if (new Set(days.map(day => day.payer + '/' + day.day)).size !== days.length) throw new Error();
    const references = days.flatMap(day => invoiceReferences(day.attempts));
    if (new Set(references).size !== references.length) throw new Error();
    return days;
  } catch { throw new Error('Invalid AI_USAGE_RECONCILIATION_JSON configuration'); }
}

function pricedUnits(record: DurableAiUsageRecord | null, price: z.infer<typeof rate>): bigint | null {
  if (!record) return null;
  if (price.kind === 'model') {
    if (record.kind === 'embedding' || record.inputTokens === null || record.cachedTokens === null ||
        record.outputTokens === null || record.cachedTokens > record.inputTokens) return null;
    return BigInt(record.inputTokens - record.cachedTokens) * BigInt(price.uncachedInputMicrosPerMillion)
      + BigInt(record.cachedTokens) * BigInt(price.cachedInputMicrosPerMillion)
      + BigInt(record.outputTokens) * BigInt(price.outputMicrosPerMillion);
  }
  if (record.kind !== 'embedding') return null;
  const units = price.kind === 'embedding_input_tokens' ? record.inputTokens : record.billableCharacters;
  return units === null ? null : BigInt(units) * BigInt(price.microsPerMillion);
}
function decimalMicros(numerator: bigint) {
  const fractional = (numerator % 1000000n).toString().padStart(6, '0').replace(/0+$/u, '');
  return (numerator / 1000000n).toString() + (fractional ? '.' + fractional : '');
}
export function dailyFinance(payer: ModelBillingSource, attempts: number, evidence?: DayFinancialEvidence,
  records: readonly (DurableAiUsageRecord | null)[] = []): AdminUsageFinance {
  const result: AdminUsageFinance = { payer, estimates: [], settlement: { status: 'unknown' }, unestimatedAttempts: attempts,
    unsettledAttempts: attempts, providerQuota: evidence?.providerQuota ?? null, approvedDailyBudget: evidence?.approvedDailyBudget ?? null };
  if (!evidence?.currency) return result;
  const currency = evidence.currency;
  const versions = new Map<string, { numerator: bigint; attempts: number }>();
  let settled = 0n;
  for (const [index, line] of evidence.attempts.entries()) {
    if (line.rate) {
      const numerator = pricedUnits(records[index] ?? null, line.rate);
      if (numerator !== null) {
        const version = versions.get(line.rate.priceVersion) ?? { numerator: 0n, attempts: 0 };
        version.numerator += numerator; version.attempts++;
        versions.set(line.rate.priceVersion, version); result.unestimatedAttempts--;
      }
    }
    if (line.settlement) { settled += BigInt(line.settlement.micros); result.unsettledAttempts--; }
  }
  result.estimates = [...versions].map(([priceVersion, sum]) => ({ status: 'estimated', currency,
    micros: decimalMicros(sum.numerator), priceVersion, attempts: sum.attempts }));
  if (result.unsettledAttempts < attempts) result.settlement = { status: 'settled', currency,
    micros: settled.toString(), attempts: attempts - result.unsettledAttempts };
  return result;
}
