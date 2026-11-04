import { z } from 'zod';
import { importProvenanceSchema, type ImportProvenance } from '../src/shared/import-provenance.ts';

const instant = z.iso.datetime({ offset: true });
export const summarySourcePeriodSchema = z.object({ from: instant, to: instant }).strict()
  .refine(({ from, to }) => Date.parse(from) <= Date.parse(to));
export type SummarySourcePeriod = z.infer<typeof summarySourcePeriodSchema>;

/** A date belongs to the snapshot being disclosed. Import and expiry do not date its contents. */
export function factContentDate(value: { contentUpdatedAt?: string | null; version: number; createdAt: string;
  status: string; confirmedAt: string | null; importedFrom?: unknown }) {
  if (value.contentUpdatedAt !== undefined) return value.contentUpdatedAt;
  if (value.importedFrom) return null;
  if (value.version === 1) return value.createdAt;
  return value.status === 'confirmed' ? value.confirmedAt : null;
}

export function memoryUpdateDate(section: 'instructions' | 'memory_topics', value: { updatedAt: string; importedFrom?: ImportProvenance }) {
  const links = value.importedFrom;
  if (!links || value.updatedAt !== links.current.importedAt) return value.updatedAt;
  // Old imports stamped the copy with the import time. Topic provenance carries updatedAt;
  // instruction provenance carries createdAt, which dates only the first version.
  const link = links.current.source;
  if (link.section !== section || section === 'instructions' && link.resourceVersion !== 1) return null;
  if (!link.createdAt || links.previous.some(prior => prior.importedAt === link.createdAt)) return null;
  return link.createdAt;
}

/** Include the dates of explicit corrections supplied to the model as well as its original messages. */
export function summarySourcePeriod(messages: readonly { createdAt: string }[], corrections: readonly unknown[] = []): SummarySourcePeriod | undefined {
  if (!messages.length) return undefined;
  const dates = messages.map(message => Date.parse(message.createdAt));
  for (const correction of corrections) {
    const change = z.object({ kind: z.enum(['profile', 'fact', 'topic', 'care']), current: z.record(z.string(), z.unknown()) }).safeParse(correction);
    if (!change.success) return undefined;
    const { kind, current } = change.data;
    let value: unknown;
    switch (kind) {
      case 'profile': value = current.confirmedAt; break;
      case 'topic': {
        const topic = z.object({ updatedAt: instant, importedFrom: importProvenanceSchema.optional() }).safeParse(current);
        if (!topic.success) return undefined;
        value = memoryUpdateDate('memory_topics', topic.data);
        break;
      }
      case 'care': value = z.object({ eventTime: z.object({ at: instant }) }).safeParse(current.details).data?.eventTime.at; break;
      case 'fact': {
        const fact = z.object({ version: z.number().int(), status: z.string(), confirmedAt: instant.nullable(), createdAt: instant,
          contentUpdatedAt: instant.nullable().optional(), importedFrom: z.unknown().optional() }).safeParse(current);
        if (!fact.success) return undefined;
        value = factContentDate(fact.data);
        break;
      }
    }
    const at = instant.safeParse(value);
    if (!at.success) return undefined;
    dates.push(Date.parse(at.data));
  }
  if (!dates.every(Number.isFinite)) return undefined;
  return { from: new Date(Math.min(...dates)).toISOString(), to: new Date(Math.max(...dates)).toISOString() };
}
