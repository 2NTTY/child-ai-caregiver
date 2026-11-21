import { z } from 'zod';

function sourceNumber(token: string) {
  if (/^\d+$/u.test(token)) return Number(token);
  let total = 0, digit: number | undefined;
  for (const character of token.replaceAll('兩','二').replaceAll('〇','零')) {
    if (character === '百' || character === '十') {
      total += (digit ?? 1) * (character === '百' ? 100 : 10);
      digit = undefined;
    } else {
      digit = '零一二三四五六七八九'.indexOf(character);
      if (digit < 0) return NaN;
    }
  }
  return total + (digit ?? 0);
}
// Values use the publisher's unit. An age shown in a scene does not define who may use the material.
export const printedAge = z.strictObject({
  wording: z.string().trim().min(1).max(80),
  unit: z.enum(['months','years']),
  form: z.enum(['age','range','before','from']),
  values: z.array(z.int().nonnegative().max(216)).min(1).max(2),
}).refine(age => {
  const tokens = age.wording.match(/\d+|[零〇一二兩三四五六七八九十百]+/gu) ?? [];
  return (age.unit === 'months' ? age.wording.includes('月') : age.wording.includes('歲'))
    && (age.form === 'before') === /前|以下|未滿/u.test(age.wording)
    && (age.form === 'from') === /以上|以後|起/u.test(age.wording)
    && (age.form === 'range' ? age.values.length === 2 && age.values[0]! <= age.values[1]! : age.values.length === 1)
    && tokens.length === age.values.length && tokens.every((token,index) => sourceNumber(token) === age.values[index]);
});
export const knowledgeAgeExample = z.strictObject({
  age: printedAge, quote: z.string().min(1).max(600), start: z.int().nonnegative().max(3999),
  paragraph: z.int().positive().optional(),
});
export type KnowledgeAgeExample = z.infer<typeof knowledgeAgeExample>;
