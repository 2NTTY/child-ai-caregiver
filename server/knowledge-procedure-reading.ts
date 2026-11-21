import type { KnowledgeEvidence, KnowledgeFilter } from '../src/shared/knowledge.ts';

/** The original stays readable in full. A search preview keeps each action alongside its printed age and unit. */
export function procedureReadingPreview(chunk: KnowledgeEvidence, filter: KnowledgeFilter): KnowledgeEvidence {
  const applicability = chunk.applicability;
  if (applicability.ageBasis !== 'per_instruction' || !applicability.ageExamples?.length) return chunk;
  const examples = applicability.ageExamples;
  const age = filter.age?.basis === 'actual' && filter.ageMatch === 'contained' ? filter.age : null;
  const matched = examples.filter(({procedure}) => {
    if (!age || !procedure) return true;
    if (procedure.relation === 'upper_group') return age.minMonths <= procedure.months;
    if (procedure.relation === 'lower_group') return age.maxMonths >= procedure.months;
    // Learning milestones and deadlines describe a sequence, not eligibility intervals.
    return true;
  });
  // A shared sentence must remain intact with every printed qualifier it contains.
  const selected = examples.filter(e => matched.some(m => e.start < m.start + m.quote.length && m.start < e.start + e.quote.length));
  if (selected.length === examples.length) return chunk;
  const excluded = examples.filter(example => !selected.includes(example));
  const original = chunk.originalText;
  let text = selected.map(example => example.quote).join('\n');
  if (original && excluded.every(e => original.slice(e.start,e.start + e.quote.length) === e.quote)) {
    const parts: string[] = [];
    let position = 0;
    for (const e of [...excluded].sort((a,b) => a.start - b.start)) {
      if (e.start > position) parts.push(original.slice(position,e.start));
      position = Math.max(position,e.start + e.quote.length);
    }
    text = parts.join('') + original.slice(position);
  }
  const intro = original?.slice(0,Math.min(...examples.map(e => e.start))).trim().slice(0,120).toWellFormed();
  const sourceExcerpt = selected[0]?.quote ?? intro ?? '';
  return {...chunk,text,sourceExcerpt,applicability:{...applicability,ageExamples:selected,
    conditions:applicability.conditions.filter(s => !excluded.some(e => s.includes(e.age.wording)))}};
}
