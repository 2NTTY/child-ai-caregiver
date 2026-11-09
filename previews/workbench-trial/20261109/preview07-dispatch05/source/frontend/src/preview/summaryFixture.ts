import {DateTime} from 'luxon';
import type {HomeChild} from '../view-model';
import type {SummaryPage, SummaryPeriod} from '../summary-view-model';
import type {TaskView} from '../task-view-model';

export const previewAppointmentId = 'a2e6b734-c2f2-4bc4-8d4b-75b04d0cfa71';
// Prewritten synthetic statistics, not a client implementation of the Server's summary service.
export function summaryFixture(child: HomeChild, period: SummaryPeriod): SummaryPage {
  const start = DateTime.fromISO(period.startDay, {zone: period.timeZone});
  const instant = start.set({hour: 9}).toISO()!;
  const task: TaskView = {id: previewAppointmentId, childId: child.id, version: 2, title: '核對家庭到診安排（合成）', details: '只屬家庭台帳示例，未向任何機構預約。', kind: 'appointment', assigneeUserId: '合成媽媽', createdBy: '合成爸爸', createdAt: instant, updatedAt: instant,
    occurrence: {id: 'preview-appointment-occurrence', dueAt: start.plus({days: 2}).set({hour: 10}).toISO()!, timeZone: period.timeZone, state: 'scheduled', terminalBasisVersion: null}};
  const records: SummaryPage['records'] = [
    {id: 'preview-summary-sleep-a', version: 2, text: '睡眠約 9.5 小時；原觀察由家長核對。', kind: 'sleep', quantity: {rawValue: '9.5', unit: 'hours', precision: 'approximate'}},
    {id: 'preview-summary-sleep-b', version: 1, text: '另一筆已確認的睡眠記錄，保留原單位。', kind: 'sleep', quantity: {rawValue: '10', unit: 'hours', precision: 'exact'}},
    {id: 'preview-summary-weight', version: 1, text: '體重記錄只供整理，不在前端判斷健康或百分位。', kind: 'measurement', quantity: {rawValue: '14.1', unit: 'kg', precision: 'exact'}},
  ].map(record => ({...record, source: '合成家庭觀察', eventTime: {rawText: '家長核對的日期與時間（合成）', at: instant, timeZone: period.timeZone, precision: 'exact'}, confirmedBy: '合成媽媽', confirmedAt: instant, reason: record.version > 1 ? '更正原觀察（合成）' : '家長已核對（合成）', createdAt: instant})) as SummaryPage['records'];
  return {childId: child.id, childName: child.displayName, canManage: child.accessRole !== 'viewer', period: {...period}, endDayExclusive: start.plus({days: period.period === 'day' ? 1 : 7}).toISODate()!, generatedAt: instant, basisVersion: 'preview-summary-basis-1',
    profile: {version: 2, ageLabel: child.ageLabel, source: '合成孩子檔案；不是 Server 資料', confirmedBy: '合成媽媽', confirmedAt: instant, reason: '合成檔案核對'},
    counts: {note: 0, feeding: 0, sleep: 2, diaper: 0, temperature: 0, measurement: 1, appointment: 0},
    metrics: [{kind: 'sleep', unit: 'hours', samples: 2, approximate: 1, total: '19.5', min: '9.5', max: '10', recordIds: records.slice(0, 2).map(item => item.id)}, {kind: 'measurement', unit: 'kg', samples: 1, approximate: 0, total: null, min: '14.1', max: '14.1', recordIds: [records[2].id]}],
    records, missing: {unknownEventTime: 2, invalidQuantities: 0, emptyKinds: ['note', 'feeding', 'diaper', 'temperature', 'appointment']}, appointments: [task], conflicts: [{...task, id: 'preview-summary-review-task', title: '來源變動後待覆核的安排（合成）', occurrence: {...task.occurrence, id: 'preview-review-occurrence', state: 'needs_review'}}],
    preparation: {version: 1, appointmentTaskId: null, questions: ['想核對哪些日常觀察需要補充？（合成已保存問題）'], checklist: [{text: '帶備已核對的原始觀察記錄（合成）', done: false}], reviewed: false, reviewedBasis: null, period: {...period}, updatedBy: '合成媽媽', updatedAt: instant}, reviewCurrent: false};
}
