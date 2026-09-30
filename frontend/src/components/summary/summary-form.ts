import {z} from 'zod';
import {DateTime} from 'luxon';
import type {PreparationDecision, SummaryBasis, SummaryPage, SummaryPeriod} from '../../summary-view-model.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromISO(value).isValid, '請填寫有效的 YYYY-MM-DD 日期。');
export const summaryPeriodSchema = z.object({startDay: day, period: z.enum(['day', 'week']), timeZone: z.string().min(1).max(80).refine(value => {try {new Intl.DateTimeFormat('en', {timeZone: value}); return true;} catch {return false;}}, '請選擇有效的 IANA 時區。')});
export const preparationFormSchema = z.object({
  appointmentTaskId: z.union([z.literal(''), z.uuid()]),
  questions: z.array(z.object({text: z.string().trim().min(1, '請填寫問題或明確移除空白欄位。').max(500, '問題最多 500 字，不會截短。')})).max(12),
  checklist: z.array(z.object({text: z.string().trim().min(1, '請填寫準備項目或明確移除空白欄位。').max(300, '準備項目最多 300 字，不會截短。'), done: z.boolean()})).max(16),
  reviewed: z.boolean(),
});
export type PreparationFormValues = z.infer<typeof preparationFormSchema>;
export const preparationDefaults = (page: SummaryPage): PreparationFormValues => ({appointmentTaskId: page.preparation.appointmentTaskId ?? '', questions: page.preparation.questions.map(text => ({text})), checklist: page.preparation.checklist.map(item => ({...item})), reviewed: page.preparation.reviewed && page.reviewCurrent});
export function preparationProjection(raw: PreparationFormValues, basis: SummaryBasis): PreparationDecision {
  // The authoritative preparation schema trims item edges. Preserve the draft and show this projection before consent.
  const values = preparationFormSchema.parse(raw);
  return {...basis, period: {...basis.period}, confirmShared: true, appointmentTaskId: values.appointmentTaskId || null,
    questions: values.questions.map(item => item.text), checklist: values.checklist.map(item => ({...item})), reviewed: values.reviewed};
}
export const summaryQueryDefaults = (): SummaryPeriod => ({startDay: DateTime.now().setZone('Asia/Hong_Kong').toISODate()!, period: 'week', timeZone: 'Asia/Hong_Kong'});
