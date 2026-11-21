import { z } from 'zod';
import type { KnowledgeChunkInput } from '../src/shared/knowledge.ts';
import { originalOrganizerApplicability } from './knowledge-inputs.ts';

type Unit = { id: string; originalText: string; scriptPassage?: { title: string } };
const numeric = z.strictObject({ basis: z.enum(['actual', 'corrected']), from: z.number().min(0).max(120),
  to: z.number().min(0).max(120), exclusive: z.boolean() });
const description = z.strictObject({ audience: z.union([z.enum(['lookup', 'general']), numeric]),
  conditions: z.array(z.string().min(1).max(180)).max(5), topics: originalOrganizerApplicability.shape.topics.max(3) });

export const scriptScopeInstruction = 'Return only the small metadata object for each numbered unit. The Server keeps the complete original wording as the text. For conditions copy short exact quotes from this unit, its official script title or the material title. Include any whole-unit publisher audience, age or other essential restriction. Use general only if the entire unit is general. For a numeric interval both endpoints must be explicitly established for this whole unit; supply the actual or corrected basis and quote the evidence. For one-sided, qualitative, unclear, cross-paragraph or otherwise unrepresentable scope use lookup: an original for reading only. Keep the actual wording and never invent an age endpoint. Use one to three short topical slugs.';
export const scriptReviewInstruction = 'Independently compare each complete original, its official heading, audience and conditions. Candidate chunks with overview treatment are for finding and reading the quoted text only: their open search audience is not eligibility for advice. Confirm restricted units preserve the publisher wording, context and exceptions, and that each detailed unit really supports its proposed audience. Read priorHold when present and hold again if a concern still applies. Where textIsOriginal is true, text is the entire verbatim original. Keep change explanations concise.';

export function scriptReadingContract(units: readonly Unit[], materialTitle: string) {
  const inputs = units.map((unit, i) => ({ label: 'u' + (i + 1), unit }));
  const schema = z.strictObject(Object.fromEntries(inputs.map(({label}) => [label, description])));
  return { schema, inputs: inputs.map(({ label, unit }) => ({ label, title: unit.scriptPassage?.title ?? materialTitle, original: unit.originalText })),
    parse(raw: unknown) {
      const values = schema.parse(raw);
      return inputs.map(({label, unit}) => {
        const {audience, conditions, topics} = values[label]!;
        const title = unit.scriptPassage?.title ?? materialTitle;
        if (conditions.some(quote => ![unit.originalText, title, materialTitle].some(source => source.includes(quote)))
          || typeof audience === 'object' && !conditions.length) throw Error('knowledge_script_scope_quote');
        const applicability: KnowledgeChunkInput['applicability'] = originalOrganizerApplicability.parse({ region: 'HK', topics, conditions,
          ageBasis: typeof audience === 'object' ? audience.basis : 'any',
          minAgeMonths: typeof audience === 'object' ? audience.from : null,
          maxAgeMonths: typeof audience === 'object' ? audience.to : null,
          ...(typeof audience === 'object' && audience.exclusive ? { maxAgeMonthsExclusive: true } : {}) });
        const treatment: KnowledgeChunkInput['treatment'] = audience === 'lookup' ? {kind:'overview',policyVersion:1} : undefined;
        if (audience === 'lookup') applicability.use = 'original_lookup';
        return { unitId:unit.id, section:[...title].slice(0,100).join(''), text:unit.originalText,
          keywords:[title.slice(0,80).toWellFormed()], applicability, ...(treatment ? {treatment} : {}) };
      });
    } };
}
