import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparationFormSchema, preparationProjection, summaryPeriodSchema} from './summary-form.ts';
import {summaryBasisChanged} from '../../summary-view-model.ts';

test('Summary period accepts real local days and explicit IANA zones', () => {
  assert.equal(summaryPeriodSchema.safeParse({startDay: '2028-02-29', period: 'week', timeZone: 'Asia/Hong_Kong'}).success, true);
  assert.equal(summaryPeriodSchema.safeParse({startDay: '2026-02-29', period: 'week', timeZone: 'Asia/Hong_Kong'}).success, false);
  assert.equal(summaryPeriodSchema.safeParse({startDay: '2026-10-01', period: 'day', timeZone: 'invalid/time'}).success, false);
});
test('Preparation review exposes contract trimming without overwriting the raw draft or truncating items', () => {
  const raw = {appointmentTaskId: '', questions: [{text: '  核對日常觀察  '}], checklist: [{text: '  帶備原記錄  ', done: true}], reviewed: false};
  const basis = {expectedVersion: 1, basisVersion: 'original-basis', period: {startDay: '2026-10-01', period: 'week', timeZone: 'Asia/Hong_Kong'}};
  const result = preparationProjection(raw, basis);
  assert.equal(raw.questions[0].text, '  核對日常觀察  '); assert.deepEqual(result.questions, ['核對日常觀察']); assert.deepEqual(result.checklist, [{text: '帶備原記錄', done: true}]); assert.equal(result.appointmentTaskId, null); assert.equal(result.reviewed, false);
  assert.equal(preparationFormSchema.safeParse({...raw, questions: [{text: '問'.repeat(501)}]}).success, false);
  assert.equal(preparationFormSchema.safeParse({...raw, questions: Array.from({length: 13}, () => ({text: '問題'}))}).success, false);
  assert.equal(preparationFormSchema.safeParse({...raw, checklist: [{text: '', done: false}]}).success, false);
  assert.equal(preparationFormSchema.safeParse({...raw, appointmentTaskId: 'not-a-task-id'}).success, false);
  assert.equal(summaryBasisChanged(basis, {preparation: {version: 1}, basisVersion: basis.basisVersion, period: {...basis.period, period: 'day'}}), true);
});
