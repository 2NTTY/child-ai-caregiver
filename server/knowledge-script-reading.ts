import { z } from 'zod';
import type { KnowledgeChunkInput } from '../src/shared/knowledge.ts';
import { originalOrganizerApplicability } from './knowledge-inputs.ts';

type Unit = { id: string; originalText: string; scriptPassage?: { title: string } };
const numeric = z.strictObject({ basis: z.enum(['actual', 'corrected']), from: z.number().min(0).max(120),
  to: z.number().min(0).max(120), exclusive: z.boolean() });
const description = z.strictObject({ audience: z.union([z.enum(['lookup', 'general']), numeric]),
  conditions: z.array(z.string().min(1).max(20)).max(5), topics: originalOrganizerApplicability.shape.topics.max(3) });

export const scriptScopeInstruction = 'Return only the small metadata object for each numbered unit. The Server keeps its complete original. In conditions select existing keys from this unit’s wording (s1, s2, title or material), never copy or paraphrase the text. Include whole-unit publisher audience, age and other essential restrictions. Use general only if the entire unit is general. For a numeric interval both endpoints must be explicitly established for the whole unit; supply the actual or corrected basis and select the evidence. For one-sided, qualitative, unclear, cross-paragraph or otherwise unrepresentable scope use lookup: reading the original only. Never invent an age endpoint. Use one to three short topical slugs.';
export const scriptReviewInstruction = 'Independently compare each complete original, its official heading, audience and conditions. Candidate chunks with overview treatment are for finding and reading the quoted text only: their open search audience is not eligibility for advice. Confirm restricted units preserve the publisher wording, context and exceptions, and that each detailed unit really supports its proposed audience. Read priorHold when present and hold again if a concern still applies. Where textIsOriginal is true, text is the entire verbatim original. Keep change explanations concise.';

export function scriptReadingContract(units: readonly Unit[], materialTitle: string) {
  const inputs = units.map((unit, i) => {
    const title = unit.scriptPassage?.title ?? materialTitle;
    const wording: Record<string,string> = {title, material:materialTitle};
    // Offsets and punctuation stay in publisher order. Labels only refer to this unit.
    const pieces = unit.originalText.match(/[^。！？；\n]+[。！？；\n]*|[。！？；\n]+/gu) ?? [];
    let n = 0;
    for (const piece of pieces) {
      for (const part of piece.match(/.{1,280}/gsu) ?? []) wording['s' + (++n)] = part;
    }
    return { label:'u' + (i + 1), unit, title, wording };
  });
  const schema = z.strictObject(Object.fromEntries(inputs.map(({label}) => [label, description])));
  return { schema, inputs: inputs.map(({ label, wording }) => ({label, wording})),
    parse(raw: unknown) {
      const values = schema.parse(raw);
      return inputs.map(({label, unit, title, wording}) => {
        const {audience, conditions: keys, topics} = values[label]!;
        if (keys.some(key => !Object.hasOwn(wording,key) || !wording[key]!.trim())
          || typeof audience === 'object' && !keys.length) throw Error('knowledge_script_scope_quote');
        const conditions = [...new Set(keys.map(key => wording[key]!.trim()))];
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
