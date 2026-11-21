import { z } from 'zod';
import { printedAge, type KnowledgeAgeExample } from '../src/shared/knowledge-age-example.ts';

export const ageExampleRegistration = z.strictObject({
  scope: z.union([z.strictObject({unitKey:z.string().min(1)}),z.strictObject({scriptTitle:z.string().min(1)})]),
  age: printedAge, quote: z.string().min(1).max(600).optional(),
});
export type AgeExampleRegistration = z.infer<typeof ageExampleRegistration>;
type Unit = {id:string; originalText:string; scriptPassage?:{title:string;firstParagraph?:number}};

export function bindPublisherAgeExamples(units: readonly Unit[], registrations: readonly AgeExampleRegistration[]) {
  const result = new Map<string, KnowledgeAgeExample[]>();
  for (const registration of registrations) {
    let matches = 0;
    for (const unit of units) {
      if ('unitKey' in registration.scope ? unit.id !== registration.scope.unitKey : unit.scriptPassage?.title !== registration.scope.scriptTitle) continue;
      const original = unit.originalText, needle = registration.quote ?? registration.age.wording;
      for (let at = original.indexOf(needle); at >= 0; at = original.indexOf(needle,at + needle.length)) {
        // A short age label can be the suffix of a different age (3歲 inside 13歲).
        if (/^[\d零〇一二兩三四五六七八九十百]/u.test(needle) && /[\d零〇一二兩三四五六七八九十百.．]$/u.test(original.slice(0,at))) continue;
        const previous = original.slice(0,at).match(/[^。；！？\n]*$/u)?.[0] ?? '';
        const next = original.slice(at + needle.length).match(/^[^。；！？\n]*[。；！？]?/u)?.[0] ?? '';
        const start = registration.quote ? at : at - previous.length;
        const quote = registration.quote ?? previous + needle + next;
        if (!quote.includes(registration.age.wording)) throw Error('knowledge_script_age_example_wording');
        const paragraph = unit.scriptPassage?.firstParagraph === undefined ? undefined
          : unit.scriptPassage.firstParagraph + original.slice(0,start).split('\n').length - 1;
        const list = result.get(unit.id) ?? [];
        list.push({age:registration.age,quote,start,...(paragraph !== undefined ? {paragraph} : {})});
        result.set(unit.id,list);
        matches++;
      }
    }
    if (!matches) throw Error('knowledge_script_age_example_missing');
  }
  for (const examples of result.values()) examples.sort((a,b) => a.start - b.start || a.quote.indexOf(a.age.wording) - b.quote.indexOf(b.age.wording));
  return result;
}
